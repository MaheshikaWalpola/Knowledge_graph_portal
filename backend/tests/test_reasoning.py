"""
Tests for reasoning (inference) during SHACL validation:
1. apply_reasoning: copies the graph, adds implied facts, drops literal subjects, falls back from OWL RL
2. Validation with reasoning off vs on:
   - missed errors: rows typed only through rdfs:domain are skipped without reasoning
   - false alarms: nodes typed only through rdfs:range fail sh:class without reasoning
"""

import os
import unittest
from unittest.mock import patch

from rdflib import Graph, Literal, Namespace, OWL, RDF

from services.reasoning_service import apply_reasoning, normalize_inference
from services.validation_service import ValidationService

PM = Namespace("http://example.org/pm#")
EX = Namespace("http://example.org/data#")

SCHEMA = """
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix pm: <http://example.org/pm#> .

pm:Parameter a owl:Class .
pm:MaximumRating a owl:Class ; rdfs:subClassOf pm:Parameter .
pm:Device a owl:Class .
pm:symbol a owl:DatatypeProperty ; rdfs:domain pm:Parameter ; rdfs:range xsd:string .
pm:ofDevice a owl:ObjectProperty ; rdfs:domain pm:Parameter ; rdfs:range pm:Device .
"""

# Every Parameter needs a symbol and must belong to a Device.
SHAPES = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix pm: <http://example.org/pm#> .
@prefix inst: <http://example.org/inst#> .

inst:Question_1_Shape a sh:NodeShape ;
    rdfs:label "Every parameter belongs to a device" ;
    sh:targetClass pm:Parameter ;
    sh:property [ sh:path pm:ofDevice ; sh:minCount 1 ; sh:class pm:Device ] .
"""

# r1 is fine. r2 has no type, only a symbol, and no device: a real error that only the
# rdfs:domain of pm:symbol reveals.
DATA_MISSED_ERROR = """
@prefix pm: <http://example.org/pm#> .
@prefix ex: <http://example.org/data#> .

ex:d1 a pm:Device .
ex:r1 a pm:MaximumRating ; pm:symbol "VDS" ; pm:ofDevice ex:d1 .
ex:r2 pm:symbol "ID" .
"""

# The device has no type, but the rdfs:range of pm:ofDevice makes it a Device, so nothing is wrong.
DATA_FALSE_ALARM = """
@prefix pm: <http://example.org/pm#> .
@prefix ex: <http://example.org/data#> .

