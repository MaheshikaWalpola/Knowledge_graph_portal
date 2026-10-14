"""
Unit tests for SHACLVerifier:
1. Grounding check (detects unknown classes/properties, allows standard vocabularies)
2. Test-data check (evaluates valid and invalid instances with pySHACL)
3. Repair loop (up to 3 attempts, unverified fallback, respects config setting)
"""

import unittest
from unittest.mock import MagicMock, patch
import json

from services.shacl_verifier import SHACLVerifier
from core.config import settings


SAMPLE_SCHEMA = """
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .

cmpo:CMPProcess a owl:Class .
cmpo:Pressure a owl:Class .
cmpo:hasTimestamp a owl:DatatypeProperty .
cmpo:hasNumericValue a owl:DatatypeProperty .
cmpo:hasUnit a owl:DatatypeProperty .
cmpo:hasInput a owl:ObjectProperty .
"""

VALID_SHAPE = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .

inst:PressureShape a sh:NodeShape ;
    sh:targetClass cmpo:Pressure ;
    sh:property [
        sh:path cmpo:hasNumericValue ;
        sh:minCount 1 ;
        sh:datatype xsd:float ;
        sh:minInclusive 0.0 ;
    ] ;
    sh:property [
        sh:path cmpo:hasUnit ;
        sh:hasValue "psi" ;
    ] .
"""

HALLUCINATED_SHAPE = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .

inst:BadShape a sh:NodeShape ;
    sh:targetClass cmpo:FakeProcessClass ;
    sh:property [
        sh:path cmpo:imaginaryPressureValue ;
        sh:minCount 1 ;
    ] .
"""


