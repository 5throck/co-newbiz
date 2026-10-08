# @co-newbiz/core-scoring

Pure scoring core for co-newbiz: RAG grading, the data-confidence ceiling, data-confidence grading, proxy-chain reliability and conversion math, and the kill-criteria predicates.

**Private package.** `private: true`; it is never published. Design: `docs/designs/2026-10-08-wave-d-core-scoring-package-design.md`.

## Rule: pure functions only

Nothing in `src/` may touch a database, the filesystem, the network or environment variables. DB adapters stay in `db/lib/` (for example `assessRun`, `deriveDataConfidence`, `evaluateKillCriteria`) and in `scripts/co-newbiz/convert.ts`; they load rows and call this package.

## Public API (`src/index.ts`)

| Module | Exports |
|---|---|
| `rag-engine.ts` | `evaluateRag`, `computeOverall`, `financialBand`, `dataConfidenceFromChain`, `regulatoryPermitGrade`, `applyHysteresis`, `applyConfidenceCeiling`, `confidenceCeilingOf`, `RAG_DIMENSIONS`, `RAG_GRADE_ORDER`, types |
| `data-confidence.ts` | `gradeFromHops`, `provenanceCap`, `worseGrade`, `gradeDataConfidence`, types |
| `chain-grading.ts` | `gradeChain`, `Hop`, `ChainGradeResult` |
| `predicate.ts` | ADR-0046 predicate AST: `parsePredicate`, `evaluatePredicate`, `renderKo`, `PredicateSchema`, types |
| `kill-criteria.ts` | `KILL_ACTIONS`, `validateRegistryEntry`, `toVarSnapshot`, `buildLookup`, types |
| `unit-conversion.ts` | `convertBetweenUnits`, `hopFactor`, `applyProxyChain`, types |

## Invariants

- The overall grade is priority-ordered, never averaged (ADR-0016).
- A grade never exceeds the data-confidence ceiling (boundary #4); `applyConfidenceCeiling` only lowers.
- An incomplete assessment is never graded unless a Red dimension or a kill criterion forces Red.
- Cross-dimension unit conversion is refused (FR-DATA-03).

## Usage

Import by relative path (the repo does not use Bun workspaces):

```ts
import { evaluateRag, applyConfidenceCeiling } from "../../packages/core-scoring/src/index.ts";
```

## Tests

```sh
cd packages/core-scoring && bun test tests
```

The suite also runs in the root `bun run test:unit` through `tests/unit/core-scoring-package.test.ts`.
