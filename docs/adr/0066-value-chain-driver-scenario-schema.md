# ADR-0066: Value-chain driver/scenario schema and the structure-simulation plane

**Status**: Accepted (2026-08-24)
**Deciders**: user (initiative + scope approved: drivers rate/fx/commodity/regulation, DART-first ingestion, Phase A–D), data-architect (schema), market-intelligence-agent (sensitivity ownership)
**Design of record**: `docs/designs/2026-08-24-value-chain-scenario-simulation-design_ko.md`

## Context

Two approved capability requests converge on one missing piece — an industry-structure scenario simulation driven by external-environment changes:

1. Downstream-inclusive market research identifying key direction-setting factors, then simulating how the industry shape moves as those factors shift.
2. Value-chain topology mapping (upstream→downstream) with per-stage 5-year financial performance, feeding the same factor-driven structural simulation.

Phase A landed the read-only data plane (topology resolver `db/lib/value-chain-topology.ts`, stage financials REST, DART collector `scripts/co-newbiz/dart-collect.ts` + user-import fallback) with **no DDL**. This ADR covers Phase B's schema — the write-side plane Phase C's engine will consume.

## Decision

Migration 0030 adds three tables:

- **`industry_driver`** — the external-driver registry. v1 seeds exactly the approved quartet (`rate` / `fx` / `commodity` / `regulation`) with stable readable ids (`drv-*`). Extension is an INSERT of a new code row (no enum CHECK — registry growth must not require migrations).
- **`chain_node_sensitivity`** — per-(project, industry, driver) elasticity + lag_months, owned by market-intelligence-agent's six-axis analysis. UNIQUE per triple; sensitivity bounded ±10; lag non-negative; evidence_ref carried for provenance.
- **`structure_simulation_result`** — quantile output of `python/structure_sim.py` (Phase C): one row per (run, scenario, industry, metric) with p05/p50/p95; scenario vocabulary is the preset trio (`downside`/`base`/`upside`) plus `custom`; metrics are the propagation outputs (`demand_delta_pct`, `margin_delta_pp`, `hhi_delta`).

Scenario INPUTS ride existing machinery: driver deltas are recorded on the run as assumption keys **exactly** `drv.rate_bp` / `drv.fx_pct` / `drv.commodity_pct` / `drv.regulation_severity` (0–3 subjective scale, rationale mandatory via FR-DATA-07) — the same exact-key convention kill-criteria #5/#6 use for wacc/hurdle_irr. Presets (downside/base/upside) are documented value sets over these four keys.

## Boundary rules (reaffirmed/extended)

- **ADR-0025 extension**: the simulation consumes `value_chain_link` coefficients ONLY. proxy_link coefficients are never read by the propagation engine or its filler; a proxy estimate may enter as an input value but never as a shared coefficient.
- Links lacking coefficients propagate as UNASSESSED nodes in outputs — never defaulted to zero-impact.
- The engine never grades RAG dimensions directly; `market.competitive_intensity` gains its evidence source from these results when Phase C lands.

## Consequences

- Phase C's engine has a stable output contract to write into (UNIQUE prevents duplicate result rows per run/scenario/node/metric).
- Driver-set growth is data-only (INSERT), so no future migration is needed to add drivers.
- Regulation severity remains subjective-but-reasoned (assertion-style discipline); if a quantitative series emerges later it attaches via `source_series_id`.

## Cross-references

Design doc (above) · ADR-0005 (run immutability) · ADR-0025 (coefficient isolation) · FR-DATA-07 (assumed requires rationale) · migration 0030
