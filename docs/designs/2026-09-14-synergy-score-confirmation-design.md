# Design: Synergy score human confirmation (`경계` #2 closure)

- Date: 2026-09-14
- Status: implemented
- Related: ADR-0090 (pipeline records `opportunity.synergy_score` recommendation), ADR-0104 (track advisory), ADR-0053 (human gate boundary), flow.spec S3/S4, migration 0099

## Problem

User report: S4 `평가 근거` voted brownfield ×2 on "`시너지 권고` 67", but no human ever
confirmed a synergy score — the value was written automatically by the synergy
pipeline on analysis completion (ADR-0090 sanctions the write, and the code
comment already called it "`사람 확정 전 권고값`"), and no confirmation path existed
anywhere (the opportunity create/edit form has only attractiveness; the PUT
API's `synergy_score` field had no UI caller). The unconfirmed recommendation
then propagated indistinguishably from a confirmed fact:

1. S4 track advisory voted on it (≥60 → brownfield ×2) with a note asserting it
   as evidence — the S4 redesign's own principle (an AI proposal is never styled
   identically to a recorded fact) did not reach this signal.
2. S2 opportunity list and the opportunity detail header displayed the bare
   number with no provenance marker.
3. Gate briefs (`s3Summary`) quoted "`시너지 점수: 67`" without the recommendation
   qualifier.

## Approach

Confirmation is a first-class human action; until it happens, the synergy score
cannot vote on the S4 track.

- **Migration 0099**: `opportunity.synergy_score_confirmed_at` /
  `synergy_score_confirmed_by` (nullable). NULL = unconfirmed recommendation.
- **`POST /api/opportunities/{id}/synergy-confirm`** (analyst+; audited
  `synergy_score.confirm`): the only human path. Body may override score
  (0–100) and rationale; without a recorded recommendation an explicit score is
  required. `DELETE` retracts the confirmation (score reverts to `권고`;
  `synergy_score.retract`). `GET` returns the current state plus the shared
  unconfirmed note. Follows the capability-gap route pattern
  (authenticate → role gate → audited write → ok envelope).
- **Pipeline re-record invalidation** (`recordSynergyRecommendation`, extracted
  for testability): when a re-run writes a *different* score, confirmation
  lapses; the same value keeps the human's confirmation.
- **S4 track advisory (`synergy` signal)**: only a confirmed score votes
  (strong ≥60 → brownfield ×2; weak → neutral ×2). An unconfirmed
  recommendation becomes a neutral info signal ×1 with the shared note — an LLM
  draft never carries gate evidence on its own (`경계` #2).
- **S3 surface**: the header chip distinguishes `synergy 확정 N` (green) from
  `synergy 권고(미확정) N` (amber); the `연결 기회` card gains the confirm form
  (score + rationale, prefilled from the recommendation) and `확정 철회` —
  analyst+ only, mirroring the API role gate.
  - 2026-09-14 follow-up (user report: the collapsed "`점수 확정하기`" toggle
    went unnoticed): the editor is now ALWAYS visible — a bordered panel with a
    clear heading (`시너지 점수 확정 — 점수를 직접 수정하고 기록합니다`), a
    score input and rationale input prefilled from the recorded value, and a
    primary `확정 저장` button. Editing and saving the score directly (including
    re-confirming a confirmed value) needs no toggle; `확정 철회` stays beside
    the save button once confirmed. The current-record chip
    (`확정`/`권고·미확정`) sits above the panel.
- **S2 list / opportunity detail**: the score column and header carry
  `확정` vs `권고(미확정)` markers so the provenance is visible at every read.
- **Gate briefs**: `s3Summary` appends (`사람 확정`) / (`권고·사람 미확정`).
- **Rules explainer** on the S4 surface documents the confirmed-vs-unconfirmed
  split instead of the old unconditional rows.
- `process-flow.ts` S3 completion is deliberately unchanged: flow.spec's
  completion criterion ("`기회에 synergy_score와 근거가 기록되었다`") is satisfied
  by the recorded recommendation per the S3 activity note; confirmation gates
  the *S4 evidence weight*, not stage completion (the soft-enforcement
  precedent of the v2.4.0 competitive artifact).

## Verification

- `bunx tsc --noEmit` (app/web-next) clean.
- `tests/unit/adr-0104.test.ts`: unconfirmed → neutral ×1 with the shared note;
  confirmed strong → brownfield ×2; confirmed weak → neutral ×2;
  `recordSynergyRecommendation` keeps confirmation on the same value and clears
  it on change.
- `bun run test:unit` full suite green (incl. openapi drift —
  `synergy-confirm` GET/POST/DELETE documented).
