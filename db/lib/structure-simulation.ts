// @version 1.0.0
/**
 * Structure-simulation composition + persistence — ADR-0066 Phase C.
 *
 * Composes the engine scenario for a run from:
 *   - the run's drv.* assumptions (driver deltas; missing drivers default to
 *     zero shock with the defaulted set disclosed in meta — these are
 *     scenario INPUTS the user chose to run, not evidence facts);
 *   - chain_node_sensitivity rows (per-node driver elasticities);
 *   - value_chain_link rows (propagation coefficients).
 *
 * Spawns python/structure_sim.py with an args array (never shell, 120s kill
 * timer — the simulation.ts discipline) and persists one
 * structure_simulation_result row per (assessed node × metric) with the
 * caller's scenario label. Unassessed nodes are returned in meta, never
 * persisted as fabricated zeros.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "./ulid.ts";

const ENGINE_SCRIPT = "python/structure_sim.py";
const ENGINE_TIMEOUT_MS = 120_000;

export interface StructureSimulationOptions {
  runId: string;
  projectId: string;
  scenario?: "downside" | "base" | "upside" | "custom";
  seed?: number;
  iterations?: number;
  now?: string;
}

export interface StructureSimResultRow {
  industry_id: string;
  scenario: string;
  metric: string;
  p05: number;
  p50: number;
  p95: number;
}

export interface StructureSimSummary {
  run_id: string;
  project_id: string;
  scenario: string;
  seed: number;
  iterations: number;
  node_count: number;
  results: StructureSimResultRow[];
  unassessed_nodes: string[];
  defaulted_drivers: string[];
}

interface EngineOutput {
  results: Array<{
    industry_id: string;
    demand_delta_pct: { p05: number; p50: number; p95: number };
    margin_delta_pp: { p05: number; p50: number; p95: number };
    unassessed: boolean;
  }>;
  unassessed_nodes: string[];
  seed: number;
  iterations: number;
}

function requireFinite(value: unknown, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`structure-simulation: engine emitted non-finite ${label}`);
  return n;
}

function spawnEngine(scenarioPath: string, timeoutMs: number): Promise<EngineOutput> {
  return new Promise((resolve, reject) => {
    const proc = Bun.spawn(["python", ENGINE_SCRIPT, scenarioPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    void proc.exited.then((code) => {
      clearTimeout(timer);
      return Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(([stdout, stderr]) => {
        if (code !== 0 && stdout.trim() === "") {
          reject(new Error(`structure_sim.py exited with code ${code}: ${stderr}`));
          return;
        }
        resolve(JSON.parse(stdout) as EngineOutput);
      });
    });
  });
}

/** Documented spread rule: sampled triangular ±50% of the recorded delta. */
function band(base: number): { mode: number; low: number; high: number } {
  const spread = Math.abs(base) * 0.5;
  return { mode: base, low: base - spread, high: base + spread };
}

