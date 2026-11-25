"""
Live ontology checks for the canvas: checks the ontology itself while it is being built.

1. Consistency (errors): a quick OWL RL check. OWL RL finds nothing in an ontology without
   instance data, so one "probe" individual is added per named class before the closure is run;
   a contradiction then shows up as an owlrl error about that probe (e.g. a class under two
   disjoint classes). This is NOT complete OWL 2 DL reasoning: many contradictions are missed.
2. Pitfalls (warnings): SHACL meta-shapes (ontology/ontology_check/meta_shapes.ttl) and one SPARQL
   query per check (ontology/ontology_check/pitfall_queries/*.rq), in the style of OOPS!.

The check is read-only: it works on copies and never writes to GraphDB.
"""
import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from pyshacl import validate as shacl_validate
from rdflib import OWL, RDF, RDFS, XSD, Graph, Namespace, URIRef
from rdflib.namespace import SH

from services.owlrl_utils import (
    OwlrlTimeout,
    OwlrlWorkerError,
    get_worker_pool,
    owlrl_max_triples,
    remove_haskey,
)

logger = logging.getLogger(__name__)

CHECK_DIR = Path(__file__).resolve().parent.parent / "ontology" / "ontology_check"
KGPC = Namespace("urn:kgp:ontology-check#")

CONSISTENCY_METHOD = "owlrl-probe"
CONSISTENCY_NOTE = ("Errors come from a quick OWL RL consistency check, not complete OWL 2 DL "
                    "reasoning, so some contradictions are not found.")

# Terms from these vocabularies are never reported or probed.
_BUILTIN_NS = (str(RDF), str(RDFS), str(OWL), str(XSD), str(SH))
_PROPERTY_TYPES = (OWL.ObjectProperty, OWL.DatatypeProperty, OWL.AnnotationProperty, RDF.Property)

# Probe individuals use their own URN scheme with a per-run id, so they can't clash with real IRIs.
_PROBE_PREFIX = "urn:kgp-probe:"
_PROBE_RE = re.compile(r"urn:kgp-probe:[0-9a-f]{32}:\d+")
_IRI_RE = re.compile(r"(?:https?|urn|file|tag):[^\s,;()<>\[\]\"']+")
_DISJOINT_RE = re.compile(r"Disjoint classes (\S+) and (\S+) have a common individual (\S+)")

_MAX_RAW_REPORT_CHARS = 500_000  # keeps the stored MongoDB record well under the 16 MB limit


def check_timeout_seconds() -> float:
    """How long the OWL RL closure may take (ONTOLOGY_CHECK_TIMEOUT_S, default 20)."""
    try:
        return float(os.getenv("ONTOLOGY_CHECK_TIMEOUT_S", "20"))
    except ValueError:
        return 20.0


class OntologyParseError(ValueError):
    """The submitted ontology could not be parsed."""


def parse_ontology(text: str, fmt: str = "turtle") -> Graph:
    if not text or not text.strip():
        raise OntologyParseError("The ontology is empty.")
    g = Graph()
    try:
        g.parse(data=text, format=fmt)
    except Exception as e:
        raise OntologyParseError(str(e)) from e
    return g


def _copy(graph: Graph) -> Graph:
    copy = Graph()
    for prefix, namespace in graph.namespaces():
        copy.bind(prefix, namespace)
    for triple in graph:
        copy.add(triple)
    return copy


def _is_builtin(iri: str) -> bool:
    return iri.startswith(_BUILTIN_NS)


def _short(iri: str) -> str:
    return iri.rstrip("#/").rsplit("#", 1)[-1].rsplit("/", 1)[-1] or iri


# ─── 1. Consistency (errors) ───────────────────────────────────────────────


def _named_classes(g: Graph) -> List[URIRef]:
    """Named, non-built-in classes: declared ones plus anything used as a class in an axiom."""
    candidates = set(g.subjects(RDF.type, OWL.Class)) | set(g.subjects(RDF.type, RDFS.Class))
    for pred in (RDFS.subClassOf, OWL.equivalentClass, OWL.disjointWith):
        for s, o in g.subject_objects(pred):
            candidates.update((s, o))
    properties = {s for t in _PROPERTY_TYPES for s in g.subjects(RDF.type, t)}
    return sorted(c for c in candidates
                  if isinstance(c, URIRef) and not _is_builtin(str(c)) and c not in properties)


