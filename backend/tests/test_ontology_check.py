"""
Tests for the live ontology check on the canvas (services/ontology_check_service.py):
1. Consistency (OWL RL with probe individuals): the SmartWafer contradiction, the owl:hasKey
   regression, probes never leak, triple limit and timeout
2. Pitfalls (meta-SHACL and SPARQL): PF01/PF02, PF04, PF05 (manual only), PF08-PF12
3. The check never changes its input; runs are stored in MongoDB without duplicates
4. POST /ontology/check: canvas and stored sources, and clean rejection of bad input
"""

import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.fake_mongo import FakeCollection, install as install_fake_mongo

# Importing services.mongo_service connects to MongoDB; these tests don't need a database.
install_fake_mongo()

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core.auth import get_current_user  # noqa: E402
from routers import ontology_check_router  # noqa: E402
from services import ontology_check_service as ocs  # noqa: E402
from services.owlrl_utils import OwlrlTimeout, OwlrlWorkerPool, get_worker_pool  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"
FAULTY_TTL = (DATA / "onto_check_faulty.ttl").read_text(encoding="utf-8")
CLEAN_TTL = (DATA / "onto_check_clean.ttl").read_text(encoding="utf-8")
# onto_check_faulty.ttl after the canvas round trip (/canvas/import, then buildTTL)
CANVAS_TTL = (DATA / "onto_check_faulty_canvas.ttl").read_text(encoding="utf-8")
EX = "http://example.org/onto-check#"

PREFIXES = """
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .
@prefix ex:   <http://example.org/onto-check#> .
"""


def tearDownModule():
    get_worker_pool().shutdown()


def check(ttl, trigger="manual"):
    result, raw = ocs.run_check(ocs.parse_ontology(ttl), trigger=trigger)
    return result, raw


def codes_on(result, iri):
    return sorted(p["code"] for p in result["problems"] if p["iri"] == iri)


class TestConsistency(unittest.TestCase):

    def test_smartwafer_is_the_only_error(self):
        result, _ = check(FAULTY_TTL)
        errors = [p for p in result["problems"] if p["severity"] == "error"]
        self.assertTrue(result["consistency_checked"])
        self.assertEqual(result["summary"]["errors"], 1)
        self.assertEqual(len(errors), 1)
        error = errors[0]
        self.assertEqual(error["iri"], EX + "SmartWafer")
        self.assertEqual((error["source"], error["code"]), ("owlrl", "CONSISTENCY"))
        self.assertEqual(sorted(error["related"]), [EX + "Device", EX + "Wafer"])
        self.assertIn("Wafer", error["message"])
        self.assertIn("Device", error["message"])

    def test_probes_never_leak_into_the_result(self):
        result, _ = check(FAULTY_TTL)
        self.assertNotIn("kgp-probe", json.dumps(result))
        self.assertNotIn("probe", json.dumps(result["problems"]).lower())

    def test_raw_owlrl_message_is_kept(self):
        _, raw = check(FAULTY_TTL)
        self.assertEqual(len(raw["owlrl_errors"]), 1)
        self.assertIn("Disjoint classes", raw["owlrl_errors"][0])

    def test_one_property_haskey_gives_no_false_error(self):
        result, _ = check(FAULTY_TTL)
        for name in ("Lot", "Batch", "Pallet", "batch1", "pallet1"):
            self.assertFalse([p for p in result["problems"] if p["severity"] == "error"
                              and (p["iri"] == EX + name or EX + name in p["related"])], name)
        self.assertTrue(any("owl:hasKey" in n for n in result["notes"]))

    def test_haskey_regression_needs_the_workaround(self):
        # Control: with the keys left in, owlrl 7.6.2 merges the Lot members and reports clashes.
        with patch.object(ocs, "remove_haskey", lambda g: []):
            result, _ = check(FAULTY_TTL)
        self.assertGreater(result["summary"]["errors"], 1)

    def test_result_says_it_is_not_complete_dl_reasoning(self):
        result, _ = check(CLEAN_TTL)
        self.assertFalse(result["complete_dl_reasoning"])
        self.assertEqual(result["consistency_method"], "owlrl-probe")
        self.assertIn("not complete OWL 2 DL", result["notes"][0])

    def test_too_many_triples_skips_the_check_with_a_note(self):
        with patch.dict(os.environ, {"REASONING_OWLRL_MAX_TRIPLES": "5"}):
            result, _ = check(FAULTY_TTL)
        self.assertFalse(result["consistency_checked"])
        self.assertEqual(result["summary"]["errors"], 0)
        self.assertTrue(any("REASONING_OWLRL_MAX_TRIPLES" in n for n in result["notes"]))
        self.assertGreater(result["summary"]["warnings"], 0)  # pitfall checks still run

    def test_timeout_is_reported_and_the_worker_replaced(self):
        pool = OwlrlWorkerPool(1)
        try:
            nt = ocs.parse_ontology(CLEAN_TTL).serialize(format="nt")
            with self.assertRaises(OwlrlTimeout):
                pool.run_closure(nt, timeout=0)  # a fresh worker can't even start that fast
            self.assertEqual(pool.run_closure(nt, timeout=60), [])  # a new worker took over
        finally:
            pool.shutdown()

    def test_timeout_becomes_a_note(self):
        with patch.object(ocs, "check_timeout_seconds", lambda: 0), \
                patch("services.ontology_check_service.get_worker_pool", lambda: _TimingOutPool()):
            result, _ = check(FAULTY_TTL)
        self.assertFalse(result["consistency_checked"])
        self.assertTrue(any("stopped" in n for n in result["notes"]))


