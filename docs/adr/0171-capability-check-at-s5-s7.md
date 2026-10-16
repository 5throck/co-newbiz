---
lang: ko
lang_reason: proper-noun
---

# ADR-0171 - Required-capability check at S5 (Green Field) and S7 per target (Brown Field)

- Status: Accepted (2026-10-14)
- Date: 2026-10-14
- Decider: Human decider (chat approval 2026-10-14, "ADR-0171 / 0172 승인"). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-14-capability-check-at-s5-s7-design.md](../designs/2026-10-14-capability-check-at-s5-s7-design.md)
- Related: ADR-0168 (partly superseded), ADR-0169 (T1 source amended), ADR-0170 (Decisions 4-6 partly superseded), ADR-0136 (amended), ADR-0143 (amended)
- Slices: 3 (1 Green Field S5 edit surface + S8 read-only summary, 2 Brown Field S7 per-target judgements + criteria reconcile + detection, 3 S8 scenario/lens/gate-brief + wiki/glossary). None implemented by this ADR; implementation begins after acceptance.
- Implementation status (2026-10-16): slices 1-3 are implemented per Amendments (1)-(5), not browser-verified. The one-off legacy copy script (`scripts/co-newbiz/copy-legacy-bf-capability-judgements.ts`) has not been run against a real database.

## Context

The attainability judgement for required capabilities is edited on S8 (ADR-0168), while the question it answers belongs to S5 for Green Field (`스스로 진입할 수 있는가?`) and to S7 per target for Brown Field (`어떤 대상이 유망한가?`, gate `target_screening`). Brown Field S3 rows are seeded once as technical criteria, so later S3 rows never reach S7.

## Decision

1. **Check location.** GF: S5 owns the judgement edit surface; storage stays on the S3 register row. BF: S7 owns it per target, only for shortlisted and selected targets.
2. **S3 single source** as in ADR-0170 and its correction (levels are S5-owned, not S3 inputs).
3. **S8 read-only.** The technical-feasibility tab shows a summary (S3 definition plus S5 or selected-target S7 judgement) with edit links. S8 PUT/confirm routes return 410 `editAt` for one release, then are removed.
4. **BF storage.** New table `brownfield_target_capability_judgement` keyed by `(brownfield_target_id, capability_row_id)`, reusing the ADR-0170 judgement JSON shape. DB schema change: this ADR is the required record; a numbered migration with rollback note follows in slice 2.
5. **Staleness.** GF as ADR-0170. BF: S3 row hash plus the target's evaluation state hash for the seeded criterion; only that target is invalidated. Invalidation keeps history and clears confirmation.
6. **Seed-once fix.** Criterion seeding becomes an idempotent reconcile: missing rows are seeded, removed rows are retired (marker, not deletion) with history.
7. **Gates.** S5 completeness and S7 `target_screening` readiness show a warning-only capability check; S8 lens T1, banner and gate briefs read S5/S7. No grade cap, no gate block.
8. **Permissions and audit.** Confirmation stays human-only; audit rows carry the calling user, `surface` and `target_id`.

## Consequences

- One migration (BF table, criterion retire columns); GF needs no data move.
- A one-off audited script copies legacy BF register judgements, unconfirmed, to the selected target.
- The capability-adjusted scenario reads confirmed, non-stale S5/S7 judgements only.
- ADR-0168/0169/0170 bodies are not edited; the README index notes the partial supersession at acceptance.

## Honest limits

Accepted by chat; open decisions OD-1..OD-6 are resolved as recommended in the design. The S5 completeness and S7 readiness code paths were not traced in detail. Judgements remain decision support, not investment advice.

## Amendment 2026-10-15: AI judgement proposal at S5

