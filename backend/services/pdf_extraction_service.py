"""
PDF extraction layer for the PDF -> CSV conversion.

Turns a PDF into a structured, page-by-page document that an LLM can read:
ruled tables become markdown tables, all remaining text is kept in reading
order, and images are recorded as placeholders (their content is not read).
No AI is involved here; the output is deterministic.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from io import BytesIO
from typing import List, Optional, Tuple

import pdfplumber

# Horizontal gap (in pt) between two words on the same line that is treated as
# a column/field separator rather than a normal word space.
COLUMN_GAP = 10.0
# Images smaller than this (in pt, either side) are ignored as decoration.
MIN_IMAGE_SIZE = 20.0

# Adobe Symbol font encodes Greek letters as Latin ASCII codes. When a PDF has no
# Unicode mapping for it, pdfplumber returns the Latin letter (e.g. "mΩ" -> "mW").
_SYMBOL_FONT_MAP = dict(zip(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    "ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖαβχδεφγηιϕκλμνοπθρστυϖωξψζ",
))
_CID_RE = re.compile(r"\(cid:\d+\)")


@dataclass
class Block:
    kind: str  # "text" | "table" | "image"
    page: int
    top: float
    text: str = ""
    rows: List[List[str]] = field(default_factory=list)
    width: float = 0.0
    height: float = 0.0


@dataclass
class PdfDocument:
    filename: str
    page_count: int
    blocks: List[Block]
    warnings: List[str]

    @property
    def images(self) -> List[Block]:
        return [b for b in self.blocks if b.kind == "image"]


def _clean_cell(cell: Optional[str]) -> str:
    """Collapse whitespace inside a cell but keep its line breaks; None becomes ''."""
    if cell is None:
        return ""
    lines = (re.sub(r"[ \t]+", " ", line).strip() for line in str(cell).splitlines())
    return "\n".join(line for line in lines if line)


def _fix_symbol_font(page) -> int:
    """Map Symbol-font Latin codes back to Greek letters in place. Returns count fixed."""
    fixed = 0
    for ch in page.chars:
        if "symbol" in ch.get("fontname", "").lower() and ch["text"] in _SYMBOL_FONT_MAP:
            ch["text"] = _SYMBOL_FONT_MAP[ch["text"]]
            fixed += 1
    return fixed


def _fill_merged_cells(table, raw: List[List[Optional[str]]]) -> List[List[str]]:
    """
    pdfplumber returns None for cells covered by a merged cell. Vertically merged
    cells are filled with the value from the row above (so continuation rows keep
    their context); horizontally merged cells are left empty.
    """
    col_x = {}
    for row in table.rows:
        for j, cell in enumerate(row.cells):
            if cell is not None and j not in col_x:
                col_x[j] = (cell[0] + cell[2]) / 2

    out: List[List[str]] = []
    for i, row in enumerate(raw):
        row_bbox = table.rows[i].bbox
        filled = []
        for j, value in enumerate(row):
            if value is not None:
                filled.append(_clean_cell(value))
                continue
            vertical = False
            if i > 0 and j in col_x:
                xc, yc = col_x[j], (row_bbox[1] + row_bbox[3]) / 2
                for x0, top, x1, bottom in table.cells:
                    if x0 <= xc <= x1 and top <= yc <= bottom:
                        vertical = top < row_bbox[1] - 1
                        break
            filled.append(out[i - 1][j] if vertical and j < len(out[i - 1]) else "")
        out.append(filled)
    return out


def _drop_empty(rows: List[List[str]]) -> List[List[str]]:
    """Drop fully empty rows and columns."""
    rows = [r for r in rows if any(r)]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    keep = [j for j in range(width) if any(r[j] for r in rows)]
    return [[r[j] for j in keep] for r in rows]


def _height(w: dict) -> float:
    return max(w["bottom"] - w["top"], 0.1)


def _group_lines(words: List[dict]) -> List[List[dict]]:
    """
    Group words into visual lines. Normal-size words form the lines; smaller words
    (sub/superscripts such as the "DS" in V_DS) are then attached to the line whose
    word they directly touch, or else to the line they overlap most.
    """
    if not words:
        return []
    heights = sorted(_height(w) for w in words)
    median = heights[len(heights) // 2]
    normal = [w for w in words if _height(w) >= 0.85 * median]
    small = [w for w in words if _height(w) < 0.85 * median]

    lines: List[List] = []  # [top, bottom, members]
    for w in sorted(normal, key=lambda w: (w["top"], w["x0"])):
        for line in lines:
            overlap = min(line[1], w["bottom"]) - max(line[0], w["top"])
            # A word directly touching a larger word is its sub/superscript
            touches_larger = overlap > 0 and any(
                abs(m["x1"] - w["x0"]) < 1.5 and _height(m) > _height(w) for m in line[2])
            if overlap >= _height(w) / 2 or touches_larger:
                line[2].append(w)
                if not touches_larger:  # keep sub/superscripts from stretching the line
                    line[0], line[1] = min(line[0], w["top"]), max(line[1], w["bottom"])
                break
        else:
            lines.append([w["top"], w["bottom"], [w]])

    for w in small:
        reach = _height(w) / 2  # sub/superscripts may sit just outside the line box
        candidates = [l for l in lines if min(l[1], w["bottom"] + reach) - max(l[0], w["top"] - reach) > 0]
        touching = [l for l in candidates if any(abs(m["x1"] - w["x0"]) < 1.5 for m in l[2])]
        if touching:
            touching[0][2].append(w)
        elif candidates:
            max(candidates, key=lambda l: min(l[1], w["bottom"]) - max(l[0], w["top"]))[2].append(w)
        else:
            lines.append([w["top"], w["bottom"], [w]])

    return [members for _, _, members in sorted(lines, key=lambda l: l[0])]


def _line_text(words: List[dict]) -> str:
    """Join a line's words, inserting ' | ' where a wide gap separates two fields."""
    words = sorted(words, key=lambda w: w["x0"])
    parts = [words[0]["text"]]
    for prev, cur in zip(words, words[1:]):
        gap = cur["x0"] - prev["x1"]
        parts.append(" | " if gap > COLUMN_GAP else ("" if gap < 0.5 else " "))
        parts.append(cur["text"])
    text = "".join(parts)
    return re.sub(r"\.{4,}", " ... ", text).strip()


