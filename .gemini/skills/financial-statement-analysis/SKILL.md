---
name: financial-statement-analysis
scope: co-newbiz
description: >
  Comprehensive Korean financial statement analysis pipeline. Collects DART data,
  validates accounting integrity, normalizes to canonical financial model,
  extracts KPIs (profitability, growth, leverage, cash flow), builds a 5-level
  ROIC value driver tree, and generates a structured KPI/driver-tree report.

  Use when: "financial statement analysis", "ROIC analysis",
  "value driver tree", "financial KPI", "profitability analysis",
  "cash flow analysis", "fundamental analysis", "DART analysis",
  "financial metrics extraction", "corporate financial analysis".
status: active
owner: financial-analyst
version: 1.0.0
last_reviewed: 2026-08-20
prerequisites:
  - k-dart
l2_propagate: false
metadata:
  procedure_keys:
    - brownfield-fs
    - greenfield-fs
  type: analysis
  tier: medium
  triggers:
    - financial statement analysis
    - ROIC analysis
    - value driver tree
    - financial KPI
    - profitability analysis
    - cash flow analysis
    - DART analysis
    - fundamental analysis
    - corporate financial analysis
---

# Financial Statement Analysis Workflow

## Context

Reused from `Projects/co-consult/skills/financial-statement-analysis` and adapted
to co-newbiz's own port of the same pipeline (Stage 5 Wave 5.2, `docs/db-schema.md`
§4, design v1.0 §4-4). The Python stages (`validate.py`/`normalize.py`/`kpi.py`/
`driver_tree.py`) are the same code, ported verbatim; the TypeScript orchestration
is co-newbiz's own CLI, not co-consult's `financial-pipeline.ts`.

**Architecture**: Bun (TypeScript) orchestration + Python pandas data processing
— Class A Computational Integrity: financial figures are computed by the
validated Python pipeline, never calculated directly by the agent.

**Owner Agent**: `financial-analyst` (dispatched by PM, per §1-4 of the design)

## Prerequisites

- `k-dart` skill — for DART data collection (Phase ①)
- Python 3 with `pandas`/`numpy` installed (`python/requirements.txt`)
- Bun runtime — for orchestration scripts

## Pipeline Stages

```
① DART Collection (k-dart)
    ↓
② Validation Engine (python/validate.py)
    ↓
③ Normalization (python/normalize.py, python/mappings/ifrs_general.json)
    ↓
④ KPI Extraction (python/kpi.py)
    ↓
⑤ ROIC Value Driver Tree (python/driver_tree.py)
```

### ① DART Data Collection

Use the `k-dart` skill to collect raw financial data via DART OpenAPI `fnlttSinglAcntAll`
(consolidated `fs_div=CFS` preferred, `OFS` fallback; `reprt_code=11011` annual report).

### ② → ⑤ Run the co-newbiz pipeline

```bash
bun scripts/co-newbiz/newbiz.ts fin:pipeline <dart.json>      # validate → normalize → kpi, chained
bun scripts/co-newbiz/newbiz.ts fin:analyze <canonical-model.json>   # KPI report from a canonical model directly
bun scripts/co-newbiz/newbiz.ts fin:driver-tree <canonical-model.json>  # 5-level ROIC decomposition
```

**Validation rules** (`python/validate.py`): accounting equation (Assets = Liabilities + Equity,
residual < 5B KRW), NI → retained-earnings reconciliation, YoY anomaly flags (>200% change or sign flip).

**KPI groups** (`python/kpi.py`): Profitability (gross/operating/EBITDA/net margin, ROE, ROA, ROIC),
Growth (revenue/OI/NI YoY, 3yr CAGR), Leverage & Liquidity (D/E, D/A, current/quick ratio, interest
coverage), Cash Flow (OCF margin, FCF, OCF/Debt), Efficiency (COGS/SG&A/R&D-to-revenue ratios).

**Driver tree** (`python/driver_tree.py`): ROIC (L0) → NOPAT / Invested Capital (L1) → Revenue/Margin/Tax
efficiency and Working Capital/Fixed Assets/Cash-Debt (L2) → detail nodes (L3-L4), each carrying value,
YoY change, and contribution weight.

### FnGuide Cross-Validation (domestic listed companies only)

For KRX-listed targets, after KPI extraction cross-check headline figures (Revenue, Operating Income,
Net Income, Total Assets, Total Equity — latest 3 years) against `comp.fnguide.com`. Match the DART
pipeline's `fs_div` to the basis FnGuide renders (consolidated↔CFS, separate↔OFS) before comparing —
a basis mismatch is the most common source of an apparent discrepancy, not a data error. Treat a
mismatch beyond ~1% as material and diagnose which stage produced it before treating the analysis
as complete. Skip for non-domestic-listed entities.

## Execution Protocol (for financial-analyst agent)

1. Receive dispatch from PM with company/target name and year range
2. Collect data via `k-dart` (or reuse existing `deliverables/<project>/dart/` data)
3. Run `fin:pipeline` then `fin:driver-tree`
4. Review outputs — validation pass rate and mapping coverage
5. Cross-validate against FnGuide for domestic listed targets; record match/mismatch
6. Feed KPI/driver-tree outputs into the RAG financial dimension and `dd_finding.value_impact`
7. Hand off to `valuation-agent` for the valuation bridge

## Error Handling

| Stage | Failure Mode | Recovery |
|-------|-------------|----------|
| Validation | Pass rate < 80% | Flag data quality issues, proceed with warnings |
| Normalization | Mapping coverage < 60% | Check `ifrs_general.json`, may need a custom mapping entry |
| KPI | Missing key fields | Report which KPIs are unavailable due to missing inputs |
| Driver Tree | NOPAT/IC unavailable | Report tree with null nodes and notes |
| FnGuide Cross-Validation | Figures mismatch | Check consolidated/separate basis mismatch first before treating as a real discrepancy |

## Related Skills

- `k-dart` — DART data collection (prerequisite)
- `historical-financial-analysis`, `peer-benchmarking`, `growth-projection-modeling` — the co-newbiz-specific extensions this pipeline feeds
- `company-intelligence` — broader company research (upstream)
