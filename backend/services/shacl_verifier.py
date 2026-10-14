import re
import json
import logging
from typing import List, Dict, Any, Optional, Set, Tuple, Callable
from rdflib import Graph, Namespace, RDF, RDFS, OWL, URIRef, BNode
import pyshacl

from core.config import settings
from services.local_llm_service import LocalLLMService, KisteConnectionError

logger = logging.getLogger(__name__)

STANDARD_VOCABULARIES = {
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "http://www.w3.org/2000/01/rdf-schema#",
    "http://www.w3.org/2002/07/owl#",
    "http://www.w3.org/2001/XMLSchema#",
    "http://www.w3.org/ns/shacl#"
}

SH = Namespace("http://www.w3.org/ns/shacl#")

# W3C SOSA/SSN terms. Domain ontologies such as CMPO reference these without declaring or
# importing them, so they are accepted as known terms (an invented sosa:/ssn: term is still flagged).
_SOSA = "http://www.w3.org/ns/sosa/"
_SSN = "http://www.w3.org/ns/ssn/"
SOSA_SSN_TERMS = {_SOSA + t for t in (
    "FeatureOfInterest", "ObservableProperty", "ActuatableProperty", "Sample", "Sensor", "Actuator",
    "Sampler", "Platform", "Observation", "Actuation", "Sampling", "Procedure", "Result",
    "ObservationCollection", "ActuationCollection", "SamplingCollection",
    "hasFeatureOfInterest", "isFeatureOfInterestOf", "hasUltimateFeatureOfInterest", "hasSample",
    "isSampleOf", "hasOriginalSample", "hasSampledFeature", "isSampledBy", "hosts", "isHostedBy",
    "observes", "isObservedBy", "madeObservation", "madeBySensor", "observedProperty",
    "madeActuation", "madeByActuator", "actsOnProperty", "isActedOnBy", "madeSampling",
    "madeBySampler", "usedProcedure", "hasResult", "isResultOf", "hasSimpleResult", "resultTime",
    "phenomenonTime", "hasMember",
)} | {_SSN + t for t in (
    "System", "Property", "Input", "Output", "Deployment", "Stimulus",
    "hasProperty", "isPropertyOf", "forProperty", "hasInput", "hasOutput", "implements",
    "implementedBy", "hasSubSystem", "deployedSystem", "deployedOnPlatform", "inDeployment",
    "hasDeployment", "detects", "isProxyFor", "wasOriginatedBy",
)}


SHAPE_STRUCTURE_GUIDE = (
    "STRUCTURING SHAPES:\n"
    "A. A `sh:NodeShape` targets a class with `sh:targetClass`. A NodeShape can never be the subject of `sh:path`; "
    "always nest path constraints in `sh:property [ sh:path ... ]`. Example (property rule on a class):\n"
    "   inst:Question_1_Shape a sh:NodeShape ;\n"
    "       rdfs:label \"Every CMP observation must be linked to exactly one polishing step.\" ;\n"
    "       sh:targetClass cmpo:CMPObservation ;\n"
    "       sh:property [\n"
    "           sh:path cmpo:duringStep ;\n"
    "           sh:minCount 1 ; sh:maxCount 1 ;\n"
    "           sh:class cmpo:PolishingStep ;\n"
    "           sh:message \"Each CMP observation must be linked to exactly one polishing step.\"\n"
    "       ] .\n"
    "B. MEASUREMENTS ARE OBSERVATIONS. If the ontology records values as observations (e.g. a subclass of "
    "sosa:Observation linked to a parameter via sosa:observedProperty and to its value via sosa:hasSimpleResult), "
    "then parameter classes such as Pressure or Velocity are NOT things that have values, and a rule about ONE kind "
    "of parameter (\"pressure values must be positive\", \"slurry flow rates must be non-negative\") must check ONLY "
    "observations whose sosa:observedProperty is that parameter or one of its subclasses. A plain "
    "`sh:property [ sh:path sosa:hasSimpleResult ... ]` on the observation class is WRONG for such a rule: it would "
    "check every observation of every parameter. Use a SPARQL constraint written with FULL IRIs (no prefixes inside "
    "the query) that selects only the violating observations:\n"
    "   inst:Question_2_Shape a sh:NodeShape ;\n"
    "       rdfs:label \"Pressure values must be positive float values.\" ;\n"
    "       sh:targetClass cmpo:CMPObservation ;\n"
    "       sh:sparql [\n"
    "           a sh:SPARQLConstraint ;\n"
    "           sh:message \"Pressure observation values must be positive floats.\" ;\n"
    "           sh:select \"\"\"\n"
    "               SELECT $this ?value WHERE {\n"
    "                   $this <http://www.w3.org/ns/sosa/observedProperty> ?param .\n"
    "                   ?param <http://www.w3.org/2000/01/rdf-schema#subClassOf>* <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#Pressure> .\n"
    "                   $this <http://www.w3.org/ns/sosa/hasSimpleResult> ?value .\n"
    "                   FILTER (datatype(?value) != <http://www.w3.org/2001/XMLSchema#float> || ?value <= 0)\n"
    "               }\"\"\"\n"
    "       ] .\n"
    "   Replace cmpo:Pressure with the parameter class the rule is about (find it in the ontology), and adapt the "
    "FILTER so it matches exactly the values that BREAK the rule.\n"
)