class TestSHACLVerifier(unittest.TestCase):

    def setUp(self):
        self.mock_llm = MagicMock()
        self.verifier = SHACLVerifier(self.mock_llm)
        self.known_terms = self.verifier.extract_ontology_terms(SAMPLE_SCHEMA)

    #  STAGE 1: Grounding Check Tests 

    def test_extract_ontology_terms(self):
        """Verifies that all classes and properties in the schema are discovered."""
        self.assertIn("https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#CMPProcess", self.known_terms)
        self.assertIn("https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#Pressure", self.known_terms)
        self.assertIn("https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#hasNumericValue", self.known_terms)
        self.assertIn("https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#hasUnit", self.known_terms)

    def test_grounding_check_valid_shape(self):
        """Valid shape with known terms produces no unknown terms."""
        unknown = self.verifier.check_grounding(VALID_SHAPE, self.known_terms)
        self.assertEqual(unknown, [])

    def test_grounding_check_hallucinated_terms(self):
        """Shape with fake class and property reports both as unknown terms."""
        unknown = self.verifier.check_grounding(HALLUCINATED_SHAPE, self.known_terms)
        self.assertEqual(len(unknown), 2)
        self.assertIn("https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#FakeProcessClass", unknown)
        self.assertIn("https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#imaginaryPressureValue", unknown)

    def test_grounding_check_ignores_standard_vocabs(self):
        """Standard W3C vocabularies (xsd, sh, rdf) should never be flagged."""
        unknown = self.verifier.check_grounding(VALID_SHAPE, self.known_terms)
        for term in unknown:
            self.assertFalse(term.startswith("http://www.w3.org/"))

    #  STAGE 2: Test-Data Check Tests 

    def test_check_test_data_passes_when_instances_match(self):
        """When valid instances conform and invalid instances violate, check passes."""
        self.mock_llm._call_kiste.return_value = json.dumps({
            "valid": [
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:P1 a cmpo:Pressure ; cmpo:hasNumericValue \"2.5\"^^xsd:float ; cmpo:hasUnit \"psi\" .",
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:P2 a cmpo:Pressure ; cmpo:hasNumericValue \"0.0\"^^xsd:float ; cmpo:hasUnit \"psi\" ."
            ],
            "invalid": [
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:PBad1 a cmpo:Pressure ; cmpo:hasNumericValue \"-1.0\"^^xsd:float ; cmpo:hasUnit \"psi\" .",
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:PBad2 a cmpo:Pressure ; cmpo:hasNumericValue \"2.5\"^^xsd:float ; cmpo:hasUnit \"bar\" ."
            ]
        })

        passed, failed_examples, reason = self.verifier.check_test_data(
            rule_text="Pressure must be non-negative and in psi.",
            shape_ttl=VALID_SHAPE,
            schema_ttl=SAMPLE_SCHEMA
        )
        self.assertTrue(passed)
        self.assertEqual(len(failed_examples), 0)

    def test_check_test_data_fails_on_behavior_mismatch(self):
        """When an invalid instance is incorrectly accepted by the shape, check flags it."""
        # A shape missing the unit check
        lenient_shape = """
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        @prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .
        @prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .

        inst:LenientShape a sh:NodeShape ;
            sh:targetClass cmpo:Pressure ;
            sh:property [
                sh:path cmpo:hasNumericValue ;
                sh:minInclusive 0.0 ;
            ] .
        """
        self.mock_llm._call_kiste.return_value = json.dumps({
            "valid": [
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\ninst:P1 a cmpo:Pressure ; cmpo:hasNumericValue \"2.5\"^^<http://www.w3.org/2001/XMLSchema#float> ; cmpo:hasUnit \"psi\" .",
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\ninst:P2 a cmpo:Pressure ; cmpo:hasNumericValue \"1.0\"^^<http://www.w3.org/2001/XMLSchema#float> ; cmpo:hasUnit \"psi\" ."
            ],
            "invalid": [
                # Wrong unit: but lenient shape does not check unit, so it conforms!
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\ninst:PBad a cmpo:Pressure ; cmpo:hasNumericValue \"2.5\"^^<http://www.w3.org/2001/XMLSchema#float> ; cmpo:hasUnit \"bar\" .",
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\ninst:PBad2 a cmpo:Pressure ; cmpo:hasNumericValue \"-5.0\"^^<http://www.w3.org/2001/XMLSchema#float> ; cmpo:hasUnit \"psi\" ."
            ]
        })

        passed, failed_examples, reason = self.verifier.check_test_data(
            rule_text="Pressure must be non-negative and in psi.",
            shape_ttl=lenient_shape,
            schema_ttl=SAMPLE_SCHEMA
        )
        self.assertFalse(passed)
        self.assertTrue(any(fe["actual"] == "conforms" for fe in failed_examples))

    #  STAGE 3: Repair Loop Tests 

    def test_verify_and_repair_verified_on_first_try(self):
        """Clean shape with valid test data is labeled verified on attempt 1."""
        self.mock_llm._call_kiste.return_value = json.dumps({
            "valid": [
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:P1 a cmpo:Pressure ; cmpo:hasNumericValue \"2.5\"^^xsd:float ; cmpo:hasUnit \"psi\" .",
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:P2 a cmpo:Pressure ; cmpo:hasNumericValue \"0.0\"^^xsd:float ; cmpo:hasUnit \"psi\" ."
            ],
            "invalid": [
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:PBad1 a cmpo:Pressure ; cmpo:hasNumericValue \"-1.0\"^^xsd:float ; cmpo:hasUnit \"psi\" .",
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:PBad2 a cmpo:Pressure ; cmpo:hasNumericValue \"2.5\"^^xsd:float ; cmpo:hasUnit \"bar\" ."
            ]
        })

        result = self.verifier.verify_and_repair(
            rule_text="Pressure must be non-negative and in psi.",
            initial_shape_ttl=VALID_SHAPE,
            schema_ttl=SAMPLE_SCHEMA,
            known_terms=self.known_terms
        )

        self.assertEqual(result["verification"], "verified")
        self.assertEqual(result["attempts"], 1)
        self.assertEqual(result["unknown_terms"], [])

    def test_verify_and_repair_successful_repair(self):
        """Flawed shape is fixed in the repair loop and labeled repaired."""
        test_examples_json = json.dumps({
            "valid": [
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:P1 a cmpo:Pressure ; cmpo:hasNumericValue \"2.5\"^^xsd:float ; cmpo:hasUnit \"psi\" .",
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:P2 a cmpo:Pressure ; cmpo:hasNumericValue \"0.0\"^^xsd:float ; cmpo:hasUnit \"psi\" ."
            ],
            "invalid": [
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:PBad1 a cmpo:Pressure ; cmpo:hasNumericValue \"-1.0\"^^xsd:float ; cmpo:hasUnit \"psi\" .",
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:PBad2 a cmpo:Pressure ; cmpo:hasNumericValue \"2.5\"^^xsd:float ; cmpo:hasUnit \"bar\" ."
            ]
        })

        # LLM returns repair shape on first call (repair), and test data on subsequent call
        self.mock_llm._call_kiste.side_effect = [
            VALID_SHAPE,         # Attempt 1 repair output
            test_examples_json   # Attempt 2 test-data generation
        ]

        result = self.verifier.verify_and_repair(
            rule_text="Pressure must be non-negative and in psi.",
            initial_shape_ttl=HALLUCINATED_SHAPE,
            schema_ttl=SAMPLE_SCHEMA,
            known_terms=self.known_terms
        )

        self.assertEqual(result["verification"], "repaired")
        self.assertEqual(result["attempts"], 2)
        self.assertEqual(result["unknown_terms"], [])

    def test_verify_and_repair_unverified_after_max_attempts(self):
        """Persistent flaws exhaust 3 attempts and return unverified."""
        # LLM always returns a hallucinated shape
        self.mock_llm._call_kiste.return_value = HALLUCINATED_SHAPE

        result = self.verifier.verify_and_repair(
            rule_text="Rule with persistent issue.",
            initial_shape_ttl=HALLUCINATED_SHAPE,
            schema_ttl=SAMPLE_SCHEMA,
            known_terms=self.known_terms
        )

        self.assertEqual(result["verification"], "unverified")
        self.assertEqual(result["attempts"], 3)
        self.assertTrue(len(result["unknown_terms"]) > 0)

    def test_verify_disabled_by_config(self):
        """When ENABLE_SHACL_VERIFICATION is False, bypasses checks and returns immediately."""
        with patch.object(settings, "ENABLE_SHACL_VERIFICATION", False):
            result = self.verifier.verify_and_repair(
                rule_text="Any rule",
                initial_shape_ttl=HALLUCINATED_SHAPE,
                schema_ttl=SAMPLE_SCHEMA
            )
            self.assertEqual(result["verification"], "verified")
            self.assertEqual(result["reason"], "verification disabled")


if __name__ == "__main__":
    unittest.main()
