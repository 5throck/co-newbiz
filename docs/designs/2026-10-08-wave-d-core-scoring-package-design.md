---
title: Wave D — Core Scoring Package (pure RAG, data-confidence, proxy-chain and kill-criteria core)
status: implemented
date: 2026-10-08
owner: platform-lead
contributors: quant-methodologist (proxy-chain and unit-conversion review), process-governance-manager (RAG framework owner)
related_adrs: [ADR-0016 (RAG priority ordering), ADR-0046 (predicate AST)]
---

# Wave D — Core Scoring Package Design

> Pre-approved by the user in chat on 2026-10-08. This is the last wave of the 2026-10-08 series.

## 1. Context

The scoring rules that carry the design's non-negotiable boundary #4 (data confidence caps the overall RAG grade) are spread across `db/lib` modules that mix pure logic with SQLite access:

- `db/lib/rag-engine.ts` — `evaluateRag`, `computeOverall`, hysteresis, and (inside `assessRun`) the Wave F-5 immediate confidence ceiling.
- `db/lib/data-confidence.ts` — hop-band and provenance-cap grading, wrapped around one `proxy_link` query.
- `db/lib/chain-grading.ts` — proxy-chain reliability grading and CI compounding (already pure).
- `db/lib/predicate.ts` and `db/lib/kill-criteria.ts` — the ADR-0046 predicate AST, registry entry validation, snapshot coercion, plus the registry file loader and snapshot query.
- `scripts/co-newbiz/convert.ts` — same-dimension unit conversion and proxy-chain multiplication, interleaved with `md_unit` / `proxy_link` reads.

Because the pure logic sits next to DB code, it can only be tested through a scratch database, and the confidence ceiling in particular had no direct test of its invariant.

## 2. Goals and non-goals

Goals:

1. Extract the pure scoring core into `packages/core-scoring/` with typed public exports, a README and its own unit tests.
2. No DB, filesystem or environment access anywhere in the package.
3. `db/lib` modules stay as thin adapters that call (and re-export) the package, so no importer changes path.
4. Property-style tests for the confidence cap: a grade never exceeds the cap, and an incomplete assessment is never graded.

Non-goals: no behavior change (every existing unit test, eval suite and E2E scenario passes unchanged); no publishing (`private: true`, never published); no change to SQL, migrations, routes or the MCP tool set.

## 3. Package layout

```
packages/core-scoring/
  package.json        @co-newbiz/core-scoring, private: true, main/exports -> src/index.ts
  README.md
  src/index.ts        public API (re-exports every module below)
  src/rag-engine.ts   evaluateRag, computeOverall, financialBand, dataConfidenceFromChain,
                      regulatoryPermitGrade, applyHysteresis, applyConfidenceCeiling,
                      confidenceCeilingOf, RAG_GRADE_ORDER + types
  src/data-confidence.ts  gradeFromHops, provenanceCap, worseGrade, gradeDataConfidence
  src/chain-grading.ts    gradeChain (moved verbatim)
  src/predicate.ts        ADR-0046 predicate AST (moved verbatim; depends on zod only)
  src/kill-criteria.ts    KILL_ACTIONS, validateRegistryEntry, toVarSnapshot, buildLookup
  src/unit-conversion.ts  convertBetweenUnits, hopFactor, applyProxyChain
  tests/core-scoring.test.ts
```

## 4. Adapter boundary

| Adapter (stays in db/lib or scripts) | Keeps | Calls in the package |
|---|---|---|
| `db/lib/rag-engine.ts` | `assessRun` (rag_assessment / rag_transition writes, previous-grade query) | `evaluateRag`, `applyHysteresis`, `applyConfidenceCeiling`, `confidenceCeilingOf` |
| `db/lib/data-confidence.ts` | `deriveDataConfidence` (proxy_link hop query) | `gradeDataConfidence` |
| `db/lib/kill-criteria.ts` | registry directory loader, snapshot fill and query, `evaluateKillCriteria` | `validateRegistryEntry`, `buildLookup` |
| `db/lib/chain-grading.ts`, `db/lib/predicate.ts` | nothing (re-export shims) | everything |
| `scripts/co-newbiz/convert.ts` | md_unit seeding and reads, proxy_chain / proxy_link reads | `convertBetweenUnits`, `hopFactor`, `applyProxyChain` |

