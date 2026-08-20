#!/usr/bin/env python3
"""
AST to .docx renderer (python-docx) — design v1.0 section 4-8.

Usage:
    python render_docx.py <input.md> <output.docx> [--glossary <dir>]

Korean handling: python-docx sets the Latin font name via style.font.name,
but Korean glyphs come from the East Asian font attribute, which must be set
through the raw w:eastAsia XML attribute or Word silently falls back to a
theme font. Both are set here from the theme.py FontSpec family.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

from glossary_appendix import append_glossary
from mdast import BulletList, Document, Heading, Paragraph, Table, parse_markdown
from theme import ACCENT_HEX, BODY_SIZE, HEADER_FILL_HEX, HEADING_SIZES, resolve_korean_font


def _set_east_asian(style, family: str) -> None:
    """Set the w:eastAsia font on a style (or run) so Korean renders in-family."""
    rpr = style._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), family)


def _shade_cell(cell, fill_hex: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_hex)
    tc_pr.append(shd)


def render(doc_ast: Document, out_path: Path, font_family: str) -> dict:
    d = docx.Document()

    # Base + heading styles: Latin name, East Asian name, sizes.
    normal = d.styles["Normal"]
    normal.font.name = font_family
    normal.font.size = Pt(BODY_SIZE)
    _set_east_asian(normal, font_family)

    for level in range(1, 7):
        style = d.styles[f"Heading {level}"]
        style.font.name = font_family
        style.font.size = Pt(HEADING_SIZES[level - 1])
        style.font.color.rgb = RGBColor.from_string(ACCENT_HEX)
        style.font.bold = True
        _set_east_asian(style, font_family)

    for block in doc_ast.blocks:
        if isinstance(block, Heading):
            d.add_heading(block.text, level=min(block.level, 6))
        elif isinstance(block, Paragraph):
            p = d.add_paragraph()
            for run in block.runs:
                r = p.add_run(run.text)
                r.bold = run.bold
                r.italic = run.italic
        elif isinstance(block, BulletList):
            for item in block.items:
                p = d.add_paragraph(style="List Bullet")
                p.add_run(item)
        elif isinstance(block, Table):
            t = d.add_table(rows=1 + len(block.rows), cols=len(block.header))
            t.style = "Table Grid"
            for col, text in enumerate(block.header):
                cell = t.rows[0].cells[col]
                cell.text = text
                _shade_cell(cell, HEADER_FILL_HEX)
                for r in cell.paragraphs[0].runs:
                    r.bold = True
                    r.font.color.rgb = RGBColor.from_string("FFFFFF")
            for row_idx, row in enumerate(block.rows, start=1):
                for col, text in enumerate(row):
                    t.rows[row_idx].cells[col].text = text

    out_path.parent.mkdir(parents=True, exist_ok=True)
    d.save(str(out_path))
    return doc_ast.counts()


def main() -> None:
    parser = argparse.ArgumentParser(description="Render Markdown to .docx via the shared AST")
    parser.add_argument("input", help="input Markdown path")
    parser.add_argument("output", help="output .docx path")
    parser.add_argument("--glossary", default=None, help="glossary directory (default: <repo>/glossary)")
    parser.add_argument("--no-glossary", action="store_true", help="skip glossary appendix generation")
    args = parser.parse_args()

    md_path = Path(args.input)
    if not md_path.exists():
        print(f"Error: input Markdown file not found: {md_path}", file=sys.stderr)
        sys.exit(1)

    font = resolve_korean_font()
    markdown = md_path.read_text(encoding="utf-8")

    glossary_terms = 0
    if not args.no_glossary:
        glossary_dir = args.glossary or str(Path(__file__).parent.parent.parent / "glossary")
        markdown, glossary_terms = append_glossary(markdown, glossary_dir)

    counts = render(parse_markdown(markdown), Path(args.output), font.family)
    print(json.dumps({
        "format": "docx",
        "output": str(Path(args.output).resolve()),
        **counts,
        "glossary_terms": glossary_terms,
        "font": font.family,
        "font_source": font.source,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
