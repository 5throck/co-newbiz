---
lang: ko
lang_reason: source-material
---

# UX Round 2 verification (R2-D) — 2026-10-09

Scope: hands-on re-run of the three Round 1 walkthroughs (s1-s7, s8-s12, shell) against the merged R2-A/R2-B/R2-C build. Method identical to Round 1: own production build, random free port, temp SQLite DB, demo seed, playwright-core Chromium, ko-KR, 1280x900 + 390x844, analyst/viewer/admin roles. Code fixes made during this round: 4 (see "Fixes applied"). Curated screenshots: `docs/evidence/gui-review/walkthrough-2026-10-09/curated/` (bulk originals moved to /tmp, not deleted).

## Result summary

- Original findings: 21 s1-s7/shell + 14 s8-s12 + 10 shell = 45 total. FIXED 39, PARTIAL 6, OPEN 0. No blocker or high remains open.
- axe: 0 serious/critical violations on all 63 routes, light AND dark (full sweep re-run on the final build, including the 4 fix files).
- Every acceptance task completed UI-only, including new market analysis from /deals, known-target entry, back navigation, gate recording (S8 HOLD/GO, S9, S11, S12 KILL), and kill-with-learning closure to the archive.
- Language validator (`bun scripts/validate-md-language.ts`): pass.

## Before/after per finding

Legend: status after R2-A/B/C plus this round's fixes. "P" = partial.

### S1-S7 walkthrough (docs/reports/ux/2026-10-09-walkthrough-s1-s7.md)

| # | Finding | Status | Evidence (curated) |
|---|---|---|---|
| F1 | No one-command new analysis from /deals | FIXED | F1-market-new-analysis |
| F2 | S3 empty state not actionable | FIXED | F2-s3-empty-state |
| F3 | Opportunity detail lacks back affordance | FIXED | F3-opp-detail-back |
| F4 | Sidebar does not show S8+ project stage | FIXED | F4-rail-s8-project-id |
| F5 | S2 header action unclear | FIXED | F5-s2-header-action |
| F6 | S1 report not discoverable | FIXED | F6-s1-report-nav |
| F7 | Synthetic values unlabelled | FIXED | F7-synthetic-values |
| F8 | Known-target entry not obvious | FIXED | F8-known-target |
| F9 | Opportunity register scroll | FIXED | F9-opportunity-register-scroll |
| F10 | S4 header/tab naming | FIXED | F10-s4-header-tab-name |
| F11 | 미제/보류 deals not visible in rail grouping | FIXED | F11-rail-miaejung |
| F12 | Route decision bare enum | FIXED | F12-route-decision-bare |
| F13 | Back button labels | FIXED (conditional on entry path) | F13-back-labels |
| F14 | Industry chips | PARTIAL — chips render; star aria-label lives on S1, not S2 | F14-industry-chips |
| F15 | S6 panel overlap | FIXED | F15-s6-overlap |

### S8-S12 walkthrough (docs/reports/ux/2026-10-09-walkthrough-s8-s12.md)

| # | Finding | Status | Evidence (curated) |
|---|---|---|---|
| 1 | IC GO accepted despite open gaps, no acknowledge | PARTIAL — gap summary renders; explicit acknowledge still not enforced | S1-ic-go-gap-dialog, S10-establishment |
| 2 | Inconsistent gate confirmation (S12 vs S8/S9/S11) | FIXED — shared confirm on all gate forms | S2-gate-confirm-flow, S2b-s12-confirm |
| 3 | Gate panel buried at page bottom | FIXED — decision reachable from top | S3-decision-reachable-top |
| 4 | Duplicate tab rows on S8 | PARTIAL — WACC/재무분석 deduplicated; StageTabs + TabNav rows remain by design (summary vs sub-analysis) | S4-s8-tab-merge |
| 5 | Waiver form | PARTIAL — form opens, scrolls, min-length shown as text; no per-row prefill | S5-waiver-form |
| 6 | DD checklist English | FIXED — 판정 대기 default, Korean filters | S6-s9-checklist-ko |
| 7 | 390px overflow | FIXED — all 5 routes ok at 390 | S7-390-dd-wacc |
| 8 | Closure/gate jargon and English messages | FIXED this round (capLabel, closureRecordLabel fallback, localizeMessage in ClosureModal/ReviewBuckets) — re-verified on rebuilt bundle: "신뢰도 상한 중간 (amber)", closure missing-record message in Korean, "LLM provider is not configured" localized | S8-closure-jargon |
| 9 | S10 investment structure English enums | FIXED — 지분/지급수단 enums Korean; 투자구조 가설 기록 primary visible | S9-s10-primary |
| 10 | Establishment tracking columns | FIXED — 담당자/갱신 columns + tracked-elsewhere note | S10-establishment |
| 11 | Closure flow (5 clicks, archive detail) | PARTIAL — 5 clicks, lands on /projects/archives with reason; archive row shows reason + 상태 마감 but not closure type; archive-row 삭제 guard untested | S11-closure-archive |
| 12 | Frosted topbar transparency | FIXED — opacity 0.88 + blur acceptable | — |
| 13 | AI 2nd request no feedback | FIXED — status-line feedback + Korean not-performed reason | S13-ai2nd-feedback |
| 14 | Inbox/agent-runs empty states | FIXED — "대기 없음"; creation-path hint remains thin | S14-inbox-empty |

