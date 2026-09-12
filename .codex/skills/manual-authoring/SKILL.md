---
name: manual-authoring
scope: co-newbiz
description: >
  Authors and maintains co-newbiz business manuals, SOPs, and governance
  reference documents (docs/manuals/, docs/governance/governance-operations.md,
  docs/runbooks/, the design guide and DD methodology pages under docs/) to
  the workspace documentation standard: declared audience split, governance
  metadata, source-of-truth primacy, and the external-reference badge rules.
  Distinct from `checklist-authoring` (binary gate items live in YAML, not
  prose).

  Use when: "write a manual", "manual authoring", "SOP authoring", "update operations manual", "documentation standard".
version: 2.1.0
last_reviewed: 2026-09-06
status: active
owner: docs-writer
prerequisites: governance-document-hierarchy
relates_to:
  - skill: checklist-authoring
    type: composes_with
  - skill: documentation-writing
    type: composes_with
  - skill: governance-document-hierarchy
    type: follows
metadata:
  type: process
  triggers:
    - manual authoring
    - write a manual
    - SOP authoring
    - documentation standard
---

## Context

co-newbiz documentation lives in two layers with different authorities: the
**repository originals** (procedures/*.yaml, checklists/*.yaml, policies/,
docs/*.md — authoritative, including the design guide and DD methodology
pages that used to live under a separate `knowledge-hub/` folder before
being consolidated into `docs/`) and **`/library`** (`app/web-next/app/library/`,
backed by `lib/library.ts` — a single live read of the originals, rendered
in the app's own chrome). There is no separate generated site any more:
ADR-0108 retired the knowledge-hub static portal
(`knowledge-hub/scripts/generate-portal.ts`) because it duplicated the same
content a second time and drifted from `/library`'s live view. This skill
governs how manuals/SOPs/reference pages are WRITTEN so they read well both
as raw markdown and once rendered through `/library`'s Markdown viewer
(`marked` — full CommonMark, including tables).

## When to Use

- Writing a new manual, SOP, runbook, or governance reference page
- Adding a design-guide or DD-methodology page under docs/
- Reviewing documentation for the workspace standard (3-stage review)

## Execution Steps

### 1. Classify before writing (`governance-document-hierarchy` first)

- Binary gate fact, one line, enforceable → checklist item (`checklist-authoring`),
  NOT a manual paragraph.
- Multi-step process with an owner and an output → procedure yaml, with the
  manual page only narrating context.
- Role-scoped "how to work" narrative → manual (this skill).
- Design decisions → ADR; ephemeral how-to for one incident → runbook.

### 2. Declare the audience split (design §10.5)

Every manual opens with a front matter block: audience (who), explicit
non-audience (who it is NOT for), and a pointer to the sibling manuals. Never merge the
three-manual split (business / admin / operations) — each has a distinct
audience and merging them is a documented anti-pattern.

### 3. Carry governance metadata — never hand-typed

- Every source document front matter: `governance_doc_id` (`man-`/`ref-`/
  `gdl-` prefix per layer), `version`, `title`, `owner_agent`.
- External enrichment (WebSearch-sourced practice notes) is allowed ONLY as
  a separated block marked with the external-reference badge (`ext-badge`) with institution · title · publish
  date · access date · URL, 2–3 independent sources for load-bearing claims
  (triangulation, cdd-07 principle), and the explicit rule that in a conflict
  the repository original prevails.

### 4. Style rules (docs-writer standard)

- Korean body uses the formal polite register (haengam-che); checklist items
  quoted from YAML keep their noun-form ending — do not "fix" them inside quotation.
- English technical terms glossed in parentheses on FIRST use per document.
- Amounts: integer millions of KRW with comma separators (ADR-0061 unit).
- No narrative-only gate claims: any "this stage passes" statement must cite
  the procedure yaml, checklist id, or ADR that enforces it.
- Write for a general reader, not just for someone who already knows the
  system: define jargon on first use, prefer full sentences to bare code/ADR
  citations in the body, and keep internal identifiers (`dd_finding`,
  ADR numbers) in the source-mapping table rather than the prose itself.

### 5. Wire new documents into `/library`, don't hand-render them

- `docs/manuals/*.md` and `policies/**/*.md` are picked up automatically
  (`lib/library.ts` scans those directories) — no registration needed.
- The design guide, DD methodology, other `docs/*.md` reference pages, and
  `templates/deliverables/*.md` are curated lists in `lib/library.ts`
  (`DESIGN_DOCS`, `DD_DOCS`, `REFERENCE_DOCS`, `TEMPLATE_DOCS`) — add a new
  document's `{ slug, title, file }` entry there.
- Nothing is generated or committed as a build artifact. There is no
  regeneration or hash-staleness check to run — `/library` reads the file
  the moment it's saved.

### 6. Update triggers

Originals change → `/library` reflects it immediately, no follow-up step.
Policy/procedure merges do not require any documentation-surface
regeneration (this replaces the old "system-reflection §5" portal-rebuild
step — see `docs/governance/governance-operations.md`).

## Output Format

- Korean markdown in docs/manuals/, docs/, guidelines/ with front matter
- Related skills: `checklist-authoring` (YAML layer),
  `documentation-writing` (general writing craft)
