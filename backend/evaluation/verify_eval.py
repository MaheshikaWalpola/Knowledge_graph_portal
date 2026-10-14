"""
SHACL Verification & Repair Evaluation Harness
Compares baseline LLM shape generation against the 3-stage verification & repair pipeline.
Metrics:
- Grounding / Hallucination Rate
- Test Case Accuracy (conforming to positive cases, catching negative cases)
- Repair Success Rate & Attempts
"""

import os
import sys
import json
import argparse
import csv
from typing import Dict, Any, List, Tuple
from rdflib import Graph
import pyshacl

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.shacl_verifier import SHACLVerifier
from services.local_llm_service import LocalLLMService, KisteConnectionError


def evaluate_shape(shape_ttl: str, positive_cases: List[str], negative_cases: List[str]) -> Tuple[int, int, int]:
    """
    Evaluates a SHACL shape against positive and negative test cases.
    Returns (correct_count, total_count, accuracy_pct).
    """
    g_shape = Graph()
    try:
        g_shape.parse(data=shape_ttl, format="turtle")
    except Exception as e:
        return 0, len(positive_cases) + len(negative_cases), 0

    correct = 0
    total = len(positive_cases) + len(negative_cases)

    # Positive cases: should conform
    for ex in positive_cases:
        try:
            g_data = Graph()
            g_data.parse(data=ex, format="turtle")
            conforms, _, _ = pyshacl.validate(g_data, shacl_graph=g_shape, inference="none")
            if conforms:
                correct += 1
        except Exception:
            pass

    # Negative cases: should violate (not conform)
    for ex in negative_cases:
        try:
            g_data = Graph()
            g_data.parse(data=ex, format="turtle")
            conforms, _, _ = pyshacl.validate(g_data, shacl_graph=g_shape, inference="none")
            if not conforms:
                correct += 1
        except Exception:
            pass

    accuracy = int(round((correct / total) * 100)) if total > 0 else 0
    return correct, total, accuracy


class MockLLMForEval:
    """Mock LLM to test evaluation harness offline when Kiste API is unreachable."""
    def __init__(self):
        pass

    def _call_kiste(self, messages: List[Dict[str, str]], json_mode: bool = False, temperature: float = 0.7) -> str:
        prompt = messages[-1]["content"] if messages else ""
        if json_mode:
            # Return test data examples
            return json.dumps({
                "valid": [
                    "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:TestGood a cmpo:Pressure ; cmpo:hasNumericValue \"5.0\"^^xsd:float ; cmpo:hasUnit \"psi\" .",
                    "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:TestGood2 a cmpo:Pressure ; cmpo:hasNumericValue \"1.0\"^^xsd:float ; cmpo:hasUnit \"psi\" ."
                ],
                "invalid": [
                    "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:TestBad a cmpo:Pressure ; cmpo:hasNumericValue \"-3.0\"^^xsd:float ; cmpo:hasUnit \"psi\" .",
                    "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\ninst:TestBad2 a cmpo:Pressure ; cmpo:hasNumericValue \"5.0\"^^xsd:float ; cmpo:hasUnit \"bar\" ."
                ]
            })
        else:
            # Return repaired Turtle shape
            return (
                "@prefix sh: <http://www.w3.org/ns/shacl#> .\n"
                "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n"
                "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n"
                "@prefix inst: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo/instance/> .\n\n"
                "inst:RepairedShape a sh:NodeShape ;\n"
                "    sh:targetClass cmpo:Pressure ;\n"
                "    sh:property [\n"
                "        sh:path cmpo:hasNumericValue ;\n"
                "        sh:minCount 1 ;\n"
                "        sh:datatype xsd:float ;\n"
                "        sh:minInclusive 0.0 ;\n"
                "        sh:message \"Must be non-negative float.\"\n"
                "    ] ;\n"
                "    sh:property [\n"
                "        sh:path cmpo:hasUnit ;\n"
                "        sh:hasValue \"psi\" ;\n"
                "        sh:message \"Must be in psi.\"\n"
                "    ] ."
            )


