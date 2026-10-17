// @version 1.0.0
/**
 * Unit tests for the standalone simulation engine (python/sim_engine/) —
 * spec 2026-09-18-s8-business-case-evaluation sections 1.2-1.4:
 *  (a) CLI contract — version probe, validation errors on exit code 2;
 *  (b) seeded determinism — identical job-spec, identical result;
 *  (c) closed-form parity — constant drivers reproduce the analytic NPV,
 *      discounted payback, and std=0;
 *  (d) seed policy — the engine's seed equals fnv1a32(case_id + ":" +
 *      sha256(canonical drivers)) computed independently here;
 *  (e) BEP volume from unit economics (REQ-W3-1) — and null when partial;
 *  (f) device fallback — an unavailable explicit device degrades to CPU with
 *      a recorded warning (REQ-W7-3/4), never a failed job;
 *  (g) case-level parallelism — parallel multi-case output equals serial
 *      single-case output, order preserved (design section 1.3).
 *
 * Skips cleanly when python3 (+numpy) is unavailable — the engine is an
 * optional accelerator and CI hosts without it still run the TS fallback.
 */

import { test, expect, describe } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PYTHON_DIR = resolve(REPO_ROOT, "python");
const PYTHON_BIN = existsSync(resolve(REPO_ROOT, ".venv", "bin", "python3"))
  ? resolve(REPO_ROOT, ".venv", "bin", "python3")
  : process.platform === "win32"
    ? "python"
    : "python3";

function probeEngine(): boolean {
  const probe = spawnSync(PYTHON_BIN, ["-m", "sim_engine", "--version"], {
    cwd: PYTHON_DIR,
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env, PYTHONPATH: PYTHON_DIR },
  });
  // Bun's spawnSync populates `status`, node's populates `exitCode` — accept both.
  const exit = probe.status ?? probe.exitCode;
  return exit === 0 && typeof probe.stdout === "string" && probe.stdout.includes("python-sim-engine");
}
const ENGINE_AVAILABLE = probeEngine();

interface EngineCase {
  case_id: string;
  seed: number;
  iterations: number;
  inputs_hash: string;
  npv: { p05: number; p50: number; p95: number; mean: number; std: number; base: number };
  irr: number | null;
  payback_discounted_years: number | null;
  bep_year: number | null;
  bep_volume: number | null;
  device: { device: string; backend: string; precision: string; build: string };
  warnings: string[];
}

interface EngineResult {
  engine: string;
  version: string;
  device: { device: string; backend: string; precision: string; reason: string; warnings: string[] };
  cases: EngineCase[];
}

function runEngine(job: unknown, timeoutMs = 120_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const proc = spawn(PYTHON_BIN, ["-m", "sim_engine"], {
      cwd: PYTHON_DIR,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONPATH: PYTHON_DIR },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
    proc.stdin.write(JSON.stringify(job));
    proc.stdin.end();
  });
}

// Independent re-implementation of the seed policy (design section 1.3) —
// canonical JSON (sorted keys, compact, integral floats as ints) → sha256 →
// fnv1a32("case_id:" + hex). Deliberately NOT imported from engine code so a
// hashing regression cannot hide.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

