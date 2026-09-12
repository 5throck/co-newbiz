---
name: value-chain-stage-financials
scope: co-newbiz
description: >
  Populates per-value-chain-node 5-year historical financial performance:
  for each industry node in the chain topology, identify member companies,
  collect their DART financials, run the per-company financial pipeline,
  and roll the results up to industry-level 5-year KPI series (revenue
  growth, margin, ROIC) recorded in `fact_industry`.

  Use when: "value chain stage financials", "per-node 5-year financials",
  "industry-level KPI rollup", "chain stage financial performance".
version: 1.0.0
last_reviewed: 2026-08-29
status: active
owner: financial-analyst
prerequisites:
  - historical-financial-analysis
metadata:
  type: domain
  triggers:
    - value chain stage financials
    - per-node 5-year financials
    - industry-level KPI rollup
    - chain stage financial performance

  procedure_keys:
    - greenfield-fs
    - brownfield-fs
relates_to:
  - skill: historical-financial-analysis
    type: composes_with
  - skill: peer-benchmarking
    type: composes_with
  - skill: value-chain-linkage-analysis
    type: follows
  - skill: value-chain-driver-identification
    type: enables
  - skill: k-dart
    type: composes_with

---

## Context

ADR-0066's structure simulation and the six-axis linkage analysis both need
a per-node historical financial baseline — without it, a driver delta is
propagated through a chain whose stages have no observed performance record,
and the simulation output cannot be sanity-checked against what each stage
actually earned over the last cycle. The chain topology
(`value_chain_link` + `db/lib/value-chain-topology.ts`) and the
`fact_industry` table already exist; this skill codifies the pipeline that
fills `fact_industry` from DART company data rather than leaving it to a
manual import form.

## When to Use

- Before running a structure simulation for a project whose chain nodes
  have no 5-year financial series yet
- When a reviewer asks how each stage of the value chain has performed
  over the past five years

## Execution Steps

1. **Resolve chain nodes to industries**: take the project's value-chain
   topology (`GET /api/projects/:id/value-chain/topology`) and map each
   node to its industry identifier
2. **Identify member companies per node**: resolve companies belonging to
   each node's industry via `md_company.industry`; record the membership
   list — an unnamed membership list makes the rollup unauditable
3. **Collect company financials**: for companies with a `dart_corp_code`,
   collect via the `k-dart` pipeline (`financial-statement-analysis` /
   `historical-financial-analysis`); companies without coverage fall back
   to the manual import endpoint (`POST .../financial-imports`) with the
   source documented — never silently omit a major member from the rollup
4. **Run the per-company pipeline and roll up**: revenue growth, margin,
   and ROIC per company over 5 years, aggregated to the industry level and
   written to `fact_industry` — state the aggregation method (median vs
   weighted) and exclude companies with insufficient period coverage from
   the aggregate rather than imputing them
5. **Cap confidence**: the rollup inherits the weakest data-confidence
   grade of its members — per the workspace boundary, data confidence caps
   the RAG grade, so a node whose series is mostly manual-import carries
   that limitation forward into every downstream simulation reading it

## Output Format

- Per-node 5-year KPI series (revenue growth, margin, ROIC) in
  `fact_industry`, with member-company list, aggregation method, and
  per-company coverage/quality notes

## Related Skills

- `value-chain-driver-identification` — consumes these series to derive
  per-stage driver sensitivities
- `value-chain-linkage-analysis` — the coefficient layer this baselines
- `scenario-planning` (Structure-Simulation Extension) — the simulation
  these baselines feed