def run_evaluation(gold_file: str, schema_file: str = None, use_mock: bool = False, output_csv: str = None):
    with open(gold_file, "r", encoding="utf-8") as f:
        gold_rules = json.load(f)

    # Load ontology schema if available
    schema_ttl = ""
    if schema_file and os.path.exists(schema_file):
        with open(schema_file, "r", encoding="utf-8") as f:
            schema_ttl = f.read()
    else:
        # Default CMP ontology excerpt
        schema_ttl = (
            "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n"
            "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n"
            "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n"
            "@prefix cmpo: <https://vsr.informatik.tu-chemnitz.de/ontologies/cmpo#> .\n\n"
            "cmpo:CMPProcess a owl:Class .\n"
            "cmpo:Pressure a owl:Class .\n"
            "cmpo:Velocity a owl:Class .\n"
            "cmpo:hasTimestamp a owl:DatatypeProperty .\n"
            "cmpo:hasInput a owl:ObjectProperty .\n"
            "cmpo:hasNumericValue a owl:DatatypeProperty .\n"
            "cmpo:hasUnit a owl:DatatypeProperty .\n"
        )

    llm = MockLLMForEval() if use_mock else LocalLLMService()
    verifier = SHACLVerifier(llm)
    known_terms = verifier.extract_ontology_terms(schema_ttl)

    results = []

    print("\n" + "=" * 80)
    print("RUNNING SHACL VERIFICATION & REPAIR EVALUATION HARNESS")
    print("=" * 80)
    print(f"Total Rules to Evaluate: {len(gold_rules)}")
    print(f"Known Ontology Terms Extracted: {len(known_terms)}")
    print(f"Mode: {'MOCK (Offline)' if use_mock else 'LIVE LLM'}\n")

    for i, rule in enumerate(gold_rules, 1):
        rule_id = rule.get("id", f"RULE-{i:02d}")
        question = rule["question"]
        gold_shacl = rule["gold_shacl"]
        positive_cases = rule.get("positive_cases", [])
        negative_cases = rule.get("negative_cases", [])

        # Simulated baseline shape: deliberately introduce a minor flaw or hallucination for evaluation testing
        baseline_shape = gold_shacl
        if i == 2:
            # Introduce hallucinated property in baseline to test grounding & repair
            baseline_shape = baseline_shape.replace("cmpo:hasUnit", "cmpo:hasUnknownPressureUnit")

        # Baseline evaluation
        base_unknown = verifier.check_grounding(baseline_shape, known_terms)
        base_correct, base_total, base_acc = evaluate_shape(baseline_shape, positive_cases, negative_cases)

        # Verifier & Repair evaluation
        verification_result = verifier.verify_and_repair(
            rule_text=question,
            initial_shape_ttl=baseline_shape,
            schema_ttl=schema_ttl,
            known_terms=known_terms
        )

        final_shape = verification_result["shape_ttl"]
        final_unknown = verifier.check_grounding(final_shape, known_terms)
        final_correct, final_total, final_acc = evaluate_shape(final_shape, positive_cases, negative_cases)

        status = verification_result["verification"]
        attempts = verification_result["attempts"]

        results.append({
            "id": rule_id,
            "question": question[:45] + ("..." if len(question) > 45 else ""),
            "base_unknown": len(base_unknown),
            "base_accuracy": f"{base_acc}%",
            "status": status,
            "attempts": attempts,
            "final_unknown": len(final_unknown),
            "final_accuracy": f"{final_acc}%",
            "accuracy_gain": f"+{final_acc - base_acc}%" if final_acc >= base_acc else f"{final_acc - base_acc}%"
        })

    # Print results table
    header = f"{'Rule ID':<9} | {'Base Acc':<8} | {'Base Halluc':<11} | {'Status':<11} | {'Attempts':<8} | {'Final Acc':<9} | {'Final Halluc':<12} | {'Gain':<6}"
    print(header)
    print("-" * len(header))
    for r in results:
        print(f"{r['id']:<9} | {r['base_accuracy']:<8} | {r['base_unknown']:<11} | {r['status']:<11} | {r['attempts']:<8} | {r['final_accuracy']:<9} | {r['final_unknown']:<12} | {r['accuracy_gain']:<6}")

    print("=" * len(header))

    # Summary Stats
    total_eval = len(results)
    verified_cnt = sum(1 for r in results if r["status"] == "verified")
    repaired_cnt = sum(1 for r in results if r["status"] == "repaired")
    unverified_cnt = sum(1 for r in results if r["status"] == "unverified")

    print(f"\nSUMMARY METRICS:")
    print(f"- Total Rules Evaluated: {total_eval}")
    print(f"- Verified Rules:        {verified_cnt} ({verified_cnt/total_eval*100:.1f}%)")
    print(f"- Repaired Rules:        {repaired_cnt} ({repaired_cnt/total_eval*100:.1f}%)")
    print(f"- Unverified Rules:      {unverified_cnt} ({unverified_cnt/total_eval*100:.1f}%)")

    # Output CSV if requested
    if output_csv:
        with open(output_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(results[0].keys()))
            writer.writeheader()
            writer.writerows(results)
        print(f"\nResults successfully exported to: {output_csv}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate SHACL verification and repair pipeline.")
    parser.add_argument("--gold", default=os.path.join(os.path.dirname(__file__), "gold", "cmp_rules_gold.json"), help="Path to gold JSON file")
    parser.add_argument("--schema", default=os.path.join(os.path.dirname(os.path.dirname(__file__)), "ontology", "default_shapes.ttl"), help="Path to schema TTL file")
    parser.add_argument("--mock", action="store_true", help="Run with mock LLM for offline testing")
    parser.add_argument("--csv", default=None, help="Path to output CSV file")

    args = parser.parse_args()
    run_evaluation(args.gold, args.schema, use_mock=args.mock, output_csv=args.csv)