export async function runStructureSimulation(opts: StructureSimulationOptions, db: Database = getDb()): Promise<StructureSimSummary> {
  const run = db.query("SELECT project_id FROM run WHERE id = ?").get(opts.runId) as { project_id: string } | null;
  if (run === null) throw new Error(`structure-simulation: run '${opts.runId}' does not exist`);
  if (run.project_id !== opts.projectId) {
    throw new Error(`structure-simulation: run '${opts.runId}' belongs to project '${run.project_id}', not '${opts.projectId}'`);
  }

  // Driver deltas: the run's OWN input snapshot (drv.* keys recorded via the
  // runs POST `set:` overrides → run_input); absent keys default to zero
  // shock and are DISCLOSED in defaulted_drivers (scenario inputs, not facts).
  const driverRows = db
    .query("SELECT assumption_key, value FROM run_input WHERE run_id = ? AND assumption_key LIKE 'drv.%'")
    .all(opts.runId) as Array<{ assumption_key: string; value: number }>;
  const driverMap = new Map(driverRows.map((r) => [r.assumption_key, r.value]));
  const DRIVER_KEYS = ["drv.rate_bp", "drv.fx_pct", "drv.commodity_pct", "drv.regulation_severity"] as const;
  const drivers: Record<string, { mode: number; low: number; high: number }> = {};
  const defaultedDrivers: string[] = [];
  for (const key of DRIVER_KEYS) {
    const v = driverMap.get(key);
    if (v === undefined) {
      defaultedDrivers.push(key);
      continue;
    }
    drivers[key.slice(4)] = band(v);
  }

  const sensitivities = db
    .query("SELECT industry_id, driver_id, sensitivity FROM chain_node_sensitivity WHERE project_id = ?")
    .all(opts.projectId) as Array<{ industry_id: string; driver_id: string; sensitivity: number }>;
  const driverCodeById = new Map(
    (db.query("SELECT id, code FROM industry_driver").all() as Array<{ id: string; code: string }>).map((r) => [r.id, r.code]),
  );
  const sensByIndustry = new Map<string, Record<string, number>>();
  for (const s of sensitivities) {
    const code = driverCodeById.get(s.driver_id);
    if (!code) continue;
    const key = { rate: "rate", fx: "fx", commodity: "commodity", regulation: "regulation" }[code] ?? code;
    const bucket = sensByIndustry.get(s.industry_id) ?? {};
    bucket[key] = s.sensitivity;
    sensByIndustry.set(s.industry_id, bucket);
  }

  const links = db
    .query("SELECT from_industry_id AS `from`, to_industry_id AS `to`, elasticity, pass_through_rate FROM value_chain_link WHERE project_id = ? ORDER BY id")
    .all(opts.projectId);

  // Nodes = union of sensitivity industries + link endpoint industries.
  const nodeIds = new Set<string>([...sensByIndustry.keys()]);
  for (const l of links as Array<{ from: string; to: string }>) {
    nodeIds.add(l.from);
    nodeIds.add(l.to);
  }
  const nodes = [...nodeIds].sort().map((industry_id) => ({ industry_id, sensitivities: sensByIndustry.get(industry_id) ?? {} }));

  const seed = opts.seed ?? 42;
  const iterations = opts.iterations ?? 5000;
  const scenario = opts.scenario ?? "custom";

  const tempDir = mkdtempSync(join(tmpdir(), "co-newbiz-struct-"));
  let output: EngineOutput;
  try {
    const scenarioPath = join(tempDir, "scenario.json");
    await Bun.write(scenarioPath, JSON.stringify({ seed, iterations, drivers, nodes, links }));
    output = await spawnEngine(scenarioPath, ENGINE_TIMEOUT_MS);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const now = opts.now ?? new Date().toISOString();
  const persisted: StructureSimResultRow[] = [];
  db.transaction(() => {
    for (const r of output.results) {
      if (r.unassessed) continue;
      for (const [metric, q] of [
        ["demand_delta_pct", r.demand_delta_pct],
        ["margin_delta_pp", r.margin_delta_pp],
      ] as const) {
        const p05 = requireFinite(q.p05, `${r.industry_id}/${metric}/p05`);
        const p50 = requireFinite(q.p50, `${r.industry_id}/${metric}/p50`);
        const p95 = requireFinite(q.p95, `${r.industry_id}/${metric}/p95`);
        db.run(
          "INSERT INTO structure_simulation_result (id, run_id, scenario, industry_id, metric, p05, p50, p95, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
          [ulid(), opts.runId, scenario, r.industry_id, metric, p05, p50, p95, now],
        );
        persisted.push({ industry_id: r.industry_id, scenario, metric, p05, p50, p95 });
      }
    }
  })();

  return {
    run_id: opts.runId,
    project_id: opts.projectId,
    scenario,
    seed,
    iterations,
    node_count: nodes.length,
    results: persisted,
    unassessed_nodes: output.unassessed_nodes,
    defaulted_drivers: defaultedDrivers,
  };
}
