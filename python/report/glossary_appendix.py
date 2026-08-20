#!/usr/bin/env python3
"""
Glossary appendix generation for the co-newbiz document renderer
(design v1.0 sections 3-3 and 4-8).

One of the four glossary tooling integrations: "보고서 생성 — 문서에 등장한
용어만 추려 말미에 용어 부록 자동 생성. 수작업 불필요." This module scans
the Markdown source for glossary terms (key / ko / en / aliases) that
actually appear in the document, then appends a "용어집 (Glossary)" section
with a four-column table. Terms that never appear are not printed.

Glossary YAML files follow glossary/_schema.yaml:
  terms:
    WACC:
      ko: ...; en: ...; definition_ko: ...; why_it_matters_ko: ...
      aliases: [...]        # optional
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml


def load_glossary(glossary_dir: str | Path) -> list[dict]:
    """Load every glossary *.yaml (except _schema.yaml) into a flat term list."""
    terms: list[dict] = []
    gdir = Path(glossary_dir)
    for path in sorted(gdir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for key, entry in (data.get("terms") or {}).items():
            if not isinstance(entry, dict):
                continue
            terms.append(
                {
                    "key": str(key),
                    "ko": str(entry.get("ko", "")),
                    "en": str(entry.get("en", "")),
                    "definition_ko": str(entry.get("definition_ko", "")),
                    "why_it_matters_ko": str(entry.get("why_it_matters_ko", "")),
                    "aliases": [str(a) for a in (entry.get("aliases") or [])],
                }
            )
    terms.sort(key=lambda t: t["key"].lower())
    return terms


def _contains(text: str, candidate: str) -> bool:
    """Latin candidates match on boundaries (case-insensitive); Korean on substring."""
    if not candidate:
        return False
    if re.fullmatch(r"[A-Za-z0-9 .\-&/]+", candidate):
        pattern = re.escape(candidate).replace(r"\ ", r"[\s]+")
        return re.search(r"(?<![A-Za-z0-9])" + pattern + r"(?![A-Za-z0-9])", text, re.IGNORECASE) is not None
    return candidate in text


def find_terms_in_document(text: str, terms: list[dict]) -> list[dict]:
    """Return glossary terms whose key/ko/en/alias appears in the text."""
    matched = []
    for term in terms:
        candidates = [term["key"], term["ko"], term["en"], *term["aliases"]]
        # Long-enough candidates only: single Korean syllables would noise-match.
        usable = [c for c in candidates if len(c) >= 2]
        if any(_contains(text, c) for c in usable):
            matched.append(term)
    return matched


def _cell(text: str) -> str:
    """Make a term field safe for a Markdown table cell."""
    return text.replace("|", "\\|").replace("\n", " ").strip()


def build_appendix_markdown(matched: list[dict]) -> str:
    """Build the appendix section in Markdown (rendered by the shared AST)."""
    lines = [
        "## 용어집 (Glossary)",
        "",
        f"본 문서에서 참조된 용어 {len(matched)}개의 정의입니다. 전체 용어집은 시스템 용어집 조회를 참고하십시오.",
        "",
        "| 용어 | 영문명 | 정의 | 왜 중요한가 |",
        "|---|---|---|---|",
    ]
    for term in matched:
        name = term["key"] + (f" ({term['ko']})" if term["ko"] else "")
        lines.append(
            "| "
            + _cell(name) + " | "
            + _cell(term["en"]) + " | "
            + _cell(term["definition_ko"]) + " | "
            + _cell(term["why_it_matters_ko"]) + " |"
        )
    lines.append("")
    return "\n".join(lines)


def append_glossary(markdown: str, glossary_dir: str | Path) -> tuple[str, int]:
    """Append the glossary appendix to a Markdown document.

    Returns (new_markdown, matched_term_count). The document is returned
    unchanged (count 0) when no glossary term appears in it.
    """
    terms = load_glossary(glossary_dir)
    matched = find_terms_in_document(markdown, terms)
    if not matched:
        return markdown, 0
    appendix = build_appendix_markdown(matched)
    if not markdown.endswith("\n"):
        markdown += "\n"
    return markdown + "\n" + appendix, len(matched)
