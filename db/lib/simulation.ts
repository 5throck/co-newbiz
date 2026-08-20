// @version 1.0.0
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
 * (contiguous from 1) feed discount_rate / base_cash_flows; every other
 * run_input key (run.wacc etc.) is versioned but ignored here — it belongs
 * to the valuation engine that does not exist yet. contingent_liability
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
 * simulation_draw stays empty ON PURPOSE: monte_carlo.py emits a quantile
 * summary only, no per-iteration draws, so there is nothing to archive —
 * retention_policy's contract is "draws may be purged after N months,
 * quantiles in simulation_result never are" (migration 0005 header).
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";

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
}

const ENGINE_TIMEOUT_MS = 120_000;
const MAX_ITERATIONS = 100_000;

const PYTHON_BIN = process.platform === "win32" ? "python" : "python3";
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
  const discountRate = inputs.get("sim.discount_rate");
  if (discountRate === undefined || !Number.isFinite(discountRate) || discountRate <= -1) {
    throw new SimulationInputError(
      "run_input key 'sim.discount_rate' is required (a finite rate > -1) before a simulation can run.",
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
      amount_low: cl.amount_low,
      amount_expected: cl.amount_expected,
      amount_high: cl.amount_high,
      timing_year: cl.expected_timing_year,
    })),
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

  const summary: EngineOutput = {
    seed,
    iterations,
    base_npv: requireFinite(output, "base_npv"),
    p05: requireFinite(output, "p05"),
    p50: requireFinite(output, "p50"),
    p95: requireFinite(output, "p95"),
    mean: requireFinite(output, "mean"),
    std: requireFinite(output, "std"),
  };

  const simulationId = ulid();
  const now = opts.now ?? new Date().toISOString();
  db.transaction(() => {
    db.run(
      "INSERT INTO simulation (id, run_id, seed, iterations, discount_rate, created_at) VALUES (?,?,?,?,?,?)",
      [simulationId, runId, seed, iterations, discountRate, now],
    );
    db.run(
      "INSERT INTO simulation_result (simulation_id, metric, p05, p50, p95, mean, std) VALUES (?,?,?,?,?,?,?)",
      [simulationId, "npv", summary.p05, summary.p50, summary.p95, summary.mean, summary.std],
    );
  })();

  return {
    simulation_id: simulationId,
    run_id: runId,
    project_id: run.project_id,
    seed,
    iterations,
    discount_rate: discountRate,
    ...summary,
    contingent_liability_count: liabilities.length,
  };
}
