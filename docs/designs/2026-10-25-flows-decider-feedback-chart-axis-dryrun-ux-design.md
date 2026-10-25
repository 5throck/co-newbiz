---
title: "Flows decider-feedback batch — ledger chart y-axis data-fitting and dry-run session page usability overhaul — design"
date: 2026-10-25
status: implemented
owner: frontend-engineer
reviewers: process-governance-manager (AI 2nd PASS-WITH-NOTES in-batch; human final at PR merge)
lang: en
---

# Flows decider-feedback batch — design

- **Spec ID**: `2026-10-25-flows-decider-feedback-chart-axis-dryrun-ux-design`
- **Status**: implemented — both rows landed in the working tree before this registration; gates green.
- **Related documents**: [`2026-10-24-flow-console-screen-design.md`](2026-10-24-flow-console-screen-design.md) (the screen design this batch amends — §14 deviation ledger governs reconciliation style), user decider feedback 2026-10-25 (two screenshots: ledger timeline annotation "bars at 100 while data is 10–25"; dry-run session page "visibility and usability are very low" with session URL).

## 1. Background

Two decider-verified defects on the 2026-10-24 flow console, both presentation-layer:

1. **Ledger timeline y-axis does not fit the data** — with bucket max 25 (a nice tick), echarts' auto nice-scale keeps the axis top *inside* the data extent (`axisNiceTicks`: niceExtent by design), yielding zero headroom: the tallest bar rendered at 100% of grid height while true values were 10–25, misrepresenting magnitude.
2. **Dry-run session page (`/flows/dry-run/[sessionId]`) usability** — 8+ logical sections rendered as one flat gray wall (no cards/section separation), session meta as an inline `·`-joined blob, editor textarea clipping its first line, uncolored +N/−M diff chip, a pre-run A/B compare that collapsed to a sliver, the primary CTA buried mid-page, and the apply warning as the dimmest bottom text.

## 2. Decisions

- **D1 (axis)**: new pure helper `countAxisMax(maxStacked)` in `flows-view-lib.ts` — 1/2/5×10^k ladder integer ceiling with ~15% headroom (min 1), hard-capped at 1.5× the data; 0/negative/NaN → 1. Primary y-axis takes `max: countAxisMax(maxStacked)` (explicit max = echarts fixMax, respected exactly), `minInterval: 1` (integer count ticks), and `alignTicks: false` on both axes (defensive pin so the cost secondary axis can never renegotiate the count axis). Series bindings unchanged (ok/failed stack → primary, cost_usd → `yAxisIndex: 1`). The reported 25-max case now renders on a 0–30 axis.
- **D2 (dry-run page)**: restructure into the app's existing card/section patterns — semantic `<dl>` meta grid with id truncate+copy; a dedicated top `실행` card holding the PrimaryAction (ConfirmDialog contract untouched) with the ledger-derived cost estimate visible beside it; a real CSS grid two-pane layout (editor 2fr / compare 3fr, stacks below `lg`) with structured empty-state panels (`base (카탈로그 원본 — 고정)` / `override (이 세션)`) replacing the pre-run sliver; diff summary as colored status chips (+green/−red) whose text carries the counts (color never sole channel); amber dirty chip (`변경됨 — 미적용`) beside the editor title; the apply new-derived-session notice promoted to a warning callout (amber tokens, `role="note"`) directly under the Apply/Revert controls; runs table gains a `토큰` column (7 columns); export moves into the A/B SectionToolbar actions slot; suggestion panel gets its own SectionToolbar card and the two agent dropdowns get distinct context captions. The `prefBeforeExecute` note moved from an unreachable executed-branch position to the empty state where it is true.
- **D3 (copy discipline)**: all OCR-suspect strings from the decider screenshot were verified against source/catalogs — none were genuine defects (e.g. OCR read `미병경` where the source has `(미변경)`, OCR read `AI에전 제네정` where the source has `에이전트 재배정`); zero wording rewrites on OCR guesses. 20 catalog keys added to BOTH locales under `pages.flows.dryRunSession`; 3 keys removed with zero remaining consumers (`targetPrefix`, `purposeLine`, `diffLines`). No Hangul in code; no styles.css change (existing classes + token-derived inline styles only); no API contract change.

## 3. Scope

`app/web-next/app/flows/ledger-view.tsx`, `app/web-next/app/flows/flows-view-lib.ts`, `app/web-next/app/flows/dry-run/[sessionId]/page.tsx`, `app/web-next/app/flows/dry-run/suggestion-panel.tsx`, `app/web-next/locales/{ko,en}.json`, `tests/unit/flows-console-view.test.ts` (v1.6.0: `countAxisMax` ladder/guard tests + option pins), `tests/unit/dry-run-view.test.ts` (migrated pins + 4 new behavior tests).

## 4. Verification gates

`bunx tsc --noEmit` (app/web-next); `bun run test:unit` (full suite green); `bun scripts/co-newbiz/i18n-lint.ts` (0 violations); `bun scripts/audit.ts` (all checks passed). AI 2nd review re-ran all four gates independently, numerically re-derived `countAxisMax` (exhaustive 2–2000, zero invariant violations), and confirmed diff hygiene (exactly the declared 8 files), invariant preservation (proposal-only boundary, a11y, both-locale key parity), and dead-key removal. Verdict: **PASS-WITH-NOTES** (P2 ×3: `createdValue` carries English "by" inside the ko catalog — future copy pass; CTA pin is source-order not structural; admin console `bar` charts share the same auto-scale pattern — recorded as a follow-up candidate, not acted on).
