---
lang: ko
lang_reason: source-material
---

# ADR-0080: Our-company analysis — group/affiliate two-level self-profile feeding S3

**Status**: Accepted — implemented in the same change (migration 0054, pipeline, APIs, page, nav)
**Date**: 2026-09-01
**Deciders**: user (standing directive), process-governance-manager (S3 input owner), greenfield-agent (activity owner)
**Design of record**: `app/our-company/page.tsx`, `app/api/our-company/**`, `lib/company-profile-pipeline.ts`, migration 0054

## Context

Spec S3 (시너지·전략적 적합성) consumes "자사 역량·포트폴리오 정보" as an input, but nothing
produced it — synergy evaluations had no structured self-profile to reason from. The user also
clarified two structural points:

1. **The self-side must be registered before synergy logic makes sense**: affiliates (and the
   group) are registered first, then analyzed (DART financials + business analysis for listed
   companies; analyst reports and industry-trend research for strengths/weaknesses).
2. **Group vs affiliate analyses differ**: an affiliate analysis is a single-company profile;
   a group analysis is a roll-up across affiliate profiles (common strengths/risks, industry
   exposure) — a synthesis of child artifacts, NOT an independent source.

Additionally, two S2/S3 usability findings were folded into this change: repeated opportunity
discovery created duplicate opportunities (dedup added in ADR-0079's discover flow), and the
synergy page's per-company analysis rows duplicated on re-analysis (now one row per company,
versions accumulate — matching the market-sizing rerun pattern).

## Decision

1. **New supporting surface `/our-company` (그룹/계열사 분석)**, positioned in the nav between
   기회 발굴 (S2) and 시너지 정합성 (S3). It is a supporting analysis producing S3's input —
   deliberately NOT a new spec stage (S3's input line already names this artifact).
2. **Two-level data model (migration 0054)**: `company_group` → `company_group_member`
   (company_name + optional dart_corp_code + role hq/affiliate) →
   `company_profile_version` (append-only payload versions per member).
3. **4-step affiliate profile pipeline** (`lib/company-profile-pipeline.ts`): DART financials →
   web research (analyst-report and industry-trend queries via the existing TAVILY integration) →
   LLM strengths/weaknesses/business assessment with source-numbered evidence and a
   deterministic fallback → version accumulation. Reanalysis = version + 1.
4. **Group roll-up is a client-side synthesis** of affiliate profiles (common strengths/risks,
   industry exposure) — clearly presented as derived, never as an independent data source.
5. **Perspective separation made explicit**: the /synergy page is a Brownfield target-company
   verification tool (DART + external research against S1/S2 linkage); the S3 synergy verdict for
   an opportunity lives in the opportunity registry's S3 panel. The /synergy intro now states
   this to end the mixed-perspective confusion.
6. **Terminology**: "기회 레지스트리" is renamed **기회 퍼널** across the spec (S2 output, S3
   input wording), UI, and generated docs — the funnel is the user-facing concept.

## Consequences

- **Positive**: S3 evaluations reason over a structured self-profile; group-level questions
  (where does the group have muscle, where are common risks) get a dedicated surface; DART
  search gained a persistent corp-code cache (stale-while-revalidate) so temporary DART blocks
  no longer break company search.
- **Accepted**: affiliate profiles are LLM/research estimates until analyst-confirmed
  (provenance rules apply); uploaded credit-report files are stored and referenced
  (`workspace/uploads/`) but not yet parsed into the pipeline (Phase 2).
- **Navigation**: 그룹/계열사 분석 sits between 기회 발굴 and 시너지 정합성, mirroring the
  process order (self-profile feeds opportunity evaluation and synergy).
