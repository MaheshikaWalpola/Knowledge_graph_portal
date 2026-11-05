"""
Unit tests for SHACLVerifier:
1. Static checks (Turtle, SHACL meta-validation, target, grounding against the ontology)
2. Blind test data (pairs from the English rule, run with pySHACL)
3. Back-translation meaning check
4. Decision and single repair, with test data created once and reused
"""

import unittest
from unittest.mock import patch
import json

from rdflib import Graph

from services.shacl_verifier import SHACLVerifier
from services.local_llm_service import KisteConnectionError
from core.config import settings


SAMPLE_SCHEMA = """
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .

cmpo:CMPProcess a owl:Class .
cmpo:Pressure a owl:Class ; rdfs:label "Pressure" .
cmpo:hasTimestamp a owl:DatatypeProperty .
cmpo:hasNumericValue a owl:DatatypeProperty ; rdfs:domain cmpo:Pressure .
cmpo:hasUnit a owl:DatatypeProperty .
cmpo:hasInput a owl:ObjectProperty .
"""

VALID_SHAPE = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .

inst:PressureShape a sh:NodeShape ;
    rdfs:label "Pressure must be non-negative and in psi." ;
    sh:targetClass cmpo:Pressure ;
    sh:property [
        sh:path cmpo:hasNumericValue ;
        sh:minCount 1 ;
        sh:datatype xsd:float ;
        sh:minInclusive 0.0 ;
        sh:message "Pressure must be non-negative."
    ] ;
    sh:property [
        sh:path cmpo:hasUnit ;
        sh:hasValue "psi" ;
    ] .
"""

# Misses the unit part of the rule
LENIENT_SHAPE = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .

inst:PressureShape a sh:NodeShape ;
    sh:targetClass cmpo:Pressure ;
    sh:property [ sh:path cmpo:hasNumericValue ; sh:minInclusive 0.0 ] .
"""

HALLUCINATED_SHAPE = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .

inst:BadShape a sh:NodeShape ;
    sh:targetClass cmpo:FakeProcessClass ;
    sh:property [
        sh:path cmpo:imaginaryPressureValue ;
        sh:minCount 1 ;
    ] .