Decider request (chat 2026-10-15): the S5 judgement UI gets an AI proposal for the judgement inputs. New proposal-only route `POST /api/opportunities/{id}/capability-attainability/ai-draft` proposes 해소 방식, 기대 수준 (<=400), cost (KRW million), months, attainability grade and a rationale (<=600) with a basis per field, from stored data only (S3 definition, opportunity context, S5 entry strategy text, company profile and disclosure lines with verification labels) plus the LLM; no web search. It writes nothing to the database and confirms nothing: drafts land in the page state, the person edits and saves, and confirmation stays the human-only route (boundary #1/#2; agents inherit the caller's permission, analyst+ as for PUT). Numbers are estimates only when defensible and carry the assumption (`basis.estimate`); otherwise null with a reason. A `high`/`low` grade needs a rationale. Fill-empty-only on the server and again in the page merge. MCP gets the draft-only tool `draft_capability_judgement`; there is still no confirm tool. No schema change, so no new ADR trigger; S8 stays read-only.

## Amendment 2026-10-15 (2): S5 entry strategy options and AI proposal

Decider request (chat 2026-10-15), recommendations accepted: the S5 section `1️⃣ 진출전략` had two free-text fields and no selectable options although it named four modes. It now has (a) four selectable modes - 직접 구축 (build), 전략 제휴 (partner), 인력 영입 (hire), 지분 투자 (invest) - multi-select with exactly one 주된 방식 (a single selection is automatically main), (b) one 선택 근거 textarea (3 rows, cap 600; the legacy `entry_strategy` text is its initial value), (c) one optional 검토했으나 선택하지 않은 대안과 사유 textarea (cap 600, still stored in `alternatives_considered`), and (d) a muted decision-support caution `진출전략에 없는 방식: <역량>` when a capability's 해소 방식 (S5 judgement) is not among the selected modes - the two are different layers, so this never blocks.

Storage without a migration: `greenfield_assessment` has no free JSON column (`business_case_lines_json` belongs to ADR-0173), so the selected modes share the existing `entry_strategy` text as an optional first line `[진출방식] build*,partner` (a `*` marks the main mode) followed by the rationale. Legacy plain text has no header and reads as rationale-only with no modes. Pure parser/serializer in `lib/greenfield-entry-strategy.ts`; the POST route re-normalizes the header, and every consumer of `entry_strategy` that builds text (investment-item recommendation, S5 judgement AI proposal context, gate brief, project charter) reads it through `entryStrategyText`, e.g. `진출방식: 직접 구축(주), 전략 제휴 - 근거: ...`. A dedicated `selected_modes_json` column would be cleaner for querying and reporting; it is proposed, not added (ADR required for a schema change).

New proposal-only route `POST /api/greenfield/{oppId}/entry-strategy-draft` (analyst+, writes nothing, not human-only) and MCP draft tool `draft_entry_strategy`: from stored S3 register (필요도, 필요 수준, 보유 판정, 보유 수준; 필수 gaps first), the S4 final decision record, opportunity context and company profile/disclosure evidence (unverified claims are context only) the LLM proposes `{modes[{mode, main, reason}], rationale, alternatives, basis, cautions}`; no web search. The page fills only empty parts as unsaved drafts with AI chips and an `AI 근거` line, a dismissible note and `AI 초안 버리기`; drafts survive refetches; a person saves. Without an LLM: 200 with an empty proposal and a note. Prompt key `s5.entry_strategy_draft`. Gate approval and the investment decision remain human (boundary #2).

## Amendment 2026-10-15 (3): S8 keeps the read-only capability summary

Decider decision (chat 2026-10-15): once the S7 per-target judgements are implemented, S8 keeps its current structure — the technical-feasibility tab retains the read-only capability summary (Decision 3) alongside the technical lens T2-T5 inputs and the capability-adjusted scenario pointer; S8 does not become finance-only and T2-T5 do not move to S9 (S9 stays the paired Brown Field verification). If the summary table feels sparse, it may later be compressed into a single summary-strip line (future refinement).

## Amendment 2026-10-15 (4): slice 2 as built (Brown Field S7)

Slice 2 is implemented: migration 0145 (`brownfield_target_capability_judgement`; `brownfield_eval_criterion.retired_at` / `retired_reason`, rollback note in the file; 0144 stays reserved for ADR-0176 and the runner's filename-order apply makes the gap and either landing order safe), `lib/brownfield-capability-judgement.ts`, the target routes `GET/PUT /api/brownfield/targets/{id}/capability-judgements` and the human-only `.../confirm`, `GET/POST /api/brownfield/{oppId}/eval-criteria/reconcile`, the warning-only `GET /api/brownfield/{oppId}/capability-readiness`, and the S7 UI (`TargetCapabilityCheck`, `CapabilityReadinessNotice`). Staleness is the S3 row hash (stamped in `attainability.basisHash`) plus an `eval_basis_hash` column over the target's verdict, note and evidence ref for the seeded criterion; either moving invalidates only that target (history entry reason `s3_changed` or `eval_changed`, confirmation cleared, prior values pre-filled). Invalidation is derived on read and materialised (history plus audit under the calling user) on every S7 write, on the criterion verdict route and on reconcile. S8 project routes are read-only for Brown Field (410 `editAt: S7`; GET shows the selected target's judgements). Not yet done: the one-off audited copy of legacy Brown Field register judgements to the selected target (Consequences), and slice 3.

## Amendment 2026-10-15 (5): slice 3 as built (S8 readers, legacy copy script, glossary)

Slice 3 is implemented, not browser-verified. S8 stays read-only with its structure kept (Amendment 3). Lens T1 for Brown Field now derives from the selected target's S7 judgements (`targetJudgementRows`; stale or unconfirmed counts as unjudged; no selected target = all unjudged; Green Field T1 unchanged), and the `target_screening` / `pre_fs` gate briefs carry a per-target `필요 역량 점검(S7)` line, labeled not an approval condition. No grade cap, no gate block. The S8 PUT/confirm routes keep answering 410 `editAt` for both tracks (removal is a later release). The one-off audited copy of legacy Brown Field register judgements is `scripts/co-newbiz/copy-legacy-bf-capability-judgements.ts` (dry-run by default, `--apply`, unconfirmed copies to the selected target, existing judgements and rows without a seeded criterion skipped, audit row per copy, idempotent); it has not been run against any real database. Glossary terms `재판정 필요` and `대상별 필요 역량 점검` were added; wiki pages were not changed. No migration. The capability-adjusted scenario code (ADR-0168 slice 4) was not found as a separate S8 artifact and is unchanged: the S5 investment simulation already reads the S5 register judgements.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-14: "ADR-0171 / 0172 승인". Recorded in DEC-20261014-08.
- Basis: chat approval of the ADR as written, including the design's recommended resolutions of OD-1..OD-6. Acceptance is by chat instruction; the decider did not review a per-item checklist, and this record does not claim the approver read specific items.
- Scope: acceptance covers the decision. Nothing of slices 1-3 is implemented; implementation begins after acceptance.
- Known limitations (owner: platform-lead): the S5 completeness and S7 readiness code paths were not traced in detail.
