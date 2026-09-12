---
name: hwp-document-processing
scope: co-newbiz
status: active
description: >
  Handles Korean office document generation and extraction: .hwpx (open
  XML/ZIP) generation from Markdown via the project's report renderer, and
  legacy .hwp binary text extraction via python/extract_hwp.py + olefile.
owner: docs-writer
version: 1.1.0
last_reviewed: 2026-09-09
metadata:
  type: implementation
  triggers:
    - hwp
    - hwpx
    - hwp document
    - hwpx document
    - hwp extraction
    - hwpx generation
    - government report template
---

## Context

co-newbiz supports both directions needed for Korean office deliverables:

- **Generation**: `bun scripts/co-newbiz/newbiz.ts report <draft.md> --format docx,pdf,hwpx`
  renders Markdown through the shared report AST into `.docx`, `.pdf`, and
  `.hwpx`, with glossary appendix support.
- **Extraction**: `bun scripts/co-newbiz/newbiz.ts hwp-extract <template.hwp> --output <text.txt>`
  reads legacy HWP 5.0 OLE BodyText streams through `python/extract_hwp.py`
  and extracts `HWPTAG_PARA_TEXT` as UTF-16LE plain text. Install
  `python/requirements.txt` first so `olefile` is available.

Extraction is intentionally text-only. Structural/layout matching for a
sample-driven deliverable still requires human review against the source form;
do not infer tables, numbering, or legal section hierarchy solely from the
plain-text output.

## When to Use

- Generating the final `.hwpx`/`.docx`/`.pdf` deliverable from an approved
  Markdown draft (→ `report` command)
- Extracting text from an existing legacy `.hwp` form/template before drafting
- Validating a generated `.hwpx`'s cross-format structural consistency
- Confirming the glossary appendix includes every term the draft actually uses

## Execution Steps

1. **If starting from an existing `.hwp`**: extract text with
   `bun scripts/co-newbiz/newbiz.ts hwp-extract <input.hwp> --output <out.txt>`
2. **Draft in Markdown** per the deliverable's chapter ownership model
3. **Generate**: `bun scripts/co-newbiz/newbiz.ts report <draft.md> --format docx,pdf,hwpx --out-dir <dir>`
4. **Cross-check structural counts** across generated formats — a mismatch
   means the renderer diverged, not that one format is "more correct"
5. **Confirm the glossary appendix** lists exactly the registered terms present
   in the body text (no fabricated terms, none of the used ones missing)
6. **Report findings**; max 2 re-generation cycles before escalating to
   `docs-writer`'s owning PM dispatch

## Output Format

- Extracted `.txt` when an existing `.hwp` was used as source
- Generated `.docx`/`.pdf`/`.hwpx` files (co-located per format)
- Structural-consistency check (heading/paragraph/table/bullet counts per format)
- Glossary-appendix accuracy report

## Related Skills

- `sample-driven-report-writing` — structural-fidelity discipline when a sample/template exists
- `glossary-management` — the source of glossary appendix terms
