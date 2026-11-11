# CMP Validation Gold Rules Dataset

This directory contains gold-standard data quality rules, target shapes, and behavioral test cases for evaluating LLM-generated SHACL shapes in the Chemical Mechanical Polishing (CMP) semiconductor domain.

## File Structure

- `cmp_rules_gold.json`: Ground-truth rules benchmark with test cases.

## JSON Schema

Each entry in `cmp_rules_gold.json` has the following format:

```json
{
  "id": "RULE-01",
  "question": "Plain-English formulation of the validation rule",
  "target_class": "http://example.org/ontology#TargetClass",
  "gold_shacl": "@prefix sh: <http://www.w3.org/ns/shacl#> ... (complete Turtle shape)",
  "positive_cases": [
    "@prefix ... (Turtle instance graph that MUST pass the rule)",
    "@prefix ... (another passing instance graph)"
  ],
  "negative_cases": [
    "@prefix ... (Turtle instance graph that MUST fail the rule)",
    "@prefix ... (another failing instance graph)"
  ]
}
```

## How to Add New Rules

1. **Formulate the Rule**: Write an unambiguous domain requirement in plain English.
2. **Define Gold SHACL**: Create the standard, correct SHACL NodeShape adhering to W3C SHACL specifications.
3. **Provide Positive Test Cases**: Minimal RDF Turtle graphs where all constraints are satisfied.
4. **Provide Negative Test Cases**: Minimal RDF Turtle graphs where each distinct violation condition (e.g. out of range, missing property, invalid unit, wrong datatype) is isolated and triggered.
5. **Verify with pySHACL**: Ensure the positive cases conform (`conforms=True`) and negative cases fail (`conforms=False`) against the gold SHACL before committing.

## Evaluating the verifier

`../verify_eval.py` measures how well the SHACL verifier separates correct shapes from wrong ones. For every rule it
checks the gold shape plus automatic mutants (a dropped constraint, a shifted or flipped value limit, a wrong required
value, a wrong target class). Each candidate is labelled correct or wrong with the gold test cases above, then judged by
the verifier without repair.

```bash
cd backend
python evaluation/verify_eval.py --schema path/to/cmpo.ttl --csv results.csv            # detection only
python evaluation/verify_eval.py --schema path/to/cmpo.ttl --repair --csv results.csv   # plus one repair
```

It reports precision / recall / F1 for catching wrong shapes, the share of "verified" shapes that are really correct,
the same for each signal alone (blind tests, back-translation), repair results, and AI calls and seconds per shape.

The numbers are only as good as the gold cases: include boundary values (e.g. exactly 0, just below 0) so a mutant
with a shifted limit is really caught, and aim for 30 or more rules covering every kind of question the portal asks.
