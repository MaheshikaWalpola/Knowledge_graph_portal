"""
PDF -> CSV conversion: maps extracted PDF content onto a schema with an LLM.

Pipeline per PDF:
  1. extract (pdf_extraction_service)  -> pages of text/tables/image placeholders
  2. map (Kiste LLM)                    -> JSON records {class, values, raw}
  3. verify                             -> source check (value appears in the PDF)
                                           + schema check (domain / range)
Results of all PDFs are combined into one CSV per schema class plus a
review.csv that lists every value with its checks, unmapped data and warnings.
"""

import csv
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from io import StringIO
from typing import Any, Dict, List, Optional, Set, Tuple

from rdflib import Graph, URIRef
from rdflib.collection import Collection
from rdflib.namespace import OWL, RDF, RDFS, SKOS

from services.local_llm_service import LocalLLMService
from services.pdf_extraction_service import (
    PdfDocument,
    extract_pdf_document,
    normalize_for_search,
    render_pages,
    searchable_text,
)

# Context windows (tokens) of the Kiste models, matched by model id prefix.
MODEL_CONTEXT = {
    "Qwen3.6": 262_144,
    "DeepSeek-V4": 1_000_000,
    "gpt-oss": 131_072,
    "gemma-4": 262_144,
    "Hunyuan": 32_768,
    "Phi-3": 4_096,
}
DEFAULT_CONTEXT = 32_768
CHARS_PER_TOKEN = 3  # conservative; numbers and German text tokenize poorly
MAX_OUTPUT_TOKENS = 32_768
LLM_TIMEOUT = 900

REVIEW_COLUMNS = [
    "type", "source_file", "page", "class", "csv_file", "csv_line",
    "property", "value", "raw", "source_check", "schema_check", "message",
]

XSD_NUMERIC = {"decimal", "double", "float", "integer", "int", "long", "short",
               "nonNegativeInteger", "positiveInteger", "negativeInteger", "nonPositiveInteger"}
XSD_INTEGER = {"integer", "int", "long", "short", "nonNegativeInteger", "positiveInteger",
               "negativeInteger", "nonPositiveInteger"}


# ---------------------------------------------------------------------------
# Schema context
# ---------------------------------------------------------------------------
def _local(uri) -> str:
    return str(uri).split("#")[-1].split("/")[-1]


@dataclass
class SchemaProperty:
    name: str
    kind: str  # "datatype" | "object" | "property"
    iri: str = ""
    domains: Set[str] = field(default_factory=set)
    range: Optional[str] = None
    label: str = ""
    comment: str = ""
    alt_labels: List[str] = field(default_factory=list)


@dataclass
class SchemaContext:
    classes: Dict[str, Dict[str, str]]       # name -> {iri, label, comment}
    ancestors: Dict[str, Set[str]]           # class -> all superclasses (local names)
    properties: Dict[str, SchemaProperty]
    prefixes: Dict[str, str] = field(default_factory=dict)  # prefix -> namespace, as bound in the file
    keys: Dict[str, List[str]] = field(default_factory=dict)  # class -> identifying properties (owl:hasKey)

    def class_and_ancestors(self, cls: str) -> Set[str]:
        return {cls} | self.ancestors.get(cls, set())