class _TimingOutPool:
    def run_closure(self, ntriples, timeout):
        raise OwlrlTimeout("OWL RL reasoning took longer than 0s")


class TestPitfalls(unittest.TestCase):

    def test_faulty_ontology_warnings(self):
        result, _ = check(FAULTY_TTL)
        self.assertEqual(codes_on(result, EX + "measuredWafer"), ["PF01", "PF02"])
        self.assertEqual(codes_on(result, EX + "A"), ["PF04"])
        self.assertEqual(codes_on(result, EX + "B"), ["PF04"])
        self.assertEqual(result["summary"]["warnings"], 4)
        cycle = next(p for p in result["problems"] if p["iri"] == EX + "A")
        self.assertEqual(cycle["related"], [EX + "B"])
        for p in result["problems"]:
            if p["severity"] == "warning":
                self.assertIn(p["source"], ("meta-shacl", "sparql"))

    def test_clean_ontology_has_no_problems(self):
        for trigger in ("manual", "auto"):
            result, _ = check(CLEAN_TTL, trigger=trigger)
            self.assertEqual(result["summary"], {"errors": 0, "warnings": 0}, trigger)
            self.assertEqual(result["problems"], [], trigger)

    def test_unconnected_class_only_on_manual_checks(self):
        ttl = PREFIXES + 'ex:Orphan a owl:Class ; rdfs:label "Orphan" .'
        manual, _ = check(ttl, trigger="manual")
        auto, _ = check(ttl, trigger="auto")
        self.assertEqual(codes_on(manual, EX + "Orphan"), ["PF05"])
        self.assertEqual(codes_on(auto, EX + "Orphan"), [])

    def test_multiple_domains(self):
        ttl = PREFIXES + """
            ex:Wafer a owl:Class ; rdfs:label "Wafer" . ex:Lot a owl:Class ; rdfs:label "Lot" .
            ex:Tool a owl:Class ; rdfs:label "Tool" .
            ex:usedBy a owl:ObjectProperty ; rdfs:label "used by" ;
                rdfs:domain ex:Wafer , ex:Lot ; rdfs:range ex:Tool ."""
        result, _ = check(ttl)
        problem = next(p for p in result["problems"] if p["code"] == "PF08")
        self.assertEqual(problem["iri"], EX + "usedBy")
        self.assertIn("domains", problem["message"])
        self.assertEqual(sorted(problem["related"]), [EX + "Lot", EX + "Wafer"])

    def test_property_kind_and_range_mismatch(self):
        ttl = PREFIXES + """
            ex:Wafer a owl:Class ; rdfs:label "Wafer" . ex:Tool a owl:Class ; rdfs:label "Tool" .
            ex:serial a owl:DatatypeProperty ; rdfs:label "serial" ; rdfs:domain ex:Wafer ; rdfs:range ex:Tool .
            ex:size a owl:ObjectProperty ; rdfs:label "size" ; rdfs:domain ex:Wafer ; rdfs:range xsd:decimal .
            # Canvas round trip: xsd:string becomes a class node; not this mistake.
            xsd:string a owl:Class .
            ex:name a owl:DatatypeProperty ; rdfs:label "name" ; rdfs:domain ex:Wafer ; rdfs:range xsd:string ."""
        result, _ = check(ttl)
        self.assertEqual(codes_on(result, EX + "serial"), ["PF09"])
        self.assertEqual(codes_on(result, EX + "size"), ["PF09"])
        self.assertEqual(codes_on(result, EX + "name"), [])

    def test_duplicate_class_labels(self):
        ttl = PREFIXES + """
            ex:Device a owl:Class ; rdfs:label "Device" ; rdfs:subClassOf ex:Thing .
            ex:Gadget a owl:Class ; rdfs:label "Device" ; rdfs:subClassOf ex:Thing .
            ex:Thing a owl:Class ; rdfs:label "Thing" ."""
        result, _ = check(ttl)
        self.assertEqual(codes_on(result, EX + "Device"), ["PF10"])
        self.assertEqual(codes_on(result, EX + "Gadget"), ["PF10"])

    def test_canvas_round_trip_effects(self):
        # What the canvas writes back for an imported ontology: the ontology header and a
        # subPropertyOf edge both come back as owl:Class / rdfs:subClassOf.
        ttl = PREFIXES + """
            <http://example.org/onto-check> a owl:Class ; rdfs:label "onto-check" .
            ex:Wafer a owl:Class ; rdfs:label "Wafer" ; rdfs:subClassOf <http://example.org/onto-check> .
            ex:hasPart a owl:ObjectProperty ; rdfs:label "has part" ; rdfs:domain ex:Wafer ; rdfs:range ex:Wafer .
            ex:hasDie a owl:ObjectProperty ; rdfs:label "has die" ; rdfs:domain ex:Wafer ; rdfs:range ex:Wafer ;
                rdfs:subClassOf ex:hasPart ."""
        result, _ = check(ttl)
        self.assertEqual(codes_on(result, "http://example.org/onto-check"), ["PF12"])
        self.assertEqual(codes_on(result, EX + "hasDie"), ["PF11"])
        self.assertEqual(codes_on(result, EX + "Wafer"), [])

    def test_ontology_header_is_not_flagged_when_typed_correctly(self):
        result, _ = check(CLEAN_TTL)
        self.assertFalse([p for p in result["problems"] if p["code"] == "PF12"])


