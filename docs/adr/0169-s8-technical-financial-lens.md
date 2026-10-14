---
lang: ko
lang_reason: proper-noun
---

# ADR-0169 - S8 two-lens view (기술적 타당성 / 재무적 타당성) and Brown Field S9 pairing

- Status: Proposed (decided in chat 2026-10-14, formal acceptance pending)
- Date: 2026-10-14
- Decider: Human decider (chat instructions 2026-10-14: the lens design and, in a follow-up, the three-part layout refinement). Drafted by backend-engineer.
- Design-of-record: [docs/designs/2026-10-14-s8-technical-financial-lens-design.md](../designs/2026-10-14-s8-technical-financial-lens-design.md)
- Related: ADR-0168 (S8 capability attainability — T1 is derived from its register rows and its panel moves under the new 기술적 타당성 tab), ADR-0069 (route handlers), ADR-0159 (project business goals — the goals status source)
- Slices: 1-3 of 8 implemented here. Slices 4-8 (T2-T5 judgement UI and human-only confirm routes, Brown Field per-target subjects and comparison columns, S9 pairing with the dd-gate blocker, wiki/E2E) are separate and not decided as code here.

## Context

S8 (사업성 검토) presents only financial figures. Two questions are mixed into one surface: 실현할 수 있는가 (can we do it) and 돈이 되는가 (does it pay). ADR-0168 added a capability-attainability register, but its result is a panel inside the financial screens rather than a first-class answer, and no shared status tells a reviewer at a glance whether the technical or the financial side carries unresolved concerns.

## Decision

1. **Two lenses, three parts (D-layout).** The S8 screen is organised into three major parts with one-line purposes: `사업 목표` (무엇을 달성하려는가, `?tab=goals`), `기술적 타당성` (실현할 수 있는가, `?tab=technical`), `재무적 타당성` (돈이 되는가, `?tab=financial`); Brown Field adds `대상 비교·선정` (`?tab=targets`), and `결정` completes the primary row — 5 primary tabs for Brown Field, 4 for Green Field, within the 5-tab navigation limit. Under `재무적 타당성` a sub-tab row holds only financial content: 시나리오 (`?tab=scenarios`), WACC (`?tab=financial/wacc`), 재무 분석 (`?tab=financial/financial-analysis`). Content is never duplicated across parts.
2. **Status vocabulary.** Both lenses use the three-state chips `충족 / 주의 / 미판정`, always icon + text (never colour alone). Warning only: neither lens caps the RAG grade or blocks a gate; every summary surface states 참고 정보이며 승인 조건이 아닙니다. Grade coupling would need its own ADR.
3. **Technical lens items (D-tech).** Six items per subject: T1 (required capability, derived read-only from the ADR-0168 register: `충족` when every row is human-confirmed and none `낮음`, `주의` when any row is `낮음`, else `미판정`), T2-T5 stored items, and T6 (다음 릴리스 placeholder; Brown Field label `S9 기술 실사 짝 검증`). Subjects are `project` (Green Field and the Brown Field selected target's project-level facts) or `target:<id>` (per-target, used by the later Brown Field slice). Confirmation stays human-only per ADR-0168 D1: an item is judged only with a status AND `confirmedBy` AND `confirmedAt`; AI may draft (`draftedBy`) but never confirm.
4. **Financial lens rule (D-fin).** `미판정` without an adopted business case or a base-case p50 simulation; `주의` when base IRR < hurdle IRR (a null/absent hurdle skips the check), any business goal is missed, or the downside NPV p50 < 0; else `충족`. No new numbers are computed — only existing adoption records, p50 simulations, `resolveProjectHurdleIrr` and goal evaluations are read.
5. **Storage.** The technical lens lives as a `technicalLens` key inside the existing `opportunity.capability_gap_json` (per-signal migration 0098 object; no schema migration). `serializeGapRegister` in `lib/technical-lens.ts` is the single write path: every writer of the register (S3 PUT route, attainability `writeRegister`, synergy pipeline merge, backfill script) passes the stored JSON through so the key can be neither dropped nor forged by a client. Unknown subjects/keys are dropped on parse; malformed items (confirmation without both fields + status) read as unjudged.
6. **Summary strip and API.** A read-only strip (both lens cards + a goals line `목표 N개 중 달성 M개` + a technical warning when any item is `주의`) renders on top of every S8 page, from `GET /api/projects/:id/s8-lens-summary` (deny-by-default 404; the financial lookups are individually try/caught so a lookup failure degrades to `미판정` and never takes the page down). The FS gate brief carries one informational line ("S8 기술적 타당성 요약(참고)") sourced from the same summary — it is evidence context, not a gate condition.
7. **Brown Field S9 pairing (designed, later slice).** For the selected target, S9 technical DD records verification rows (`s8Ref`, `result` verified | different | unverifiable) against the S8 technical items; the S9 DD completion check gains exactly one new blocker — the selected target's T2 and T5 must have S9 verification recorded before the dd gate. This is implemented in a later slice and noted here so the storage shape (`verification` rows) is fixed now.
8. **Deep-link compatibility.** Old entry points keep working: `?tab=capability` → 기술적 타당성, `?tab=financial` → 시나리오 (재무적 타당성), `?tab=overview` and other legacy values land on the most sensible part, `#anchor` fragments are stripped, unknown values fall back to 시나리오, and Green Field `targets` falls back to 시나리오.
9. **Existing projects.** No backfill; projects without a lens read as `미판정` everywhere. The S8 completion check and `process/flow.spec.yaml` are unchanged.

## Consequences

- `capability_gap_json` gains one optional stored key; readers that ignore it keep working, and the single-writer helper is enforced by a filesystem-walk regression test.
- The capability panel relocates from the financial screens to the 기술적 타당성 part (amending the ADR-0168 as-built placement), with a compact link from the 시나리오 sub-tab.
- The MCP surface gains nothing in this slice; the REST summary route is the contract.

## Honest limits

Decision by chat instruction; formal acceptance is pending (this record is Proposed). The lens statuses aggregate human judgements and existing model outputs; they are decision support, not investment advice. T2-T5 have no input UI yet — the items show `미판정` with a 다음 릴리스 notice.

## Acceptance record

- Approver: the human decider (user, account techcross), chat instructions on 2026-10-14 approving the two-lens design and the three-part layout refinement. A formal acceptance record (following the DEC-20261014-03/05 pattern) is pending until the human reviews the implementation report.
- Scope: chat approval covers the decision; slices 4-8 do not exist.
- Known deviations and limitations (owner: platform-lead):
  1. T6 has no stored item; it renders from the placeholder only. Exit: the S9-pairing slice.
  2. The summary strip is not browser-verified; unit tests cover the view-model and route authorisation only.
  3. The S9 dd-gate blocker (selected target T2/T5 verification) is designed but not implemented; flow.spec stays unchanged until that slice.
