# Skill Governance Record — value-chain-linkage-analysis

## Overview

- **Skill Name**: value-chain-linkage-analysis
- **Version**: 1.1.0
- **Owner Agent**: quant-methodologist
- **Scope**: co-newbiz
- **Purpose**: Assesses upstream/downstream margin and demand-risk exposure via the `value_chain_link` table's pass-through-rate coefficients — deliberately stored separately from `proxy_industry_chain`'s demand-estimation betas (ADR-0025: the two answer different questions and would corrupt each other if shared).

## Scope

- Identify the value-chain linkage whose fortunes materially affect the target's margin or demand
- Estimate the pass-through-rate coefficient; store as `value_chain_link` (never referencing a `proxy_link` row for the same industry pair)
- Assess risk implications (margin risk from volatile upstream inputs, demand risk from cyclical downstream customers) as RAG risk-dimension inputs

## Persistence Surface (ADR-0116 Phase 5)

- `POST /api/projects/{id}/value-chain-links` — the REST writer for `value_chain_link` rows (analyst+; judgment numerics only — statistical betas/R² are calibrate-exclusive per ADR-0025; `evidence_ref` in `doc:`/`src:`/`https://` form per ADR-0058)
- `GET /api/projects/{id}/value-chain-links` — list
- `GET /api/projects/{id}/value-chain/topology` — Kahn layering over the links
- Statistical hops (β, R², CI) are produced exclusively by the calibrate regression (`POST /api/projects/{id}/proxy-chain/calibrate` → `scripts/co-newbiz/calibrate.ts`), never hand-entered

## Phase History

- **2026-08-20**: v1.0.0 initial release (Wave A2 era; described the analysis steps without a named persistence endpoint — `value_chain_link` had no writer until ADR-0116).
- **2026-09-11**: v1.1.0 — added the persistence-surface section: `value_chain_link` gained its first writer (repository + REST per ADR-0116), the topology endpoint now exists, and the calibrate trigger is reachable per project. SKILL.md Execution Step 4 renumbered accordingly.

## Acceptance Criteria

- [x] Defined in `.agents/skills/value-chain-linkage-analysis/SKILL.md`
- [x] Carries frontmatter `version` matching this record's Changelog
- [x] Persistence surface validated by `tests/unit/value-chain-link.test.ts`
- [x] Registered in `docs/VERSION_MANIFEST.md`

## Changelog

- **2026-09-11 (v1.1.0)**: REST persistence surface documented (value-chain-links POST/GET, topology GET); execution steps renumbered; provenance aligned with ADR-0116.
- **2026-08-20 (v1.0.0)**: Initial skill release.
