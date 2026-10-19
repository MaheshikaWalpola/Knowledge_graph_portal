import os
import re
import json
import logging
from concurrent.futures import Future, ThreadPoolExecutor
from functools import lru_cache
from typing import List, Dict, Any, Optional, Set, Tuple, Callable
from rdflib import Graph, Namespace, RDF, RDFS, OWL, XSD, URIRef, BNode
from rdflib.compare import isomorphic
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


_PROSE_PREDICATES = {str(RDFS.comment), str(OWL.versionInfo)}
_DCTERMS = "http://purl.org/dc/terms/"


@lru_cache(maxsize=8)
def compact_schema(schema_ttl: Optional[str]) -> str:
    """
    Ontology text for AI prompts: every class, property, label, synonym and hierarchy/domain/range link,
    without long prose descriptions and metadata (about a third of the size for CMPO), so prompts stay fast.
    Falls back to the text without comment lines if it cannot be parsed.
    """
    if not schema_ttl or not schema_ttl.strip():
        return ""
    try:
        g = Graph()
        g.parse(data=schema_ttl, format="turtle")
        small = Graph()
        for pfx, ns in g.namespaces():
            small.bind(pfx, ns)
        for s, p, o in g:
            if str(p) in _PROSE_PREDICATES or str(p).startswith(_DCTERMS):
                continue
            small.add((s, p, o))
        return small.serialize(format="turtle")
    except Exception:
        lines = [ln for ln in schema_ttl.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
        return "\n".join(lines)


def schema_context(schema_ttl: Optional[str], limit: int = 12000) -> str:
    """Compact schema text for verification prompts, capped at limit characters."""
    text = compact_schema(schema_ttl)
    return text[:limit] if text else "CMP semiconductor ontology."


def data_sample(instance_ttl: Optional[str], limit: int = 3000) -> str:
    """Start of the user's real instance data, showing the actual data structure to the AI."""
    if not instance_ttl or not instance_ttl.strip():
        return ""
    return instance_ttl.strip()[:limit]


CMPO = "https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#"
INST = "https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/"

# Prefixes declared for the AI's test graphs, so it does not have to write them (shorter answers, fewer parse errors)
BASE_PREFIXES = {
    "rdf": str(RDF), "rdfs": str(RDFS), "owl": str(OWL), "xsd": str(XSD), "sh": str(SH),
    "sosa": _SOSA, "ssn": _SSN, "cmpo": CMPO, "inst": INST,
}

# Text a shape carries for humans. Removed before back-translation, so the AI has to read the logic instead of
# repeating the rule it was given in the label.
_HUMAN_TEXT_PREDICATES = {RDFS.label, RDFS.comment, SH.message, SH.name, SH.description}

MEANING_VERDICTS = ("equivalent", "broader", "narrower", "different")

# Optional reasoning effort for verification AI calls (e.g. "low" for gpt-oss); unset sends nothing extra
VERIFY_REASONING_EFFORT = os.getenv("KISTE_VERIFY_REASONING_EFFORT") or None


@lru_cache(maxsize=8)
def parse_schema(schema_ttl: Optional[str]) -> Optional[Graph]:
    """Parsed ontology, cached per text (treat as read-only); None if missing or not parseable."""
    if not schema_ttl or not schema_ttl.strip():
        return None
    # No rdflib default prefixes (brick, foaf, ...): only the ones the ontology declares reach the prompts
    g = Graph(bind_namespaces="none")
    try:
        g.parse(data=schema_ttl, format="turtle")
        return g
    except Exception:
        return None


@lru_cache(maxsize=8)
def prefix_block(schema_ttl: Optional[str]) -> str:
    """@prefix lines for the common vocabularies plus every prefix the ontology declares."""
    prefixes = dict(BASE_PREFIXES)
    g = parse_schema(schema_ttl)
    if g is not None:
        for pfx, ns in g.namespaces():
            if pfx and pfx not in prefixes and str(ns) not in prefixes.values():
                prefixes[pfx] = str(ns)
    return "\n".join(f"@prefix {p}: <{ns}> ." for p, ns in prefixes.items())


@lru_cache(maxsize=8)
def ontology_digest(schema_ttl: Optional[str]) -> str:
    """
    One line per class and property (parents, domain -> range, label) for verification prompts. Several times
    shorter than Turtle, so the whole ontology fits in the prompt instead of being cut off at a character limit.
    """
    g = parse_schema(schema_ttl)
    if g is None:
        return schema_context(schema_ttl)
    names = Graph()
    for line in prefix_block(schema_ttl).splitlines():
        m = re.match(r"@prefix (\S*): <([^>]*)> \.", line)
        if m:
            names.bind(m.group(1), m.group(2), override=True)

    def qn(term) -> str:
        try:
            return names.namespace_manager.normalizeUri(term)
        except Exception:
            return f"<{term}>"

    def label(term) -> str:
        lbl = next((str(o) for o in g.objects(term, RDFS.label)), "")
        local = re.split(r"[#/]", str(term))[-1]
        return f'  "{lbl}"' if lbl and lbl.replace(" ", "").lower() != local.lower() else ""

    classes = {s for t in (OWL.Class, RDFS.Class) for s in g.subjects(RDF.type, t) if isinstance(s, URIRef)}
    classes |= {s for s in g.subjects(RDFS.subClassOf, None) if isinstance(s, URIRef)}
    props: Dict[URIRef, str] = {}
    for kind, t in (("object", OWL.ObjectProperty), ("datatype", OWL.DatatypeProperty), ("property", RDF.Property)):
        for s in g.subjects(RDF.type, t):
            if isinstance(s, URIRef):
                props.setdefault(s, kind)
    for pred in (RDFS.domain, RDFS.range):
        for s in g.subjects(pred, None):
            if isinstance(s, URIRef):
                props.setdefault(s, "property")
    if not classes and not props:
        return schema_context(schema_ttl)

    lines = ["CLASSES (class < parent classes):"]
    for c in sorted(classes, key=str):
        parents = [qn(o) for o in g.objects(c, RDFS.subClassOf) if isinstance(o, URIRef)]
        lines.append(qn(c) + (f" < {', '.join(parents)}" if parents else "") + label(c))
    lines.append("PROPERTIES (property [kind] domain -> range):")
    for p in sorted(props, key=str):
        dom = ", ".join(qn(o) for o in g.objects(p, RDFS.domain) if isinstance(o, URIRef)) or "any"
        rng = ", ".join(qn(o) for o in g.objects(p, RDFS.range) if isinstance(o, URIRef)) or "any"
        lines.append(f"{qn(p)} [{props[p]}] {dom} -> {rng}{label(p)}")
    return "\n".join(lines)


def _strip_fences(text: str) -> str:
    text = re.sub(r"^```[a-zA-Z]*\n", "", (text or "").strip())
    return re.sub(r"```$", "", text).strip()


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
            if isinstance(node, URIRef) and (node, None, None) not in g_shape:
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

    def check_static(self, shape_ttl: str, known_terms: Set[str]) -> Tuple[Optional[Graph], List[str], List[str]]:
        """
        Check 1, no AI: the shape is valid Turtle, is valid SHACL (checked against the W3C SHACL-for-SHACL
        shapes), has a target, and uses only terms from the ontology.
        Returns (parsed shape or None, problems, unknown terms).
        """
        g = Graph()
        try:
            g.parse(data=shape_ttl, format="turtle")
        except Exception as e:
            return None, [f"The shape is not valid Turtle: {str(e)[:150]}"], []

        problems = []
        try:
            pyshacl.validate(Graph(), shacl_graph=g, meta_shacl=True)
        except Exception as e:
            msgs = list(dict.fromkeys(re.findall(r"Message: (.+)", str(e))))
            problems.append("The shape is not valid SHACL: " + ("; ".join(msgs[:3]) if msgs else str(e)[:150]))

        targets = (SH.targetClass, SH.targetNode, SH.targetSubjectsOf, SH.targetObjectsOf)
        if not any(next(g.triples((None, t, None)), None) for t in targets):
            problems.append("The shape has no target (e.g. sh:targetClass), so it never checks anything.")

        unknown = self.check_grounding(shape_ttl, known_terms)
        if unknown:
            problems.append("It uses terms that are not in the ontology: " + ", ".join(unknown))
        return g, problems, unknown

    def generate_test_cases(self, rule_text: str, schema_ttl: Optional[str] = None, model: Optional[str] = None,
                            instance_ttl: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Check 2a: blind test data. Written from the English rule and the ontology only, never from the shape, so
        the tests say what the rule means instead of repeating what the shape does. Each invalid graph is a copy
        of a valid one with one change, which keeps the examples realistic and the failure easy to explain.
        Asks again once if fewer than 2 usable pairs come back.
        Returns [{"ttl", "graph", "expected": "valid" | "invalid", "note"}].
        """
        cases = self._request_test_cases(rule_text, schema_ttl, model, instance_ttl)
        if sum(1 for c in cases if c["expected"] == "invalid") < 2:
            seen = {c["ttl"] for c in cases}
            cases += [c for c in self._request_test_cases(rule_text, schema_ttl, model, instance_ttl)
                      if c["ttl"] not in seen]
        return cases

    def _request_test_cases(self, rule_text: str, schema_ttl: Optional[str], model: Optional[str],
                            instance_ttl: Optional[str]) -> List[Dict[str, Any]]:
        prefixes = prefix_block(schema_ttl)
        prefix_names = ", ".join(re.findall(r"@prefix (\S*):", prefixes))
        sample = data_sample(instance_ttl)
        sample_text = (
            "EXAMPLE OF THE USER'S REAL DATA (build the test data with the same structure, classes and properties):\n"
            f"{sample}\n\n"
        ) if sample else ""
        prompt = (
            "Write test data for a data quality rule on an RDF knowledge graph. You do not see how the rule is "
            "implemented; work only from the rule and the ontology.\n\n"
            f"RULE: \"{rule_text}\"\n\n"
            f"ONTOLOGY:\n{ontology_digest(schema_ttl)}\n\n"
            f"{sample_text}"
            "Write 3 test PAIRS:\n"
            "- \"valid\": a minimal Turtle graph that follows the rule. Give every node its rdf:type and include every "
            "link and value the rule talks about, shaped like the real data.\n"
            "- \"invalid\": a copy of \"valid\" with ONE small change that breaks the rule (a value out of range, a "
            "missing required link or value, a wrong unit or datatype). If the rule has several parts, break a "
            "different part in each pair.\n"
            "- \"change\": a few words saying what you changed.\n"
            "Also write \"out_of_scope\": a minimal graph with an item the rule is NOT about that would break the "
            "rule's condition if the rule applied to it (e.g. for a pressure rule, an observation of another parameter "
            "with a bad value). Use \"\" if there is no such item.\n\n"
            f"Do NOT write @prefix lines. These prefixes are already declared: {prefix_names}. "
            "Write any other IRI in full as <...>.\n"
            "Return JSON only: {\"pairs\": [{\"valid\": \"...\", \"invalid\": \"...\", \"change\": \"...\"}], "
            "\"out_of_scope\": \"...\"}"
        )
        messages = [
            {"role": "system", "content": "You write minimal RDF test data in Turtle. You output only valid JSON."},
            {"role": "user", "content": prompt},
        ]
        response = self.llm._call_kiste(messages, json_mode=True, temperature=0.2, model_override=model,
                                        reasoning_effort=VERIFY_REASONING_EFFORT)
        try:
            data = json.loads(_strip_fences(response))
        except Exception as e:
            logger.warning(f"Test data answer was not JSON: {e}")
            return []
        if not isinstance(data, dict):
            return []

        def parse(body: Any) -> Optional[Tuple[str, Graph]]:
            if not isinstance(body, str) or not body.strip():
                return None
            body = _strip_fences(body)
            g = Graph()
            try:
                g.parse(data=prefixes + "\n" + body, format="turtle")
            except Exception:
                return None
            return (body, g) if len(g) else None

        cases = []
        pairs = data.get("pairs") if isinstance(data.get("pairs"), list) else []
        for pair in pairs:
            if not isinstance(pair, dict):
                continue
            valid, invalid = parse(pair.get("valid")), parse(pair.get("invalid"))
            # A pair is only useful if both graphs parse and the "broken" copy really differs
            if not valid or not invalid or isomorphic(valid[1], invalid[1]):
                continue
            change = str(pair.get("change") or "one change that breaks the rule")[:120]
            if all(c["ttl"] != valid[0] for c in cases):
                cases.append({"ttl": valid[0], "graph": valid[1], "expected": "valid", "note": "data that follows the rule"})
            cases.append({"ttl": invalid[0], "graph": invalid[1], "expected": "invalid", "note": change})
        out_of_scope = parse(data.get("out_of_scope"))
        if out_of_scope and cases:
            cases.append({"ttl": out_of_scope[0], "graph": out_of_scope[1], "expected": "valid",
                          "note": "an item the rule is not about"})
        return cases

    @staticmethod
    def run_tests(shape_graph: Graph, cases: List[Dict[str, Any]], ont_graph: Optional[Graph] = None) -> List[Dict[str, Any]]:
        """Check 2b, no AI: runs pySHACL on every test graph and returns the ones the shape got wrong."""
        failed = []
        for case in cases:
            expected_valid = case["expected"] == "valid"
            try:
                conforms, _, _ = pyshacl.validate(case["graph"], shacl_graph=shape_graph, ont_graph=ont_graph,
                                                  inference="none", abort_on_first=True)
            except Exception as e:
                failed.append({"example": case["ttl"], "expected": case["expected"], "actual": "error",
                               "message": f"The shape could not be run on test data ({case['note']}): {str(e)[:100]}"})
                continue
            if conforms == expected_valid:
                continue
            if expected_valid:
                message = f"The shape rejected test data it should accept ({case['note']})"
            else:
                message = f"The shape accepted test data that breaks the rule ({case['note']})"
            failed.append({"example": case["ttl"], "expected": case["expected"],
                           "actual": "violates" if expected_valid else "conforms", "message": message})
        return failed

    @staticmethod
    def logic_only(shape_graph: Graph) -> str:
        """The shape without labels, messages and comments, i.e. only what it actually checks."""
        g = Graph()
        for pfx, ns in shape_graph.namespaces():
            g.bind(pfx, ns)
        for t in shape_graph:
            if t[1] not in _HUMAN_TEXT_PREDICATES:
                g.add(t)
        return g.serialize(format="turtle")

    def check_meaning(self, rule_text: str, shape_graph: Graph, model: Optional[str] = None) -> Dict[str, str]:
        """
        Check 3: back-translation. One AI call describes what the shape does without seeing the rule (labels and
        messages are removed), and a second compares that description with the rule.
        Returns {"verdict": equivalent | broader | narrower | different | unknown, "explanation", "back_translation"}.
        """
        describe = (
            "Describe in plain English what this SHACL shape checks, in one or two sentences: which items it checks, "
            "which properties, and which values, counts, datatypes or units it accepts or rejects. Describe what the "
            "code really does, including mistakes; do not guess what it was meant to do.\n\n"
            f"{self.logic_only(shape_graph)}"
        )
        back_translation = self.llm._call_kiste(
            [{"role": "system", "content": "You explain SHACL shapes literally and briefly. Plain text only."},
             {"role": "user", "content": describe}],
            json_mode=False, temperature=0.0, model_override=model, reasoning_effort=VERIFY_REASONING_EFFORT
        ).strip()

        compare = (
            "A data quality rule was turned into a SHACL check. Compare what the rule asks with what the check does.\n\n"
            f"RULE: \"{rule_text}\"\n"
            f"WHAT THE CHECK DOES: \"{back_translation}\"\n\n"
            "Choose one verdict:\n"
            "- \"equivalent\": the check rejects exactly the data the rule forbids. Different wording is fine, and so "
            "are details the rule implies (e.g. a numeric datatype for a value limit, or requiring the value to exist).\n"
            "- \"broader\": the check also rejects data the rule allows (stricter limits, or it checks items the rule "
            "is not about).\n"
            "- \"narrower\": the check misses data the rule forbids (part of the rule is missing, or limits are looser).\n"
            "- \"different\": the check is about something else.\n"
            "Return JSON only: {\"verdict\": \"...\", \"explanation\": \"one short sentence naming the difference, "
            "or empty if equivalent\"}"
        )
        response = self.llm._call_kiste(
            [{"role": "system", "content": "You compare rules with what code does. You output only valid JSON."},
             {"role": "user", "content": compare}],
            json_mode=True, temperature=0.0, model_override=model, reasoning_effort=VERIFY_REASONING_EFFORT
        )
        try:
            data = json.loads(_strip_fences(response))
            verdict = str(data.get("verdict", "")).strip().lower()
            explanation = str(data.get("explanation") or "").strip()
        except Exception:
            verdict, explanation = "unknown", ""
        if verdict not in MEANING_VERDICTS:
            verdict = "unknown"
        return {"verdict": verdict, "explanation": explanation, "back_translation": back_translation}

    def repair_shape(
        self,
        rule_text: str,
        current_shape_ttl: str,
        problems: List[str],
        failed_examples: List[Dict[str, Any]],
        meaning: Optional[Dict[str, str]] = None,
        schema_ttl: Optional[str] = None,
        model: Optional[str] = None,
        instance_ttl: Optional[str] = None
    ) -> str:
        """Asks the AI for a corrected shape, given everything the checks found. Returns Turtle."""
        issues = [f"- {p}" for p in problems]
        if meaning and meaning.get("back_translation"):
            issues.append(f"- What the shape currently does: \"{meaning['back_translation']}\"")
        for fe in failed_examples[:3]:
            issues.append(f"- {fe.get('message', '')}. Test data:\n{fe.get('example', '')[:600]}")
        sample = data_sample(instance_ttl)
        sample_text = (
            "EXAMPLE OF THE USER'S REAL DATA (the shape must fit this structure):\n"
            f"{sample}\n\n"
        ) if sample else ""

        prompt = (
            "You are an expert Semantic Web and SHACL developer.\n"
            f"This SHACL shape was written for the rule \"{rule_text}\", but checking it found problems:\n\n"
            + "\n".join(issues) + "\n\n"
            f"CURRENT SHACL SHAPE:\n{current_shape_ttl}\n\n"
            f"ONTOLOGY:\n{ontology_digest(schema_ttl)}\n\n"
            f"{sample_text}"
            "Instructions:\n"
            "1. Output ONLY the corrected shape in valid Turtle, with its @prefix lines.\n"
            "2. Keep the same shape IRI and rdfs:label.\n"
            "3. Fix the problems so the shape checks exactly what the rule says, no more and no less.\n"
            "4. Nest property constraints inside sh:property [ sh:path ... ]. Never attach sh:path directly to sh:NodeShape.\n"
            "5. No explanations, markdown code blocks, or text before/after the Turtle.\n\n"
            f"{SHAPE_STRUCTURE_GUIDE}"
        )
        messages = [
            {"role": "system", "content": "You are a SHACL code repair expert. You output only valid Turtle syntax without markdown."},
            {"role": "user", "content": prompt}
        ]
        response = self.llm._call_kiste(messages, json_mode=False, temperature=0.1, model_override=model)
        return _strip_fences(response)

    def _check_once(self, rule_text: str, shape_ttl: str, known_terms: Set[str], ont_graph: Optional[Graph],
                    tests_future: Future, pool: ThreadPoolExecutor, model: Optional[str],
                    progress: Callable[[str], None]) -> Dict[str, Any]:
        """Runs all checks on one version of the shape and decides whether it is verified."""
        shape_graph, problems, unknown = self.check_static(shape_ttl, known_terms)
        if problems:
            # Fix the obvious problems before spending AI calls on the meaning
            return {"passed": False, "repairable": True, "problems": problems, "unknown_terms": unknown,
                    "failed_examples": [], "meaning": None, "tests_total": 0}

        progress("testing")
        meaning_future = pool.submit(self.check_meaning, rule_text, shape_graph, model)
        try:
            cases = tests_future.result()
        except KisteConnectionError:
            raise
        except Exception as e:
            logger.warning(f"Could not create test data for rule '{rule_text}': {e}")
            cases = []
        failed = self.run_tests(shape_graph, cases, ont_graph) if cases else []
        meaning = meaning_future.result()

        verdict = meaning["verdict"]
        enough_tests = sum(1 for c in cases if c["expected"] == "invalid") >= 2
        # AI-written test data is itself sometimes wrong. With enough tests, one disagreement is tolerated when
        # the independent meaning check confirms the shape; a real mistake would show in both checks.
        tolerated = 1 if len(cases) >= 6 and verdict == "equivalent" else 0

        if not enough_tests:
            problems.append("Could not create enough test data for this rule.")
        if verdict in ("broader", "narrower", "different"):
            problems.append(f"The shape's meaning is {verdict} than the rule"
                            + (f": {meaning['explanation']}" if meaning["explanation"] else "."))
        elif verdict == "unknown":
            problems.append("Could not compare the shape's meaning with the rule.")
        if len(failed) > tolerated:
            problems.append(f"{len(failed)} of {len(cases)} tests failed.")

        passed = enough_tests and verdict == "equivalent" and len(failed) <= tolerated
        # Repair only when a check found something wrong with the shape itself, not when the tests are missing
        repairable = not passed and (verdict in ("broader", "narrower", "different") or len(failed) > tolerated)
        return {"passed": passed, "repairable": repairable, "problems": problems, "unknown_terms": [],
                "failed_examples": failed, "meaning": meaning, "tests_total": len(cases)}

    @staticmethod
    def _result(rule_text: str, shape_ttl: str, verification: str, attempts: int, check: Dict[str, Any],
                reason: Optional[str] = None) -> Dict[str, Any]:
        failed = check.get("failed_examples", [])
        return {
            "rule_text": rule_text,
            "shape_ttl": shape_ttl,
            "verification": verification,
            "attempts": attempts,
            "unknown_terms": check.get("unknown_terms", []),
            "failed_examples": failed,
            "reason": reason if reason is not None else ("" if verification != "unverified" else " ".join(check.get("problems", []))),
            "meaning": check.get("meaning"),
            "tests": {"total": check.get("tests_total", 0), "failed": len(failed)},
        }

    def verify_and_repair(
        self,
        rule_text: str,
        initial_shape_ttl: str,
        schema_ttl: Optional[str] = None,
        known_terms: Optional[Set[str]] = None,
        on_progress: Optional[Callable[[str], None]] = None,
        model: Optional[str] = None,
        instance_ttl: Optional[str] = None,
        max_repairs: int = 1
    ) -> Dict[str, Any]:
        """
        Checks that a shape means what its English rule says, using three independent checks:
        1. Static (no AI): valid Turtle and SHACL, has a target, only ontology terms.
        2. Blind tests: test data written from the rule alone must be accepted or rejected as the rule says.
        3. Back-translation: the AI describes the shape without its labels and the description is compared with the rule.
        The shape is verified when all three agree; otherwise it is repaired up to max_repairs times. Test data is
        created once and reused, so re-checking a repaired shape only costs the back-translation.
        Returns {rule_text, shape_ttl, verification: verified | repaired | unverified, attempts, unknown_terms,
                 failed_examples, reason, meaning, tests}.
        """
        if not getattr(settings, "ENABLE_SHACL_VERIFICATION", True):
            return self._result(rule_text, initial_shape_ttl, "verified", 1, {}, reason="verification disabled")

        if known_terms is None and schema_ttl:
            known_terms = self.extract_ontology_terms(schema_ttl)
        known_terms = known_terms or set()
        ont_graph = parse_schema(schema_ttl)
        progress = on_progress or (lambda stage: None)

        shape_ttl = initial_shape_ttl
        attempts = 1
        check: Dict[str, Any] = {}
        pool = ThreadPoolExecutor(max_workers=2)
        try:
            progress("grounding")
            # Test data does not depend on the shape, so it is written while the shape is being checked
            tests_future = pool.submit(self.generate_test_cases, rule_text, schema_ttl, model, instance_ttl)
            while True:
                check = self._check_once(rule_text, shape_ttl, known_terms, ont_graph, tests_future, pool, model, progress)
                if check["passed"]:
                    return self._result(rule_text, shape_ttl, "verified" if attempts == 1 else "repaired", attempts, check)
                if attempts > max_repairs or not check["repairable"]:
                    return self._result(rule_text, shape_ttl, "unverified", attempts, check)
                progress("repairing")
                try:
                    shape_ttl = self.repair_shape(rule_text, shape_ttl, check["problems"], check["failed_examples"],
                                                  check["meaning"], schema_ttl, model, instance_ttl)
                except KisteConnectionError:
                    raise
                except Exception as e:
                    return self._result(rule_text, shape_ttl, "unverified", attempts, check, reason=f"Repair failed: {e}")
                attempts += 1
        except KisteConnectionError:
            return self._result(rule_text, shape_ttl, "unverified", attempts, check, reason="verification unavailable")
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
