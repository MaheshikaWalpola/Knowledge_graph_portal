"""
Service to parse user-uploaded RDF files and import them into GraphDB.

Supports: Turtle (.ttl), RDF/XML (.rdf, .owl), N-Triples (.nt), JSON-LD (.jsonld)
Modes:  combined (single file) | separate (schema file + instance file)
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Optional

from rdflib import Graph, URIRef, OWL, RDF, RDFS


# ── format detection ────────────────────────────────────────────────

EXT_FORMAT = {
    ".ttl":    "turtle",
    ".turtle": "turtle",
    ".rdf":    "xml",
    ".owl":    "xml",
    ".xml":    "xml",
    ".nt":     "nt",
    ".ntriples": "nt",
    ".jsonld": "json-ld",
    ".json":   "json-ld",
}


def _guess_format(filename: str) -> str:
    fname = (filename or "").lower().strip()
    for ext, fmt in EXT_FORMAT.items():
        if fname.endswith(ext):
            return fmt
    return "turtle"  # default fallback


# ── namespace detection ─────────────────────────────────────────────

def detect_primary_namespace(g: Graph) -> Optional[str]:
    """
    Try to find the "main" namespace of an uploaded ontology.
    Priority:
      1. owl:Ontology subject IRI
      2. Most-used namespace among subject IRIs
      3. None
    """
    # 1) Look for owl:Ontology
    for s in g.subjects(RDF.type, OWL.Ontology):
        iri = str(s)
        if iri.endswith("#") or iri.endswith("/"):
            return iri
        return iri.rsplit("/", 1)[0] + "/"

    # 2) Count namespace prefixes from subject IRIs
    ns_count: Counter = Counter()
    for s in g.subjects():
        if not isinstance(s, URIRef):
            continue
        iri = str(s)
        if "#" in iri:
            ns = iri.rsplit("#", 1)[0] + "#"
        elif "/" in iri:
            ns = iri.rsplit("/", 1)[0] + "/"
        else:
            continue
        ns_count[ns] += 1

    if ns_count:
        return ns_count.most_common(1)[0][0]

    return None


# ── parse helpers ───────────────────────────────────────────────────

@dataclass
class ParsedRDF:
    turtle: str
    triple_count: int
    namespace: Optional[str]


def parse_rdf_bytes(content: bytes, filename: str) -> ParsedRDF:
    """Parse raw bytes into an rdflib Graph and return Turtle + metadata."""
    fmt = _guess_format(filename)
    g = Graph()
    g.parse(data=content, format=fmt)

    namespace = detect_primary_namespace(g)
    turtle_str = g.serialize(format="turtle")
    return ParsedRDF(
        turtle=turtle_str,
        triple_count=len(g),
        namespace=namespace,
    )


def split_schema_and_instances(g: Graph):
    """
    Heuristic split: schema triples use OWL/RDFS vocabulary as predicates
    (rdf:type owl:Class, rdfs:subClassOf, rdfs:domain, rdfs:range, etc.),
    while instance triples are everything else.
    """
    SCHEMA_PREDICATES = {
        RDF.type,
        RDFS.subClassOf,
        RDFS.domain,
        RDFS.range,
        RDFS.label,
        RDFS.comment,
        OWL.equivalentClass,
        OWL.disjointWith,
        OWL.inverseOf,
        OWL.unionOf,
        OWL.intersectionOf,
        OWL.complementOf,
        OWL.onProperty,
        OWL.someValuesFrom,
        OWL.allValuesFrom,
        OWL.hasValue,
        OWL.cardinality,
        OWL.minCardinality,
        OWL.maxCardinality,
    }

    SCHEMA_OBJECT_TYPES = {
        OWL.Class,
        OWL.ObjectProperty,
        OWL.DatatypeProperty,
        OWL.AnnotationProperty,
        OWL.Restriction,
        OWL.Ontology,
        OWL.NamedIndividual,
        RDFS.Class,
        RDF.Property,
    }

    schema_g = Graph()
    instance_g = Graph()

    # Copy namespace bindings
    for prefix, ns in g.namespaces():
        schema_g.bind(prefix, ns)
        instance_g.bind(prefix, ns)

    for s, p, o in g:
        if p in SCHEMA_PREDICATES:
            # rdf:type owl:Class → schema; rdf:type <UserClass> → instance
            if p == RDF.type and o in SCHEMA_OBJECT_TYPES:
                schema_g.add((s, p, o))
            elif p == RDF.type:
                instance_g.add((s, p, o))
            else:
                schema_g.add((s, p, o))
        else:
            instance_g.add((s, p, o))

    return schema_g, instance_g