function fnv1a32(key: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function expectedSeed(caseId: string, drivers: Record<string, unknown>): number {
  const hex = createHash("sha256").update(canonicalJson(drivers)).digest("hex");
  return fnv1a32(`${caseId}:${hex}`);
}

const CONSTANT_JOB = {
  job_id: "test:constant",
  device: "cpu",
  iterations: 500,
  horizon_years: 5,
  discount_rate: { value: 0.1, subject: "promoter", source: "user" },
  seed_policy: { base: "proj", hash: "fnv1a" },
  cases: [
    {
      case_id: "const:market_forward",
      drivers: {
        revenue_y1: { dist: "constant", value: 250, unit: "KRW_M" },
        revenue_growth: { dist: "constant", value: 0 },
        opex_ratio: { dist: "constant", value: 0.6 },
        capex_ratio: { dist: "constant", value: 0.1 },
        initial_investment: { dist: "constant", value: 100, unit: "KRW_M" },
      },
    },
  ],
};

describe("sim_engine", () => {
  test.skipIf(!ENGINE_AVAILABLE)("CLI --version identifies the engine", () => {
    expect(ENGINE_AVAILABLE).toBe(true);
  });

  test.skipIf(!ENGINE_AVAILABLE)("exit value parity: exit_ev_revenue sells the business at the final year for the same multiple", async () => {
    const exitJob = {
      ...CONSTANT_JOB,
      job_id: "test:exit",
      cases: [
        {
          case_id: "exit:market_forward",
          drivers: {
            ...CONSTANT_JOB.cases[0].drivers,
            exit_ev_revenue: { dist: "constant", value: 3, unit: "multiple" },
          },
        },
      ],
    };
    const { code, stdout, stderr } = await runEngine(exitJob);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const kase = (JSON.parse(stdout) as EngineResult).cases[0];
    // Constant growth 0 → revenue 250 every year; entry 100, FCF 75/yr,
    // exit 250×3 realized at year 5: analytic NPV is exact.
    const annuity = [1, 2, 3, 4, 5].reduce((acc, t) => acc + 1 / 1.1 ** t, 0);
    const expectedNpv = -100 + 75 * annuity + (250 * 3) / 1.1 ** 5;
    expect(kase.npv.base).toBeCloseTo(expectedNpv, 6);
    expect(kase.npv.std).toBeLessThan(1e-9);
    expect(kase.npv.p05).toBe(kase.npv.p50);
    expect(kase.npv.p50).toBe(kase.npv.p95);
    expect(kase.irr).not.toBeNull(); // the exit inflow keeps IRR defined
    // Absent the driver, the same job must reproduce the legacy number
    // exactly — the exit driver is purely additive (0 default).
    const legacy = await runEngine(CONSTANT_JOB);
    const legacyCase = (JSON.parse(legacy.stdout) as EngineResult).cases[0];
    const noExitNpv = -100 + 75 * annuity;
    expect(legacyCase.npv.base).toBeCloseTo(noExitNpv, 6);
  });

  test.skipIf(!ENGINE_AVAILABLE)("closed-form parity: constant drivers reproduce the analytic NPV/payback and std=0", async () => {
    const { code, stdout, stderr } = await runEngine(CONSTANT_JOB);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as EngineResult;
    const kase = result.cases[0];

    // NPV = -100 + 75 x 5y annuity @10% = 184.30900...
    const annuity = [1, 2, 3, 4, 5].reduce((acc, t) => acc + 1 / 1.1 ** t, 0);
    const expectedNpv = -100 + 75 * annuity;
    expect(kase.npv.base).toBeCloseTo(expectedNpv, 6);
    // Degenerate distribution: every iteration is the same value, so the
    // spread is float-rounding noise only (mean's own ulp), never model noise.
    expect(kase.npv.std).toBeLessThan(1e-9);
    expect(kase.npv.p05).toBe(kase.npv.p50);
    expect(kase.npv.p50).toBe(kase.npv.p95);

    // Discounted payback: cumulative crosses zero during year 2 at 1.51337.
    expect(kase.payback_discounted_years).toBeCloseTo(1 + 31.8181818 / 61.9834711, 5);
    expect(kase.bep_year).toBe(kase.payback_discounted_years);
    expect(kase.irr).not.toBeNull();
    expect(kase.irr!).toBeGreaterThan(0.65);
    expect(kase.irr!).toBeLessThan(0.75);
    expect(result.device.device).toBe("cpu");
  });

  test.skipIf(!ENGINE_AVAILABLE)("seeded determinism: identical job-spec reproduces an identical result", async () => {
    const noisyJob = {
      ...CONSTANT_JOB,
      job_id: "test:noise",
      cases: [
        {
          case_id: "noise:market_forward",
          drivers: {
            ...CONSTANT_JOB.cases[0].drivers,
            revenue_growth: { dist: "normal", mean: 0.05, sigma: 0.02 },
          },
        },
      ],
    };
    const first = await runEngine(noisyJob);
    const second = await runEngine(noisyJob);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const a = JSON.parse(first.stdout) as EngineResult;
    const b = JSON.parse(second.stdout) as EngineResult;
    expect(a.cases[0].seed).toBe(b.cases[0].seed);
    expect(a.cases[0].npv).toEqual(b.cases[0].npv);
    // Noise must actually move the distribution off the deterministic path.
    expect(a.cases[0].npv.std).toBeGreaterThan(0);
  });

  test.skipIf(!ENGINE_AVAILABLE)("seed policy: engine seed equals fnv1a32(case_id + ':' + sha256(canonical drivers))", async () => {
    const { code, stdout } = await runEngine(CONSTANT_JOB);
    expect(code).toBe(0);
    const result = JSON.parse(stdout) as EngineResult;
    const drivers = CONSTANT_JOB.cases[0].drivers;
    expect(result.cases[0].seed).toBe(expectedSeed(CONSTANT_JOB.cases[0].case_id, drivers));
    // A driver change must deterministically change the seed (REQ-W6-4).
    const changedJob = structuredClone(CONSTANT_JOB);
    (changedJob.cases[0].drivers.revenue_y1 as { value: number }).value = 260;
    const changed = await runEngine(changedJob);
    const changedResult = JSON.parse(changed.stdout) as EngineResult;
    expect(changedResult.cases[0].seed).not.toBe(result.cases[0].seed);
    expect(changedResult.cases[0].seed).toBe(expectedSeed(CONSTANT_JOB.cases[0].case_id, changedJob.cases[0].drivers));
  });

  test.skipIf(!ENGINE_AVAILABLE)("BEP volume from unit economics; null with a warning when inputs are partial (REQ-W3-1)", async () => {
    const bepJob = {
      ...CONSTANT_JOB,
      job_id: "test:bep",
      cases: [
        {
          case_id: "bep:market_forward",
          drivers: {
            revenue_y1: { dist: "constant", value: 250 },
            fixed_cost_annual: { dist: "constant", value: 1000, unit: "KRW_M" },
            unit_price: { dist: "constant", value: 12, unit: "KRW" },
            unit_variable_cost: { dist: "constant", value: 7, unit: "KRW" },
          },
        },
      ],
    };
    const result = JSON.parse((await runEngine(bepJob)).stdout) as EngineResult;
    expect(result.cases[0].bep_volume).toBe(200);

    const partialJob = structuredClone(bepJob);
    delete (partialJob.cases[0].drivers as Record<string, unknown>).unit_variable_cost;
    const partial = JSON.parse((await runEngine(partialJob)).stdout) as EngineResult;
    expect(partial.cases[0].bep_volume).toBeNull();
    expect(partial.cases[0].warnings.join(" ")).toContain("bep_volume");
  });

  test.skipIf(!ENGINE_AVAILABLE)("device fallback: an unavailable explicit device degrades to CPU with a recorded warning (REQ-W7-3/4)", async () => {
    const gpuJob = { ...CONSTANT_JOB, job_id: "test:gpu", device: "cuda" };
    const result = JSON.parse((await runEngine(gpuJob)).stdout) as EngineResult;
    expect(result.device.device).toBe("cpu");
    expect(result.device.warnings.join(" ")).toContain("fallback");
    expect(result.cases[0].warnings.join(" ")).toContain("fallback");
  });

  test.skipIf(!ENGINE_AVAILABLE)("case parallelism: parallel multi-case output equals serial single-case output, order preserved", async () => {
    const caseDriver = (revenue: number) => ({
      revenue_y1: { dist: "constant", value: revenue },
      revenue_growth: { dist: "normal", mean: 0.05, sigma: 0.02 },
      opex_ratio: { dist: "constant", value: 0.6 },
      capex_ratio: { dist: "constant", value: 0.1 },
      initial_investment: { dist: "constant", value: 100 },
    });
    const ids = ["base:market_forward", "upside:market_forward", "downside:market_forward"];
    const multiJob = {
      ...CONSTANT_JOB,
      job_id: "test:multi",
      cases: ids.map((case_id, i) => ({ case_id, drivers: caseDriver(200 + 50 * i) })),
    };
    const parallel = JSON.parse((await runEngine(multiJob)).stdout) as EngineResult;
    expect(parallel.cases.map((c) => c.case_id)).toEqual(ids);
    for (let i = 0; i < ids.length; i++) {
      const serialJob = { ...CONSTANT_JOB, job_id: `test:single:${i}`, cases: [multiJob.cases[i]] };
      const serial = JSON.parse((await runEngine(serialJob)).stdout) as EngineResult;
      // Same drivers -> same seed -> same distribution, regardless of pooling.
      expect(serial.cases[0].seed).toBe(parallel.cases[i].seed);
      expect(serial.cases[0].npv).toEqual(parallel.cases[i].npv);
    }
  });

  test.skipIf(!ENGINE_AVAILABLE)("contract violations exit 2 with a precise message, never a stack trace", async () => {
    const badCases = [
      { ...CONSTANT_JOB, cases: [] },
      { ...CONSTANT_JOB, device: "tpu" },
      { ...CONSTANT_JOB, iterations: "many" },
      { ...CONSTANT_JOB, cases: [{ case_id: "x", drivers: { revenue_growth: { dist: "constant" } } }] },
    ];
    for (const bad of badCases) {
      const { code, stderr } = await runEngine(bad);
      expect(code).toBe(2);
      expect(stderr).toContain("invalid job-spec");
      expect(stderr).not.toContain("Traceback");
    }
  });

  test.skipIf(!ENGINE_AVAILABLE)("ramp-up curve multiplies revenue by year and holds its last value (REQ-W1-2)", async () => {
    const rampJob = {
      ...CONSTANT_JOB,
      job_id: "test:ramp",
      iterations: 200,
      cases: [
        {
          case_id: "ramp:market_forward",
          drivers: {
            revenue_y1: { dist: "constant", value: 100 },
            revenue_growth: { dist: "constant", value: 0 },
            opex_ratio: { dist: "constant", value: 0.6 },
            capex_ratio: { dist: "constant", value: 0.1 },
            // No initial investment — every flow is positive, payback = 0.
            ramp_up: { dist: "constant", value: [0.5, 1.0, 1.0] },
          },
        },
      ],
    };
    const { code, stdout, stderr } = await runEngine(rampJob);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const kase = (JSON.parse(stdout) as EngineResult).cases[0];

    // FCF_t = 100 x 0.3 x ramp_t; the 3-year curve holds 1.0 for years 4-5.
    const rate = 0.1;
    const ramp = [0.5, 1.0, 1.0, 1.0, 1.0];
    const expectedNpv = ramp.reduce((acc, u, i) => acc + (100 * 0.3 * u) / (1 + rate) ** (i + 1), 0);
    expect(kase.npv.base).toBeCloseTo(expectedNpv, 6);
    expect(kase.npv.std).toBeLessThan(1e-9);
    // First flow is positive with no year-0 outflow — immediate break-even.
    expect(kase.payback_discounted_years).toBe(0);
  });
});

// -- ADR-0181 slice 4 — the FX risk INDEX driver (환 리스크) ---------------------
describe("sim_engine fx_index (ADR-0181 slice 4)", () => {
  const BASE_DRIVERS = {
    revenue_y1: { dist: "constant", value: 250, unit: "KRW_M" },
    revenue_growth: { dist: "constant", value: 0 },
    opex_ratio: { dist: "constant", value: 0.6 },
    capex_ratio: { dist: "constant", value: 0.1 },
    initial_investment: { dist: "constant", value: 100, unit: "KRW_M" },
  };
  function fxJob(fxDriver: Record<string, unknown> | null, caseId: string) {
    return {
      job_id: `test:${caseId}`,
      device: "cpu",
      iterations: 500,
      horizon_years: 5,
      discount_rate: { value: 0.1, subject: "promoter", source: "user" },
      seed_policy: { base: "proj", hash: "fnv1a" },
      cases: [
        {
          case_id: caseId,
          drivers: fxDriver ? { ...BASE_DRIVERS, fx_index: fxDriver } : { ...BASE_DRIVERS },
        },
      ],
    };
  }

  test.skipIf(!ENGINE_AVAILABLE)("fx_index ≡ 1.0 (constant) leaves the result EXACTLY unchanged (no double conversion)", async () => {
    const base = await runEngine(fxJob(null, "fxbase:market_forward"));
    expect(base.code).toBe(0);
    const withFx = await runEngine(fxJob({ dist: "constant", value: 1.0, unit: "index" }, "fxc1:market_forward"));
    expect(withFx.code).toBe(0);
    const baseCase = (JSON.parse(base.stdout).cases as EngineCase[])[0];
    const fxCases = (JSON.parse(withFx.stdout).cases as EngineCase[])[0];
    // The level rate lives ONLY in the deterministic KRW conversion upstream —
    // an index of exactly 1.0 must not move a single quantile.
    expect(fxCases.npv.p50).toBeCloseTo(baseCase.npv.p50, 9);
    expect(fxCases.npv.p05).toBeCloseTo(baseCase.npv.p05, 9);
    expect(fxCases.npv.p95).toBeCloseTo(baseCase.npv.p95, 9);
  });

  test.skipIf(!ENGINE_AVAILABLE)("fx_index triangular vol=0 degenerates to the unchanged result; ±10% widens the band", async () => {
    const base = await runEngine(fxJob(null, "fxbase2:market_forward"));
    const degenerate = await runEngine(
      fxJob({ dist: "triangular", low: 1.0, expected: 1.0, high: 1.0, unit: "index" }, "fxdeg:market_forward"),
    );
    expect(base.code).toBe(0);
    expect(degenerate.code).toBe(0);
    const baseCase = (JSON.parse(base.stdout).cases as EngineCase[])[0];
    const degCase = (JSON.parse(degenerate.stdout).cases as EngineCase[])[0];
    expect(degCase.npv.p50).toBeCloseTo(baseCase.npv.p50, 9);
    expect(degCase.npv.std).toBeLessThan(1e-9);

    // ±10% band on a constant-base case: the FX band alone must move the
    // quantiles (p05 < p50 < p95) — the driver is APPLIED, not just parsed.
    const band = await runEngine(
      fxJob({ dist: "triangular", low: 0.9, expected: 1.0, high: 1.1, unit: "index" }, "fxband:market_forward"),
    );
    expect(band.code).toBe(0);
    const bandCase = (JSON.parse(band.stdout).cases as EngineCase[])[0];
    expect(bandCase.npv.p05).toBeLessThan(bandCase.npv.p50);
    expect(bandCase.npv.p50).toBeLessThan(bandCase.npv.p95);
    expect(bandCase.npv.std).toBeGreaterThan(0);
  });
});
