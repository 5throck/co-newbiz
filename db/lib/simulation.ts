// @version 1.2.0
/**
 * Simulation orchestrator — the REST-side bridge to python/monte_carlo.py
 * (ADR-0026, design v1.0 §4-6/§4-8, FR-MA-08). The CLI (`newbiz.ts simulate
 * <scenario-json>`) is a pure scenario-file runner: it neither reads run
 * inputs nor persists anything, and the migration 0005 tables had no writer
 * before this module. runSimulationForRun composes the engine scenario from
 * a run's immutable run_input snapshot plus the run's project's
 * contingent_liability rows, spawns the engine, and persists the simulation
 * row and its quantile summary in one transaction.
 *
 * Scenario composition convention (the engine's input contract, monte_carlo.py
 * docstring): run_input keys `sim.discount_rate` and `sim.cf1`..`sim.cfN`
 * (contiguous from 1) feed base_cash_flows; discount_rate resolves from an
 * explicit comparison override, then a user-confirmed `wacc` assumption /
 * run_input, then the legacy `sim.discount_rate` key. contingent_liability
 * columns map 1:1 onto the engine's liability shape (probability,
 * amount_low/expected/high, expected_timing_year -> timing_year).
 *
 * Seed default: parseInt(run.input_hash.slice(0, 8), 16) % 2^31 —
 * deterministic per input set, so the same inputs reproduce the same
 * quantiles even when the caller omits the seed (design §12 verification
 * item 13). An explicit seed always wins and is stored on the simulation
 * row either way.
 *
 * Subprocess safety: the engine is spawned with an ARGS ARRAY and
 * shell:false — never shell:true — so no winQuote() dance is needed
 * (unlike simulate.ts, whose shell-on-Windows path must quote). The
 * scenario JSON lives in a throwaway mkdtemp directory, removed whether
 * the engine succeeds or dies. A timeout kills the child.
 *
 * 1.2.0 — PYTHON_BIN now prefers the repo-root `.venv/bin/python3` on
 * non-Windows platforms (same venv-first discipline as fin-pipeline.ts and
 * calibrate.ts), so the numpy-backed engine spawns with its dependencies in
 * venv-managed environments (CI runners and PEP 668 machines).
 *
 * 1.1.0 — per-iteration draws are now REQUESTED (scenario include_draws)
 * and PERSISTED into simulation_draw (iteration_no 1..N, metric 'npv').
 * The retention contract is unchanged (migration 0005 header): draws may be
 * purged after N months via retention_policy; the quantile summary in
 * simulation_result is never purged. Raw draw ROWS are still never exposed
 * through the API — GET /api/simulations/:id/results serves a server-side
 * histogram/CDF aggregate instead (api.test.ts pins the absence of a raw
 * `draws` property on the response).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";
import { resolveRunWacc } from "./wacc.ts";

/** Caller-fixable input problem — the REST layer maps this to 400. */
export class SimulationInputError extends Error {}

export interface RunSimulationOptions {
  runId: string;
  /** Explicit seed; omitted = deterministic default derived from run.input_hash. */
  seed?: number;
  /** Omitted = the engine's own default (10000). */
  iterations?: number;
  now?: string;
  /** Engine kill deadline, default 120s — a wedged run must not hang the caller. */
  timeoutMs?: number;
  /** Scenario comparison (A3): override the run's sim.discount_rate without
   * touching the stored run inputs. The override is used for THIS simulation
   * only and is recorded via the simulation row's discount_rate column. */
  discountRateOverride?: number;
}

export interface SimulationRunResult {
  simulation_id: string;
  run_id: string;
  project_id: string;
  seed: number;
  iterations: number;
  discount_rate: number;
  base_npv: number;
  p05: number;
  p50: number;
  p95: number;
  mean: number;
  std: number;
  contingent_liability_count: number;
  /** A5: deterministic IRR of the base cash flows (undefined in legacy outputs). */
  irr?: number;
  /** A5: first year cumulative undiscounted cash flow >= 0 (undefined in legacy outputs). */
  payback_year?: number;
}

