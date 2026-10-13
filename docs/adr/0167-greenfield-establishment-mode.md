---
lang: ko
lang_reason: proper-noun
---

# ADR-0167 — Green Field establishment mode: new legal entity vs new business unit (amends ADR-0047 A.5 and ADR-0100)

- Status: Accepted (2026-10-14) with notes
- Date: 2026-10-14
- Decider: Human decider (chat instruction 2026-10-14). Drafted by backend-engineer.
- Design-of-record: [docs/designs/2026-10-14-greenfield-business-unit-vs-new-entity-design.md](../designs/2026-10-14-greenfield-business-unit-vs-new-entity-design.md)
- Amends: ADR-0047 section A.5 (S11 establishment applies when origin is internal or joint AND the mode is new_entity; the business-unit set applies when origin is internal AND the mode is business_unit), ADR-0100 (the S10 IC structure decision includes the establishment mode; S11 executes that mode's step set)
- Related: ADR-0161 (greenfield execution baseline gx-* applies to both modes), ADR-0165 (assignee, evidence and reopen rules apply unchanged to both step sets), ADR-0166 (Green Field default origin internal), ADR-0014 (additive migration), ADR-0163 (stop-on-error migration runner), DEC-20261014-02
- Slice: 1 of 2 (backend). Slice 2 (checklists, IC package wording, glossary, wiki, UI) is separate and not decided here.

## Context

The decider stated on 2026-10-14 that a Green Field project does not have to create a new legal entity: the company can run the new business as a new business unit (`신규 사업부`) inside the existing company. The product assumed a new entity in S10 (`설립 법인 형태`), in the five S11 steps (`ESTABLISHMENT_STEP_TITLES`) and in the S11 completion predicate (`origin in {internal, joint}` requires 5/5 entity steps). A business-unit project therefore could not finish S11 truthfully.

## Decision

1. **Values (D1).** Project-level `establishment_mode`: `new_entity` (`신규 법인 설립`) or `business_unit` (`신규 사업부 추진`).
2. **Origin rule (D2).** `business_unit` is allowed only with origin `internal` (and a Green Field track). `joint` stays `new_entity`. Origin `external` or Brown Field: not applicable, the mode stays NULL. A contractual unincorporated JV is out of scope.
3. **Who decides, when (D3).** A human decides the mode at S10 (`PUT /api/projects/:id/establishment-mode`, cookie session of a person; 403 `human_only` for bearer, OAuth-delegated MCP and agent callers; also in `HUMAN_ONLY_ROUTES`). S5 promotion may store only a non-binding `establishment_mode_suggested`. Agents may propose (`propose_establishment_mode`, an `approval` proposal with subject `establishment_mode`) but can never set or confirm; the confirming person's own session runs the PUT. `record_establishment` accepts an optional `mode` only as a consistency check (409 `mode_mismatch`), never to set it.
4. **No default (D4).** A new Green Field project has no mode until chosen at S10. Until then every establishment write fails with 409 `mode_not_chosen` and the S11 completion check reports "establishment mode not chosen" instead of silently assuming `new_entity`. Existing projects with origin internal/joint are backfilled to `new_entity` by migration 0142, so nothing changes for them. A non-Green-Field project with no stored mode keeps the `new_entity` behaviour.
5. **Change later (D5).** A stored mode may be changed (including after S11 started) only with a reason of at least 10 characters (400 `reason_required`). The change is audited (`establishment_mode.change`, target `<projectId>#mode@<via>`) and written to `establishment_mode_event`. Step rows recorded under the old mode stay untouched as read-only history; the new mode's steps start at `pending`. A change newer than the latest valid GO of the dd / entity_ic / group_ic gate sets `changed_after_gate` (a warning only; gate decisions are never revoked). business_unit to new_entity is allowed (later spin-off).
6. **Step sets (D6).** `new_entity` is unchanged. `business_unit` has five steps: (1) business unit establishment resolution, (2) business registration place/type add or change, (3) permit holder-name check, (4) staffing and organization change, (5) completion confirm (organization, budget and authority baseline). The sequence rule is identical: step 5 needs steps 1-4 done. Evidence, assignee, reopen and notification rules are ADR-0165 unchanged.
7. **S11 predicate.** For origin internal/joint: mode unchosen (Green Field) is blocked with its own reason; otherwise `done < 5` in the project's mode blocks with a mode-specific text. Origin external or other: unchanged.
8. **Procedures.** `procedures/_shared/entity-establishment-execution/schema.yaml` (1.2.0) additionally requires `project.establishment_mode` in `[new_entity]` or NULL (legacy keeps applying). New sibling `procedures/_shared/business-unit-establishment-execution/schema.yaml` (1.0.0) applies when origin is `internal` AND the mode is `business_unit` (an `is_null` guard makes an unchosen mode skip, never apply by default, because the S11 check reports it). `project.establishment_mode` is a new routing var (`evidence_var`, `column`, seeded by 0142).
9. **Slice 2 (D7-D9, not decided here as code).** `modes` tags on `ef-*` plus a `bu-*` checklist, the IC "no liability isolation" standing risk, glossary terms and wiki are slice 2.

## Data model (migration 0142, additive, reversible)

- `md_project.establishment_mode` (CHECK in the two values; `business_unit` needs `origin = 'internal'`), `md_project.establishment_mode_suggested`.
- `entity_establishment_step.mode` and `entity_establishment_step_event.mode`, `NOT NULL DEFAULT 'new_entity'`.
- `establishment_mode_event` (append-only: `set` | `change`, reason mandatory on a change).
- `evidence_var` seed `project.establishment_mode`; backfill `new_entity` for origin internal/joint.

## Policy and pin notes

- Policy impact analysis: the entity-establishment-execution `applies_when` changes; the change is backward compatible (new_entity or NULL still applies), so in-flight `project_policy_pin` projects, all `new_entity`, stay on the previous behaviour. The new procedure only applies to projects that explicitly chose `business_unit`.
- ADR triggers hit: DB schema change, procedure change, MCP tool scope change (one proposal-only tool added; no write scope widened), human-only route added.
- Open legal items needing counsel (not inferred by the system): articles-of-incorporation purpose amendment, VAT registration change for a new place of business, labour consultation duties on internal reassignment, certification scope extension with the certifying body.

## Consequences

- Business-unit Green Field projects can finish S11 truthfully; entity projects behave exactly as before.
- Existing test fixtures that promote a Green Field project and set origin internal must also set the mode.
- Rollback: the header SQL of 0142 (drops the added columns/table/seed); code rollback by reverting the PR together with the procedure YAML.

## Acceptance record

- Approver: the human decider (user, account techcross), chat instruction on 2026-10-14: "ADR-0167, ADR-0168 정식 승인". Recorded separately from ADR-0168 (DEC-20261014-05); this record is DEC-20261014-04.
- Basis: chat approval after the implementation reports for slice 1 (migration 0142, mode API, S10/S11 UI; PR #535). Acceptance is by chat instruction; no per-item checklist was recorded. This record does not claim the approver read specific commits or ticked individual items.
- Not verified by the AI: the S10 mode panel and the S11 table were verified by unit tests and the scenario run, not in a browser. The legal points in design section 13 are k-law verified for statutes only; permits, certifications, labor case law and each permit statute need counsel. Slice 2 (checklists ef-* tags and bu-* checklist, IC "no liability isolation" line, glossary) is in progress and is not part of what this acceptance verified.
- Known deviations and limitations (owner: platform-lead):
  1. D2 says Brown Field mode stays NULL, but the 0142 backfill is keyed on origin only, so Brown Field projects with origin internal/joint and recorded establishment steps become `new_entity` (harmless where steps exist). Exit: align the D2 text or note it in the data-alignment report.
  2. The backend still returns an English parenthetical in the 409 `mode_not_chosen` message and the S11 blocker. The UI maps by error code and strips it on stage screens; PromotionPanel shows the raw text. Exit: a Korean backend message.
  3. The business-unit form choice is stored as a prefix in the structure hypothesis free-text `liability_isolation_note` (no DB field). Exit: add a field if usage grows.
