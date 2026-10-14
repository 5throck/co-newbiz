---
lang: ko
lang_reason: proper-noun
---

# ADR-0168 - S8 required-capability attainability review (5-step level scale, register JSON extension, human-only confirmation)

- Status: Accepted (2026-10-14)
- Date: 2026-10-14
- Decider: Human decider (chat instruction 2026-10-14). Drafted by backend-engineer.
- Design-of-record: [docs/designs/2026-10-14-s8-capability-attainability-design.md](../designs/2026-10-14-s8-capability-attainability-design.md)
- Related: ADR-0136 (S5 fills required/current level on the S3 register), ADR-0098 migration `opportunity.capability_gap_json`, DEC-20261014-03
- Slice: 1 and 2 of 6 (scale, parser round-trip, S5 pickers, S8 panel, GET/PUT/confirm API). AI draft (3), the capability-adjusted scenario (4), Brown Field per-target judgements (5) and wiki/glossary/gate-brief line (6) are separate and not decided as code here.

## Context

S8 shows NPV/IRR that silently assume every capability required by S3 exists from day one. `requiredLevel` / `currentLevel` on the S3 register are free text, so a gap cannot be compared, and nothing records whether a missing capability can be secured, at what cost or how long it takes.

## Decision

1. **Who judges (D1).** A person judges attainability. An agent may only save a draft (`draftedBy: "ai"`); it can never confirm. Confirming (`confirmedBy` / `confirmedAt`) is human-only: cookie session of a non-agent account, 403 `human_only` for bearer, OAuth-delegated MCP and agent callers; the route is also in `HUMAN_ONLY_ROUTES`. Boundary #1 and #2 are unchanged.
2. **One shared 5-step scale (D2).** `requiredLevel` and `currentLevel` use `none / basic / working / skilled / leading` shown as the five Korean labels (ordered 1..5). The stored value stays the label string in the existing text fields. A value off the scale is legacy text: it is kept verbatim, read as unjudged (`null` step), shown as a caption and never deleted by the system. Gap = required - current (0..4), null when either side is off the scale.
3. **Storage (D5).** Reuse the S3 register JSON and add an optional `attainability` object per row: `{ closingCostKrwM, monthsToAttain, grade (high | medium | low | null = unjudged), rationale, evidence[], draftedBy, confirmedBy, confirmedAt }`. No migration, no new table. `normalizeGapRows` now round-trips the object. The S3 register save (`PUT /api/opportunities/:id/capability-gap`, also used by S5) carries the stored `attainability` over by row id and ignores client-sent values, so an S3 or S5 save can neither drop nor forge a judgement or confirmation.
4. **API.** `GET/PUT /api/projects/:id/capability-attainability` read and write the source opportunity's register rows (PUT is a per-row patch; analyst+ member; viewer 403, outsider and admin 404). `POST .../confirm` confirms judged rows (human-only). Rationale is mandatory for `high` and `low`; levels must be scale values (or an unchanged legacy text); cost and months must be >= 0. A change to a row's judgement content clears its confirmation. Every write appends an `audit_log` entry (`capability_attainability.save` / `.confirm`, target `<projectId>#capability@<via>`); no new table.
5. **Model effect (D3).** None in this slice. Closing cost and months are recorded but never added to the case automatically; the capability-adjusted scenario (optional, no automatic haircut) is slice 4. The S8 banner states that the figures assume the required capabilities can be secured.
6. **Grade (D4).** Warning only. RAG and the overall grade are unchanged; a cap needs its own ADR (phase 2).
7. **Existing projects.** Rows without a judgement read as unjudged and the banner shows; no backfill; stored numbers are untouched. `lib/project-charter.ts` still reads the legacy S5 column `capability_gaps_json` (out of scope).

## Consequences

- The register JSON contract grows by one optional object; readers that ignore it keep working.
- The MCP surface gets no confirm tool (by design); no read tool is added in this slice, the REST route is the contract.
- Brown Field per-target judgements will live as `bc.capability.*` assumptions (slice 5) and need no schema change either.

## Honest limits

Decision by chat instruction; formal acceptance is pending. Attainability grades are human judgements supported by rationale and evidence, not a model output, and are not investment advice.

## Acceptance record

- Approver: the human decider (user, account techcross), chat instruction on 2026-10-14: "ADR-0167, ADR-0168 정식 승인". Recorded separately from ADR-0167 (DEC-20261014-04); this record is DEC-20261014-05.
- Basis: chat approval after the implementation reports for slices 1 and 2. Acceptance is by chat instruction; no per-item checklist was recorded. This record does not claim the approver read specific commits or ticked individual items.
- Scope: acceptance covers the decision. Only slices 1 and 2 exist; the AI draft route/MCP tool (slice 3), the capability-adjusted scenario (4), the Brown Field per-target column (5) and the wiki/glossary/gate-brief line (6) are not implemented and remain open.
- Not verified by the AI: the S8 panel was not browser-verified.
- Known deviations and limitations (owner: platform-lead):
  1. Level fields remain the existing `requiredLevel`/`currentLevel` strings (Korean label) instead of separate step fields. Exit: revisit when slice 4 needs numeric steps.
  2. No MCP read tool was added. Exit: add one if an agent consumer appears.
  3. `lib/project-charter.ts` still reads the old S5 column `capability_gaps_json`. Exit: migrate the reader to the register JSON.
  4. The grade cap is deferred (warning only); a future cap needs ADR-0169 or later.
  5. A follow-up design (S8 technical and financial lenses, `docs/designs/2026-10-14-s8-technical-financial-lens-design.md`) will move the panel under a `기술적 타당성` tab; the panel location in this ADR will then change.
