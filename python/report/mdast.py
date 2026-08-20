#!/usr/bin/env python3
"""
Markdown to common AST for the co-newbiz document renderer (design v1.0 section 4-8).

Every renderer (docx / pdf / hwpx) consumes this single AST so the three
formats cannot drift apart in layout structure — the reason a common AST
exists at all per the design note: "Word and PDF built separately fork their
layouts."

Named mdast.py instead of the design's ast.py because a module named ast.py
on sys.path shadows the Python standard-library ast module inside the
renderer processes, which python-docx / reportlab / python-hwpx internals
may import. Behavior is unchanged; only the module name deviates.

Supported Markdown subset (report deliverables only — not general Markdown):
  - ATX headings, levels 1-6
  - pipe tables with a |---|---| separator row
  - unordered (- / *) and ordered (1.) list items, rendered as bullets
  - paragraphs, with **bold** and *italic* inline runs
  - YAML front matter (leading --- ... ---) is skipped
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Run:
    """One inline span of a paragraph with its formatting flags."""

    text: str
    bold: bool = False
    italic: bool = False


@dataclass
class Heading:
    level: int
    text: str  # plain text — heading styles carry the emphasis


@dataclass
class Paragraph:
    runs: list[Run]


@dataclass
class Table:
    header: list[str]
    rows: list[list[str]]


@dataclass
class BulletList:
    items: list[str]  # plain text — marker preserved for ordered items


@dataclass
class Document:
    blocks: list = field(default_factory=list)

    def counts(self) -> dict:
        """Block counts for the render summary JSON."""
        return {
            "headings": sum(isinstance(b, Heading) for b in self.blocks),
            "paragraphs": sum(isinstance(b, Paragraph) for b in self.blocks),
            "tables": sum(isinstance(b, Table) for b in self.blocks),
            "bullets": sum(len(b.items) for b in self.blocks if isinstance(b, BulletList)),
        }


_INLINE_RE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*)")


def strip_inline_markers(text: str) -> str:
    """Drop ** and * markers, keeping the text (tables, headings, bullets)."""
    parts = []
    for token in _INLINE_RE.split(text):
        if token.startswith("**") and token.endswith("**") and len(token) > 4:
            parts.append(token[2:-2])
        elif token.startswith("*") and token.endswith("*") and len(token) > 2:
            parts.append(token[1:-1])
        else:
            parts.append(token)
    return "".join(parts)


def parse_inline(text: str) -> list[Run]:
    """Split a paragraph line into bold/italic runs."""
    runs = []
    for token in _INLINE_RE.split(text):
        if not token:
            continue
        if token.startswith("**") and token.endswith("**") and len(token) > 4:
            runs.append(Run(token[2:-2], bold=True))
        elif token.startswith("*") and token.endswith("*") and len(token) > 2:
            runs.append(Run(token[1:-1], italic=True))
        else:
            runs.append(Run(token))
    return runs or [Run("")]


def _parse_table_row(line: str) -> list[str]:
    """Split a pipe-table row into stripped cell strings (co-consult pattern)."""
    parts = line.strip().split("|")
    if parts and parts[0].strip() == "":
        parts = parts[1:]
    if parts and parts[-1].strip() == "":
        parts = parts[:-1]
    return [cell.strip() for cell in parts]


def _is_table_separator(line: str) -> bool:
    cells = _parse_table_row(line)
    if not cells:
        return False
    return all(cell.replace(":", "").replace("-", "") == "" for cell in cells)


def _is_list_item(line: str) -> tuple[bool, str]:
    """Return (is_item, item_text) for '- ', '* ' and '1. ' markers.

    The ordered marker is preserved in item_text so numbering survives
    renderers that only draw bullets.
    """
    stripped = line.strip()
    m = re.match(r"^(\d+)\.\s+(.*)$", stripped)
    if m:
        return True, f"{m.group(1)}. {m.group(2)}"
    m = re.match(r"^[-*]\s+(.*)$", stripped)
    if m:
        return True, m.group(1)
    return False, stripped


def parse_markdown(text: str) -> Document:
    """Parse the supported Markdown subset into a Document."""
    lines = text.splitlines()

    # Skip YAML front matter (leading '---' ... '---').
    start = 0
    if lines and lines[0].strip() == "---":
        for idx in range(1, len(lines)):
            if lines[idx].strip() == "---":
                start = idx + 1
                break

    doc = Document()
    i = start
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped == "" or stripped == "---":
            i += 1
            continue

        # ATX heading.
        hashes = 0
        for ch in stripped:
            if ch == "#":
                hashes += 1
            else:
                break
        if 1 <= hashes <= 6 and len(stripped) > hashes and stripped[hashes] == " ":
            doc.blocks.append(Heading(hashes, strip_inline_markers(stripped[hashes + 1:].strip())))
            i += 1
            continue

        # Pipe table block.
        if stripped.startswith("|"):
            table_lines = [line]
            j = i + 1
            while j < n and lines[j].strip().startswith("|"):
                table_lines.append(lines[j])
                j += 1
            header = _parse_table_row(table_lines[0])
            data = table_lines[1:]
            if data and _is_table_separator(data[0]):
                data = data[1:]
            rows = []
            for row in data:
                cells = _parse_table_row(row)
                # Pad/trim to header width so ragged rows cannot break renderers.
                cells = (cells + [""] * len(header))[: len(header)]
                rows.append([strip_inline_markers(c) for c in cells])
            header = [strip_inline_markers(c) for c in header]
            doc.blocks.append(Table(header, rows))
            i = j
            continue

        # Consecutive list items collapse into one BulletList.
        is_item, item_text = _is_list_item(stripped)
        if is_item:
            items = [strip_inline_markers(item_text)]
            j = i + 1
            while j < n:
                nxt_is_item, nxt_text = _is_list_line(lines[j])
                if not nxt_is_item:
                    break
                items.append(strip_inline_markers(nxt_text))
                j += 1
            doc.blocks.append(BulletList(items))
            i = j
            continue

        doc.blocks.append(Paragraph(parse_inline(stripped)))
        i += 1

    return doc


def _is_list_line(line: str) -> tuple[bool, str]:
    if line.strip() == "":
        return False, ""
    return _is_list_item(line)
