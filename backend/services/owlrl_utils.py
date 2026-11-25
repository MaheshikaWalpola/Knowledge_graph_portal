"""
Helpers for running owlrl (OWL 2 RL reasoning in pure Python) safely from the web backend.

- remove_haskey: the workaround for owlrl's owl:hasKey bug.
- OwlrlWorkerPool: runs the OWL RL closure in a few reused worker processes, so a slow or
  runaway closure can be stopped after a timeout (a Python thread can't be killed).
"""
import multiprocessing as mp
import os
import queue
import threading
import time
from typing import List, Tuple

from rdflib import OWL, Graph, URIRef

# owlrl records each inconsistency it finds as a triple with this predicate and a message string.
OWLRL_ERROR = URIRef("http://www.daml.org/2002/03/agents/agent-ont#error")

_DEFAULT_OWLRL_MAX_TRIPLES = 50_000


def owlrl_max_triples() -> int:
    """Largest graph OWL RL is run on (REASONING_OWLRL_MAX_TRIPLES, default 50,000)."""
    try:
        return int(os.getenv("REASONING_OWLRL_MAX_TRIPLES", _DEFAULT_OWLRL_MAX_TRIPLES))
    except ValueError:
        return _DEFAULT_OWLRL_MAX_TRIPLES


def remove_haskey(graph: Graph) -> List[Tuple]:
    """
    Remove every owl:hasKey statement from `graph` (in place) and return the removed triples.

    owlrl 7.6.2's owl:hasKey rule (prp-key) has an off-by-one bug: for a key of one property it
    compares no values at all, so it declares all members of the class owl:sameAs each other.
    With probe individuals that merges unrelated classes and creates false errors.

    NOTE: this duplicates the workaround in services/reasoning_service.py on the
    validation_reasoning branch. Once both branches are in main, merge them into one helper.
    """
    held = list(graph.triples((None, OWL.hasKey, None)))
    for triple in held:
        graph.remove(triple)
    return held


# ─── Worker processes ──────────────────────────────────────────────────────


def _worker_main(conn) -> None:
    """Worker loop: receive N-Triples, run the OWL RL closure, send back the error messages."""
    import owlrl  # imported here so the parent only pays for it once per worker

    while True:
        try:
            job = conn.recv()
        except (EOFError, OSError):
            return
        if job is None:
            return
        try:
            g = Graph()
            g.parse(data=job, format="nt")
            owlrl.DeductiveClosure(owlrl.OWLRL_Semantics, axiomatic_triples=False,
                                   datatype_axioms=False).expand(g)
            conn.send(("ok", sorted({str(o) for o in g.objects(None, OWLRL_ERROR)})))
        except Exception as e:  # report it and stay alive for the next job
            conn.send(("error", f"{type(e).__name__}: {e}"))


class OwlrlTimeout(Exception):
    """The closure did not finish in time (or no worker became free in time)."""


class OwlrlWorkerError(Exception):
    """The worker failed or died while reasoning."""


class _Worker:
    def __init__(self, process, conn):
        self.process = process
        self.conn = conn

    def stop(self) -> None:
        try:
            self.conn.close()
        except OSError:
            pass
        if self.process.is_alive():
            self.process.terminate()
            self.process.join(1)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(1)


class OwlrlWorkerPool:
    """
    A small pool of reused worker processes (started on first use).

    Each job runs in one worker. If it takes longer than the timeout, that worker is killed and
    a fresh one is started for the next job, so one runaway ontology can't block the pool.
    Workers use the 'spawn' start method: forking a multi-threaded server process is unsafe.
    """

    def __init__(self, size: int = 2):
        self._size = max(1, size)
        self._ctx = mp.get_context("spawn")
        self._idle: "queue.Queue[_Worker]" = queue.Queue()
        self._lock = threading.Lock()
        self._count = 0

    def _spawn(self) -> _Worker:
        parent_conn, child_conn = self._ctx.Pipe()
        process = self._ctx.Process(target=_worker_main, args=(child_conn,), daemon=True,
                                    name="owlrl-worker")
        process.start()
        child_conn.close()
        return _Worker(process, parent_conn)

    def _discard(self, worker: _Worker) -> None:
        worker.stop()
        with self._lock:
            self._count -= 1

    def _acquire(self, timeout: float) -> _Worker:
        deadline = time.monotonic() + timeout
        while True:
            try:
                worker = self._idle.get_nowait()
            except queue.Empty:
                worker = None
                with self._lock:
                    can_start = self._count < self._size
                    if can_start:
                        self._count += 1
                if can_start:
                    try:
                        return self._spawn()
                    except Exception:
                        with self._lock:
                            self._count -= 1
                        raise
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise OwlrlTimeout("All reasoning workers are busy")
                try:
                    worker = self._idle.get(timeout=remaining)
                except queue.Empty:
                    raise OwlrlTimeout("All reasoning workers are busy")
            if worker.process.is_alive():
                return worker
            self._discard(worker)  # died while idle: replace it

    def run_closure(self, ntriples: str, timeout: float) -> List[str]:
        """Run the OWL RL closure on `ntriples` and return owlrl's error messages."""
        deadline = time.monotonic() + timeout
        worker = self._acquire(timeout)
        try:
            worker.conn.send(ntriples)
            if not worker.conn.poll(max(deadline - time.monotonic(), 0.05)):
                self._discard(worker)
                raise OwlrlTimeout(f"OWL RL reasoning took longer than {timeout:g}s")
            status, payload = worker.conn.recv()
        except (EOFError, OSError, BrokenPipeError) as e:
            self._discard(worker)
            raise OwlrlWorkerError(f"Reasoning worker stopped unexpectedly: {e}") from e
        self._idle.put(worker)
        if status != "ok":
            raise OwlrlWorkerError(payload)
        return payload

    def shutdown(self) -> None:
        while True:
            try:
                worker = self._idle.get_nowait()
            except queue.Empty:
                return
            self._discard(worker)


_pool = None
_pool_lock = threading.Lock()


def get_worker_pool() -> OwlrlWorkerPool:
    """The process-wide pool (size from ONTOLOGY_CHECK_WORKERS, default 2)."""
    global _pool
    with _pool_lock:
        if _pool is None:
            try:
                size = int(os.getenv("ONTOLOGY_CHECK_WORKERS", "2"))
            except ValueError:
                size = 2
            _pool = OwlrlWorkerPool(size)
        return _pool
