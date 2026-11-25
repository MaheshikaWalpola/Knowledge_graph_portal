"""
Tests for the timing log (services.run_log_service) and the router's _timed hook that writes it:
every run of a validation-page step becomes one Mongo document with its duration and status, the rounds
summary carries the per-step times, and a generated shape records how long its model call took.
"""

import asyncio
import unittest
from unittest.mock import patch

from services import generation_log_service as genlog
from services import run_log_service as runlog
from routers.validation_router import _timed, _round_of
from tests.test_generation_log import FakeCollection, FakeLLM, run_generation, CONTEXT, VALID_SHAPE
from services.validation_service import ValidationService


class TestRunLog(unittest.TestCase):

    def setUp(self):
        self.runs = FakeCollection()
        self.gens = FakeCollection()
        self.patchers = [patch.object(runlog, "_col", lambda: self.runs), patch.object(genlog, "_col", lambda: self.gens)]
        for p in self.patchers:
            p.start()

    def tearDown(self):
        for p in self.patchers:
            p.stop()

    def test_log_run_has_every_field(self):
        row = runlog.log_run(user_email="me@example.org", step="shacl_generation", duration_ms=631000, round_id="r1",
                             model_id="Qwen3.6-35B-A3B-MLX-8bit", schema_id="CMPO_1", target="workspace", count=20)
        self.assertEqual(set(runlog.FIELDS) - set(row), set(), "a documented field is missing")
        self.assertEqual((row["status"], row["error"], row["duration_ms"]), ("completed", None, 631000))
        self.assertLess(row["started_at"], row["finished_at"])
        with self.assertRaises(ValueError):
            runlog.log_run(user_email="me@example.org", step="something_else", duration_ms=1)

    def test_list_runs_filters(self):
        runlog.log_run(user_email="me@example.org", step="shacl_generation", duration_ms=10, round_id="r1", model_id="m1")
        runlog.log_run(user_email="me@example.org", step="validation", duration_ms=20, round_id="r1")
        runlog.log_run(user_email="me@example.org", step="validation", duration_ms=30, round_id="r2", status="error", error="boom")
        runlog.log_run(user_email="someone@else.org", step="validation", duration_ms=40, round_id="r1")
        mine = runlog.list_runs(user_email="me@example.org")
        self.assertEqual(mine["total"], 3)
        self.assertEqual(runlog.list_runs(user_email="me@example.org", round_id="r1")["total"], 2)
        self.assertEqual(runlog.list_runs(user_email="me@example.org", step="validation", status="error")["entries"][0]["error"], "boom")
        self.assertEqual(runlog.list_runs(user_email="me@example.org", model="m1")["total"], 1)

    def test_timings_by_round_sums_completed_runs_per_step(self):
        runlog.log_run(user_email="me", step="shacl_generation", duration_ms=100, round_id="r1")
        runlog.log_run(user_email="me", step="shacl_verification", duration_ms=200, round_id="r1")
        runlog.log_run(user_email="me", step="shacl_verification", duration_ms=50, round_id="r1")  # verified again
        runlog.log_run(user_email="me", step="validation", duration_ms=999, round_id="r1", status="aborted")  # not counted
        runlog.log_run(user_email="me", step="validation", duration_ms=70, round_id="r2")
        self.assertEqual(runlog.timings_by_round(["r1", "r2", None]),
                         {"r1": {"shacl_generation": 100, "shacl_verification": 250}, "r2": {"validation": 70}})
        self.assertEqual(runlog.timings_by_round([]), {})

    def test_timed_writes_a_row_for_completed_error_and_aborted_runs(self):
        run = {"step": "shacl_generation", "user_email": "me@example.org", "model_id": "m1", "count": 3}
        with _timed("gen", run=run):
            run["round_id"] = "r1"
            run["detail"] = {"rules": 3, "shapes_logged": 3}
        with self.assertRaises(RuntimeError):
            with _timed("gen", run={"step": "validation", "user_email": "me@example.org"}):
                raise RuntimeError("boom")
        with self.assertRaises(asyncio.CancelledError):
            with _timed("gen", run={"step": "shacl_verification", "user_email": "me@example.org"}):
                raise asyncio.CancelledError()
        with _timed("no log, no run dict"):
            pass
        rows = {d["step"]: d for d in self.runs.docs}
        self.assertEqual(len(self.runs.docs), 3)
        self.assertEqual((rows["shacl_generation"]["status"], rows["shacl_generation"]["round_id"], rows["shacl_generation"]["detail"]),
                         ("completed", "r1", {"rules": 3, "shapes_logged": 3}))
        self.assertEqual((rows["validation"]["status"], rows["validation"]["error"]), ("error", "RuntimeError: boom"))
        self.assertEqual(rows["shacl_verification"]["status"], "aborted")
        self.assertTrue(all(d["duration_ms"] >= 0 for d in self.runs.docs))

    def test_round_of_reads_the_round_from_a_logged_shape(self):
        raw = genlog.log_generation(user_email="me@example.org", statement_text="rule", model_id="m1", shape_ttl=VALID_SHAPE,
                                    round_id="r9")
        self.assertEqual(_round_of([None, raw["generation_id"]], "me@example.org"), "r9")
        self.assertIsNone(_round_of([None, "missing"], "me@example.org"))
        self.assertIsNone(_round_of(None, "me@example.org"))

    def test_rounds_summary_carries_the_step_times(self):
        service = ValidationService()
        service.llm = FakeLLM()
        completed = [e for e in run_generation(service, ["Every pressure value must be at least 0"], "m1", CONTEXT)
                     if e["status"] == "completed"][0]
        round_id = completed["round_id"]
        runlog.log_run(user_email="me@example.org", step="shacl_generation", duration_ms=631000, round_id=round_id)
        runlog.log_run(user_email="me@example.org", step="shacl_verification", duration_ms=1428600, round_id=round_id)
        runlog.log_run(user_email="me@example.org", step="validation", duration_ms=637200, round_id=round_id)
        entry = genlog.list_rounds(user_email="me@example.org")["entries"][0]
        self.assertEqual(entry["timings_ms"], {"shacl_generation": 631000, "shacl_verification": 1428600, "validation": 637200})
        # the shape row records its own model-call time
        shape = genlog.get_generation(completed["generation_ids"][0])
        self.assertIsInstance(shape["duration_ms"], int)
        self.assertGreaterEqual(shape["duration_ms"], 0)


if __name__ == "__main__":
    unittest.main()
