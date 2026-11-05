"""
SHACL Verification Evaluation Harness

Answers: "How do we know an English question was correctly converted to a SHACL shape?" by measuring how well the
verifier tells correct shapes from wrong ones, against hand-made ground truth.

For every gold rule it builds candidate shapes:
- the gold shape (correct), and
- automatic mutants of it, each a typical translation mistake: a missing constraint, a shifted value limit,
  a wrong unit/value, or a wrong target class.
Each candidate is labelled correct or wrong by running the rule's hand-written gold test cases with pySHACL (a mutant
that still passes them all counts as correct). The verifier then judges every candidate WITHOUT repair, and the
harness reports:
- detection of wrong shapes (precision / recall / F1, wrong shape = positive class),
- how trustworthy "verified" is (share of verified shapes that are really correct),
- the same numbers for each signal alone (blind tests only, back-translation only), to show what combining them adds,
- with --repair: gold-test accuracy before and after one repair,
- AI calls and seconds per shape.

Usage:
  python evaluation/verify_eval.py --schema path/to/cmpo.ttl [--model gpt-oss-120b-MXFP4-Q8] [--repair] [--csv out.csv]
  python evaluation/verify_eval.py --mock     # offline smoke test of the harness itself, numbers are meaningless
"""

import os
import re
import sys
import csv
import json
import time
import argparse
import threading
from typing import Dict, Any, List, Tuple

from rdflib import Graph, Literal, URIRef, BNode
from rdflib.namespace import RDF, OWL
import pyshacl

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.shacl_verifier import SHACLVerifier, SH, parse_schema
from services.local_llm_service import LocalLLMService

DEFAULT_SCHEMA = """
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .

cmpo:CMPProcess a owl:Class .
cmpo:Pressure a owl:Class .
cmpo:Velocity a owl:Class .
cmpo:hasTimestamp a owl:DatatypeProperty .
cmpo:hasInput a owl:ObjectProperty .
cmpo:hasNumericValue a owl:DatatypeProperty .
cmpo:hasUnit a owl:DatatypeProperty .
"""


#  Ground truth

def gold_accuracy(shape_ttl: str, positive_cases: List[str], negative_cases: List[str],
                  ont_graph: Graph = None) -> Tuple[int, int]:
    """(correct, total) over the gold cases: positives must conform, negatives must violate."""
    total = len(positive_cases) + len(negative_cases)
    try:
        g_shape = Graph().parse(data=shape_ttl, format="turtle")
    except Exception:
        return 0, total
    correct = 0
    for cases, should_conform in ((positive_cases, True), (negative_cases, False)):
        for ex in cases:
            try:
                g_data = Graph().parse(data=ex, format="turtle")
                conforms, _, _ = pyshacl.validate(g_data, shacl_graph=g_shape, ont_graph=ont_graph, inference="none")
                correct += int(conforms == should_conform)
            except Exception:
                pass
    return correct, total


#  Mutants: typical English -> SHACL translation mistakes

def _subgraph(g: Graph, node) -> List[tuple]:
    """Triples of a blank-node structure (e.g. one sh:property [...] block)."""
    out, todo, seen = [], [node], set()
    while todo:
        n = todo.pop()
        if n in seen:
            continue
        seen.add(n)
        for t in g.triples((n, None, None)):
            out.append(t)
            if isinstance(t[2], BNode):
                todo.append(t[2])
    return out


def make_mutants(gold_ttl: str, schema: Graph) -> List[Tuple[str, str]]:
    """Returns [(mutation name, shape Turtle)]."""
    gold = Graph().parse(data=gold_ttl, format="turtle")
    mutants = []

    def variant(name, change):
        g = Graph()
        for pfx, ns in gold.namespaces():
            g.bind(pfx, ns)
        for t in gold:
            g.add(t)
        if change(g):
            mutants.append((name, g.serialize(format="turtle")))

    # A part of the rule is missing: drop each property constraint in turn
    for i, (s, _, prop) in enumerate(sorted(gold.triples((None, SH.property, None)), key=str)):
        def drop(g, s=s, prop=prop):
            g.remove((s, SH.property, prop))
            for t in _subgraph(g, prop):
                g.remove(t)
            return True
        variant(f"drop_property_{i + 1}", drop)

    # Value limits shifted (looser limit) or flipped between inclusive and exclusive
    for pred in (SH.minInclusive, SH.maxInclusive, SH.minExclusive, SH.maxExclusive):
        for s, _, o in list(gold.triples((None, pred, None))):
            def shift(g, s=s, pred=pred, o=o):
                value = float(o)
                looser = value - (abs(value) or 1) * 2 if "min" in str(pred) else value * 2 + 10
                g.set((s, pred, Literal(looser, datatype=o.datatype)))
                return True
            variant(f"shift_{str(pred).split('#')[-1]}", shift)

            def flip(g, s=s, pred=pred, o=o):
                other = {SH.minInclusive: SH.minExclusive, SH.minExclusive: SH.minInclusive,
                         SH.maxInclusive: SH.maxExclusive, SH.maxExclusive: SH.maxInclusive}[pred]
                g.remove((s, pred, o))
                g.add((s, other, o))
                return True
            variant(f"flip_{str(pred).split('#')[-1]}", flip)

    # Wrong required value (e.g. unit)
    for s, _, o in list(gold.triples((None, SH.hasValue, None))):
        if isinstance(o, Literal):
            variant("wrong_value", lambda g, s=s, o=o: g.set((s, SH.hasValue, Literal(str(o) + "_x"))) or True)

    # Wrong target class: another class from the ontology
    classes = sorted({c for c in schema.subjects(RDF.type, OWL.Class) if isinstance(c, URIRef)}, key=str)
    for s, _, target in list(gold.triples((None, SH.targetClass, None))):
        other = next((c for c in classes if c != target), None)
        if other is not None:
            variant("wrong_target", lambda g, s=s, other=other: g.set((s, SH.targetClass, other)) or True)
    return mutants