def build_schema_context(schema_bytes: bytes) -> SchemaContext:
    """Parse the schema into the classes/properties the LLM may use."""
    g = Graph()
    try:
        g.parse(data=schema_bytes, format="turtle")
    except Exception:
        try:
            g.parse(data=schema_bytes)
        except Exception as e:
            raise ValueError(f"Failed to parse schema file: {str(e)}")

    def text(s, pred) -> str:
        for o in g.objects(s, pred):
            return re.sub(r"\s+", " ", str(o)).strip()
        return ""

    classes: Dict[str, Dict[str, str]] = {}
    for cls_type in (OWL.Class, RDFS.Class):
        for s in g.subjects(RDF.type, cls_type):
            if isinstance(s, URIRef):
                classes[_local(s)] = {"iri": str(s),
                                      "label": text(s, RDFS.label) or text(s, SKOS.prefLabel),
                                      "comment": text(s, RDFS.comment)}

    parents: Dict[str, Set[str]] = {}
    for s, o in g.subject_objects(RDFS.subClassOf):
        if isinstance(s, URIRef) and isinstance(o, URIRef):
            parents.setdefault(_local(s), set()).add(_local(o))

    def all_ancestors(cls: str, seen: Set[str]) -> Set[str]:
        out = set()
        for p in parents.get(cls, set()):
            if p not in seen:
                seen.add(p)
                out |= {p} | all_ancestors(p, seen)
        return out

    ancestors = {c: all_ancestors(c, {c}) for c in classes}

    properties: Dict[str, SchemaProperty] = {}
    for prop_type, kind in ((OWL.DatatypeProperty, "datatype"), (OWL.ObjectProperty, "object"),
                            (RDF.Property, "property")):
        for s in g.subjects(RDF.type, prop_type):
            name = _local(s)
            if not isinstance(s, URIRef) or name in properties:
                continue
            rng = next((o for o in g.objects(s, RDFS.range) if isinstance(o, URIRef)), None)
            properties[name] = SchemaProperty(
                name=name,
                kind=kind,
                iri=str(s),
                domains={_local(o) for o in g.objects(s, RDFS.domain) if isinstance(o, URIRef)},
                range=_local(rng) if rng is not None else None,
                label=text(s, RDFS.label),
                comment=text(s, RDFS.comment),
                alt_labels=sorted(str(o) for o in g.objects(s, SKOS.altLabel)),
            )

    keys: Dict[str, List[str]] = {}
    for s, key_list in g.subject_objects(OWL.hasKey):
        if isinstance(s, URIRef) and _local(s) in classes:
            keys[_local(s)] = [_local(p) for p in Collection(g, key_list) if _local(p) in properties]

    if not classes and not properties:
        raise ValueError("The schema contains no classes or properties")
    return SchemaContext(classes=classes, ancestors=ancestors, properties=properties,
                         prefixes={p: str(ns) for p, ns in g.namespaces()}, keys=keys)


def render_schema(ctx: SchemaContext) -> str:
    lines = ["CLASSES:"]
    for name in sorted(ctx.classes):
        info = ctx.classes[name]
        parts = [f"- {name}"]
        if info["label"] and info["label"].lower() != name.lower():
            parts.append(f'"{info["label"]}"')
        if ctx.ancestors.get(name):
            parts.append(f"(subclass of {', '.join(sorted(ctx.ancestors[name]))})")
        if info["comment"]:
            parts.append(f"- {info['comment'][:200]}")
        lines.append(" ".join(parts))

    lines.append("\nPROPERTIES:")
    for name in sorted(ctx.properties):
        p = ctx.properties[name]
        parts = [f"- {name} [{p.kind}]"]
        parts.append(f"domain: {', '.join(sorted(p.domains)) if p.domains else 'any'}")
        parts.append(f"range: {p.range or 'any'}")
        if p.label and p.label.lower() != name.lower():
            parts.append(f'label: "{p.label}"')
        if p.alt_labels:
            parts.append(f"also called: {', '.join(p.alt_labels[:5])}")
        if p.comment:
            parts.append(p.comment[:200])
        lines.append("; ".join(parts))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# LLM mapping
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You convert the content of technical PDF documents (semiconductor datasheets, test reports, certificates, process forms, etc.) into records that follow a given RDF schema. The documents have no fixed format.

The document text was extracted automatically:
- "=== PAGE n ===" marks the start of a page.
- "[TABLE k on page n]" blocks are tables in markdown. The first row is NOT necessarily a header; tables are often grids of key/value pairs. "<br>" is a line break inside a cell.
- " | " inside a text line separates fields that were far apart on the page (often a key and its value, or two columns).
- "[IMAGE ...]" marks an image whose content is not available. Never guess what it contains.

