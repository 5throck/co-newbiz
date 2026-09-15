---
lang: ko
lang_reason: source-material
---

# ADR-0113: Competitive-positioning disclosure cross-check — the S3 경쟁 tab gains a DART 사업보고서 + targeted-research verification step (payload schemaVersion 3)

- Status: Accepted
- Date: 2026-09-10
- Deciders: New Business Review Lead (PM)
- Related: ADR-0093 (company-profile payload v2, S1 confidence standard, "silence is never approval"), ADR-0092 decision 6 (three-state verification ledger), k-dart skill v2.1.0 P3/P4 (`searchDisclosures`, `fetchDisclosureText`), Boundary 4 (data confidence caps the grade)

## Context

The S3 그룹/계열사 분석 경쟁 tab renders `competitive` output that is LLM-
estimated from web-research excerpts alone (pipeline step 4, ADR-0093). The
section carries a fixed grade `C — "LLM 추정 — 공시·리서치 대조 전"`, the
verification ledger has **no** competitive entries, and the UI footnote admits
the gap verbatim: "공시·리서치 원문 대조 전입니다." The workspace already
ships the infrastructure to close this gap but nothing calls it:
`dart-client.ts` exposes `searchDisclosures` (12-month disclosure list) and
`fetchDisclosureText` (원문 ZIP→XML→text, 500k-char cap) with zero callers,
and `company_group_member.dart_corp_code` is persisted at registration.

## Decision

1. **Pipeline step 5 — 공시·리서치 원문 대조** (`lib/company-profile-crosscheck.ts`,
   called from `company-profile-pipeline.ts` only when step 4 produced a
   non-degraded `competitive`; failures never block version persistence —
   the ADR-0093 step-4 rule):
   - **DART path** (listed members): `searchDisclosures(corpCode, "business")`
     → new `selectBusinessReport` helper (latest rcept_dt, 비정정 preferred,
     정정-only falls back to 정정) → `fetchDisclosureText` → deterministic
     `extractDisclosureContext` (4k-char windows around 경쟁/주요제품/시장점유율/
     매출처-style keyword hits, ≤6 merged windows) → LLM verdict prompt.
     A 12-month list window always contains the latest filed annual report
     (annual cadence, filed each spring). HWP/ZIP extraction failures become
     `dart_unavailable` with the reason recorded — never a crash.
   - **Research path** (all members): one targeted Tavily query per competitor
     (≤5) as independent triangulation beyond step 2's shared excerpts.
   - **Verdicts, not rewrites.** The LLM judges each claim (competitors +
     positioning sentence) as `confirmed | directional | contradicted |
     unverified` with an evidence quote and source class (`dart | research |
     dart+research`). The estimated positioning text is **never** rewritten
     automatically — a contradiction surfaces for human judgement (판정은
     사람). Verdict-generation failure yields all-`unverified` with the
     reason in `crossCheck.note`.
2. **Payload schemaVersion 3** (JSON blob, no migration — ADR-0093 pattern):
   `competitive.crossCheck?: { status: cross_checked | dart_unavailable |
   research_only; checkedAt; dartReport {rceptNo, reportNm, rceptDt,
   reportUrl}; claims[]; note? }`. Versions persisted as
   `methodology: "company-profile v3"`. Old payloads render unchanged
   (optional field + the legacy static footnote).
3. **Confidence standard wiring** (deterministic): section grade for
   경쟁 포지셔닝 becomes B- only when the DART 원문 대조 produced ≥1
   `confirmed`; cross-checked-directional and research-only stay C (note
   distinguishes them); `dart_unavailable` is C-; missing output stays D.
   Ledger rows are appended per competitor plus one for the positioning
   sentence: confirmed→confirmed, directional/contradicted→needs_judgement
   (a contradiction is never auto-scored against the claim),
   unverified/no-verdict→could_not_verify. RAG cap rules unchanged.
4. **UI** (경쟁 tab): a 대조 section with a status chip, the DART 사업보고서
   원문 보기 link, a claim/판정/근거 table (chip reuse of the S1 검증·한계
   pattern), a per-competitor verdict chip in the 경쟁사 table, and a dynamic
   footnote replacing "대조 전" only when a crossCheck exists.

## Consequences

- The footnote "공시·리서치 원문 대조 전입니다" becomes a truthful statement
  per run instead of a permanent disclaimer; the ledger no longer stays
  silent on the section most exposed to LLM hallucination.
- ~2 extra DART calls per listed-member analyze run (list + document) inside
  the existing daily-budget gate, ≤5 Tavily calls, one bounded LLM call
  (~24k-char context).
- The exact DART per-report viewer URL is not invented: `dartReport.reportUrl`
  reuses the corp-level report-list URL format already used by
  `fetchFinancials` (`dsab007/main.do?option=corp&corp_code=…`).
- HWP-primary filings remain unverifiable by machine (`dart_unavailable`,
  OCR is a future path); 비상장 members are structurally research-only.
- S1 market-sizing 경쟁 구조 could reuse the same helpers but is out of scope
  here.
