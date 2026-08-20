#!/usr/bin/env python3
"""
AST to .pdf renderer (reportlab) — design v1.0 section 4-8.

Usage:
    python render_pdf.py <input.md> <output.pdf> [--glossary <dir>]

Korean handling — the known hard part per the design note: reportlab has no
built-in CJK font, so a real Korean .ttf pair is registered through
pdfmetrics (theme.py resolves which one). A font *family* is registered too
so <b> markup inside Paragraphs maps to the real bold face. Korean text has
no spaces to wrap on, so every body/cell style sets wordWrap="CJK".
Malgun Gothic has no italic face; italic runs degrade to regular.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).parent))

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph as RLParagraph, SimpleDocTemplate, Spacer, Table as RLTable, TableStyle

from glossary_appendix import append_glossary
from mdast import BulletList, Document, Heading, Paragraph, Table, parse_markdown
from theme import (
    ACCENT_RGB,
    BODY_LEADING,
    BODY_SIZE,
    CELL_SIZE,
    GRID_HEX,
    HEADER_FILL_HEX,
    HEADING_SIZES,
    KR_FONT_BOLD,
    KR_FONT_REGULAR,
    ROW_ALT_FILL_HEX,
    resolve_korean_font,
)

MARGIN_LR = 54  # ~1.9 cm
MARGIN_TB = 64


def _runs_to_markup(runs) -> str:
    """AST runs -> reportlab paragraph markup (escape first, then wrap)."""
    parts = []
    for run in runs:
        text = escape(run.text)
        if run.bold:
            text = f"<b>{text}</b>"
        if run.italic:
            text = f"<i>{text}</i>"
        parts.append(text)
    return "".join(parts)


def render(doc_ast: Document, out_path: Path) -> dict:
    font = resolve_korean_font()
    pdfmetrics.registerFont(TTFont(KR_FONT_REGULAR, font.regular_path))
    pdfmetrics.registerFont(TTFont(KR_FONT_BOLD, font.bold_path))
    registerFontFamily(
        KR_FONT_REGULAR,
        normal=KR_FONT_REGULAR,
        bold=KR_FONT_BOLD,
        italic=KR_FONT_REGULAR,   # Malgun has no italic face — degrade to regular
        boldItalic=KR_FONT_BOLD,
    )

    base = dict(fontName=KR_FONT_REGULAR, wordWrap="CJK")
    body_style = ParagraphStyle(
        "Body", fontSize=BODY_SIZE, leading=BODY_LEADING, spaceAfter=6, textColor=colors.black, **base
    )
    cell_style = ParagraphStyle(
        "Cell", fontSize=CELL_SIZE, leading=CELL_SIZE + 4, textColor=colors.black, **base
    )
    header_cell_style = ParagraphStyle(
        "HeaderCell", fontSize=CELL_SIZE, leading=CELL_SIZE + 4, textColor=colors.white, **base
    )
    heading_styles = [
        ParagraphStyle(
            f"H{lvl}",
            fontSize=HEADING_SIZES[lvl - 1],
            leading=HEADING_SIZES[lvl - 1] + 6,
            spaceBefore=14 if lvl <= 2 else 10,
            spaceAfter=6,
            textColor=colors.Color(*ACCENT_RGB),
            **base,
        )
        for lvl in range(1, 7)
    ]

    usable_width = A4[0] - 2 * MARGIN_LR
    story = []
    for block in doc_ast.blocks:
        if isinstance(block, Heading):
            story.append(RLParagraph(escape(block.text), heading_styles[min(block.level, 6) - 1]))
        elif isinstance(block, Paragraph):
            story.append(RLParagraph(_runs_to_markup(block.runs), body_style))
        elif isinstance(block, BulletList):
            for item in block.items:
                story.append(RLParagraph(escape(item), body_style, bulletText="•"))
            story.append(Spacer(1, 4))
        elif isinstance(block, Table):
            col_width = usable_width / max(len(block.header), 1)
            data = [[RLParagraph(escape(h), header_cell_style) for h in block.header]]
            for row in block.rows:
                data.append([RLParagraph(escape(c), cell_style) for c in row])
            table = RLTable(data, colWidths=[col_width] * len(block.header), repeatRows=1)
            table.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#" + HEADER_FILL_HEX)),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#" + ROW_ALT_FILL_HEX)]),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#" + GRID_HEX)),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ])
            )
            story.append(table)
            story.append(Spacer(1, 8))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(out_path), pagesize=A4,
        leftMargin=MARGIN_LR, rightMargin=MARGIN_LR, topMargin=MARGIN_TB, bottomMargin=MARGIN_TB,
        title="co-newbiz report",
    )
    doc.build(story)
    return doc_ast.counts()


def main() -> None:
    parser = argparse.ArgumentParser(description="Render Markdown to .pdf via the shared AST")
    parser.add_argument("input", help="input Markdown path")
    parser.add_argument("output", help="output .pdf path")
    parser.add_argument("--glossary", default=None, help="glossary directory (default: <repo>/glossary)")
    parser.add_argument("--no-glossary", action="store_true", help="skip glossary appendix generation")
    args = parser.parse_args()

    md_path = Path(args.input)
    if not md_path.exists():
        print(f"Error: input Markdown file not found: {md_path}", file=sys.stderr)
        sys.exit(1)

    markdown = md_path.read_text(encoding="utf-8")
    glossary_terms = 0
    if not args.no_glossary:
        glossary_dir = args.glossary or str(Path(__file__).parent.parent.parent / "glossary")
        markdown, glossary_terms = append_glossary(markdown, glossary_dir)

    counts = render(parse_markdown(markdown), Path(args.output))
    print(json.dumps({
        "format": "pdf",
        "output": str(Path(args.output).resolve()),
        **counts,
        "glossary_terms": glossary_terms,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
