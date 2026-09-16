# Brownfield S6/S7 Evaluation Auto-Draft (Financial Rubric + Technical Evidence)

- Spec ID: `2026-09-16-brownfield-eval-auto-draft`
- Date: 2026-09-16
- Status: implemented
- ADRs: [ADR-0140](../adr/0140-brownfield-financial-eval-auto-draft.md), [ADR-0141](../adr/0141-brownfield-technical-eval-auto-draft.md) (supersede ADR-0139 decision 3's fixed 5-item list; the human-verdict boundary is preserved and strengthened)

## Problem

The S7 candidate detail screen (`/brownfield/targets/[targetId]`) recorded every
financial/technical evaluation verdict manually even though the deciding numbers
(five DART business years per account) were already synced into `fact_financial`,
and technical capability items (seeded from the S3 capability-gap register) had
no evidence assembly at all. Users asked for draft automation with two hard
constraints: drafts must remain editable until the human confirms (the combined
score only materializes after technical evaluation completes), and items that
cannot be verified from evidence must be shown as explicitly `확인 안됨`
(unverified) rather than silently skipped or fabricated.

## Design

### 1. Financial draft — deterministic rubric (ADR-0140)

- `lib/brownfield-financial-rubric.ts` turns `deriveFinancialAnalysis` output
  into pass/partial/fail proposals per builtin criterion, no LLM: revenue
  (CAGR ≥ +5% and latest YoY ≥ 0 → pass; ≥ 0% → partial), operating profit and
  net income (all-years black + latest margin ≥ 5%/3% → pass; latest-year loss
  → fail), debt (latest ratio ≤ 200% and period rise ≤ 50p.p. → pass; > 300% →
  fail). Conservative fallbacks: undefined CAGR (base ≤ 0) judges by trend
  direction; insolvency (equity ≤ 0 or non-finite ratio) fails with an explicit
  note. Fewer than `minYears` (default 3) years yields no proposal, reason only.
- Thresholds live per-criterion in `brownfield_eval_criterion.rubric_json`
  (migration 0107; NULL = code defaults), editable via
  `PATCH .../eval-criteria/{id}` for financial builtins only, audited
  (`eval_criterion.rubric_update`), validated by field specs shared with the UI.
- Financial builtins become 4 items — `net_income_5y` (`당기순이익`) added —
  seeded per-`data_ref` so existing opportunities are topped up without
  re-seeding.

### 2. Technical draft — LLM over assembled evidence (ADR-0141)

- `lib/brownfield-technical-draft.ts` builds an evidence block from (a) the
  last 3 years of DART disclosure titles (`searchDisclosures` gains an optional
  `months` parameter; default 12 keeps existing callers unchanged), (b) the
  company AI profile (strengths/weaknesses/positioning via `loadLatestProfile`),
  and (c) per-criterion web search (Tavily) — then asks the LLM under the
  `s7.screening_draft` system prompt (evidence-only discipline).
- `unverified` is a first-class LLM answer; missing drafts (LLM unset, parse
  failure) also map to `확인 안됨` with a reason, pre-filled into the note so a
  human-recorded verdict documents the verification gap.

### 3. One endpoint, same boundary

`POST .../targets/{targetId}/eval-draft` takes `{ category }` and returns
proposals only — nothing is persisted. Humans confirm through the existing
`PUT eval-state` path (assessed_by = the user), individually (select change)
or in bulk (`초안 저장`). Already-human-judged items are never drafted over.

### 4. Candidate-detail UI

- Eval tab: per-category draft buttons, metric badges (CAGR/margin/ratio or
  evidence counts), editable draft notes, `확인 안됨` chip for null-status
  drafts, threshold editor, amber `자동 초안` chips for proposals.
- Financials tab: the redundant `재무 facts` card (manual sync button +
  series/ratio summary) was removed; the load-time auto-sync stays because
  `fact_financial` feeds the financial draft.
- Overview/SWOT: `[n]` research-citation markers now render as links to the
  actual external sources, and used external research (top 3/5 with links) is
  recorded inline next to the analysis it supports, with the full list in the
  sources tab.
- Profile tabs: font sizes aligned to the SWOT tab standard (body 0.88rem,
  card headers 0.9rem).
- List page: the `목표 시장 정의` / `후보 발굴` grid rebalanced from 1:1 to 2:3.

## Verification

- `tsc --noEmit` clean; `lint:design` 0 violations.
- Rubric engine scenario-tested via bun (healthy growth → pass across items,
  declining/leveraged → fail, 2-year data → no proposal, insolvency → fail).
- Technical parser tested: verdict whitelist, source_index → URL restoration,
  fallback/broken-JSON → empty map (all items become `확인 안됨`), unknown ids
  ignored.
- Migration 0107 applied to the dev DB via `bun db/migrate.ts`.

## Out of scope

Peer/industry-median relative thresholds (needs market-observation linkage),
disclosure full-text parsing (new integration), liquidity ratios (accounts not
in `WANTED_ACCOUNTS`).
