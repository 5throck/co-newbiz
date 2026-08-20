---
name: hwp-document-processing
scope: co-newbiz
status: active
description: >
  Handles Korean office document generation for deliverables — .hwpx (open
  XML/ZIP) generation from Markdown via the project's own report renderer,
  with OWPML schema validation. .hwp (legacy binary) template extraction is
  not yet ported to co-newbiz (see Adaptation Note below) — use when a
  deliverable must be generated as .docx/.pdf/.hwpx from an approved
  Markdown draft, or when validating a generated .hwpx.
owner: docs-writer
version: 1.0.0
last_reviewed: 2026-08-20
metadata:
  type: implementation
  triggers:
    - hwp
    - hwpx
    - hwp document
    - hwpx document
    - hwpx generation
    - government report template
---

## Context

Reused from `Projects/co-consult/skills/hwp-document-processing`. co-consult's
skill covers two directions — reading/extracting an existing `.hwp` template's
structure, and generating a fresh `.hwpx`. **co-newbiz's Wave 5.2d renderer
(`python/report/render_hwpx.py`, wired as `newbiz.ts report`) only implements
the generation direction** — Markdown to `.hwpx`/`.docx`/`.pdf` via a shared
AST (`python/report/mdast.py`), with a glossary appendix auto-generated from
terms used in the document. Extraction from an existing `.hwp` binary template
(`python/extract_hwp.py`, `hwp-extract.ts` in co-consult) has **not been
ported** — flagged here rather than silently assumed available.

### Generation path (verified, Wave 5.2d)

1. Draft the deliverable in Markdown per the project's report template
   (`templates/deliverables/ic-memo-template.md` or similar)
2. Generate: `bun scripts/co-newbiz/newbiz.ts report <draft.md> --format docx,pdf,hwpx`
3. The renderer embeds Korean fonts (Malgun Gothic / Nanum via a 4-tier
   resolution chain) and appends a glossary appendix for every registered
   term that appears in the document (design §3-3, `glossary_appendix.py`)
4. Structural counts (headings/paragraphs/tables/bullets) are identical
   across all three output formats, since they share one AST — a
   cross-format layout drift is a renderer defect, not expected variance

### Extraction path (deferred — not available in co-newbiz today)

If a future engagement requires ingesting an existing `.hwp`/`.hwpx` template
(e.g. a government submission form whose chapter structure must be matched
exactly), port `python/extract_hwp.py` and the read-mode of `python-hwpx`
from `Projects/co-consult/` first — do not attempt ad hoc parsing. Until
ported, treat any such requirement as a scope gap to raise with `platform-lead`,
not as something this skill already covers.

## When to Use

- Generating the final `.hwpx`/`.docx`/`.pdf` deliverable from an approved
  Markdown draft (→ `report` command)
- Validating a generated `.hwpx`'s cross-format structural consistency
- Confirming the glossary appendix includes every term the draft actually uses

## Execution Steps

1. **Draft in Markdown** per the deliverable's chapter ownership model
2. **Generate**: `bun scripts/co-newbiz/newbiz.ts report <draft.md> --format docx,pdf,hwpx --out-dir <dir>`
3. **Cross-check structural counts** across the three generated formats — a
   mismatch means the renderer diverged, not that one format is "more correct"
4. **Confirm the glossary appendix** lists exactly the registered terms present
   in the body text (no fabricated terms, none of the used ones missing)
5. **Report findings** to the requesting agent; max 2 re-generation cycles
   before escalating to `docs-writer`'s owning PM dispatch

## Output Format

- Generated `.docx`/`.pdf`/`.hwpx` files (co-located per format)
- Structural-consistency check (heading/paragraph/table/bullet counts per format)
- Glossary-appendix accuracy report

## Related Skills

- `sample-driven-report-writing` — the structural-fidelity discipline this
  renderer's output must satisfy when a sample/template exists
- `glossary-management` — the source of the terms this renderer's appendix draws from
