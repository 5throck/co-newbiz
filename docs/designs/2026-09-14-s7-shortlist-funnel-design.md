# Design: S7 shortlisting workflow made visible (S6 → S7 funnel)

- Date: 2026-09-14
- Status: implemented
- Related: flow.spec S6/S7, ADR-0094 (target lifecycle), ADR-0097 (S6/S7 committee proposes, human gate decides)

## Problem

User report: the S6 Long List exists, but the process of narrowing it down to the S7 Short List is not clearly organized in the web service. Diagnosis of `/brownfield`:

- The Long List was one flat table mixing pending, shortlisted, and excluded rows — no funnel view of the narrowing process.
- Screening progress was a bare `판정 3/9` number; which specific items were pending/failed was only visible after expanding a row.
- Promotion required expanding the row; disabled-state reasons were hover-only.
- flow.spec S7 requires the **Target Ranking/Score** artifact and the completion criterion "every Long List candidate has a ranking score or an exclusion reason" — but rank was just promotion order, no score existed, and nothing in the UI tracked that completion criterion.

## Approach

All changes center the *narrowing funnel* so the S7 workflow reads as: `판정` (t-01~t-09) → `승격`/`제외` → `순위 확정` → committee deliberation + the `target_screening` gate.

**Frontend (`app/brownfield/page.tsx`)**

- **Selection funnel strip**: `Long List N → 판정 완료 K → 승격 가능 J → Short List S · 제외 X`, computed from existing `screening_summary` values, plus a remaining-work line listing candidates that still need judgment or exclusion (operationalizes the S7 completion criterion).
- **Verdict strip column**: per candidate, t-01~t-09 rendered as nine compact chips (`충/미/예/N/·`) with per-item tooltips — the candidate's standing is readable at a glance without expanding.
- **Deterministic selection score** (`targetScore`): gates t-01~t-02 (waiver-ineligible) act as promotion conditions and are excluded from scoring; the seven waiver-eligible items score `충족`/`해당없음` = 1, `예외` = 0.5, `미충족` = 0, shown as a percentage once fully judged (progress `judged/total` before that). This evidences the "Target Ranking/Score" output without adding data entry.
- **Status filter chips** (`전체`/`심사 중`/`Short List`/`제외`, S1 market-page pattern) and pending renamed `대기` → `심사 중` to describe the workflow role.
- **Inline promotion**: rows whose knock-outs pass get an enabled `승격` button directly in the row.
- **Short List rank adjustment**: ↑/↓ buttons swap the row with its ranked neighbor (`orderIdx` over shortlisted rows regardless of active filter).

**API (`targets/[targetId]/rerank/route.ts`, new)**

- `POST { direction: 'up'|'down' }` — swaps the shortlisted target with its neighbor in rank order and re-normalizes ranks to 1..N; edge moves return `moved: false` (not an error). Audited as `brownfield_target.rerank`. Rank stays the human-confirmed ordering; the committee/gate flow (already on the page) remains the decision path.

## Verification

- `bunx tsc --noEmit` clean.
- Manual: filter chips narrow the table; a candidate with all nine verdicts shows `충/예/N` chips and a score percentage; promotion button enables exactly when `knockOutsPassed`; ↑/↓ reorder the Short List and persist after refetch; funnel counts update after each action.
