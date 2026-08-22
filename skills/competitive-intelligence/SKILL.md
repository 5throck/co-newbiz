---
name: competitive-intelligence
scope: co-newbiz
description: >
  Systematic market and competitive analysis for new-business review — market
  entry analysis, framework selection (Porter's Five Forces, SWOT, PESTEL),
  competitor profiling, market sizing (TAM/SAM/SOM), and opportunity assessment.

  Use when: "competitive analysis", "market analysis", "competitor profiling",
  "market entry analysis", "industry attractiveness", "competitive intelligence",
  "five forces".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: market-intelligence-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - competitive analysis
    - market analysis
    - competitor profiling
    - market entry analysis
    - industry attractiveness
    - competitive intelligence
    - five forces

  procedure_keys:
    - brownfield-dd
---

## Context

Reused from `Projects/co-consult/skills/competitive-intelligence`. Use at
Screening/Pre-FS whenever a review requires understanding the competitive
landscape, market dynamics, or industry structure — for both Green Field
(new-establishment) and Brown Field (M&A target market) reviews.

## When to Use

- Green Field market entry or expansion analysis
- Brown Field target/competitor benchmarking
- Industry attractiveness assessment feeding the RAG market dimension
- TAM/SAM/SOM opportunity sizing

## Execution Steps

1. **Define Research Scope**: clarify industry boundaries, geographic scope, and
   time horizon with the project lead
2. **Select Frameworks**: choose 2-3 appropriate frameworks:
   - Porter's Five Forces (industry attractiveness)
   - SWOT (internal/external factors)
   - PESTEL (macro-environment, cross-reference `region-profiles/*.yaml`)
   - Competitive Positioning Map (relative market position)
3. **Competitor Profiling**: for each key competitor — market share, positioning,
   strengths/weaknesses, strategic moves, financial health indicators (KSIC-coded
   via `md_industry` where the competitor is a `md_company` row)
4. **Market Sizing**: TAM → SAM → SOM with methodology documented as an
   `assumption(kind='derived')`, anchored to a `proxy_chain` or direct data source
5. **Market Entry Module** (Green Field only):
   - Regulatory and compliance requirements (hand off to `legal-counsel`)
   - Entry barriers and success factors
   - Recommended entry mode (organic / partnership / acquisition)
6. **Synthesis**: produce structured findings — executive summary, methodology,
   key findings, implications, recommendations
7. **Handoff**: pass findings to `insight-synthesis` for cross-domain integration

## Output Format

- Competitive Analysis section: Executive Summary, Methodology, Industry Overview,
  Competitor Profiles (table), Market Sizing, Strategic Implications,
  Recommendations — feeds the RAG market dimension's rationale

## Related Skills

- `insight-synthesis` — cross-domain integration
- `value-chain-linkage-analysis` — upstream/downstream connection analysis (do
  not confuse a market-sizing beta with a proxy-chain beta — ADR-0025)
- `company-intelligence` — deeper individual-company research
