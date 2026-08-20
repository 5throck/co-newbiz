#!/usr/bin/env python3
"""
AST to .hwpx renderer (python-hwpx) — design v1.0 section 4-8.

Usage:
    python render_hwpx.py <input.md> <output.hwpx> [--glossary <dir>]

Builds on the proven pattern from Projects/co-consult/python/generate_hwpx.py
(HwpxDocument / add_heading / add_table / set_cell_text / save_to_path, then
OWPML schema validation via hwpx.tools.validator) but consumes the shared
AST like the docx/pdf renderers, so all three formats share one layout
structure. Inline bold/italic markers are stripped — HWPX paragraphs are
plain text here, matching the co-consult behavior. No Hancom Office install
is required to generate or validate the file.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from hwpx.document import HwpxDocument

from glossary_appendix import append_glossary
from mdast import BulletList, Document, Heading, Paragraph, Table, parse_markdown


def render(doc_ast: Document, out_path: Path) -> dict:
    doc = HwpxDocument.new()

    for block in doc_ast.blocks:
        if isinstance(block, Heading):
            doc.add_heading(block.text, level=min(block.level, 9))
        elif isinstance(block, Paragraph):
            doc.add_paragraph("".join(r.text for r in block.runs))
        elif isinstance(block, BulletList):
            for item in block.items:
                doc.add_paragraph("• " + item)
        elif isinstance(block, Table):
            cols = max(len(block.header), 1)
            rows = 1 + len(block.rows)
            table = doc.add_table(rows=rows, cols=cols)
            for col, text in enumerate(block.header):
                table.set_cell_text(0, col, text)
            for row_offset, row in enumerate(block.rows, start=1):
                for col, text in enumerate(row):
                    table.set_cell_text(row_offset, col, text)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save_to_path(str(out_path))
    return doc_ast.counts()


def validate(hwpx_path: Path) -> str:
    """Run OWPML schema validation; returns PASS / FAIL / SKIP."""
    try:
        from hwpx.tools import validator
    except ImportError:
        return "SKIP"

    report = validator.validate_document(str(hwpx_path))
    if report.ok:
        return "PASS"
    for issue in report.errors:
        location = f"{issue.part_name}:{issue.line}:{issue.column}" if issue.line else issue.part_name
        print(f"[hwpx validation] [{issue.severity}] {location}: {issue.message}", file=sys.stderr)
    return "FAIL"


def main() -> None:
    parser = argparse.ArgumentParser(description="Render Markdown to .hwpx via the shared AST")
    parser.add_argument("input", help="input Markdown path")
    parser.add_argument("output", help="output .hwpx path")
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
    validation = validate(Path(args.output))
    print(json.dumps({
        "format": "hwpx",
        "output": str(Path(args.output).resolve()),
        **counts,
        "glossary_terms": glossary_terms,
        "validation": validation,
    }, ensure_ascii=False))
    if validation == "FAIL":
        sys.exit(1)


if __name__ == "__main__":
    main()
