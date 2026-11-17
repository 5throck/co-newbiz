# Owner Decisions N1-N4: AI Verdict Gate Block, Selected Enforcement, Terminology, Procedure Wording

- Spec ID: `2026-11-18-governance-decisions-n1-n4`
- Date: 2026-11-18
- Status: approved (2026-11-18; owner decided each item in chat)
- Author: PM (decisions recorded from the owner; implementation dispatched to backend, docs and glossary roles)
- ADR: [ADR-0202](../adr/0202-unreviewed-ai-verdicts-block-gate.md) (draft, gate semantics for N1)
- Related: ADR-0200 (verdict origin), ADR-0201 (deal-shape viability first), boundaries 1 and 2.

## 1. Context

The S5/S6/S7 review (2026-11-17) left four decisions that only the owner could make. The owner answered on 2026-11-18.

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| N1 | How does the screening gate treat AI-draft verdicts nobody reviewed? | Option 1: they count as incomplete review items and block the gate. |
| N2 | Does the server enforce that the opportunity is `selected`? | Yes, enforce on the server. |
| N3 | Which short-list wording stays? | The new wording: `최종 후보 목록` and `심사 종료`. |
| N4 | Procedure wording for `brownfield-target-screening` steps 1/3/3.5 | Align it to the shipped behavior. |

## 3. N1: unreviewed AI verdicts block the gate

- At brownfield opportunity gates `pre_fs` and `target_screening`, `gateGoPrerequisiteGaps` adds the gap
  `ai_draft_review:<n>` while live `ai_draft` verdicts exist (status other than `pending`, target not excluded).
- `auto_rule` verdicts are deterministic checks and never block. `human` verdicts never block.
- No auto-clear. Only a person saving the verdict on the candidate detail screen turns it into a `human` verdict.
  The rule-only bulk accept (`accept-rule`) covers `auto_rule` rows only and does not clear AI drafts.
- The refusal reuses the existing 409 `gate_prerequisites_incomplete`. The gap is a machine-readable token that the
  panel localizes (`components.gateIntegrity.gapAiDraftReview`).
- The gate snapshot carries an optional `ai_draft_review: {unreviewed}` key at those two gates only. The schema
  version stays 3 because the key is absent elsewhere.

## 4. N2: server-side `selected` enforcement

- `lib/selected-guard.ts` returns 409 `not_selected` through the existing envelope.
- Applied to `route-decision` POST, `route-recommendation` POST (both returned 400 before), and the S6 writes
  `eval-state` PUT, `accept-rule`, `shortlist`, `exclude`, `rerank`, `screening-draft`, `eval-draft-runs` POST.
- Left unguarded on purpose: `target-scope`, `sizing-link`, `entry-market-derivation` (they happen before selection).
  `deal-shapes` already requires S7 through its own guard.
- The MCP tool `record_candidate_screening` goes through the eval-state PUT and inherits the guard.

## 5. N3 and N4: terminology and procedure wording

- `Short List`, `숏리스트` become `최종 후보 목록`; `승격` in the short-list sense becomes `심사 종료`. Identifiers
  (`shortlist` status codes, `shortlist_candidate`, committee ids, the artifact name `Target Company Short List`) stay.
- Surfaces: flow.spec 2.21.3, procedures, kill-criteria text, locales (ko and en), wiki, glossary (five terms with aliases).
- `brownfield-target-screening` stays at 1.2.0 (unreleased) with steps 1/3/3.5 reworded; `brownfield-fs-comparative`
  moves to 1.1.0.

## 6. Verification

- Unit tests for the gate gap, the selected guard (six routes), terminology pins, and the glossary drift ceiling (217).
- `lint:i18n`, `design:lint`, `lint:route-audit`, typecheck baseline and Biome on changed files.

## 7. Deployment notes

- Run `governance:sync` on each environment: three procedure versions are superseded.
- Clients of `route-decision` and `route-recommendation` see 409 `not_selected` instead of 400.