class TestReadOnly(unittest.TestCase):

    def test_input_graph_is_not_modified(self):
        for ttl in (FAULTY_TTL, CLEAN_TTL):
            graph = ocs.parse_ontology(ttl)
            before = set(graph)
            ocs.run_check(graph, trigger="manual")
            self.assertEqual(set(graph), before)


class TestStorage(unittest.TestCase):

    def setUp(self):
        self.collection = FakeCollection()
        patcher = patch.object(ocs, "_checks_collection", lambda: self.collection)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _store(self, ttl, trigger="manual", schema_id="s1"):
        result, raw = check(ttl, trigger=trigger)
        stored = ocs.store_check(user_email="u@example.org", schema_id=schema_id, source="canvas",
                                 ttl_hash=ocs.ttl_sha256(ttl), result=result, raw=raw)
        return stored, result

    def test_each_run_is_a_new_record_with_raw_outputs(self):
        stored, result = self._store(FAULTY_TTL)
        self.assertTrue(stored)
        doc = self.collection.docs[0]
        self.assertEqual(doc["check_id"], result["check_id"])
        self.assertEqual(doc["result"]["summary"], {"errors": 1, "warnings": 4})
        self.assertEqual(len(doc["raw"]["owlrl_errors"]), 1)
        self.assertIn("ValidationReport", doc["raw"]["pyshacl_report_ttl"])
        self.assertIn("PF04", doc["raw"]["sparql_rows"])

        first = json.dumps(doc, sort_keys=True)
        self.assertTrue(self._store(CLEAN_TTL)[0])
        self.assertEqual(len(self.collection.docs), 2)
        self.assertEqual(json.dumps(self.collection.docs[0], sort_keys=True), first)  # never overwritten

    def test_unchanged_ontology_is_not_stored_twice(self):
        self.assertTrue(self._store(FAULTY_TTL)[0])
        self.assertFalse(self._store(FAULTY_TTL)[0])
        self.assertEqual(len(self.collection.docs), 1)
        self.assertTrue(self._store(FAULTY_TTL, schema_id="other")[0])  # another schema
        self.assertTrue(self._store(FAULTY_TTL, trigger="auto")[0])     # different checks ran
        self.assertTrue(self._store(FAULTY_TTL + "\n# edit")[0])        # changed text
        self.assertEqual(len(self.collection.docs), 4)