"""

RULE = "Pressure must be non-negative and in psi."


def pressure(name, value, unit="psi"):
    """Test graph body without @prefix lines, as the AI is asked to write it."""
    return f'inst:{name} a cmpo:Pressure ; cmpo:hasNumericValue "{value}"^^xsd:float ; cmpo:hasUnit "{unit}" .'


GOOD_TESTS = {
    "pairs": [
        {"valid": pressure("P1", "2.5"), "invalid": pressure("P1", "-1.0"), "change": "negative value"},
        {"valid": pressure("P2", "0.0"), "invalid": pressure("P2", "0.0", "bar"), "change": "unit bar"},
        {"valid": pressure("P3", "4.0"), "invalid": pressure("P3", "-4.0"), "change": "negative value"},
    ],
    "out_of_scope": 'inst:T1 a cmpo:CMPProcess ; cmpo:hasNumericValue "-3.0"^^xsd:float .',
}


class FakeLLM:
    """Answers each kind of verifier prompt (test data, describe, compare, repair) and records the calls."""

    def __init__(self, tests=GOOD_TESTS, description="Checks that every Pressure has a value of at least 0 in psi.",
                 verdict="equivalent", repairs=(VALID_SHAPE,), verdicts=None):
        self.tests = tests
        self.description = description
        self.verdicts = list(verdicts) if verdicts else None
        self.verdict = verdict
        self.repairs = list(repairs)
        self.calls = []

    def _call_kiste(self, messages, json_mode=False, temperature=0.7, model_override=None, reasoning_effort=None):
        system = messages[0]["content"]
        if "test data" in system:
            self.calls.append("tests")
            return self.tests if isinstance(self.tests, str) else json.dumps(self.tests)
        if "explain SHACL" in system:
            self.calls.append("describe")
            return self.description
        if "compare rules" in system:
            self.calls.append("compare")
            verdict = self.verdicts.pop(0) if self.verdicts else self.verdict
            return json.dumps({"verdict": verdict, "explanation": "" if verdict == "equivalent" else "unit is not checked"})
        if "repair" in system:
            self.calls.append("repair")
            return self.repairs.pop(0) if len(self.repairs) > 1 else self.repairs[0]
        raise AssertionError(f"unexpected prompt: {system}")


class TestSHACLVerifier(unittest.TestCase):

    def setUp(self):
        self.verifier = SHACLVerifier(FakeLLM())
        self.known_terms = self.verifier.extract_ontology_terms(SAMPLE_SCHEMA)

    def verify(self, llm, shape, **kwargs):
        self.verifier.llm = llm
        return self.verifier.verify_and_repair(rule_text=RULE, initial_shape_ttl=shape, schema_ttl=SAMPLE_SCHEMA,
                                               known_terms=self.known_terms, **kwargs)

    #  Check 1: static checks

    def test_extract_ontology_terms(self):
        for local in ("CMPProcess", "Pressure", "hasNumericValue", "hasUnit"):
            self.assertIn(f"https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#{local}", self.known_terms)

    def test_grounding_check_valid_shape(self):
        self.assertEqual(self.verifier.check_grounding(VALID_SHAPE, self.known_terms), [])

    def test_grounding_check_hallucinated_terms(self):
        unknown = self.verifier.check_grounding(HALLUCINATED_SHAPE, self.known_terms)
        self.assertEqual(len(unknown), 2)
        self.assertIn("https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#FakeProcessClass", unknown)
        self.assertIn("https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#imaginaryPressureValue", unknown)

    def test_static_check_accepts_valid_shape(self):
        graph, problems, unknown = self.verifier.check_static(VALID_SHAPE, self.known_terms)
        self.assertIsNotNone(graph)
        self.assertEqual(problems, [])
        self.assertEqual(unknown, [])

    def test_static_check_rejects_invalid_shacl(self):
        bad = VALID_SHAPE.replace("sh:minCount 1", 'sh:minCount "one"')
        _, problems, _ = self.verifier.check_static(bad, self.known_terms)
        self.assertTrue(any("not valid SHACL" in p for p in problems))

    def test_static_check_rejects_shape_without_target(self):
        no_target = VALID_SHAPE.replace("sh:targetClass cmpo:Pressure ;", "")
        _, problems, _ = self.verifier.check_static(no_target, self.known_terms)
        self.assertTrue(any("no target" in p for p in problems))

    def test_static_check_rejects_bad_turtle(self):
        graph, problems, _ = self.verifier.check_static("this is not turtle", self.known_terms)
        self.assertIsNone(graph)
        self.assertTrue(problems)

    #  Check 2: blind test data

    def test_test_cases_get_prefixes_and_skip_unusable_pairs(self):
        tests = {"pairs": GOOD_TESTS["pairs"] + [
            {"valid": pressure("P9", "1.0"), "invalid": pressure("P9", "1.0"), "change": "nothing"},  # no change
            {"valid": "not turtle at all", "invalid": pressure("P8", "-1.0"), "change": "broken"},
        ], "out_of_scope": GOOD_TESTS["out_of_scope"]}
        self.verifier.llm = FakeLLM(tests=tests)
        cases = self.verifier.generate_test_cases(RULE, SAMPLE_SCHEMA)
        self.assertEqual(sum(c["expected"] == "invalid" for c in cases), 3)
        self.assertEqual(sum(c["expected"] == "valid" for c in cases), 4)  # 3 pair originals + out of scope

    def test_test_cases_ask_again_when_too_few(self):
        llm = FakeLLM(tests={"pairs": [GOOD_TESTS["pairs"][0]]})
        self.verifier.llm = llm
        self.verifier.generate_test_cases(RULE, SAMPLE_SCHEMA)
        self.assertEqual(llm.calls, ["tests", "tests"])

    def test_run_tests_finds_missing_unit_check(self):
        self.verifier.llm = FakeLLM()
        cases = self.verifier.generate_test_cases(RULE, SAMPLE_SCHEMA)
        shape = Graph().parse(data=LENIENT_SHAPE, format="turtle")
        failed = self.verifier.run_tests(shape, cases)
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["actual"], "conforms")

    #  Check 3: back-translation

    def test_back_translation_does_not_see_labels_or_messages(self):
        text = SHACLVerifier.logic_only(Graph().parse(data=VALID_SHAPE, format="turtle"))
        self.assertNotIn("non-negative", text)
        self.assertIn("minInclusive", text)

    #  Decision and repair

    def test_verified_on_first_try_with_three_calls(self):
        llm = FakeLLM()
        result = self.verify(llm, VALID_SHAPE)
        self.assertEqual(result["verification"], "verified")
        self.assertEqual(result["attempts"], 1)
        self.assertEqual(sorted(llm.calls), ["compare", "describe", "tests"])
        self.assertEqual(result["meaning"]["verdict"], "equivalent")
        self.assertEqual(result["tests"], {"total": 7, "failed": 0})

    def test_repaired_after_hallucination_and_tests_written_once(self):
        llm = FakeLLM(repairs=(VALID_SHAPE,))
        result = self.verify(llm, HALLUCINATED_SHAPE)
        self.assertEqual(result["verification"], "repaired")
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(llm.calls.count("tests"), 1)

    def test_wrong_meaning_is_repaired(self):
        llm = FakeLLM(verdicts=["narrower", "equivalent"], repairs=(VALID_SHAPE,))
        result = self.verify(llm, LENIENT_SHAPE)
        self.assertEqual(result["verification"], "repaired")
        self.assertEqual(llm.calls.count("repair"), 1)
        self.assertEqual(llm.calls.count("tests"), 1)

    def test_unverified_after_one_failed_repair(self):
        llm = FakeLLM(verdict="narrower", repairs=(LENIENT_SHAPE,))
        result = self.verify(llm, LENIENT_SHAPE)
        self.assertEqual(result["verification"], "unverified")
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(llm.calls.count("repair"), 1)
        self.assertIn("narrower", result["reason"])

    def test_one_wrong_test_is_tolerated_when_meaning_matches(self):
        # The AI wrote a wrong "invalid" example (a positive value), the shape is right to accept it
        tests = json.loads(json.dumps(GOOD_TESTS))
        tests["pairs"][2]["invalid"] = pressure("P3", "7.0")
        llm = FakeLLM(tests=tests)
        result = self.verify(llm, VALID_SHAPE)
        self.assertEqual(result["verification"], "verified")
        self.assertEqual(result["tests"]["failed"], 1)

    def test_failing_tests_without_meaning_match_are_not_tolerated(self):
        llm = FakeLLM(verdict="narrower", repairs=(VALID_SHAPE,), verdicts=["narrower", "equivalent"])
        result = self.verify(llm, LENIENT_SHAPE, max_repairs=0)
        self.assertEqual(result["verification"], "unverified")
        self.assertEqual(result["tests"]["failed"], 1)

    def test_no_repair_when_test_data_cannot_be_made(self):
        llm = FakeLLM(tests="not json")
        result = self.verify(llm, VALID_SHAPE)
        self.assertEqual(result["verification"], "unverified")
        self.assertNotIn("repair", llm.calls)
        self.assertIn("test data", result["reason"])

    def test_ai_unreachable(self):
        class Down:
            def _call_kiste(self, *args, **kwargs):
                raise KisteConnectionError("down")
        result = self.verify(Down(), VALID_SHAPE)
        self.assertEqual(result["verification"], "unverified")
        self.assertEqual(result["reason"], "verification unavailable")

    def test_verify_disabled_by_config(self):
        with patch.object(settings, "ENABLE_SHACL_VERIFICATION", False):
            result = self.verify(FakeLLM(), HALLUCINATED_SHAPE)
            self.assertEqual(result["verification"], "verified")
            self.assertEqual(result["reason"], "verification disabled")


if __name__ == "__main__":
    unittest.main()