#  AI wrappers

class CountingLLM:
    """Counts AI calls per thread so cost per shape can be reported."""

    def __init__(self, inner):
        self.inner = inner
        self.lock = threading.Lock()
        self.total = 0

    def _call_kiste(self, *args, **kwargs):
        with self.lock:
            self.total += 1
        return self.inner._call_kiste(*args, **kwargs)


class MockLLM:
    """Offline stand-in, only to check that the harness runs. It answers from the gold cases, so it is not a measurement."""

    def __init__(self, rules: List[Dict[str, Any]]):
        self.rules = {r["question"]: r for r in rules}

    @staticmethod
    def _body(ttl: str) -> str:
        return "\n".join(ln for ln in ttl.splitlines() if not ln.strip().startswith("@prefix"))

    def _call_kiste(self, messages, json_mode=False, temperature=0.7, model_override=None, reasoning_effort=None):
        system, prompt = messages[0]["content"], messages[-1]["content"]
        if "test data" in system:
            rule = next((r for q, r in self.rules.items() if q in prompt), None)
            if not rule:
                return json.dumps({"pairs": []})
            pairs = [{"valid": self._body(rule["positive_cases"][i % len(rule["positive_cases"])]),
                      "invalid": self._body(neg), "change": "gold negative case"}
                     for i, neg in enumerate(rule["negative_cases"])]
            return json.dumps({"pairs": pairs, "out_of_scope": ""})
        if "explain SHACL" in system:
            return "Checks the target class against the listed constraints."
        if "compare rules" in system:
            return json.dumps({"verdict": "equivalent", "explanation": ""})
        return re.search(r"CURRENT SHACL SHAPE:\n(.*?)\n\nONTOLOGY:", prompt, re.S).group(1)


#  Metrics

def detection_scores(rows: List[Dict[str, Any]], accepted_key: str) -> Dict[str, float]:
    """Wrong shape = positive class. A shape is 'flagged' when the signal does not accept it."""
    tp = sum(1 for r in rows if not r["truly_correct"] and not r[accepted_key])
    fp = sum(1 for r in rows if r["truly_correct"] and not r[accepted_key])
    fn = sum(1 for r in rows if not r["truly_correct"] and r[accepted_key])
    accepted = [r for r in rows if r[accepted_key]]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    trust = sum(1 for r in accepted if r["truly_correct"]) / len(accepted) if accepted else 0.0
    return {"precision": precision, "recall": recall, "f1": f1, "verified_really_correct": trust,
            "accepted": len(accepted)}