def _map_owlrl_error(message: str, probes: Dict[str, str]) -> Dict[str, Any]:
    """Turn an owlrl error string into a problem on the class(es) it involves, without probes."""
    probe_classes = [probes[p] for p in _PROBE_RE.findall(message) if p in probes]
    detail = _PROBE_RE.sub(lambda m: f"[member of {probes.get(m.group(0), 'unknown class')}]", message)

    match = _DISJOINT_RE.search(message)
    if match and probe_classes:
        iri = probe_classes[0]
        a, b = match.group(1), match.group(2)
        text = (f"Disjoint classes {_short(a)} and {_short(b)} have a common member, "
                f"so {_short(iri)} can never have members")
        related = [x for x in (a, b) if x != iri]
    else:
        iris = [x.rstrip(".") for x in _IRI_RE.findall(detail)]
        iri = probe_classes[0] if probe_classes else (iris[0] if iris else None)
        related = list(dict.fromkeys(x for x in iris if x != iri))
        text = f"OWL RL found a contradiction: {detail}"
    return {"iri": iri, "severity": "error", "source": "owlrl", "code": "CONSISTENCY",
            "message": text, "related": related, "detail": detail}


def check_consistency(onto: Graph, timeout: Optional[float] = None) -> Dict[str, Any]:
    """
    Quick OWL RL consistency check with one probe individual per named class.

    Returns {problems, notes, checked, raw_errors}; `checked` is False when the check was skipped.
    """
    notes: List[str] = []
    limit = owlrl_max_triples()
    if len(onto) > limit:
        notes.append(f"The ontology has {len(onto):,} triples, more than the OWL RL limit of "
                     f"{limit:,} (REASONING_OWLRL_MAX_TRIPLES), so the consistency check was skipped.")
        return {"problems": [], "notes": notes, "checked": False, "raw_errors": []}

    g = _copy(onto)
    if remove_haskey(g):
        notes.append("owl:hasKey statements were left out of the consistency check "
                     "(owlrl would wrongly merge members of keyed classes).")

    run_id = uuid4().hex
    probes: Dict[str, str] = {}
    for i, cls in enumerate(_named_classes(g)):
        probe = URIRef(f"{_PROBE_PREFIX}{run_id}:{i}")
        g.add((probe, RDF.type, cls))
        probes[str(probe)] = str(cls)

    timeout = check_timeout_seconds() if timeout is None else timeout
    try:
        raw_errors = get_worker_pool().run_closure(g.serialize(format="nt"), timeout)
    except OwlrlTimeout as e:
        notes.append(f"The consistency check was stopped: {e}.")
        return {"problems": [], "notes": notes, "checked": False, "raw_errors": []}
    except OwlrlWorkerError as e:
        logger.warning("OWL RL consistency check failed: %s", e)
        notes.append(f"The consistency check failed: {str(e)[:200]}")
        return {"problems": [], "notes": notes, "checked": False, "raw_errors": []}

    problems, seen = [], set()
    for message in raw_errors:
        problem = _map_owlrl_error(message, probes)
        key = (problem["iri"], problem["message"])
        if key not in seen:
            seen.add(key)
            problems.append(problem)
    return {"problems": problems, "notes": notes, "checked": True, "raw_errors": raw_errors}


# ─── 2. Pitfalls (warnings) ────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _meta_shapes() -> Graph:
    g = Graph()
    g.parse(CHECK_DIR / "meta_shapes.ttl", format="turtle")
    return g


@lru_cache(maxsize=1)
def _pitfall_queries() -> Tuple[Dict[str, Any], ...]:
    """Load the .rq files; each starts with '# code:', '# message:' and optionally '# manual_only:'."""
    queries = []
    for path in sorted((CHECK_DIR / "pitfall_queries").glob("*.rq")):
        text = path.read_text(encoding="utf-8")
        header = dict(re.findall(r"^#\s*(code|message|manual_only):\s*(.+?)\s*$", text, re.MULTILINE))
        if "code" not in header or "message" not in header:
            raise ValueError(f"{path.name} needs '# code:' and '# message:' header lines")
        queries.append({"code": header["code"], "message": header["message"],
                        "manual_only": header.get("manual_only", "").lower() == "true",
                        "query": text, "file": path.name})
    return tuple(queries)


def _run_meta_shapes(g: Graph) -> Tuple[List[Dict[str, Any]], str]:
    shapes = _meta_shapes()
    _, report, _ = shacl_validate(g, shacl_graph=shapes, inference="none",
                                  allow_warnings=True, advanced=False, meta_shacl=False)
    problems = []
    for result in report.subjects(RDF.type, SH.ValidationResult):
        focus = report.value(result, SH.focusNode)
        source = report.value(result, SH.sourceShape)
        code = shapes.value(source, KGPC.code)
        if not isinstance(focus, URIRef) or code is None:
            continue
        message = shapes.value(source, SH.message) or report.value(result, SH.resultMessage)
        problems.append({"iri": str(focus), "severity": "warning", "source": "meta-shacl",
                         "code": str(code), "message": str(message), "related": []})
    return problems, report.serialize(format="turtle")[:_MAX_RAW_REPORT_CHARS]


