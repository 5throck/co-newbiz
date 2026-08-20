---
name: interpretation-registry
scope: co-newbiz
description: >
  Records and looks up governance interpretation Q&A ("does this clause
  apply to our case?") so an answer is never re-derived from scratch, and
  never silently contradicted by a later answer. Supersession is explicit
  and scoped: a later answer may only replace an earlier answer to the
  *same* document+clause question (FR-GOV-12). Backed by
  `db/lib/compliance.ts` and `GET/POST /api/interpretations`.

  Use when: "interpretation registry", "does this clause apply",
  "record an interpretation", "supersede an interpretation".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: compliance-officer
prerequisites: none
metadata:
  type: process
  triggers:
    - interpretation registry
    - does this clause apply
    - record an interpretation
    - supersede an interpretation
---

## Context

Requester: any agent or human reviewer. Responder: the `owner_agent` of the
governance document in question (e.g. `legal-counsel` for a policy legal
question, `process-governance-manager` for a procedure question — never
generically "compliance-officer" regardless of topic). Published
interpretations are discoverable via the glossary's `lookup_term` MCP
integration where the question concerns a defined term.

## When to Use

- A question arises about whether/how a clause applies to a specific case
- Before answering, always search first — the answer may already exist
- An earlier answer needs refinement (supersession), not silent replacement

## Execution Steps

1. **Search before answering**: `searchInterpretations({ governanceDocId,
   clauseRef, text })` — published answers first, newest first within each
   group. Following the `supersedes` chain gives the effective current answer;
   a superseded row is history, not guidance
2. **If no existing answer covers it**: route the question to the
   document's `owner_agent`, not a generic reviewer
3. **Record the answer**: `recordInterpretation()` with `governanceDocId`,
   `clauseRef`, `question`, `answer`, `askedBy`, `answeredBy`, `answeredAt`,
   and `published` (default true unless the answer needs a review pass first)
4. **Superseding an earlier answer**: pass `supersedes: <id>` — the engine
   refuses the write if the target doesn't exist, or if it belongs to a
   *different* document+clause than the new answer targets (FR-GOV-12) —
   this is enforced, not a documentation convention
5. **Never edit a published answer in place** — a refinement is always a
   new row with `supersedes` set, preserving the full history of what was
   asked and answered when

## Output Format

- Interpretation record (question, answer, answered_by, answered_at,
  supersedes chain, published flag)

## Related Skills

- `compliance-monitoring` — interpretation-query volume/topic feeds the
  governance KPI review and amendment priority
- `glossary-management` — the term-lookup surface interpretations connect to
