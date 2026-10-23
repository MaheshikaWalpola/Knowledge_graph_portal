"""
Schema-driven instance generation for CSVs whose structure follows the schema
(as produced by the PDF -> CSV conversion):

  - one CSV per class, named "<ClassName>.csv"
  - column headers are schema property names (plus an optional "id" column)

Every row becomes one instance of the class. Datatype values are typed by the
property's range; object property values are resolved to the instance they
name (by its "id" or identifier property), or a new instance of the range class.

For Workspace compatibility, every numeric value is additionally written as a
sosa:Observation (observedProperty / hasSimpleResult / hasFeatureOfInterest),
the pattern the Workspace aggregates into data nodes and charts.
"""

import csv
import hashlib
import re
import urllib.parse
from datetime import datetime
from io import StringIO
from typing import Dict, List, Optional, Set, Tuple

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, RDFS, XSD

from services.instance_generation_service import InstanceBuildResult, extract_primary_namespace
from services.pdf_conversion_service import SchemaContext, SchemaProperty, build_schema_context

SOSA = Namespace("http://www.w3.org/ns/sosa/")

# Optional column carrying a record identifier; not a schema property
ID_COLUMN = "id"
# Files of the PDF conversion that hold no instance data
IGNORED_FILES = {"review.csv"}

XSD_INTEGER = {"integer", "int", "long", "short", "byte", "nonNegativeInteger", "positiveInteger",
               "negativeInteger", "nonPositiveInteger", "unsignedInt"}
XSD_NUMERIC = XSD_INTEGER | {"decimal", "double", "float"}
# Property names that identify their instance, e.g. runId, hasWaferId, documentNumber
IDENTIFIER_RE = re.compile(r"(^id$|^identifier$|[a-z0-9](Id|ID|Identifier|Number)$)")
# Property names that name their instance, e.g. organizationName, deviceName
NAME_RE = re.compile(r"(^name$|[a-z0-9]Name$)")


def _class_name(filename: str) -> str:
    return filename.rsplit("/", 1)[-1].rsplit(".", 1)[0]


def _read_csv(content: bytes) -> Tuple[List[str], List[Dict[str, str]]]:
    reader = csv.DictReader(StringIO(content.decode("utf-8-sig")))
    headers = [h.strip() for h in reader.fieldnames or []]
    rows = [{h.strip(): (v or "").strip() for h, v in row.items() if h} for row in reader]
    return headers, rows


def is_schema_structured(schema_bytes: bytes, filenames: List[str], contents: List[bytes]) -> bool:
    """
    True if every data CSV is named after a schema class and all its headers are
    schema properties (or the "id" column), i.e. the CSVs follow the schema.
    """
    try:
        ctx = build_schema_context(schema_bytes)
    except ValueError:
        return False
    data_files = [(n, c) for n, c in zip(filenames, contents) if n.rsplit("/", 1)[-1] not in IGNORED_FILES]
    if not data_files:
        return False
    for name, content in data_files:
        if _class_name(name) not in ctx.classes:
            return False
        try:
            headers, _ = _read_csv(content)
        except (UnicodeDecodeError, csv.Error):
            return False
        if not headers or any(h != ID_COLUMN and h not in ctx.properties for h in headers):
            return False
    return True


def _safe(value: str) -> str:
    return urllib.parse.quote(re.sub(r"\s+", "_", value.strip()), safe="-_.")