def run_evaluation(gold_file: str, schema_file: str = None, use_mock: bool = False, output_csv: str = None,
                   model: str = None, with_repair: bool = False):
    with open(gold_file, "r", encoding="utf-8") as f:
        gold_rules = json.load(f)
    schema_ttl = DEFAULT_SCHEMA
    if schema_file:
        with open(schema_file, "r", encoding="utf-8") as f:
            schema_ttl = f.read()
    schema = parse_schema(schema_ttl)
    if schema is None:
        sys.exit(f"Could not parse the ontology {schema_file or '(built-in excerpt)'} as Turtle.")

    llm = CountingLLM(MockLLM(gold_rules) if use_mock else LocalLLMService())
    verifier = SHACLVerifier(llm)
    known_terms = verifier.extract_ontology_terms(schema_ttl)

    candidates = []
    for i, rule in enumerate(gold_rules, 1):
        rule_id = rule.get("id", f"RULE-{i:02d}")
        candidates.append((rule, rule_id, "gold", rule["gold_shacl"]))
        candidates += [(rule, rule_id, name, ttl) for name, ttl in make_mutants(rule["gold_shacl"], schema)]

    print("\n" + "=" * 100)
    print("SHACL VERIFICATION EVALUATION")
    print("=" * 100)
    print(f"Gold rules: {len(gold_rules)} | Candidate shapes: {len(candidates)} | "
          f"Ontology terms: {len(known_terms)} | Mode: {'MOCK (harness check only)' if use_mock else 'LIVE AI'}\n")

    rows = []
    for rule, rule_id, variant, shape_ttl in candidates:
        pos, neg = rule.get("positive_cases", []), rule.get("negative_cases", [])
        correct, total = gold_accuracy(shape_ttl, pos, neg, schema)
        calls_before, start = llm.total, time.time()
        res = verifier.verify_and_repair(rule_text=rule["question"], initial_shape_ttl=shape_ttl, schema_ttl=schema_ttl,
                                         known_terms=known_terms, model=model, max_repairs=1 if with_repair else 0)
        seconds = time.time() - start
        meaning = res.get("meaning") or {}
        tests = res.get("tests") or {}
        row = {
            "id": rule_id,
            "variant": variant,
            "truly_correct": correct == total,
            "gold_accuracy_before": f"{correct}/{total}",
            "verification": res["verification"],
            # What each signal alone would have decided for the shape it saw first
            "accepted_by_verifier": res["verification"] == "verified",
            "accepted_by_tests": bool(tests.get("total")) and tests.get("failed", 0) == 0,
            "accepted_by_meaning": meaning.get("verdict") == "equivalent",
            "meaning_verdict": meaning.get("verdict", "-"),
            "tests_failed": f"{tests.get('failed', 0)}/{tests.get('total', 0)}",
            "ai_calls": llm.total - calls_before,
            "seconds": round(seconds, 1),
            "back_translation": meaning.get("back_translation", ""),
        }
        if with_repair:
            after, _ = gold_accuracy(res["shape_ttl"], pos, neg, schema)
            row["gold_accuracy_after"] = f"{after}/{total}"
            # With repair on, the per-signal columns describe the last shape checked, so only the verifier
            # decision is comparable; "verified" here means "verified without needing a repair"
        rows.append(row)
        print(f"{rule_id:<9} {variant:<22} correct={str(row['truly_correct']):<5} -> {res['verification']:<10} "
              f"meaning={row['meaning_verdict']:<10} tests_failed={row['tests_failed']:<5} "
              f"calls={row['ai_calls']} {row['seconds']}s")

    print("\n" + "-" * 100)
    n_wrong = sum(1 for r in rows if not r["truly_correct"])
    print(f"Wrong shapes: {n_wrong} of {len(rows)}\n")
    print(f"{'Signal':<26} {'Precision':>9} {'Recall':>7} {'F1':>6} {'Verified & really correct':>27}")
    for label, key in (("Combined verifier", "accepted_by_verifier"), ("Blind tests only", "accepted_by_tests"),
                       ("Back-translation only", "accepted_by_meaning")):
        s = detection_scores(rows, key)
        print(f"{label:<26} {s['precision']:>9.2f} {s['recall']:>7.2f} {s['f1']:>6.2f} "
              f"{s['verified_really_correct']:>18.2f} (of {s['accepted']})")
    print("(Precision/recall/F1 are for catching WRONG shapes; the last column is how often 'verified' can be trusted.)")

    if with_repair:
        fixed = sum(1 for r in rows if not r["truly_correct"]
                    and r["gold_accuracy_after"].split("/")[0] == r["gold_accuracy_after"].split("/")[1])
        broken = sum(1 for r in rows if r["truly_correct"]
                     and r["gold_accuracy_after"].split("/")[0] != r["gold_accuracy_after"].split("/")[1])
        print(f"\nRepair: {fixed} of {n_wrong} wrong shapes fixed, {broken} correct shapes broken by repair.")

    calls = [r["ai_calls"] for r in rows]
    secs = [r["seconds"] for r in rows]
    print(f"\nCost per shape: {sum(calls) / len(calls):.1f} AI calls, {sum(secs) / len(secs):.1f} s on average "
          f"(max {max(secs):.1f} s)")

    if output_csv:
        with open(output_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"Results written to: {output_csv}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate how well SHACL verification separates correct from wrong shapes.")
    parser.add_argument("--gold", default=os.path.join(os.path.dirname(__file__), "gold", "cmp_rules_gold.json"), help="Path to gold JSON file")
    parser.add_argument("--schema", default=None, help="Ontology Turtle file (default: a small built-in CMPO excerpt)")
    parser.add_argument("--model", default=None, help="Kiste model to use (default: KISTE_MODEL)")
    parser.add_argument("--repair", action="store_true", help="Also allow one repair and report accuracy after it")
    parser.add_argument("--mock", action="store_true", help="Offline smoke test of the harness (numbers are meaningless)")
    parser.add_argument("--csv", default=None, help="Path to output CSV file")

    args = parser.parse_args()
    run_evaluation(args.gold, args.schema, use_mock=args.mock, output_csv=args.csv, model=args.model,
                   with_repair=args.repair)
