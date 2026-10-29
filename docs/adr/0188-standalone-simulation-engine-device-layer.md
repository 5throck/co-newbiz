# ADR-0188: Standalone Monte Carlo Simulation Engine — Device Layer and Input-Derived Seeds

**Status**: Accepted
**Date**: 2026-09-18
**Deciders**: New Business Review Lead (PM); user direction approved (reflecting the 2026-09-18 third requirement round)
**Design of record**: [`docs/designs/2026-09-18-s8-business-case-evaluation-design.md`](../designs/2026-09-18-s8-business-case-evaluation-design.md) (§1 engine contract, device layer, parallel processing; §4 transparency; §5 parameter tuning)
**Related**: ADR-0052 §D.4 (seed determinism — contract kept, mechanism updated by this ADR), ADR-0096 (activity chain orchestration), ADR-0098 (S8 multi business-case generation), ADR-0115 (WACC component decomposition), ADR-0117 (dual perspective — shared-seed clause changed), ADR-0026 (contingent-liability triangular distribution)

> Renumbered from ADR-0142 on 2026-10-29 (duplicate number; ADR-0142 remains company-competitor-human-confirmation).

## Context

The S8 simulation ran as a TS loop inside the web process (`runSeededSimulation` in `business-case-generator.ts`). It had three structural limits: (1) iteration count and distribution variety translated directly into web request time, (2) it could not be reused outside the web (batch and analysis scripts), and (3) parameter provenance existed only as a `key=value;` string in `valuation_simulation.note`, so "which arguments produced this run" could not be proven structurally. As complexity and iteration count grow, a GPU becomes necessary, and the case grid (scenario x perspective x parameter set) is naturally parallel.

## Decision

1. **Move computation to a standalone engine outside the web** — `python/sim_engine/` (numpy CPU path by default). Language candidates (TS/Java/C/Rust) were evaluated and Python was adopted: the existing `python/monte_carlo.py` asset and the `python/` stack precedent, numpy vectorisation gives C-class performance, and scipy leaves room for extension. The TS generator is demoted to a job-spec builder plus engine spawner; if the engine fails, the existing TS simulator remains as a fallback (dual path during the transition, distinguished by an `engine=` stamp in the note).
2. **Device layer** — a single PyTorch abstraction covers four vendors (CUDA = NVIDIA, ROCm build = AMD/HIP, MPS = Apple Silicon, XPU = Intel oneAPI). Auto-detect order is `cuda > mps > xpu > rocm > cpu`. torch is an optional extra (lazy import) and the CPU path uses numpy alone; without a GPU the fallback is recorded as a warning. Small jobs (iterations x cases below a threshold) go to the CPU even when a GPU exists, because of transfer overhead.
3. **The seed is redefined as a pure function of the input** — `seed = fnv1a32(case_id + ":" + sha256(canonical_drivers))`. The ADR-0052 §D.4 contract ("same input -> same result") is kept but its mechanism becomes concrete: changing a parameter deterministically changes the seed, so results before and after a tweak are independent, reproducible samples. Because the RNG stream differs per device, the reproducibility contract is refined to "same job-spec + same device", and the snapshot records device, build, and precision.
4. **Change to ADR-0117's shared-seed clause** — ADR-0117 defined that "the two variants share a seed, so the difference comes only from the growth/volatility parameters". Under an input-derived seed, a different driver set per variant yields a different seed. Comparison between variants is guaranteed not by a shared seed but by the **determinism of same-condition reruns**, and this ADR changes that clause of ADR-0117. Existing stored rows keep the old contract until regenerated.
5. **Input snapshot = execution contract** — the engine returns the received job-spec unchanged in its result, and it is stored in `business_case_model.inputs_json`. Parsing the note string remains only as a fallback for legacy rows.

## Consequences

- Engine runtime dependencies: python3 + numpy (required), torch (optional — per-vendor build variants are documented). In an unconfigured environment the TS fallback runs, so the feature does not stop.
- `valuation_simulation` gains break-even timing, volume, and discounted-payback columns (migration 0112), and the model gains `inputs_json` (0113).
- CI reproducibility: `runSeededSimulation` (TS) and the engine use different RNGs, so quantiles do not match bit for bit — equivalence is verified with closed-form NPV, deterministic-rerun, and statistical-tolerance tests.