def _typed_literal(value: str, prop: SchemaProperty) -> Tuple[Literal, Optional[float]]:
    """
    Type a value by the property's XSD range. Returns (literal, numeric value or None).
    Values that do not fit the range are kept as plain strings.
    """
    rng = prop.range
    if rng in XSD_NUMERIC:
        try:
            num = float(value)
            if rng in XSD_INTEGER and num.is_integer():
                return Literal(int(num), datatype=XSD[rng]), num
            if rng not in XSD_INTEGER:
                return Literal(value, datatype=XSD[rng]), num
        except ValueError:
            pass
    elif rng == "dateTime":
        try:
            return Literal(datetime.fromisoformat(value).isoformat(), datatype=XSD.dateTime), None
        except ValueError:
            pass
    elif rng == "date":
        try:
            return Literal(datetime.fromisoformat(value).date().isoformat(), datatype=XSD.date), None
        except ValueError:
            pass
    elif rng == "boolean" and value.lower() in {"true", "false", "1", "0", "yes", "no"}:
        return Literal(value.lower() in {"true", "1", "yes"}, datatype=XSD.boolean), None
    elif rng == "string":
        return Literal(value, datatype=XSD.string), None
    return Literal(value), None


class _Builder:
    def __init__(self, ctx: SchemaContext, inst_ns: str):
        self.ctx = ctx
        self.INST = Namespace(inst_ns)
        self.g = Graph()
        self.warnings: List[str] = []
        # (class name, value) -> instance IRI(s), for resolving object property values:
        # identifiers first, then any datatype value (used only when it is unique)
        self.index: Dict[Tuple[str, str], URIRef] = {}
        self.value_index: Dict[Tuple[str, str], Set[URIRef]] = {}
        self.instance_classes: Dict[URIRef, str] = {}
        self.pending_links: List[Tuple[URIRef, SchemaProperty, str]] = []

    def _instance_iri(self, cls: str, headers: List[str], row: Dict[str, str]) -> Tuple[URIRef, List[str]]:
        """
        IRI from the class's key, else the "id" column, else a hash of the row. Real keys
        come first so the same thing from several files is one instance; all keys are
        returned so links can find the instance by any of them.

        The key is the schema's owl:hasKey for the class (or a superclass). A schema that
        declares no keys at all falls back to guessing: the first identifier property of
        the class (its domain must include the class), else its name property.
        """
        own = self.ctx.class_and_ancestors(cls)
        if self.ctx.keys:
            key_props = next((self.ctx.keys[c] for c in [cls, *sorted(own - {cls})] if c in self.ctx.keys), [])
            parts = [row.get(p, "") for p in key_props]
            keys = ["_".join(parts)] if key_props and all(parts) else []
            if key_props and not keys:
                self.warnings.append(f"{cls} '{row.get(ID_COLUMN, '')}': key {', '.join(key_props)} is empty; "
                                     f"named after its id, so it is not merged with the same {cls} from other files")
        else:
            def own_values(pattern: re.Pattern) -> List[str]:
                return [row[h] for h in headers if row.get(h) and h != ID_COLUMN
                        and self.ctx.properties[h].kind != "object" and pattern.search(h)
                        and (not self.ctx.properties[h].domains or self.ctx.properties[h].domains & own)]

            keys = own_values(IDENTIFIER_RE) + own_values(NAME_RE)
        keys += [row[ID_COLUMN]] if row.get(ID_COLUMN) else []
        if keys:
            return self.INST[f"{cls.lower()}_{_safe(keys[0])}"], keys
        digest = hashlib.sha1(repr(sorted(row.items())).encode()).hexdigest()[:10]
        return self.INST[f"{cls.lower()}_{digest}"], keys

    def add_row(self, cls: str, headers: List[str], row: Dict[str, str]):
        iri, keys = self._instance_iri(cls, headers, row)
        self.g.add((iri, RDF.type, URIRef(self.ctx.classes[cls]["iri"])))
        self.instance_classes[iri] = cls
        for key in keys:
            self.index[(cls, key)] = iri

        own = self.ctx.class_and_ancestors(cls)
        for header in headers:
            value = row.get(header, "")
            if not value or header == ID_COLUMN:
                continue
            prop = self.ctx.properties[header]
            # A property the schema gives to other classes would make the graph contradict the schema
            if prop.domains and not prop.domains & own:
                self.warnings.append(f"{cls}.{header}: belongs to {', '.join(sorted(prop.domains))}, "
                                     f"not {cls}; '{value}' skipped")
                continue
            if prop.kind == "object":
                self.pending_links.append((iri, prop, value))
                continue
            literal, number = _typed_literal(value, prop)
            if prop.range in XSD_NUMERIC | {"date", "dateTime", "boolean"} and literal.datatype is None:
                self.warnings.append(f"{cls}.{header}: '{value}' does not fit range {prop.range}; kept as text")
            self.g.add((iri, URIRef(prop.iri), literal))
            self.value_index.setdefault((cls, value), set()).add(iri)
            if number is not None:
                self._add_observation(iri, prop, number)

    def _add_observation(self, feature: URIRef, prop: SchemaProperty, number: float):
        obs = URIRef(f"{feature}_obs_{prop.name}")
        self.g.add((obs, RDF.type, SOSA.Observation))
        self.g.add((obs, SOSA.observedProperty, URIRef(prop.iri)))
        self.g.add((obs, SOSA.hasFeatureOfInterest, feature))
        self.g.add((obs, SOSA.hasSimpleResult, Literal(number, datatype=XSD.float)))

    def _fits(self, cls: str, range_cls: Optional[str]) -> bool:
        return range_cls is None or range_cls in self.ctx.class_and_ancestors(cls)

    def _find_instance(self, range_cls: Optional[str], value: str) -> Optional[URIRef]:
        """
        The instance of the range class (or a subclass) this value names: by its
        identifier, else by any of its values if exactly one instance has it.
        """
        for (cls, key), iri in self.index.items():
            if key == value and self._fits(cls, range_cls):
                return iri
        matches = set().union(*[iris for (cls, v), iris in self.value_index.items()
                                if v == value and self._fits(cls, range_cls)])
        return next(iter(matches)) if len(matches) == 1 else None

    def resolve_links(self):
        """
        Link object property values to the instance they name. If the range class has
        no instances in the data at all, the named instance is created; otherwise an
        unresolvable value is skipped, as it names nothing that exists.
        """
        for subject, prop, value in self.pending_links:
            range_cls = prop.range if prop.range in self.ctx.classes else None
            target = self._find_instance(range_cls, value)
            if target is None:
                if range_cls is None or any(self._fits(c, range_cls) for c in self.instance_classes.values()):
                    self.warnings.append(f"{prop.name}: no {range_cls or 'instance'} found for '{value}'; "
                                         f"link skipped")
                    continue
                target = self.INST[f"{range_cls.lower()}_{_safe(value)}"]
                self.g.add((target, RDF.type, URIRef(self.ctx.classes[range_cls]["iri"])))
                self.g.add((target, RDFS.label, Literal(value)))
                self.index[(range_cls, value)] = target
            self.g.add((subject, URIRef(prop.iri), target))


def build_instances_from_schema_csvs(
    files: List[bytes],
    filenames: List[str],
    schema_bytes: bytes,
) -> InstanceBuildResult:
    """Generate an RDF instance file from CSVs that follow the schema (see module docstring)."""
    ctx = build_schema_context(schema_bytes)
    _, inst_ns = extract_primary_namespace(schema_bytes)
    builder = _Builder(ctx, inst_ns)

    rows_processed = 0
    for content, name in zip(files, filenames):
        if name.rsplit("/", 1)[-1] in IGNORED_FILES:
            continue
        cls = _class_name(name)
        headers, rows = _read_csv(content)
        for row in rows:
            if any(row.get(h) for h in headers):
                builder.add_row(cls, headers, row)
                rows_processed += 1
    builder.resolve_links()

    g = builder.g
    for prefix, ns in ctx.prefixes.items():
        if prefix and not ns.startswith("http://www.w3.org/") and ns != str(SOSA):
            g.bind(prefix, ns)
    g.bind("inst", builder.INST)
    g.bind("sosa", SOSA)
    for w in builder.warnings:
        print(f"[schema instances] {w}")

    return InstanceBuildResult(turtle=g.serialize(format="turtle"), triples=len(g),
                               rows_processed=rows_processed)
