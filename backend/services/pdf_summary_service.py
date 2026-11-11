"""
Human-readable PDF summary of a PDF -> CSV conversion.

Built from the ConversionResult (no extra AI call), so it always matches review.csv:
  1. Overview          -> what was read, per PDF and per class
  2. Values to check   -> flagged values with the reason they may be unreliable
  3. All values        -> per PDF and record: raw text in the PDF, final CSV value,
                          class / property it was matched to
"""

import os
import re
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from services.pdf_conversion_service import ConversionResult

# Values come from datasheets (Ω, µ, °, ä ...), which the built-in PDF fonts cannot show.
# DejaVu covers the most; Vera ships with reportlab and is the fallback.
_FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", os.path.join(os.path.dirname(reportlab.__file__), "fonts")]
_FONT_FILES = [("DejaVuSans.ttf", "DejaVuSans-Bold.ttf"), ("Vera.ttf", "VeraBd.ttf")]

FLAG_BG = colors.HexColor("#FFF4E0")
HEADER_BG = colors.HexColor("#E8ECF1")
RECORD_BG = colors.HexColor("#F4F6F8")
GRID = colors.HexColor("#C8CED6")
ACCENT = colors.HexColor("#B26A00")


def _register_fonts() -> Tuple[str, str]:
    for regular, bold in _FONT_FILES:
        for d in _FONT_DIRS:
            if os.path.exists(os.path.join(d, regular)) and os.path.exists(os.path.join(d, bold)):
                name = regular.rsplit(".", 1)[0]
                if name not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(name, os.path.join(d, regular)))
                    pdfmetrics.registerFont(TTFont(name + "-Bold", os.path.join(d, bold)))
                    pdfmetrics.registerFontFamily(name, normal=name, bold=name + "-Bold",
                                                  italic=name, boldItalic=name + "-Bold")
                return name, name + "-Bold"
    return "Helvetica", "Helvetica-Bold"


def _styles() -> Dict[str, ParagraphStyle]:
    regular, bold = _register_fonts()
    base = ParagraphStyle("base", fontName=regular, fontSize=9, leading=12, alignment=TA_LEFT)
    return {
        "title": ParagraphStyle("title", parent=base, fontName=bold, fontSize=18, leading=22, spaceAfter=4),
        "h1": ParagraphStyle("h1", parent=base, fontName=bold, fontSize=13, leading=17, spaceBefore=10, spaceAfter=6),
        "h2": ParagraphStyle("h2", parent=base, fontName=bold, fontSize=11, leading=14, spaceBefore=10, spaceAfter=4),
        "body": ParagraphStyle("body", parent=base, fontSize=10, leading=14, spaceAfter=4),
        "muted": ParagraphStyle("muted", parent=base, textColor=colors.HexColor("#5A6470")),
        "cell": ParagraphStyle("cell", parent=base, fontSize=8, leading=10),
        # Values and ids often have no spaces; let them break anywhere
        "value": ParagraphStyle("value", parent=base, fontSize=8, leading=10, wordWrap="CJK"),
        "head": ParagraphStyle("head", parent=base, fontName=bold, fontSize=8, leading=10),
        "record": ParagraphStyle("record", parent=base, fontName=bold, fontSize=8.5, leading=11),
        "flag": ParagraphStyle("flag", parent=base, fontName=bold, fontSize=8, leading=10, textColor=ACCENT),
    }


def _p(text: Any, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(str(text)), style)