ex:r1 a pm:MaximumRating ; pm:symbol "VDS" ; pm:ofDevice ex:d1 .
ex:r2 a pm:MaximumRating ; pm:symbol "ID" ; pm:ofDevice ex:d1 .
"""


def _graph(*ttls):
    g = Graph()
    for ttl in ttls:
        g.parse(data=ttl, format="turtle")
    return g


class TestApplyReasoning(unittest.TestCase):

    def test_none_returns_unchanged_copy(self):
        g = _graph(SCHEMA, DATA_MISSED_ERROR)
        result = apply_reasoning(g, "none")
        self.assertEqual(result["used"], "none")
        self.assertEqual(result["inferred"], 0)
        self.assertEqual(len(result["graph"]), len(g))
        self.assertIsNot(result["graph"], g)

    def test_rdfs_adds_implied_types_without_changing_input(self):
        g = _graph(SCHEMA, DATA_MISSED_ERROR)
        size_before = len(g)
        result = apply_reasoning(g, "rdfs")
        expanded = result["graph"]
        self.assertIn((EX.r2, RDF.type, PM.Parameter), expanded)   # from rdfs:domain of pm:symbol
        self.assertIn((EX.r1, RDF.type, PM.Parameter), expanded)   # from rdfs:subClassOf
        self.assertIn((EX.d1, RDF.type, PM.Device), expanded)      # from rdfs:range of pm:ofDevice
        self.assertGreater(result["inferred"], 0)
        self.assertEqual(len(g), size_before, "input graph must not be modified")

    def test_literal_subjects_are_removed(self):
        for mode in ("rdfs", "owlrl"):
            expanded = apply_reasoning(_graph(SCHEMA, DATA_MISSED_ERROR), mode)["graph"]
            self.assertFalse(any(isinstance(s, Literal) for s, _, _ in expanded), mode)

    def test_owlrl_falls_back_to_rdfs_above_limit(self):
        with patch.dict(os.environ, {"REASONING_OWLRL_MAX_TRIPLES": "3"}):
            result = apply_reasoning(_graph(SCHEMA, DATA_MISSED_ERROR), "owlrl")
        self.assertEqual(result["used"], "rdfs")
        self.assertIn("OWL RL limit", result["note"])

    def test_owlrl_runs_below_limit(self):
        result = apply_reasoning(_graph(SCHEMA, DATA_MISSED_ERROR), "owlrl")
        self.assertEqual(result["used"], "owlrl")
        self.assertEqual(result["note"], "")

    def test_owlrl_does_not_merge_records_with_a_one_property_key(self):
        # owlrl's prp-key rule ignores the key values for a one-property owl:hasKey and would make
        # every two Devices owl:sameAs; the keys must be held back while reasoning, then restored.
        keyed = SCHEMA + "\npm:Device owl:hasKey ( pm:deviceName ) .\npm:deviceName a owl:DatatypeProperty .\n"
        data = """
        @prefix pm: <http://example.org/pm#> .
        @prefix ex: <http://example.org/data#> .
        ex:d1 a pm:Device ; pm:deviceName "A" .
        ex:d2 a pm:Device ; pm:deviceName "B" .
        """
        g = _graph(keyed, data)
        result = apply_reasoning(g, "owlrl")
        self.assertNotIn((EX.d1, OWL.sameAs, EX.d2), result["graph"])
        self.assertEqual(len(list(result["graph"].triples((None, OWL.hasKey, None)))), 1, "keys are restored")
        self.assertIn("owl:hasKey", result["note"])

    def test_normalize_inference(self):
        self.assertEqual(normalize_inference(None), "none")
        self.assertEqual(normalize_inference(" RDFS "), "rdfs")
        with self.assertRaises(ValueError):
            normalize_inference("hermit")


class TestValidationWithReasoning(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.service = ValidationService()

    def _run(self, data, inference):
        return self.service.validate_rdf(data_ttl=data, shapes_ttl=SHAPES, schema_ttl=SCHEMA, inference=inference)

    def test_reasoning_finds_missed_error(self):
        off = self._run(DATA_MISSED_ERROR, "none")
        on = self._run(DATA_MISSED_ERROR, "rdfs")
        self.assertTrue(off["conforms"], "without reasoning the untyped row is skipped")
        self.assertFalse(on["conforms"])
        self.assertEqual({v["focus_node"] for v in on["violations"]}, {"http://example.org/data#r2"})

    def test_reasoning_removes_false_alarm(self):
        off = self._run(DATA_FALSE_ALARM, "none")
        on = self._run(DATA_FALSE_ALARM, "rdfs")
        self.assertFalse(off["conforms"], "without reasoning the untyped device fails sh:class")
        self.assertEqual(len(off["violations"]), 2)
        self.assertTrue(on["conforms"])

    def test_report_records_inference(self):
        off = self._run(DATA_MISSED_ERROR, "none")
        self.assertEqual(off["inference"], "none")
        self.assertEqual(off["inferred_triples"], 0)
        on = self._run(DATA_MISSED_ERROR, "owlrl")
        self.assertEqual(on["inference"], "owlrl")
        self.assertEqual(on["inference_requested"], "owlrl")
        self.assertGreater(on["inferred_triples"], 0)
        self.assertEqual(on["reasoning_notes"], [])

    def test_focus_node_count_includes_inferred_nodes(self):
        on = self._run(DATA_MISSED_ERROR, "rdfs")
        self.assertEqual(on["rules"][0]["total_focus_nodes"], 2)

    def test_warns_when_no_ontology(self):
        report = self.service.validate_rdf(data_ttl=DATA_MISSED_ERROR, shapes_ttl=SHAPES, schema_ttl=None, inference="rdfs")
        self.assertTrue(any("no ontology" in n for n in report["reasoning_notes"]))

    def test_invalid_mode_returns_error(self):
        report = self._run(DATA_MISSED_ERROR, "hermit")
        self.assertIn("Unknown reasoning mode", report["error"])

    def test_pdf_report_includes_reasoning(self):
        pdf = self.service.generate_pdf_report(self._run(DATA_MISSED_ERROR, "rdfs"))
        self.assertTrue(pdf.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()
