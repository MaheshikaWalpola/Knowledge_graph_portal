"""
Reasoning (inference) for SHACL validation.

Works out the facts an ontology implies (e.g. "every MaximumRating is a Parameter", or "whatever
pm:ofDevice points to is a Device") and adds them to a copy of the graph before it is validated,
so both the SPARQL pre-check and pySHACL see the same expanded data. The user's stored data is
never changed.
"""
import os
from typing import Any, Dict

import owlrl
from rdflib import OWL, Graph, Literal

try:
    # pySHACL's RDFS rules skip the one-time rules that add "hidden" literal triples which break
    # SHACL checks; this is the same closure pySHACL itself runs for inference="rdfs".
    from pyshacl.inference import CustomRDFSSemantics as _RDFSSemantics
except ImportError:  # pragma: no cover
    _RDFSSemantics = owlrl.RDFS_Semantics

INFERENCE_MODES = ("none", "rdfs", "owlrl")
INFERENCE_LABELS = {"none": "Off", "rdfs": "RDFS", "owlrl": "OWL RL"}

_DEFAULT_OWLRL_MAX_TRIPLES = 50_000


def owlrl_max_triples() -> int:
    """Graphs larger than this are reasoned with RDFS instead of OWL RL (REASONING_OWLRL_MAX_TRIPLES)."""
    try:
        return int(os.getenv("REASONING_OWLRL_MAX_TRIPLES", _DEFAULT_OWLRL_MAX_TRIPLES))
    except ValueError:
        return _DEFAULT_OWLRL_MAX_TRIPLES


def normalize_inference(mode: Any) -> str:
    """Return a valid inference mode ('none', 'rdfs' or 'owlrl'); raise ValueError for anything else."""
    value = str(mode or "none").strip().lower()
    if value not in INFERENCE_MODES:
        raise ValueError(f"Unknown reasoning mode '{mode}'. Use one of: {', '.join(INFERENCE_MODES)}.")
    return value


def apply_reasoning(graph: Graph, mode: str) -> Dict[str, Any]:
    """
    Expand a copy of `graph` with the facts implied by the ontology it contains.

    Returns a dict with:
      graph    - the expanded copy (the input graph is left untouched)
      used     - the mode actually applied (may be 'rdfs' when OWL RL was too large)
      inferred - number of triples added
      note     - a user-facing message when the requested mode was changed, else ""
    """
    mode = normalize_inference(mode)
    expanded = Graph()
    for prefix, namespace in graph.namespaces():
        expanded.bind(prefix, namespace)
    expanded += graph
    if mode == "none":
        return {"graph": expanded, "used": "none", "inferred": 0, "note": ""}

    note = ""
    limit = owlrl_max_triples()
    if mode == "owlrl" and len(graph) > limit:
        mode = "rdfs"
        note = (f"The data has {len(graph):,} triples, more than the OWL RL limit of {limit:,}, "
                f"so RDFS reasoning was used instead.")

    # owlrl's owl:hasKey rule (prp-key) has an off-by-one bug: for a key of one property it compares no
    # values at all, so it declares every two members of the class owl:sameAs and mixes their data.
    # The portal's schemas put a one-property key on most classes, so leave the keys out while reasoning.
    held_keys = []
    if mode == "owlrl":
        held_keys = list(expanded.triples((None, OWL.hasKey, None)))
        for triple in held_keys:
            expanded.remove(triple)
        if held_keys:
            extra = "owl:hasKey statements were not used by OWL RL reasoning (they would wrongly merge records)."
            note = f"{note} {extra}".strip()

    semantics = owlrl.OWLRL_Semantics if mode == "owlrl" else _RDFSSemantics
    before = len(expanded)
    owlrl.DeductiveClosure(semantics, axiomatic_triples=False, datatype_axioms=False).expand(expanded)

    # A literal can't be the subject of a triple in RDF. Reasoning still produces some (e.g. from a
    # literal-valued property whose range is a class); left in, a literal could gain a class type
    # and wrongly pass an sh:class check.
    for triple in [t for t in expanded if isinstance(t[0], Literal)]:
        expanded.remove(triple)

    inferred = max(len(expanded) - before, 0)
    for triple in held_keys:
        expanded.add(triple)
    return {"graph": expanded, "used": mode, "inferred": inferred, "note": note}