def _plural(n: int, word: str, plural: Optional[str] = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


# ---------------------------------------------------------------------------
# Reasons in plain language
# ---------------------------------------------------------------------------
def _schema_reason(part: str) -> str:
    m = re.match(r"domain: (\S+) belongs to (.+), not (\S+)$", part)
    if m:
        return f"The schema puts {m.group(1)} on {m.group(2)}, but it was found on a {m.group(3)} record."
    m = re.match(r"range: links to a (\S+) record, expected (\S+)$", part)
    if m:
        return f"Links to a {m.group(1)} record, but the schema expects a {m.group(2)}."
    m = re.match(r"range: (.+)$", part)
    if m:
        return f"Does not fit the type in the schema: {m.group(1)}."
    return part


def _check_reason(part: str) -> str:
    m = re.match(r"label '(.*)' does not fit (\S+)$", part)
    if m:
        return f"Read next to the label “{m.group(1)}”, which does not clearly fit {m.group(2)}."
    m = re.match(r"same value as (.+), but written only once in the PDF$", part)
    if m:
        return (f"The same value was also used for {m.group(1)}, but the PDF writes it only once, "
                f"so it probably belongs to only one of them.")
    return part


def reasons(row: Dict[str, Any]) -> List[str]:
    """Why a review row may be unreliable, as short sentences."""
    if row["type"] == "link_added":
        return [f"Not read from the PDF: {row['message'].replace('filled automatically: ', 'filled in automatically as ')}."]
    out = []
    if row["source_check"] == "NOT FOUND":
        out.append("Not found in the PDF text. The AI may have reworded, converted or guessed it.")
    if row["schema_check"] and row["schema_check"] != "ok":
        out += [_schema_reason(p) for p in row["schema_check"].split("; ")]
    out += [_check_reason(p) for p in row["message"].split("; ")[1:] if p]
    return out


def is_flagged(row: Dict[str, Any]) -> bool:
    return row["type"] == "link_added" or (row["type"] == "value" and row["message"].startswith("CHECK"))


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
class _Report:
    def __init__(self, result: ConversionResult, pdf_names: List[str]):
        self.result = result
        self.ctx = result.ctx
        self.s = _styles()
        self.records = {row["id"]: (cls, row) for cls, rows in result.rows.items() for row in rows}
        # (class, csv line) -> record id; line 1 of each CSV is the header
        self.line_to_record = {(cls, n + 2): row["id"] for cls, rows in result.rows.items()
                               for n, row in enumerate(rows)}
        # Values (and automatically added links) in the order they were found
        self.values = [r for r in result.review if r["type"] in ("value", "link_added")]
        self.errors = {r["source_file"]: r["message"] for r in result.review if r["type"] == "error"}
        self.pdf_names = pdf_names or list(dict.fromkeys(r["source_file"] for r in result.review))
        self.check_no: Dict[int, int] = {}  # id(review row) -> number in section 2
        for row in self.values:
            if is_flagged(row):
                self.check_no[id(row)] = len(self.check_no) + 1

    # -- helpers ------------------------------------------------------------
    def record_name(self, record_id: str) -> str:
        """'MeasurementRun ID-000123' by its key value, else 'DeviceData record (DeviceData.csv line 2)'."""
        if record_id not in self.records:
            return record_id
        cls, row = self.records[record_id]
        own = self.ctx.class_and_ancestors(cls)
        key_props = next((self.ctx.keys[c] for c in [cls, *sorted(own - {cls})] if c in self.ctx.keys), [])
        name = ", ".join(row[p] for p in key_props if row.get(p))
        if name:
            return f"{cls} {name}"
        return f"{cls} record ({cls}.csv line {self.result.rows[cls].index(row) + 2})"

    def _is_link(self, prop_name: str) -> bool:
        prop = self.ctx.properties.get(prop_name)
        return bool(prop and prop.kind == "object")

    def final_value(self, row: Dict[str, Any]) -> str:
        if self._is_link(row["property"]) and row["value"] in self.records:
            return f"links to {self.record_name(row['value'])}"
        return row["value"]

    def raw_text(self, row: Dict[str, Any]) -> str:
        if row["type"] == "link_added":
            return "(not in the PDF)"
        if self._is_link(row["property"]) and row["value"] in self.records and not row["raw"]:
            return "(link between records)"
        return row["raw"] or row["value"]

    def where(self, row: Dict[str, Any]) -> str:
        page = f", page {row['page']}" if row["page"] not in ("", None) else ""
        return f"{row['source_file']}{page}"

    def _table(self, data, widths, flagged_rows=(), record_rows=(), header=True) -> Table:
        t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
        style = [
            ("GRID", (0, 0), (-1, -1), 0.4, GRID),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
        if header:
            style.append(("BACKGROUND", (0, 0), (-1, 0), HEADER_BG))
        for i in flagged_rows:
            style.append(("BACKGROUND", (0, i), (-1, i), FLAG_BG))
        for i in record_rows:
            style += [("SPAN", (0, i), (-1, i)), ("BACKGROUND", (0, i), (-1, i), RECORD_BG)]
        t.setStyle(TableStyle(style))
        return t

    # -- sections -----------------------------------------------------------
    def overview(self, schema_name: Optional[str], model: Optional[str]) -> List[Any]:
        s = self.s
        n_values, n_flagged = len(self.values), len(self.check_no)
        n_records = sum(len(rows) for rows in self.result.rows.values())
        n_ok = len(self.pdf_names) - len(self.errors)
        out = [_p("PDF to CSV conversion summary", s["title"])]
        meta = [datetime.now().strftime("%Y-%m-%d %H:%M")]
        if schema_name:
            meta.append(f"schema {schema_name}")
        if model:
            meta.append(f"AI model {model}")
        out += [_p(" · ".join(meta), s["muted"]), Spacer(1, 6 * mm), _p("1. Overview", s["h1"])]

        sentences = [
            f"{n_ok} of {_plural(len(self.pdf_names), 'PDF')} {'was' if n_ok == 1 else 'were'} read. "
            f"{_plural(n_values, 'value')} were extracted into {_plural(n_records, 'record')} "
            f"of {_plural(len(self.result.rows), 'class', 'classes')}.",
        ]
        if n_flagged:
            share = round(100 * n_flagged / n_values) if n_values else 0
            sentences.append(
                f"<b>{_plural(n_flagged, 'value')} ({share} %) may be unreliable</b> and should be checked "
                f"against the PDF before the CSVs are used. They are listed in section 2 and highlighted "
                f"in section 3.")
        else:
            sentences.append("No value was flagged by the checks.")
        sentences.append(
            "Each value was checked: does it appear in the PDF text, was it read next to a label that fits "
            "its property, does it fit the class and type the schema expects, and is a value written once "
            "in the PDF used for only one property.")
        for text in sentences:
            out.append(Paragraph(text, s["body"]))
        for name, message in self.errors.items():
            out.append(Paragraph(f"<b>Could not convert {escape(name)}:</b> {escape(message)}", s["body"]))

        # Per PDF
        out.append(_p("Per PDF", s["h2"]))
        data = [[_p(h, s["head"]) for h in ("PDF", "Records", "Values", "May be unreliable")]]
        flagged_rows = []
        for name in self.pdf_names:
            rows = [r for r in self.values if r["source_file"] == name]
            n_rec = len({(r["class"], r["csv_line"]) for r in rows})
            n_flag = sum(1 for r in rows if id(r) in self.check_no)
            status = "could not be converted" if name in self.errors else str(n_flag)
            if n_flag or name in self.errors:
                flagged_rows.append(len(data))
            data.append([_p(name, s["value"]), _p(n_rec, s["cell"]), _p(len(rows), s["cell"]), _p(status, s["cell"])])
        out.append(self._table(data, [130 * mm, 30 * mm, 30 * mm, 50 * mm], flagged_rows))

        # Per class
        out.append(_p("Per class", s["h2"]))
        data = [[_p(h, s["head"]) for h in ("Class", "CSV file", "Records", "Values", "May be unreliable")]]
        flagged_rows = []
        for cls in sorted(self.result.rows):
            rows = [r for r in self.values if r["class"] == cls]
            n_flag = sum(1 for r in rows if id(r) in self.check_no)
            if n_flag:
                flagged_rows.append(len(data))
            data.append([_p(cls, s["cell"]), _p(f"{cls}.csv", s["cell"]), _p(len(self.result.rows[cls]), s["cell"]),
                         _p(len(rows), s["cell"]), _p(n_flag, s["cell"])])
        out.append(self._table(data, [70 * mm, 70 * mm, 30 * mm, 30 * mm, 40 * mm], flagged_rows))

        out += [Spacer(1, 4 * mm), _p(
            "How to read the tables: “Raw text in PDF” is the text as the AI read it from the PDF, "
            "“Final value” is what was written to the CSV after clean-up (for example a label "
            "removed from the start of the value). Links between records are shown by the name of the "
            "record they point to.", s["muted"])]
        return out

    def flagged_section(self) -> List[Any]:
        s = self.s
        out = [_p("2. Values that may be unreliable", s["h1"])]
        if not self.check_no:
            return out + [_p("No value was flagged.", s["body"])]
        out.append(_p("Check these values against the PDF. The number in the first column is shown next "
                      "to the value in section 3.", s["muted"]))
        data = [[_p(h, s["head"]) for h in
                 ("#", "Where", "Record", "Class / property", "Raw text in PDF", "Final value", "Why it may be unreliable")]]
        for row in self.values:
            if id(row) not in self.check_no:
                continue
            record = self.line_to_record.get((row["class"], row["csv_line"]), "")
            data.append([
                _p(self.check_no[id(row)], s["flag"]),
                _p(self.where(row), s["value"]),
                _p(self.record_name(record) if record else "", s["value"]),
                _p(f"{row['class']} / {row['property']}", s["value"]),
                _p(self.raw_text(row), s["value"]),
                _p(self.final_value(row), s["value"]),
                Paragraph("<br/>".join(escape(r) for r in reasons(row)), s["cell"]),
            ])
        out.append(self._table(data, [10 * mm, 40 * mm, 36 * mm, 40 * mm, 36 * mm, 36 * mm, 69 * mm]))
        return out

    def all_values_section(self) -> List[Any]:
        s = self.s
        out = [_p("3. All extracted values", s["h1"]),
               _p("Grouped by PDF and record. Highlighted rows are listed in section 2.", s["muted"])]
        for name in self.pdf_names:
            rows = [r for r in self.values if r["source_file"] == name]
            n_flag = sum(1 for r in rows if id(r) in self.check_no)
            out.append(_p(name, s["h2"]))
            if not rows:
                out.append(_p("Could not be converted." if name in self.errors else "No values were extracted.", s["body"]))
                continue
            out.append(_p(f"{_plural(len(rows), 'value')}, {n_flag} may be unreliable", s["muted"]))

            # Keep each record's values together, records in the order they were found
            order = {}
            for r in rows:
                order.setdefault((r["class"], r["csv_line"]), len(order))
            rows = sorted(rows, key=lambda r: order[(r["class"], r["csv_line"])])

            data = [[_p(h, s["head"]) for h in ("Property", "Raw text in PDF", "Final value", "Check")]]
            flagged_rows, record_rows, current = [], [], None
            for r in rows:
                key = (r["class"], r["csv_line"])
                if key != current:
                    current = key
                    rid = self.line_to_record.get(key, "")
                    page = next((x["page"] for x in rows if (x["class"], x["csv_line"]) == key
                                 and x["page"] not in ("", None)), "")
                    head = self.record_name(rid) if rid else r["class"]
                    head = r["class"] if head.endswith(f"line {r['csv_line']})") else head
                    head += f"  ·  page {page}" if page else ""
                    head += f"  ·  {r['csv_file']} line {r['csv_line']}"
                    record_rows.append(len(data))
                    data.append([_p(head, s["record"]), "", "", ""])
                no = self.check_no.get(id(r))
                if no:
                    flagged_rows.append(len(data))
                data.append([_p(r["property"], s["value"]), _p(self.raw_text(r), s["value"]),
                             _p(self.final_value(r), s["value"]),
                             _p(f"see #{no}" if no else "", s["flag"])])
            out.append(self._table(data, [70 * mm, 85 * mm, 85 * mm, 27 * mm], flagged_rows, record_rows))
        return out


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#5A6470"))
    canvas.drawString(15 * mm, 8 * mm, "PDF to CSV conversion summary")
    canvas.drawRightString(doc.pagesize[0] - 15 * mm, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_summary_pdf(result: ConversionResult, pdf_names: List[str],
                      schema_name: Optional[str] = None, model: Optional[str] = None) -> bytes:
    """Render the conversion summary as PDF bytes."""
    report = _Report(result, pdf_names)
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=14 * mm, bottomMargin=15 * mm, title="PDF to CSV conversion summary")
    story = report.overview(schema_name, model) + [PageBreak()]
    story += report.flagged_section() + [PageBreak()]
    story += report.all_values_section()
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