class TestEndpoint(unittest.TestCase):

    def setUp(self):
        app = FastAPI()
        app.include_router(ontology_check_router.router)
        app.dependency_overrides[get_current_user] = lambda: {"email": "u@example.org"}
        self.client = TestClient(app)
        self.collection = FakeCollection()
        for patcher in (patch.object(ocs, "_checks_collection", lambda: self.collection),
                        patch.object(ontology_check_router, "_load_stored_ttl", self._no_graphdb)):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def _no_graphdb(*args):
        raise AssertionError("the canvas check must not read from GraphDB")

    def post(self, body):
        return self.client.post("/ontology/check", json=body)

    def test_canvas_check(self):
        resp = self.post({"source": "canvas", "ttl": FAULTY_TTL, "schema_id": "s1"})
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["summary"], {"errors": 1, "warnings": 4})
        self.assertEqual(body["schema_id"], "s1")
        self.assertTrue(body["stored"])
        self.assertEqual(len(self.collection.docs), 1)
        self.assertEqual(self.collection.docs[0]["check_id"], body["check_id"])

        again = self.post({"source": "canvas", "ttl": FAULTY_TTL, "schema_id": "s1"}).json()
        self.assertFalse(again["stored"])
        self.assertEqual(len(self.collection.docs), 1)

    def test_stored_schema_check(self):
        with patch.object(ontology_check_router, "_load_stored_ttl", lambda user, sid: FAULTY_TTL):
            resp = self.post({"source": "stored", "schema_id": "s1"})
        self.assertEqual(resp.status_code, 200, resp.text)
        errors = [p for p in resp.json()["problems"] if p["severity"] == "error"]
        self.assertEqual([p["iri"] for p in errors], [EX + "SmartWafer"])
        self.assertEqual(self.collection.docs[0]["source"], "stored")

    def test_auto_trigger_skips_pf05(self):
        ttl = PREFIXES + 'ex:Orphan a owl:Class ; rdfs:label "Orphan" .'
        body = self.post({"ttl": ttl, "trigger": "auto"}).json()
        self.assertEqual(body["problems"], [])

    def test_bad_input_is_rejected_cleanly(self):
        cases = [
            ({"ttl": "ex:A a owl:Class ."}, 400),                      # undefined prefix
            ({"ttl": "@prefix ex: <http://x#> . ex:A ex:b"}, 400),     # broken Turtle
            ({"ttl": "   "}, 400),                                     # empty canvas
            ({}, 400),                                                 # nothing to check
            ({"source": "stored"}, 400),                               # no schema_id
            ({"source": "stored", "schema_id": "s1", "ttl": CLEAN_TTL}, 400),  # both
            ({"source": "graphdb", "ttl": CLEAN_TTL}, 422),            # unknown source
            ({"ttl": CLEAN_TTL, "trigger": "sometimes"}, 422),         # unknown trigger
            ({"ttl": CLEAN_TTL, "unexpected": 1}, 422),                # unknown field
        ]
        for body, status in cases:
            resp = self.post(body)
            self.assertEqual(resp.status_code, status, f"{body}: {resp.text}")
            if status == 400:
                self.assertIn("summary", resp.json()["detail"], body)
        self.assertEqual(self.collection.docs, [])

    def test_unparsable_canvas_content_gets_a_canvas_message(self):
        resp = self.post({"source": "canvas", "ttl": CANVAS_TTL})
        self.assertEqual(resp.status_code, 400)
        detail = resp.json()["detail"]
        self.assertIn("canvas content is not valid Turtle", detail["summary"])
        self.assertIn("Check saved schema", detail["summary"])
        self.assertTrue(detail["technical"])

    def test_too_large_is_rejected(self):
        with patch.dict(os.environ, {"ONTOLOGY_CHECK_MAX_BYTES": "100"}):
            resp = self.post({"ttl": CLEAN_TTL})
        self.assertEqual(resp.status_code, 413)
        self.assertIn("too large", resp.json()["detail"]["summary"])

    def test_storage_failure_still_returns_the_result(self):
        def broken():
            raise RuntimeError("database down")
        with patch.object(ocs, "_checks_collection", broken):
            resp = self.post({"ttl": FAULTY_TTL})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["stored"])
        self.assertTrue(any("could not be saved" in n for n in resp.json()["notes"]))


if __name__ == "__main__":
    unittest.main()