def schema_context(schema_ttl: Optional[str], limit: int = 12000) -> str:
    """Schema text for prompts: comment-only lines are dropped so the limit is spent on definitions."""
    if not schema_ttl:
        return "CMP semiconductor ontology."
    lines = [ln for ln in schema_ttl.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    return "\n".join(lines)[:limit]


def data_sample(instance_ttl: Optional[str], limit: int = 3000) -> str:
    """Start of the user's real instance data, showing the actual data structure to the AI."""
    if not instance_ttl or not instance_ttl.strip():
        return ""
    return instance_ttl.strip()[:limit]


class SHACLVerifier:
    def __init__(self, llm_service: Optional[LocalLLMService] = None):
        self.llm = llm_service or LocalLLMService()

    @staticmethod
    def extract_ontology_terms(schema_ttl_or_graph: Any) -> Set[str]:
        """
        Parses the ontology schema and returns all known class and property IRIs as strings.
        Supports classes (owl:Class, rdfs:Class) and properties (owl:ObjectProperty, owl:DatatypeProperty, rdf:Property).
        """
        if isinstance(schema_ttl_or_graph, Graph):
            g = schema_ttl_or_graph
        else:
            g = Graph()
            if schema_ttl_or_graph and isinstance(schema_ttl_or_graph, str) and schema_ttl_or_graph.strip():
                try:
                    g.parse(data=schema_ttl_or_graph, format="turtle")
                except Exception as e:
                    try:
                        g.parse(data=schema_ttl_or_graph, format="xml")
                    except Exception:
                        logger.warning(f"Could not parse ontology schema: {e}")

        known_terms = set()
        # Classes
        for cls in g.subjects(RDF.type, OWL.Class):
            if isinstance(cls, URIRef):
                known_terms.add(str(cls))
        for cls in g.subjects(RDF.type, RDFS.Class):
            if isinstance(cls, URIRef):
                known_terms.add(str(cls))
        for s, _, o in g.triples((None, RDFS.subClassOf, None)):
            if isinstance(s, URIRef):
                known_terms.add(str(s))
            if isinstance(o, URIRef):
                known_terms.add(str(o))

        # Properties
        for prop in g.subjects(RDF.type, OWL.ObjectProperty):
            if isinstance(prop, URIRef):
                known_terms.add(str(prop))
        for prop in g.subjects(RDF.type, OWL.DatatypeProperty):
            if isinstance(prop, URIRef):
                known_terms.add(str(prop))
        for prop in g.subjects(RDF.type, RDF.Property):
            if isinstance(prop, URIRef):
                known_terms.add(str(prop))

        # Domain/Range predicates
        for p, _, _ in g.triples((None, RDFS.domain, None)):
            if isinstance(p, URIRef):
                known_terms.add(str(p))
        for p, _, _ in g.triples((None, RDFS.range, None)):
            if isinstance(p, URIRef):
                known_terms.add(str(p))

        return known_terms

    @staticmethod
    def extract_used_terms(data_ttl: Optional[str]) -> Set[str]:
        """Properties and classes actually used in instance data (predicates and rdf:type objects)."""
        used = set()
        if not data_ttl or not data_ttl.strip():
            return used
        g = Graph()
        try:
            g.parse(data=data_ttl, format="turtle")
        except Exception as e:
            logger.warning(f"Could not parse instance data for known terms: {e}")
            return used
        for p in g.predicates(unique=True):
            if isinstance(p, URIRef):
                used.add(str(p))
        for o in g.objects(None, RDF.type, unique=True):
            if isinstance(o, URIRef):
                used.add(str(o))
        return used

    @staticmethod
    def _is_standard_vocab(iri: str) -> bool:
        return any(iri.startswith(std) for std in STANDARD_VOCABULARIES)

    def check_grounding(self, shape_ttl: str, known_terms: Set[str]) -> List[str]:
        """
        Check 1: Grounding check
        - Parse generated shape with RDFLib.
        - Collect every class used in sh:targetClass, sh:class, sh:node.
        - Collect every property IRI used in sh:path.
        - Compare against known ontology terms, ignoring standard vocabularies (rdf, rdfs, owl, xsd, sh).
        - Return list of unknown/hallucinated terms.
        """
        if not known_terms:
            return []  # No schema terms provided, cannot claim terms are hallucinated

        g_shape = Graph()
        try:
            g_shape.parse(data=shape_ttl, format="turtle")
        except Exception as e:
            logger.warning(f"Grounding check failed to parse shape Turtle: {e}")
            return [f"SyntaxError: {str(e)[:100]}"]

        used_terms = set()

        # sh:targetClass
        for _, _, target_cls in g_shape.triples((None, SH.targetClass, None)):
            if isinstance(target_cls, URIRef):
                used_terms.add(str(target_cls))

        # sh:class
        for _, _, cls in g_shape.triples((None, SH["class"], None)):
            if isinstance(cls, URIRef):
                used_terms.add(str(cls))

        # sh:node
        for _, _, node in g_shape.triples((None, SH.node, None)):
            if isinstance(node, URIRef):
                used_terms.add(str(node))

        # sh:path
        for _, _, path in g_shape.triples((None, SH.path, None)):
            if isinstance(path, URIRef):
                used_terms.add(str(path))
            elif isinstance(path, BNode):
                # Traverse sequence or alternative path
                for _, _, item in g_shape.triples((path, None, None)):
                    if isinstance(item, URIRef):
                        used_terms.add(str(item))

        # Filter out standard vocabularies and check against known terms
        unknown_terms = []
        for term in sorted(used_terms):
            if self._is_standard_vocab(term):
                continue
            if term not in known_terms and term not in SOSA_SSN_TERMS:
                unknown_terms.append(term)

        return unknown_terms

    def _generate_test_examples(self, rule_text: str, shape_ttl: str, schema_ttl: Optional[str], model: Optional[str] = None,
                                instance_ttl: Optional[str] = None) -> Tuple[List[str], List[str]]:
        """
        Calls LLM to generate 3 valid and 3 invalid tiny Turtle instance graphs.
        Returns (valid_examples, invalid_examples).
        """
        schema_snippet = schema_context(schema_ttl)
        sample = data_sample(instance_ttl)
        sample_text = (
            "EXAMPLE OF THE USER'S REAL INSTANCE DATA (follow the same structure, properties and classes):\n"
            f"{sample}\n\n"
        ) if sample else ""
        prompt = (
            "You are a Semantic Web and SHACL validation test engineer.\n"
            "Given the plain-English data quality rule, the generated SHACL shape, and the ontology context, "
            "generate exactly 3 VALID and 3 INVALID minimal RDF Turtle instance graphs to test the SHACL shape.\n\n"
            f"Rule: \"{rule_text}\"\n\n"
            f"Generated SHACL Shape:\n{shape_ttl}\n\n"
            f"Ontology snippet:\n{schema_snippet}\n\n"
            f"{sample_text}"
            "Requirements:\n"
            "1. 'valid' examples: Minimal instance graphs that MUST fully satisfy and conform to the shape and rule.\n"
            "2. 'invalid' examples: Minimal instance graphs that deliberately violate the rule (e.g. negative value, missing mandatory property, wrong type).\n"
            "   SCOPE TEST (required): at least one 'valid' example must contain an item the rule is NOT about that would break "
            "the rule's condition if the rule applied to it, e.g. for 'pressure values must be positive' an observation of a "
            "different parameter (such as a temperature or zeta potential) with a negative value. The shape must accept it; "
            "a shape that rejects it is too broad.\n"
            "3. Each example must be a self-contained Turtle (.ttl) string including all necessary @prefix declarations (@prefix cmpo: ..., @prefix inst: ..., @prefix xsd: ..., @prefix rdfs: ...).\n"
            "4. Return strictly JSON with exactly this structure:\n"
            "{\n"
            "  \"valid\": [\"<turtle snippet 1>\", \"<turtle snippet 2>\", \"<turtle snippet 3>\"],\n"
            "  \"invalid\": [\"<turtle snippet 1>\", \"<turtle snippet 2>\", \"<turtle snippet 3>\"],\n"
            "}\n"
        )
        messages = [
            {"role": "system", "content": "You are a SHACL test dataset generator. You output only valid JSON."},
            {"role": "user", "content": prompt}
        ]

        response = self.llm._call_kiste(messages, json_mode=True, temperature=0.1, model_override=model)
        data = json.loads(response)
        valid = data.get("valid", [])
        invalid = data.get("invalid", [])
        return (valid if isinstance(valid, list) else [], invalid if isinstance(invalid, list) else [])

    def check_test_data(
        self,
        rule_text: str,
        shape_ttl: str,
        schema_ttl: Optional[str] = None,
        model: Optional[str] = None,
        instance_ttl: Optional[str] = None
    ) -> Tuple[bool, List[Dict[str, Any]], str]:
        """
        Check 2: Test-data check
        - Ask LLM for 3 valid and 3 invalid tiny Turtle graphs.
        - Run pyshacl.validate on each.
        - Verify valid -> conforms, invalid -> does not conform.
        - Discard broken example and retry once.
        - If fewer than 2 valid and 2 invalid usable examples remain: return unverified ("not enough test examples").
        Returns (passed, failed_examples, reason).
        """
        try:
            valid_raw, invalid_raw = self._generate_test_examples(rule_text, shape_ttl, schema_ttl, model, instance_ttl)
        except Exception as e:
            logger.warning(f"Error generating test examples: {e}")
            return False, [], "failed to generate test examples"

        def filter_parseable(examples: List[str]) -> Tuple[List[str], List[str]]:
            clean_good = []
            broken = []
            for ex in examples:
                if not isinstance(ex, str) or not ex.strip():
                    continue
                # Clean code fences if LLM included any inside string
                clean_ex = re.sub(r"^```[a-zA-Z]*\n", "", ex.strip())
                clean_ex = re.sub(r"```$", "", clean_ex).strip()
                g = Graph()
                try:
                    g.parse(data=clean_ex, format="turtle")
                    clean_good.append(clean_ex)
                except Exception:
                    broken.append(clean_ex)
            return clean_good, broken

        valid_clean, broken_v = filter_parseable(valid_raw)
        invalid_clean, broken_inv = filter_parseable(invalid_raw)

        # Retry once if we had broken examples and don't meet the 2 usable threshold
        if (len(valid_clean) < 2 or len(invalid_clean) < 2) and (broken_v or broken_inv):
            try:
                retry_v, retry_inv = self._generate_test_examples(rule_text, shape_ttl, schema_ttl, model, instance_ttl)
                v2, _ = filter_parseable(retry_v)
                inv2, _ = filter_parseable(retry_inv)
                valid_clean = list(dict.fromkeys(valid_clean + v2))
                invalid_clean = list(dict.fromkeys(invalid_clean + inv2))
            except Exception as e:
                logger.warning(f"Retry generating test examples failed: {e}")

        if len(valid_clean) < 2 or len(invalid_clean) < 2:
            return False, [], "not enough test examples"

        failed_examples = []
        ont_graph = None
        if schema_ttl and schema_ttl.strip():
            try:
                ont_graph = Graph()
                ont_graph.parse(data=schema_ttl, format="turtle")
            except Exception:
                ont_graph = None

        g_shape = Graph()
        try:
            g_shape.parse(data=shape_ttl, format="turtle")
        except Exception as e:
            return False, [{"example": shape_ttl, "expected": "valid", "actual": "parse_error", "message": str(e)}], "shape syntax error"

        # Test valid examples (expected: conforms == True)
        for ex in valid_clean[:3]:
            g_data = Graph()
            try:
                g_data.parse(data=ex, format="turtle")
                conforms, _, results_text = pyshacl.validate(
                    g_data,
                    shacl_graph=g_shape,
                    ont_graph=ont_graph,
                    inference="none",
                    abort_on_first=False
                )
                if not conforms:
                    failed_examples.append({
                        "example": ex,
                        "expected": "valid",
                        "actual": "violates",
                        "message": "Expected valid instance to conform, but SHACL shape rejected it."
                    })
            except Exception as e:
                failed_examples.append({
                    "example": ex,
                    "expected": "valid",
                    "actual": "error",
                    "message": f"Execution error: {str(e)[:100]}"
                })

        # Test invalid examples (expected: conforms == False)
        for ex in invalid_clean[:3]:
            g_data = Graph()
            try:
                g_data.parse(data=ex, format="turtle")
                conforms, _, results_text = pyshacl.validate(
                    g_data,
                    shacl_graph=g_shape,
                    ont_graph=ont_graph,
                    inference="none",
                    abort_on_first=False
                )
                if conforms:
                    failed_examples.append({
                        "example": ex,
                        "expected": "invalid",
                        "actual": "conforms",
                        "message": "Expected invalid instance to violate shape, but SHACL shape accepted it."
                    })
            except Exception as e:
                failed_examples.append({
                    "example": ex,
                    "expected": "invalid",
                    "actual": "error",
                    "message": f"Execution error: {str(e)[:100]}"
                })

        passed = (len(failed_examples) == 0)
        reason = "" if passed else f"{len(failed_examples)} behavioral test case(s) failed"
        return passed, failed_examples, reason

    def repair_shape(
        self,
        rule_text: str,
        current_shape_ttl: str,
        unknown_terms: List[str],
        failed_examples: List[Dict[str, Any]],
        schema_ttl: Optional[str] = None,
        model: Optional[str] = None,
        instance_ttl: Optional[str] = None
    ) -> str:
        """
        Check 3: Repair loop prompt
        Sends original sentence, current shape, unknown terms and failed examples explained in words.
        Returns corrected Turtle shape code.
        """
        issue_descriptions = []
        if unknown_terms:
            issue_descriptions.append(
                f"- Unknown/hallucinated terms not found in the ontology schema: {', '.join(unknown_terms)}. "
                f"You MUST use only valid classes and properties from the ontology."
            )
        for fe in failed_examples[:3]:
            ex_snippet = fe.get("example", "")[:200]
            if fe.get("expected") == "invalid" and fe.get("actual") == "conforms":
                issue_descriptions.append(
                    f"- The shape accepted an invalid test example that it should have rejected: {ex_snippet} "
                    f"(Make sure constraints like sh:minInclusive, sh:minCount, or sh:datatype are properly placed inside sh:property)."
                )
            elif fe.get("expected") == "valid" and fe.get("actual") == "violates":
                issue_descriptions.append(
                    f"- The shape rejected a valid test example that conforms to the rule: {ex_snippet} "
                    f"(Check for overly strict constraints, a wrong targetClass, or a shape that also checks items "
                    f"the rule is not about, e.g. observations of other parameters)."
                )

        issues_text = "\n".join(issue_descriptions) or "The shape did not conform to the expected rule behavior."
        schema_snippet = schema_context(schema_ttl)
        sample = data_sample(instance_ttl)
        sample_text = (
            "EXAMPLE OF THE USER'S REAL INSTANCE DATA (follow the same structure, properties and classes):\n"
            f"{sample}\n\n"
        ) if sample else ""

        prompt = (
            "You are an expert Semantic Web and SHACL developer.\n"
            f"The following SHACL shape was generated for the rule: \"{rule_text}\", but verification found issues:\n\n"
            f"DETECTED ISSUES:\n{issues_text}\n\n"
            f"CURRENT SHACL SHAPE:\n{current_shape_ttl}\n\n"
            f"ONTOLOGY SCHEMA CONTEXT:\n{schema_snippet}\n\n"
            f"{sample_text}"
            "Instructions:\n"
            "1. Output ONLY valid, corrected Turtle (.ttl) syntax for the shape.\n"
            "2. Fix all hallucinated terms and constraint logic errors.\n"
            "3. Nest property constraints inside sh:property [ sh:path ... ]. Never attach sh:path directly to sh:NodeShape.\n"
            "4. Do NOT output any explanations, markdown code blocks, or text before/after the Turtle.\n\n"
            f"{SHAPE_STRUCTURE_GUIDE}"
        )
        messages = [
            {"role": "system", "content": "You are a SHACL code repair expert. You output only valid Turtle syntax without markdown."},
            {"role": "user", "content": prompt}
        ]

        response = self.llm._call_kiste(messages, json_mode=False, temperature=0.1, model_override=model)
        clean_ttl = re.sub(r"^```[a-zA-Z]*\n", "", response)
        clean_ttl = re.sub(r"```$", "", clean_ttl.strip())
        return clean_ttl.strip()

    def verify_and_repair(
        self,
        rule_text: str,
        initial_shape_ttl: str,
        schema_ttl: Optional[str] = None,
        known_terms: Optional[Set[str]] = None,
        on_progress: Optional[Callable[[str], None]] = None,
        model: Optional[str] = None,
        instance_ttl: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes the full verification & repair pipeline:
        1. Grounding check
        2. Test-data check
        3. Repair loop (up to 3 attempts)
        Returns:
        {
          "rule_text": str,
          "shape_ttl": str,
          "verification": "verified" | "repaired" | "unverified",
          "attempts": int,
          "unknown_terms": list,
          "failed_examples": list,
          "reason": str
        }
        """
        # If verification is disabled by config, return verified immediately
        if not getattr(settings, "ENABLE_SHACL_VERIFICATION", True):
            return {
                "rule_text": rule_text,
                "shape_ttl": initial_shape_ttl,
                "verification": "verified",
                "attempts": 1,
                "unknown_terms": [],
                "failed_examples": [],
                "reason": "verification disabled"
            }

        if known_terms is None and schema_ttl:
            known_terms = self.extract_ontology_terms(schema_ttl)
        known_terms = known_terms or set()

        current_shape = initial_shape_ttl
        attempts = 1
        max_attempts = 4  # Initial attempt + up to 3 repair attempts

        last_unknown_terms = []
        last_failed_examples = []
        last_reason = ""

        while attempts <= max_attempts:
            # Check 1: Grounding check
            if on_progress:
                on_progress("grounding" if attempts == 1 else "repairing")

            unknown_terms = self.check_grounding(current_shape, known_terms)
            grounding_passed = (len(unknown_terms) == 0)
            last_unknown_terms = unknown_terms

            # Check 2: Test-data check
            if on_progress:
                on_progress("testing" if attempts == 1 else "repairing")

            test_passed = False
            failed_examples = []
            test_reason = ""

            try:
                test_passed, failed_examples, test_reason = self.check_test_data(
                    rule_text=rule_text,
                    shape_ttl=current_shape,
                    schema_ttl=schema_ttl,
                    model=model,
                    instance_ttl=instance_ttl
                )
            except KisteConnectionError:
                return {
                    "rule_text": rule_text,
                    "shape_ttl": current_shape,
                    "verification": "unverified",
                    "attempts": attempts,
                    "unknown_terms": last_unknown_terms,
                    "failed_examples": [],
                    "reason": "verification unavailable"
                }
            except Exception as ex:
                test_passed = False
                test_reason = str(ex)

            last_failed_examples = failed_examples
            last_reason = test_reason

            # If both checks passed
            if grounding_passed and test_passed:
                return {
                    "rule_text": rule_text,
                    "shape_ttl": current_shape,
                    "verification": "verified" if attempts == 1 else "repaired",
                    "attempts": attempts,
                    "unknown_terms": [],
                    "failed_examples": [],
                    "reason": ""
                }

            # If failed and attempts remain, try repair
            if attempts < max_attempts:
                if on_progress:
                    on_progress("repairing")
                try:
                    current_shape = self.repair_shape(
                        rule_text=rule_text,
                        current_shape_ttl=current_shape,
                        unknown_terms=unknown_terms,
                        failed_examples=failed_examples,
                        schema_ttl=schema_ttl,
                        model=model,
                        instance_ttl=instance_ttl
                    )
                except KisteConnectionError:
                    return {
                        "rule_text": rule_text,
                        "shape_ttl": current_shape,
                        "verification": "unverified",
                        "attempts": attempts,
                        "unknown_terms": last_unknown_terms,
                        "failed_examples": last_failed_examples,
                        "reason": "verification unavailable"
                    }
                except Exception as ex:
                    last_reason = f"Repair failed: {ex}"
                    break

            attempts += 1

        # Still failing after repair limit or test example shortage
        final_reason = last_reason
        if last_unknown_terms and not final_reason:
            final_reason = f"Unknown terms: {', '.join(last_unknown_terms)}"

        return {
            "rule_text": rule_text,
            "shape_ttl": current_shape,
            "verification": "unverified",
            "attempts": min(attempts, max_attempts),
            "unknown_terms": last_unknown_terms,
            "failed_examples": last_failed_examples,
            "reason": final_reason or "shape failed verification tests"
        }