### Shell walkthrough (docs/reports/ux/2026-10-09-walkthrough-shell.md)

| # | Finding | Status |
|---|---|---|
| SH1 | Orphan routes in nav | FIXED |
| SH2 | 404 page | FIXED |
| SH6 | Role gating (viewer/admin redirect) | FIXED — viewer notice, admin redirect with Korean notice |
| SH10 | axe violations | FIXED — 0 serious/critical, 63 routes, light + dark |

## Click counts before -> after (per task, click-only)

| Task | Before | After |
|---|---|---|
| New market analysis from /deals | 6 | 1 |
| Known-target entry | 4 | 2 (focused form + notice) |
| S8 HOLD record | 4 | 5 (adds shared confirm) |
| S8 GO record | 3 | 2 |
| S9 gate record | 3 | 3 |
| S11 IC GO | 3+3 | 3 |
| S12 KILL transition | 3-6 | 2 |
| Closure (kill-with-learning to archive) | 5 | 5 |

S8 HOLD +1 click is the deliberate shared human-confirm step (finding 2 fix); net win across the gate family.

## Fixes applied this round (frontend only, Onyx tokens, no `as any`)

- `app/web-next/components/stages/IcReviewStage.tsx` — `capLabel()` maps confidence_cap domain green/amber/red to 높음/중간/낮음 instead of raw enum.
- `app/web-next/lib/labels.ts` — `closureRecordLabel` falls back to base record key (parameterized keys like `venture_transition_decision(kill_with_learning_captured)`); `localizeMessage` rule for "The latest S12 transition decision must be '...'".
- `app/web-next/components/ClosureModal.tsx` — missing-record message goes through `localizeMessage` fallback.
- `app/web-next/components/ReviewBuckets.tsx` — not_performed_reason localized ("LLM provider is not configured" -> Korean actionable text).

Re-verified on a rebuilt bundle (fresh temp DB): all four render Korean; axe 0 blocking on ic-review / business-case / dd / portfolio, light and dark.

## Remaining (larger than a small fix — listed, not fixed)

1. S11 GO-on-open-gaps needs a server-side acknowledge/confirm contract (finding 1) — a data/API change, not CSS.
2. Waiver per-row prefill needs an API shape carrying per-item waiver intent (finding 5).
3. S8 dual tab rows are a structural IA decision (summary vs analysis navigation) — recommend a follow-up design task.
4. Archive row should surface closure type (needs closure_type in the archive list payload).
5. F14: move/add star aria-label so it is visible on S2, not only S1.

## Verification suite

- test:unit — pass (full unit suite)
- test:e2e — pass (all scenarios, 353 s)
- typecheck — pass (91 baselined errors, no new errors)
- web-next `tsc --noEmit` direct — 0 errors in app/web-next sources
- `typecheck:web` (script) — FAILS on HEAD itself, identical without this round's changes (bun:sqlite / import.meta type resolution in ../../db and ../../scripts — pre-existing environment issue, not a regression; all app/web-next files clean)
- design:lint — no violations
- contrast:check — all enforced pairs >= 4.5:1 in both themes
- verify-scripts — all 206 registered scripts verified
- audit.ts — all checks passed

No `as any` introduced; `app/web-next/tsconfig.json` untouched (clean per `git status`).
