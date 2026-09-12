---
name: sample-driven-report-writing
status: active
scope: co-newbiz
description: >
  Analyzes a deliverable sample (PDF/DOCX/HWPX) to extract its table-of-contents
  structure AND, for each section, whether tables and/or charts are mandatory —
  then researches and drafts report content that matches the sample's exact
  structure and visual-element requirements. Use when: writing any new-business
  review deliverable that must conform to a supplied sample or government/
  institutional template format.
owner: docs-writer
version: 1.0.0
last_reviewed: 2026-08-20
prerequisites: hwp-document-processing
relates_to:
  - skill: translate
    type: composes_with
metadata:
  type: domain
  triggers:
    - sample-driven report
    - deliverable template
    - match sample structure
    - write to sample format
---

## Context

Reused from `Projects/co-consult/skills/sample-driven-report-writing`,
generalizing the "write-to-sample" discipline for co-newbiz deliverables (IC
memos, Green Field/Brown Field feasibility reports, government submission
forms). Given a finished reference deliverable or an official template, produce
a new deliverable whose chapter structure, section composition, and
table/chart usage match the sample exactly — not approximately. Always
re-extract from the actual attached sample; template editions drift.

**PM Gateway applies**: PM displays an execution plan table before dispatching
any specialist at each phase transition.

**Adaptation note**: co-newbiz's ingestion tooling for a pre-existing `.hwp`
sample is not yet ported (see `hwp-document-processing`'s Adaptation Note) —
`.pdf`/`.docx`/`.hwpx` samples can be ingested today; a `.hwp`-only sample
is a scope gap to raise before starting Phase 1.

## When to Use

- A project lead or regulator supplies a reference deliverable (or an
  institutional form template) and the new report must match its structure
- A public-sector submission specifies chapter count, mandatory tables, and
  a page budget
- A completed past deliverable should serve as the structural model for a
  new project
- Do NOT use for free-form reports with no required structure

## Phase 1 — Sample Analysis

Ingest the actual sample and produce a Writing Spec artifact
(`memory/<project>-writing-spec-<date>.md`) — the single source of truth for
the rest of the workflow.

### 1.1 Ingest the sample

| Sample format | Tool |
|---|---|
| `.pdf` | Text extraction / WebFetch / manual read (OCR first if image-only) |
| `.docx` | Direct read |
| `.hwpx` (open XML) | `python-hwpx` read mode (co-newbiz has generate-only wiring today — see `hwp-document-processing`) |
| `.hwp` (legacy binary) | Not yet supported in co-newbiz — see Adaptation Note above |

### 1.2 Extract structure and per-section visual-element requirements

For each chapter/section, record: number and title; TOC position and approximate
page span; table mandatory-flag (`requires-table` if the section contains one or
more tables in the sample, with typical column structure); chart mandatory-flag
(`requires-chart`, with chart type); narrative-only sections; every
guideline/placeholder slot that must be replaced with real content; and a
per-chapter page-budget target derived from the sample's length.

**Critical**: a section marked `requires-table` is incomplete without a table,
and `requires-chart` is incomplete without a chart — these flags are not decorative.

### 1.3 Confirm the spec

Confirm the Writing Spec with the project lead before research begins.

## Phase 2 — Research

Dispatch analytical inputs against the Writing Spec's section list:

- **Company financials / industry data** → `k-dart`, `financial-statement-analysis`, `company-intelligence`, `competitive-intelligence`
- **Legal / regulatory environment** → `k-law`
- **DART fallback** (non-disclosing / unlisted targets): company-provided source
  documents, explicitly labeled as company-provided and not independently
  verifiable the way a DART filing is
- Map each research output to the specific chapter(s) it feeds

## Phase 3 — Draft

- Chapters assigned by content type (financial → `financial-analyst`; narrative →
  `docs-writer`; domain → the relevant domain agent) and drafted in parallel
  where research is already in hand
- Every guideline/placeholder slot is replaced with real content
- Table-to-narrative ratio: every data table is followed by at least half a page
  of interpretation
- Every `requires-table`/`requires-chart` section contains that element
- `docs-writer` assembles the full draft, confirms chapter order matches the
  Writing Spec's TOC exactly

## Phase 4 — Validate & Render

1. **Structural validation** (via `hwp-document-processing`): chapter order
   matches the sample TOC; no placeholder leftovers; page count within ±15%
2. **Visual-element audit**: re-scan for each section's mandatory-flag
3. **Render** via `bun scripts/co-newbiz/newbiz.ts report <draft.md> --format <fmt>`
4. Max 2 revision cycles before PM escalation

## Writing Principles

1. No placeholder leftovers — every guideline/example block becomes real narrative
2. Expand through argument density, never by padding with raw source documents
3. Table-to-narrative ratio holds throughout
4. DART fallback materials are explicitly labeled
5. Drafts may contain financials and PII — review for sensitive data before any
   `git add`/commit; PII in `management_package`/`comp_benchmark`-adjacent
   sections stays role-based, never named (design §4-9-1(b))
6. File naming: `{project}-{report-type}-{YYYY-MM-DD}.md` (draft) → final
   format per sample, in `deliverables/reports/`

## Output Format

- Writing Spec (`memory/<project>-writing-spec-<date>.md`)
- Full deliverable draft matching the Writing Spec's TOC exactly
- Chapter-by-chapter page count vs. target
- Final deliverable in the sample's specified format, validated
- `memory/YYYY-MM-DD.md` session summary entry

## Related Skills

- `hwp-document-processing` — sample ingestion (where format-supported) and rendering
- `financial-statement-analysis`, `company-intelligence`, `competitive-intelligence` — research inputs
- `k-law` — legal/regulatory research input
- `insight-synthesis` — cross-source synthesis for narrative chapters