interface EngineOutput {
  seed: number;
  iterations: number;
  base_npv: number;
  p05: number;
  p50: number;
  p95: number;
  mean: number;
  std: number;
  /** A5: deterministic IRR of the base cash flows (absent in legacy outputs). */
  irr?: number;
  /** A5: first year cumulative undiscounted cash flow >= 0 (absent in legacy outputs). */
  payback_year?: number;
  /** Present only when the scenario asked include_draws (4dp-rounded, deterministic per seed). */
  draws?: number[];
}

const ENGINE_TIMEOUT_MS = 120_000;
const MAX_ITERATIONS = 100_000;

// Same venv-first discipline as fin-pipeline.ts/calibrate.ts: prefer the
// repo-root `.venv` (built from python/requirements.txt) so the numpy-backed
// engine spawns with its dependencies; fall back to the system interpreter.
function resolvePythonBin(): string {
  if (process.platform !== "win32") {
    const venvBin = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".venv", "bin", "python3");
    if (existsSync(venvBin)) return venvBin;
  }
  return process.platform === "win32" ? "python" : "python3";
}
const PYTHON_BIN = resolvePythonBin();
const ENGINE_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "python", "monte_carlo.py");

function requireFinite(output: EngineOutput, field: keyof EngineOutput): number {
  const value = output[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Monte Carlo engine returned a non-numeric ${String(field)}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Spawn the engine with an args array (shell:false — see module doc). */
function runEngine(scenarioPath: string, timeoutMs: number): Promise<EngineOutput> {
  return new Promise((resolveFn, reject) => {
    const proc = spawn(PYTHON_BIN, [ENGINE_SCRIPT, scenarioPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start the Monte Carlo engine (${PYTHON_BIN}): ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Monte Carlo engine timed out after ${timeoutMs}ms and was killed.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`monte_carlo.py exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolveFn(JSON.parse(stdout) as EngineOutput);
      } catch (err) {
        reject(new Error(`Monte Carlo engine stdout was not valid JSON: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  });
}

export async function runSimulationForRun(db: Database, opts: RunSimulationOptions): Promise<SimulationRunResult> {
  const runId = opts.runId.trim();
  const run = db.query("SELECT id, project_id, input_hash FROM run WHERE id = ?").get(runId) as
    | { id: string; project_id: string; input_hash: string }
    | null;
  if (!run) throw new SimulationInputError(`Run '${runId}' not found.`);

  const iterations = opts.iterations ?? 10_000;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new SimulationInputError(`iterations must be an integer between 1 and ${MAX_ITERATIONS}.`);
  }
  const seed =
    opts.seed ??
    (parseInt(run.input_hash.slice(0, 8), 16) % 2_147_483_647); // deterministic per input set — see module doc
  if (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647) {
    throw new SimulationInputError("seed must be an integer between 0 and 2147483647.");
  }

  const inputs = new Map<string, number>();
  for (const row of db
    .query("SELECT assumption_key, value FROM run_input WHERE run_id = ?")
    .all(runId) as { assumption_key: string; value: number }[]) {
    inputs.set(row.assumption_key, row.value);
  }
  const runWacc = resolveRunWacc(db, runId);
  const discountRate = opts.discountRateOverride ?? runWacc?.value ?? inputs.get("sim.discount_rate");
  if (discountRate === undefined || !Number.isFinite(discountRate) || discountRate <= -1) {
    throw new SimulationInputError(
      "a user WACC assumption/run_input key 'wacc' or legacy run_input key 'sim.discount_rate' is required (finite rate > -1) before a simulation can run.",
    );
  }
  const flows = [...inputs.entries()]
    .filter(([key]) => /^sim\.cf(0|[1-9]\d*)$/.test(key))
    .map(([key, value]) => ({ year: Number(key.slice("sim.cf".length)), value }))
    .sort((a, b) => a.year - b.year);
  if (flows.length === 0 || flows.some((f, i) => f.year !== i + 1 || !Number.isFinite(f.value))) {
    throw new SimulationInputError(
      "run_input keys 'sim.cf1'..'sim.cfN' (contiguous from 1, finite values) are required before a simulation can run.",
    );
  }

  // Column names map 1:1 onto the engine's liability shape (ADR-0026).
  // UNIT BOUNDARY (ADR-0061): storage is INTEGER KRW-millions; the engine's
  // contract (and the pinned raw-won rule constants) stay in won, so amounts
  // scale ×1e6 on the way in and quantiles ÷1e6 (rounded to millions) on the
  // way back into simulation_result.
  const SCALE = 1_000_000;
  const liabilities = db
    .query(
      `SELECT probability, amount_low, amount_expected, amount_high, expected_timing_year
       FROM contingent_liability WHERE project_id = ? ORDER BY id`,
    )
    .all(run.project_id) as {
    probability: number;
    amount_low: number;
    amount_expected: number;
    amount_high: number;
    expected_timing_year: number;
  }[];

  const scenario = {
    seed,
    iterations,
    discount_rate: discountRate,
    base_cash_flows: flows.map((f) => f.value),
    contingent_liabilities: liabilities.map((cl) => ({
      probability: cl.probability,
      amount_low: cl.amount_low * SCALE,
      amount_expected: cl.amount_expected * SCALE,
      amount_high: cl.amount_high * SCALE,
      timing_year: cl.expected_timing_year,
    })),
    include_draws: true, // persisted to simulation_draw (retention-purgeable) — see module doc
  };

  const tempDir = mkdtempSync(join(tmpdir(), "co-newbiz-sim-"));
  let output: EngineOutput;
  try {
    const scenarioPath = join(tempDir, "scenario.json");
    writeFileSync(scenarioPath, JSON.stringify(scenario), "utf8");
    output = await runEngine(scenarioPath, opts.timeoutMs ?? ENGINE_TIMEOUT_MS);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  // UNIT BOUNDARY note: only CONTINGENT AMOUNTS are storage-scaled (KRW
  // millions in, won into the engine). Engine OUTPUTS persist verbatim —
  // simulation_result keeps engine-native units per design §12's seeded-
  // reproduction contract (the CLI-parity test pins exact quantiles).
  const summary: EngineOutput = {
    seed,
    iterations,
    base_npv: requireFinite(output, "base_npv"),
    p05: requireFinite(output, "p05"),
    p50: requireFinite(output, "p50"),
    p95: requireFinite(output, "p95"),
    mean: requireFinite(output, "mean"),
    std: requireFinite(output, "std"),
    // A5 extension: deterministic IRR/payback of the base cash flows. Optional
    // — older engine outputs (and pinned fixtures) without them stay valid.
    irr: typeof output.irr === "number" && Number.isFinite(output.irr) ? output.irr : undefined,
    payback_year: typeof output.payback_year === "number" && Number.isInteger(output.payback_year)
      ? output.payback_year
      : undefined,
  };

  const simulationId = ulid();
  const now = opts.now ?? new Date().toISOString();
  // Draws are validated against the summary BEFORE anything is written: a
  // truncated or non-finite draw array means the engine run is corrupt and
  // nothing should persist (the summary alone would silently disagree with
  // the histogram built from the draws).
  const draws = output.draws;
  if (!Array.isArray(draws) || draws.length !== iterations || draws.some((d) => !Number.isFinite(d))) {
    throw new Error(
      `Monte Carlo engine returned an invalid draws array (expected ${iterations} finite values, got ${
        Array.isArray(draws) ? draws.length : String(draws)
      }).`,
    );
  }
  db.transaction(() => {
    db.run(
      "INSERT INTO simulation (id, run_id, seed, iterations, discount_rate, created_at) VALUES (?,?,?,?,?,?)",
      [simulationId, runId, seed, iterations, discountRate, now],
    );
    db.run(
      "INSERT INTO simulation_result (simulation_id, metric, p05, p50, p95, mean, std) VALUES (?,?,?,?,?,?,?)",
      [simulationId, "npv", summary.p05, summary.p50, summary.p95, summary.mean, summary.std],
    );
    const insertDraw = db.query(
      "INSERT INTO simulation_draw (simulation_id, iteration_no, metric, value) VALUES (?,?, 'npv', ?)",
    );
    for (let i = 0; i < draws.length; i++) insertDraw.run(simulationId, i + 1, draws[i]);
  })();

  return {
    simulation_id: simulationId,
    run_id: runId,
    project_id: run.project_id,
    discount_rate: discountRate,
    ...summary,
    contingent_liability_count: liabilities.length,
  };
}
