"""
Unit tests for the query-based (sh:sparql) part of validation:
1. A constraint that uses VALUES / MINUS / SERVICE is skipped and reported as "Not evaluated" instead of
   running for hours in rdflib and then being refused by pySHACL.
2. A constraint whose query exceeds the time cap is reported the same way; the run still completes.
3. If pySHACL refuses the shapes it hands back a ValidationFailure object instead of a graph; that becomes
   an error event, not an AttributeError.
"""

import time
import unittest
from unittest.mock import patch

from pyshacl.errors import ValidationFailure

from services.validation_service import ValidationService, _call_with_timeout


PREFIXES = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .
"""

DATA = PREFIXES + """
inst:w1 a cmpo:Wafer ; cmpo:hasWaferId "W-1" .
inst:w2 a cmpo:Wafer ; cmpo:hasWaferId "W-2" .
inst:w3 a cmpo:Wafer .
"""

# Question 1: a plain property shape (always evaluated). Question 2: a query-based shape, body supplied by the test.
SHAPES = PREFIXES + """
inst:Question_1_Shape a sh:NodeShape ;
    rdfs:label "Every wafer must have a wafer id." ;
    sh:targetClass cmpo:Wafer ;
    sh:property [ sh:path cmpo:hasWaferId ; sh:minCount 1 ; sh:message "Wafer id missing." ] .

inst:Question_2_Shape a sh:NodeShape ;
    rdfs:label "Wafer ids must be strings." ;
    sh:targetClass cmpo:Wafer ;
    sh:sparql [
        a sh:SPARQLConstraint ;
        sh:message "Wafer id is not a string." ;
        sh:select \"\"\"%s\"\"\"
    ] .
"""

GOOD_QUERY = """SELECT $this ?v WHERE { $this <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#hasWaferId> ?v .
    FILTER (datatype(?v) != <http://www.w3.org/2001/XMLSchema#string>) }"""

VALUES_QUERY = """SELECT $this ?v WHERE { VALUES ?cls { <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#Wafer> }
    $this a ?cls . $this <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#hasWaferId> ?v .
    FILTER (datatype(?v) != <http://www.w3.org/2001/XMLSchema#string>) }"""

Q1 = "https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/Question_1_Shape"
Q2 = "https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/Question_2_Shape"


def rules_by_iri(report):
    return {r["shape_iri"]: r for r in report["rules"]}


class TestSparqlConstraints(unittest.TestCase):

    def setUp(self):
        self.service = ValidationService()

    def test_supported_query_is_evaluated(self):
        report = self.service.validate_rdf(DATA, SHAPES % GOOD_QUERY)
        rules = rules_by_iri(report)
        self.assertEqual(rules[Q1]["status"], "Fail")           # w3 has no id
        self.assertEqual(rules[Q2]["status"], "Pass")           # both ids are strings
        self.assertEqual(report["not_evaluated_count"], 0)

    def test_values_query_is_skipped_not_run(self):
        with patch("services.validation_service._call_with_timeout") as run:
            report = self.service.validate_rdf(DATA, SHAPES % VALUES_QUERY)
            run.assert_not_called()                             # never handed to rdflib
        self.assertNotIn("error", report)
        rules = rules_by_iri(report)
        self.assertEqual(rules[Q2]["status"], "Not evaluated")
        self.assertIn("VALUES", rules[Q2]["advice"])
        self.assertEqual(rules[Q1]["status"], "Fail")           # the other rule still ran
        self.assertEqual(report["not_evaluated_count"], 1)
        self.assertEqual(report["failed_questions"], 1)
        self.assertIn("1 not evaluated", report["status_summary"])
        self.assertIn(Q2, [r["shape_iri"] for r in report["unreliable_rules"]])

    def test_skipped_rule_alone_means_needs_review_not_fail(self):
        shapes = (SHAPES % VALUES_QUERY).replace("sh:minCount 1", "sh:minCount 0")   # Question 1 now passes
        report = self.service.validate_rdf(DATA, shapes)
        self.assertEqual(report["gate_decision"], "Needs review")

    def test_slow_query_times_out_and_run_completes(self):
        with patch("services.validation_service._query_timeout_sec", return_value=5.0), \
             patch("services.validation_service._call_with_timeout", return_value=(None, True)):
            report = self.service.validate_rdf(DATA, SHAPES % GOOD_QUERY)
        rules = rules_by_iri(report)
        self.assertEqual(rules[Q2]["status"], "Not evaluated")
        self.assertIn("did not finish within 5 s", rules[Q2]["advice"])
        self.assertEqual(rules[Q1]["status"], "Fail")

    def test_call_with_timeout(self):
        self.assertEqual(_call_with_timeout(lambda: 42, 1.0), (42, False))
        value, timed_out = _call_with_timeout(lambda: time.sleep(2), 0.05)
        self.assertTrue(timed_out)
        with self.assertRaises(ValueError):
            _call_with_timeout(lambda: (_ for _ in ()).throw(ValueError("boom")), 1.0)

    def test_pyshacl_refusal_is_an_error_event_not_a_crash(self):
        refused = (False, ValidationFailure("A SPARQL Constraint must not contain a VALUES clause."), "")
        with patch("services.validation_service.validate", return_value=refused):
            report = self.service.validate_rdf(DATA, SHAPES % GOOD_QUERY)
        self.assertEqual(report["execution_status"], "Error")
        self.assertIn("VALUES", report["error"])


if __name__ == "__main__":
    unittest.main()