Rules:
1. Use only class and property names from the schema, spelled exactly as given.
2. Decide what the records are. A document can describe zero, one or many things (e.g. a product, several part numbers, a wafer, many measured dies, several process steps). Create one record per real-world thing, with the class that fits best. Only use properties whose domain is the record's class or one of its superclasses (domain "any" fits every class).
3. Only use information that is explicitly in the document. Never guess, infer or invent values. If a value is not in the document, leave the property out.
4. "values" maps property name -> value. Write the value so it fits the property's range: for numeric ranges a plain number with "." as decimal separator and no unit; for date ranges YYYY-MM-DD; for dateTime ranges YYYY-MM-DDTHH:MM:SS; otherwise the text as written.
5. Give every record an "id" that is unique within your reply ("r1", "r2", ...). For an object property whose related thing is one of your records, give that record's id as the value, e.g. a measurement run that has a result record: "hasResult": "r2". Create a record for the related thing whenever the document contains data about it. Only if the related thing is not one of your records, give its identifier or name as written in the document.
6. Whenever a value is not an exact copy of the document text (unit removed, number or date reformatted, text shortened), put the exact original text in "raw" under the same property name.
7. Put every other piece of data that fits no schema property into "unmapped" as [key, value, page]. Skip boilerplate such as page numbers.
8. Reply with ONE JSON object and nothing else, in exactly this format:
{"records": [{"id": "r1", "class": "ClassName", "page": 1, "values": {"propertyName": "value"}, "raw": {"propertyName": "original text"}}], "unmapped": [["key", "value", 1]], "notes": "one or two sentences on how you identified the records"}"""


def _context_tokens(model: Optional[str]) -> int:
    for prefix, tokens in MODEL_CONTEXT.items():
        if model and model.startswith(prefix):
            return tokens
    return DEFAULT_CONTEXT


def _chunk_pages(pages: List[str], budget_chars: int) -> List[str]:
    """Greedily group pages into chunks that fit the character budget."""
    chunks, current = [], ""
    for page in pages:
        if current and len(current) + len(page) > budget_chars:
            chunks.append(current)
            current = ""
        current = f"{current}\n\n{page}" if current else page
    if current:
        chunks.append(current)
    return chunks


def _parse_json_reply(reply: str) -> Dict[str, Any]:
    """Parse the model reply, tolerating <think> blocks and markdown code fences."""
    text = re.sub(r"<think>.*?</think>", "", reply or "", flags=re.DOTALL).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        data = json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("AI reply is not a JSON object")
    return data


def _map_chunk(llm: LocalLLMService, schema_text: str, chunk: str, part: str,
               model: Optional[str], max_tokens: int) -> Dict[str, Any]:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"SCHEMA\n{schema_text}\n\nDOCUMENT{part}\n{chunk}"},
    ]
    reply = llm._call_kiste(messages, json_mode=True, temperature=0.1, model_override=model,
                            timeout=LLM_TIMEOUT, max_tokens=max_tokens)
    try:
        return _parse_json_reply(reply)
    except (json.JSONDecodeError, ValueError):
        # One retry, showing the model its invalid reply
        messages += [{"role": "assistant", "content": reply},
                     {"role": "user", "content": "That was not a valid JSON object in the required format. "
                                                 "Reply again with only the JSON object."}]
        reply = llm._call_kiste(messages, json_mode=True, temperature=0.0, model_override=model,
                                timeout=LLM_TIMEOUT, max_tokens=max_tokens)
        try:
            return _parse_json_reply(reply)
        except (json.JSONDecodeError, ValueError):
            raise ValueError("The AI did not return valid JSON (the reply may have been cut off)")


def map_document(doc: PdfDocument, schema_text: str, model: Optional[str]) -> Tuple[Dict[str, Any], int]:
    """Run the LLM over the document (chunked by pages if needed). Returns (merged result, chunk count)."""
    context = _context_tokens(model)
    max_tokens = min(MAX_OUTPUT_TOKENS, context // 4)
    budget_chars = (context - max_tokens) * CHARS_PER_TOKEN // 2 - len(schema_text) - len(SYSTEM_PROMPT)
    if budget_chars < 2000:
        raise ValueError("The selected model's context window is too small for this schema")

    chunks = _chunk_pages(render_pages(doc), budget_chars)
    llm = LocalLLMService()
    merged = {"records": [], "unmapped": [], "notes": []}
    for i, chunk in enumerate(chunks, start=1):
        part = f" (part {i} of {len(chunks)}; other parts are processed separately)" if len(chunks) > 1 else ""
        result = _map_chunk(llm, schema_text, chunk, part, model, max_tokens)
        merged["records"] += [{**r, "_chunk": i} for r in result.get("records") or [] if isinstance(r, dict)]
        merged["unmapped"] += [u for u in result.get("unmapped") or [] if isinstance(u, (list, dict))]
        if result.get("notes"):
            merged["notes"].append(str(result["notes"]))
    return merged, len(chunks)


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
def source_check(value: str, raw: str, haystack: str) -> str:
    for candidate in (raw, value):
        needle = normalize_for_search(candidate or "")
        if needle and needle in haystack:
            return "found (weak: short value)" if len(needle) <= 2 else "found"
    return "NOT FOUND"


def _parse_date(value: str, with_time: bool) -> bool:
    formats = ["%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y", "%d %B %Y", "%d %b %Y"]
    if with_time:
        formats = ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] + formats
    for fmt in formats:
        try:
            datetime.strptime(value.strip(), fmt)
            return True
        except ValueError:
            continue
    return False


def range_check(value: str, rng: Optional[str]) -> Optional[str]:
    """Return an error message if the value does not fit an XSD range, else None."""
    if not rng:
        return None
    v = value.strip()
    if rng in XSD_NUMERIC:
        try:
            num = float(v)
        except ValueError:
            return f"expected a number ({rng})"
        if rng in XSD_INTEGER and not num.is_integer():
            return f"expected an integer ({rng})"
    elif rng == "boolean" and v.lower() not in {"true", "false", "1", "0", "yes", "no"}:
        return "expected a boolean"
    elif rng == "date" and not _parse_date(v, with_time=False):
        return "expected a date (YYYY-MM-DD)"
    elif rng == "dateTime" and not _parse_date(v, with_time=True):
        return "expected a date-time (YYYY-MM-DDTHH:MM:SS)"
    return None


def schema_check(cls: str, prop: SchemaProperty, value: str, ctx: SchemaContext,
                 target_class: Optional[str] = None) -> str:
    problems = []
    if prop.domains and not (prop.domains & ctx.class_and_ancestors(cls)):
        problems.append(f"domain: {prop.name} belongs to {', '.join(sorted(prop.domains))}, not {cls}")
    if target_class and prop.range in ctx.classes and prop.range not in ctx.class_and_ancestors(target_class):
        problems.append(f"range: links to a {target_class} record, expected {prop.range}")
    if prop.kind != "object":
        err = range_check(value, prop.range)
        if err:
            problems.append(f"range: {err}")
    return "; ".join(problems) if problems else "ok"


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
class ConversionResult:
    """Accumulates records from all PDFs and renders the CSV / review files."""

    def __init__(self, ctx: SchemaContext):
        self.ctx = ctx
        self.rows: Dict[str, List[Dict[str, str]]] = {}   # class -> rows
        self.columns: Dict[str, List[str]] = {}           # class -> ordered columns
        self.review: List[Dict[str, Any]] = []

    def add_review(self, **fields):
        fields["class"] = fields.pop("class_", "")  # "class" is a Python keyword
        self.review.append({c: fields.get(c, "") for c in REVIEW_COLUMNS})

    def add_document(self, doc: PdfDocument, mapped: Dict[str, Any]) -> Dict[str, int]:
        haystack = searchable_text(doc)
        stats = {"records": 0, "values": 0, "flagged": 0, "unmapped": 0}
        record_ids = self._assign_ids(doc, mapped["records"])

        for rec in mapped["records"]:
            cls = str(rec.get("class", "")).strip()
            page = rec.get("page", "")
            values = rec.get("values") if isinstance(rec.get("values"), dict) else {}
            raws = rec.get("raw") if isinstance(rec.get("raw"), dict) else {}

            if cls not in self.ctx.classes:
                for prop, val in values.items():
                    self._unmapped(doc, prop, val, page, f"AI used unknown class '{cls}'")
                    stats["unmapped"] += 1
                continue

            row: Dict[str, str] = {"id": rec["_id"]}
            pending = []
            for prop_name, val in values.items():
                val = "" if val is None else (json.dumps(val) if isinstance(val, (list, dict)) else str(val)).strip()
                if not val:
                    continue
                prop = self.ctx.properties.get(prop_name)
                if prop is None:
                    self._unmapped(doc, prop_name, val, page, f"AI used unknown property '{prop_name}'")
                    stats["unmapped"] += 1
                    continue
                raw = str(raws.get(prop_name, "") or "").strip()
                # A link to another record of this reply refers to it by its document-wide id
                target = record_ids.get((rec["_chunk"], val)) if prop.kind == "object" else None
                if target:
                    val = target[0]
                row[prop_name] = val
                pending.append((prop, val, raw, target))
            if len(row) == 1:
                continue

            self.rows.setdefault(cls, []).append(row)
            cols = self.columns.setdefault(cls, ["id"])
            cols += [p for p in row if p not in cols]
            line = len(self.rows[cls]) + 1  # line 1 is the header
            stats["records"] += 1

            for prop, val, raw, target in pending:
                src = "link to record" if target else source_check(val, raw, haystack)
                sch = schema_check(cls, prop, val, self.ctx, target_class=target[1] if target else None)
                flagged = src == "NOT FOUND" or sch != "ok"
                stats["values"] += 1
                stats["flagged"] += flagged
                self.add_review(type="value", source_file=doc.filename, page=page, class_=cls,
                                csv_file=f"{cls}.csv", csv_line=line, property=prop.name, value=val,
                                raw=raw, source_check=src, schema_check=sch,
                                message="CHECK" if flagged else "")

        for item in mapped["unmapped"]:
            if isinstance(item, dict):
                key, val, page = item.get("key", ""), item.get("value", ""), item.get("page", "")
            else:
                key, val, page = (list(item) + ["", "", ""])[:3]
            self._unmapped(doc, key, val, page, "no matching schema property")
            stats["unmapped"] += 1

        for note in mapped["notes"]:
            self.add_review(type="ai_note", source_file=doc.filename, message=note)
        self.add_warnings(doc)
        return stats

    @staticmethod
    def _assign_ids(doc: PdfDocument, records: List[Dict[str, Any]]) -> Dict[Tuple[int, str], Tuple[str, str]]:
        """
        Give every record an id that is unique across all PDFs ("<file>-<AI id>") and
        store it as rec["_id"]. Returns (chunk, AI id) -> (unique id, class) for links.
        """
        slug = re.sub(r"[^A-Za-z0-9]+", "-", doc.filename.rsplit(".", 1)[0]).strip("-") or "doc"
        multi_chunk = len({rec["_chunk"] for rec in records}) > 1
        ids: Dict[Tuple[int, str], Tuple[str, str]] = {}
        used: Set[str] = set()
        for n, rec in enumerate(records, start=1):
            local = re.sub(r"[^A-Za-z0-9_.-]+", "", str(rec.get("id") or "")) or f"r{n}"
            unique = f"{slug}-p{rec['_chunk']}-{local}" if multi_chunk else f"{slug}-{local}"
            if unique in used:  # the AI reused an id
                unique = f"{unique}-{n}"
            used.add(unique)
            rec["_id"] = unique
            ids.setdefault((rec["_chunk"], str(rec.get("id") or "").strip()), (unique, str(rec.get("class", "")).strip()))
        return ids

    def _unmapped(self, doc: PdfDocument, key, val, page, message: str):
        self.add_review(type="unmapped", source_file=doc.filename, page=page, property=str(key),
                        value=str(val), message=message)

    def add_warnings(self, doc: PdfDocument):
        for w in doc.warnings:
            self.add_review(type="warning", source_file=doc.filename, message=w)
        for img in doc.images:
            self.add_review(type="image_not_read", source_file=doc.filename, page=img.page,
                            message=f"Image {img.width:.0f}x{img.height:.0f} pt; check it manually")

    def add_error(self, filename: str, message: str):
        self.add_review(type="error", source_file=filename, message=message)

    def render(self) -> List[Dict[str, str]]:
        """Return [{name, content}] for each class CSV plus review.csv."""
        files = []
        for cls in sorted(self.rows):
            buf = StringIO()
            writer = csv.DictWriter(buf, fieldnames=self.columns[cls], lineterminator="\n")
            writer.writeheader()
            writer.writerows(self.rows[cls])
            files.append({"name": f"{cls}.csv", "content": buf.getvalue()})

        buf = StringIO()
        writer = csv.DictWriter(buf, fieldnames=REVIEW_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(self.review)
        files.append({"name": "review.csv", "content": buf.getvalue()})
        return files

    def summary(self) -> Dict[str, Any]:
        return {
            "records_per_class": {cls: len(rows) for cls, rows in sorted(self.rows.items())},
            "values": sum(1 for r in self.review if r["type"] == "value"),
            "flagged_values": sum(1 for r in self.review if r["type"] == "value" and r["message"] == "CHECK"),
            "unmapped": sum(1 for r in self.review if r["type"] == "unmapped"),
            "images_not_read": sum(1 for r in self.review if r["type"] == "image_not_read"),
        }


def convert_pdf(content: bytes, filename: str, schema_text: str, model: Optional[str],
                result: ConversionResult) -> Dict[str, int]:
    """Extract, map and verify one PDF, adding its records to `result`."""
    doc = extract_pdf_document(content, filename)
    mapped, chunks = map_document(doc, schema_text, model)
    stats = result.add_document(doc, mapped)
    stats["chunks"] = chunks
    return stats