Each adapter does `export * from "../../packages/core-scoring/src/<module>.ts"`, so every symbol that used to be exported from `db/lib/*` is still exported from the same path. Error messages, rationale strings and the per-hop error order in `convertViaProxyChain` are byte-identical.

## 5. Module resolution

Relative import paths, not a Bun workspace. The repo has no `workspaces` field, `app/web-next` already reaches `../../db` through relative paths under a Turbopack root scoped to the repo (2026-09-09 build fix), and a workspace would rewrite `bun.lock` for no runtime gain. The package still carries a `package.json` (name, `private: true`, `exports`) so it can become a workspace member later without code changes. `zod` is a peer dependency resolved from the repo root.

`tsconfig.core.json` and `tsconfig.json` add `packages/**/*.ts` to `include`; the core typecheck stays at 0 errors.

## 6. Confidence-ceiling extraction

`assessRun` previously computed the ceiling inline with a local `GRADE_ORDER`. It now calls:

- `confidenceCeilingOf(evaluation)` — the assessed `data_confidence` grade, or `undefined`.
- `applyConfidenceCeiling(grade, ceiling)` — returns `{ grade, capNote }`; it only ever lowers, and the note text is unchanged.

The `enforceConfidenceCeiling` flag stays in the adapter, so CLI semantics (flag unset) are unchanged.

## 7. Tests

- `packages/core-scoring/tests/core-scoring.test.ts` runs from the package (`bun test tests`) and is registered in `test:unit` and coverage through `tests/unit/core-scoring-package.test.ts` (a one-line import).
- Property-style cases, deterministic (seeded mulberry32 PRNG and exhaustive enumeration, no new dependency):
  - `applyConfidenceCeiling` over every grade x ceiling: the result is at most the ceiling and at most the input.
  - `computeOverall` over all 3^6 dimension combinations x kill flag: overall is at most `data_confidence`.
  - 2,000 random `evaluateRag` inputs: a graded overall is at most the ceiling; an incomplete assessment is either ungraded (`overall: null`) or forced Red.
  - Dropping any one of the six inputs from a fully-Green assessment yields `overall: null`.
  - 1,000 random `gradeDataConfidence` inputs never beat the provenance cap.
- Existing suites unchanged: `tests/unit/chain-grading.test.ts`, `predicate.test.ts`, `wave-f5-rag*.test.ts`, `calibrate-convert.test.ts` and the rest import through the `db/lib` and `scripts` paths and pass as before.

## 8. Verification

`test:unit`, `test:scripts`, `test:e2e`, `typecheck` (core 0 errors, baseline unchanged), `test:coverage` + `coverage:check`, web-next `tsc --noEmit` (0 errors), `bun run eval` offline (rag/kill/antitrust 100%, calibration n/a — identical to the committed `2026-10-08-offline-baseline` scoreboard), `cd app/web-next && bun run build`, `generate-skill-graph`, `verify-scripts`, `audit.ts`.

## 9. Accessibility

Not applicable. The wave adds no UI; rendered output is unchanged.

## 10. Preview

Not applicable. No screen, route or visual change; there is nothing to preview.

## 11. Risks

- **Silent behavior drift during the move.** Mitigated by moving code verbatim, keeping all strings, and running every pre-existing suite plus the offline eval against the baseline.
- **Two import paths for the same symbol.** Intended: `db/lib` is the adapter path for DB callers, the package path is for pure callers. Both resolve to one implementation.
- **A future contributor adds DB access to the package.** The README states the purity rule and the package has no DB dependency to import.

## 12. Status

Implemented on 2026-10-08 (branch `pr/20261008-wave-d-core-scoring`).