def _run_sparql_checks(g: Graph, trigger: str) -> Tuple[List[Dict[str, Any]], Dict[str, List]]:
    problems: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    raw_rows: Dict[str, List] = {}
    for check in _pitfall_queries():
        if check["manual_only"] and trigger != "manual":
            continue
        rows = list(g.query(check["query"]))
        raw_rows[check["code"]] = [{str(k): str(v) for k, v in row.asdict().items()} for row in rows]
        for row in rows:
            values = row.asdict()
            iri = values.get("iri")
            if not isinstance(iri, URIRef) or _is_builtin(str(iri)):
                continue
            detail = str(values["detail"]) if values.get("detail") is not None else ""
            key = (check["code"], str(iri), detail)
            problem = problems.setdefault(key, {
                "iri": str(iri), "severity": "warning", "source": "sparql", "code": check["code"],
                "message": check["message"].replace("{detail}", detail), "related": []})
            related = values.get("related")
            if related is not None and str(related) not in problem["related"]:
                problem["related"].append(str(related))
    return list(problems.values()), raw_rows


def check_pitfalls(onto: Graph, trigger: str = "manual") -> Dict[str, Any]:
    """Modelling pitfalls (all severity 'warning'). PF05 only runs when trigger == 'manual'."""
    g = _copy(onto)
    shacl_problems, report_ttl = _run_meta_shapes(g)
    sparql_problems, raw_rows = _run_sparql_checks(g, trigger)
    return {"problems": shacl_problems + sparql_problems,
            "raw": {"pyshacl_report_ttl": report_ttl, "sparql_rows": raw_rows}}


# ─── Combined check ────────────────────────────────────────────────────────


def run_check(onto: Graph, trigger: str = "manual",
              timeout: Optional[float] = None) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Run both checks on `onto` (left unchanged). Returns (result for the client, raw outputs).
    """
    consistency = check_consistency(onto, timeout=timeout)
    pitfalls = check_pitfalls(onto, trigger=trigger)

    problems = consistency["problems"] + pitfalls["problems"]
    problems.sort(key=lambda p: (p["severity"] != "error", p["code"], p["iri"] or ""))
    notes = [CONSISTENCY_NOTE] + consistency["notes"]
    if trigger != "manual":
        notes.append("Unconnected classes (PF05) are only checked when you run the check manually.")

    result = {
        "check_id": str(uuid4()),
        "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "consistency_method": CONSISTENCY_METHOD,
        "complete_dl_reasoning": False,
        "consistency_checked": consistency["checked"],
        "trigger": trigger,
        "triples_checked": len(onto),
        "summary": {"errors": sum(p["severity"] == "error" for p in problems),
                    "warnings": sum(p["severity"] == "warning" for p in problems)},
        "problems": problems,
        "notes": notes,
    }
    raw = {"owlrl_errors": consistency["raw_errors"], **pitfalls["raw"]}
    return result, raw


# ─── Storage (MongoDB) ─────────────────────────────────────────────────────


def ttl_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _checks_collection():
    # Imported lazily: importing mongo_service connects to MongoDB to create indexes.
    from services.mongo_service import ontology_checks_collection
    return ontology_checks_collection


def store_check(*, user_email: str, schema_id: Optional[str], source: str, ttl_hash: str,
                result: Dict[str, Any], raw: Dict[str, Any]) -> bool:
    """
    Insert one record per run (earlier runs are never changed). Skipped, returning False, when the
    latest record for this user and schema has the same ontology hash and trigger, since the result
    would be the same (a manual run adds PF05, so it is stored even after an auto run).
    """
    collection = _checks_collection()
    latest = collection.find_one({"user_email": user_email, "schema_id": schema_id},
                                 sort=[("checked_at", -1)],
                                 projection={"ttl_sha256": 1, "trigger": 1})
    if latest and latest.get("ttl_sha256") == ttl_hash and latest.get("trigger") == result["trigger"]:
        return False
    collection.insert_one({
        "check_id": result["check_id"],
        "user_email": user_email,
        "schema_id": schema_id,
        "source": source,
        "trigger": result["trigger"],
        "ttl_sha256": ttl_hash,
        "checked_at": result["checked_at"],
        "result": result,
        "raw": raw,
    })
    return True