def _inside(obj: dict, bboxes: List[Tuple[float, float, float, float]]) -> bool:
    xc = (obj["x0"] + obj["x1"]) / 2
    yc = (obj["top"] + obj["bottom"]) / 2
    return any(x0 <= xc <= x1 and top <= yc <= bottom for x0, top, x1, bottom in bboxes)


def _extract_page(page, page_no: int, warnings: List[str]) -> List[Block]:
    blocks: List[Block] = []

    fixed = _fix_symbol_font(page)
    if fixed:
        warnings.append(
            f"Page {page_no}: {fixed} Symbol-font character(s) were converted to Greek letters "
            f"(e.g. Ω, µ); check units in the output."
        )

    # Ruled tables
    table_bboxes = []
    for table in page.find_tables():
        rows = _drop_empty(_fill_merged_cells(table, table.extract()))
        # Single-column "tables" are usually framed text boxes or shaded rows;
        # they read better (and lose nothing) as plain text.
        if not rows or len(rows[0]) < 2:
            continue
        table_bboxes.append(table.bbox)
        blocks.append(Block("table", page_no, table.bbox[1], rows=rows))

    # Text outside the tables, as lines in reading order
    text_page = page.filter(lambda obj: obj.get("object_type") != "char" or not _inside(obj, table_bboxes))
    words = text_page.extract_words(keep_blank_chars=False, use_text_flow=False)
    for line in _group_lines(words):
        blocks.append(Block("text", page_no, min(w["top"] for w in line), text=_line_text(line)))

    # Images (content not read)
    for img in page.images:
        if img["width"] < MIN_IMAGE_SIZE or img["height"] < MIN_IMAGE_SIZE:
            continue
        blocks.append(Block("image", page_no, img["top"], width=img["width"], height=img["height"]))

    if not page.chars:
        warnings.append(f"Page {page_no}: no extractable text (scanned page?); content was not read.")

    blocks.sort(key=lambda b: b.top)
    return blocks


def extract_pdf_document(content: bytes, filename: str) -> PdfDocument:
    """
    Extract a PDF into ordered text/table/image blocks.
    Raises ValueError if the PDF cannot be read.
    """
    warnings: List[str] = []
    blocks: List[Block] = []
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            page_count = len(pdf.pages)
            for page_no, page in enumerate(pdf.pages, start=1):
                blocks.extend(_extract_page(page, page_no, warnings))
    except Exception as e:
        raise ValueError(f"Failed to read PDF file {filename}: {str(e)}")

    cid_count = sum(len(_CID_RE.findall(b.text)) for b in blocks) + sum(
        len(_CID_RE.findall(c)) for b in blocks for r in b.rows for c in r
    )
    if cid_count:
        warnings.append(f"{cid_count} character(s) could not be decoded and were replaced with '?'.")
        for b in blocks:
            b.text = _CID_RE.sub("?", b.text)
            b.rows = [[_CID_RE.sub("?", c) for c in r] for r in b.rows]

    images = [b for b in blocks if b.kind == "image"]
    if images:
        pages = sorted({b.page for b in images})
        warnings.append(
            f"{len(images)} image(s) on page(s) {', '.join(map(str, pages))} were not read; "
            f"they may contain information that is missing from the output."
        )

    return PdfDocument(filename=filename, page_count=page_count, blocks=blocks, warnings=warnings)


def _markdown_table(rows: List[List[str]]) -> str:
    def fmt(r):
        return "| " + " | ".join(c.replace("|", "/").replace("\n", "<br>") for c in r) + " |"
    lines = [fmt(rows[0]), "|" + "---|" * len(rows[0])]
    lines += [fmt(r) for r in rows[1:]]
    return "\n".join(lines)


def render_pages(doc: PdfDocument) -> List[str]:
    """Render each page as LLM-readable text. Returns one string per page."""
    pages = []
    for page_no in range(1, doc.page_count + 1):
        out = [f"=== PAGE {page_no} ==="]
        table_no = image_no = 0
        for b in (b for b in doc.blocks if b.page == page_no):
            if b.kind == "text":
                out.append(b.text)
            elif b.kind == "table":
                table_no += 1
                out.append(f"\n[TABLE {table_no} on page {page_no}]\n{_markdown_table(b.rows)}\n")
            else:
                image_no += 1
                out.append(f"[IMAGE {image_no} on page {page_no}: {b.width:.0f}x{b.height:.0f} pt, content not available]")
        pages.append("\n".join(out))
    return pages


def normalize_for_search(text: str) -> str:
    """Normalization shared by the source check: unicode, case, whitespace, decimal comma."""
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"(?<=\d),(?=\d)", ".", text)
    return re.sub(r"\s+", "", text)


def searchable_text(doc: PdfDocument) -> str:
    """All text in the document (text blocks and table cells), normalized for searching."""
    parts = []
    for b in doc.blocks:
        if b.kind == "text":
            parts.append(b.text)
        elif b.kind == "table":
            parts.extend(" ".join(r) for r in b.rows)
    return normalize_for_search("\n".join(parts))
