---
lang: ko
lang_reason: source-material
---

# ADR-0093: Company-profile expansion to S1-level comprehensiveness

- Status: Accepted
- Date: 2026-09-03
- Deciders: New Business Review Lead (PM), per user direction
- Related: ADR-0080 (S3 support tool, no stage promotion), ADR-0089 (S3 input-prep activities), ADR-0090 (synergy alignment / profile reuse), ADR-0092 decision 6 (S1 confidence standard), ADR-0077 (JSON payload extension precedent), ADR-0014 (additive-only migrations)

## Context

The affiliate company profile (그룹/계열사 분석, /our-company) produced a 4-step
pipeline and a 3-tab report. Compared with the S1 market analysis (8+ sub-steps,
11 tabs, deterministic financial synthesis, confidence standard), it was
materially shallower: DART accounts were stored raw with no ratios or trends,
SWOT covered only strengths/weaknesses, there was no competitive positioning,
no linkage to the S1 market matrices the industries already have, and no
confidence/risk machinery. The API already returned version history and
per-step notes that the UI discarded.

## Decision

### 1. Payload extension without migration

`CompanyProfilePayload` gains optional fields — `financialAnalysis`, `swot`,
`competitive`, `industryLinkage`, `sectionConfidence`, `verificationLedger`,
`ragCapRecommendation`, `schemaVersion` — stored in the same TEXT JSON payload
column of `company_profile_version` (ADR-0077 precedent). No DB migration. The
payload wrapper becomes `{ methodology: "company-profile v2", schemaVersion: 2,
profile }`. Every v1 field name is unchanged; `loadLatestProfile` consumers
(ADR-0090 synergy reuse) read defensively and keep working.

### 2. Pipeline 4 → 6 steps

- Step 3's LLM assessment now also produces opportunities/threats (SWOT) with
  the same per-item source-citation rule and the same honest degraded fallback.
- New step 4: LLM competitive positioning (competitors + positioning text).
  Failure records a degraded note; it never blocks the version save.
- New step 5: deterministic synthesis (no LLM) — financial ratios/trends
  (`lib/company-financials.ts`), industry linkage (each industryExposure entry
  matched to `md_industry` and its latest completed S1 matrix: anchor total,
  bottom-up CAGR, external-forecast gap, qualitative factors), per-section
  confidence grades assigned from the section's evidence class, a verification
  ledger (DART ingestion = confirmed; uploaded credit report = could_not_verify
  with the explicit note that the pipeline does not yet read file contents; LLM
  claims = needs_judgement; matrix links = confirmed), and the RAG cap.
- The version save becomes step 6 and records its own summary.

### 3. Adoption of the S1 confidence standard (ADR-0092 decision 6)

Section confidence grades, a verification ledger, and the RAG cap apply to the
profile exactly as to S1 matrices: data confidence caps the grade (boundary 4);
an analyst-confirmed state is required before the cap can be green; silence in
the ledger is never read as approval. This is applied to a NON-stage S3
input-prep activity (ADR-0080/0089): stage non-promotion is reaffirmed — the
profile is recurring master data for S3/S5/S7, and the confidence attachments
exist so its consumers can see how much of it is verified, not to gate it.

### 4. UI restructure to 7 tabs

개요 / 재무 / 강·약점 SWOT / 산업 연계 / 경쟁 / 출처·데이터 / 버전·노트. Every
new section renders conditionally on its payload field, so pre-expansion (v1)
payloads render the legacy subset with a re-analysis hint instead of empty
tabs. The version history and step notes the API already returned are now
rendered.

### 5. Seed route deferred

S1 has an agent-research seed route because pre-staged research materially
improves its LLM pipeline. The profile pipeline already ingests filing-grade
DART data and live web research at run time, and a profile re-runs in seconds
per affiliate — a second append-only write path adds risk without benefit.
Revisit only if offline/batch re-analysis of all affiliates is requested.

## Consequences

- **Positive**: profile depth reaches S1 parity — ratios/trends computed not
  asked, SWOT and competitive views grounded in cited research, industry
  exposure connected to real S1 matrix numbers, and consumers can read the
  confidence attachments before using the profile as S3/S5/S7 input.
- **Risk accepted**: uploaded credit-report files are still not parsed (the
  ledger says so explicitly rather than implying they were used).
- **Risk accepted**: `industryLinkage` name matching can miss when the LLM's
  exposure wording diverges from `md_industry.name_ko`; misses are recorded
  with a note ("S1 매트릭스 없음"), not silently dropped.
- **Migration**: none. Old payloads remain readable; synergy reuse is
  unaffected (verified by regression run).
