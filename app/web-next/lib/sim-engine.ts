// sim-engine — client for the standalone Monte Carlo engine
// (python/sim_engine/, spec 2026-09-18-s8-business-case-evaluation sections
// 1.2/1.4). Generic by design: this module knows the JSON contract and the
// subprocess mechanics, nothing about S8 — job-spec building lives with the
// model that owns the constants (business-case-generator.ts).
//
// Execution policy (design section 1):
// - the engine is OPTIONAL. A cached probe checks `python3 -m sim_engine
//   --version` once; any failure means the caller silently falls back to the
//   legacy in-process simulator and the fallback is stamped into the note.
// - CO_NEWBIZ_SIM_ENGINE=off is the ops/test kill switch ( skips the probe).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PYTHON_DIR = resolve(REPO_ROOT, "python");
const ENGINE_TIMEOUT_MS = 120_000;

export interface EngineDevice {
  device: string;
  backend: string;
  precision: string;
  build?: string;
  reason?: string;
  warnings?: string[];
}

export interface EngineCaseResult {
  case_id: string;
  seed: number;
  iterations: number;
  inputs_hash: string;
  npv: { p05: number; p50: number; p95: number; mean: number; std: number; base: number };
  irr: number | null;
  payback_discounted_years: number | null;
  bep_year: number | null;
  bep_volume: number | null;
  device: EngineDevice;
  warnings: string[];
  inputs_echo: unknown;
  elapsed_ms: number;
}

export interface EngineJobResult {
  job_id: string;
  engine: string;
  version: string;
  device: EngineDevice;
  cases: EngineCaseResult[];
  elapsed_ms: number;
}

export function engineKillSwitchOff(): boolean {
  return process.env.CO_NEWBIZ_SIM_ENGINE === "off";
}

function pythonBin(): string {
  const venvPython = resolve(REPO_ROOT, ".venv", "bin", "python3");
  if (existsSync(venvPython)) return venvPython;
  return process.platform === "win32" ? "python" : "python3";
}

let availabilityProbe: Promise<string | null> | null = null;

/** Resolves to the engine version string, or null when unavailable. Cached —
 *  one probe per process; resetSimEngineProbe() re-arms it (tests only). */
export function probeSimEngine(): Promise<string | null> {
  if (!availabilityProbe) {
    availabilityProbe = (async () => {
      try {
        const stdout = await spawnEngine(["--version"], 10_000);
        const parsed = JSON.parse(stdout) as { engine?: string; version?: string };
        return parsed.engine === "python-sim-engine" && parsed.version ? parsed.version : null;
      } catch {
        return null;
      }
    })();
  }
  return availabilityProbe;
}

export function resetSimEngineProbe(): void {
  availabilityProbe = null;
}

function spawnEngine(args: string[], timeoutMs: number, stdinPayload?: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(pythonBin(), ["-m", "sim_engine", ...args], {
      cwd: PYTHON_DIR,
      stdio: [stdinPayload !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONPATH: PYTHON_DIR },
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      rejectPromise(new Error(`sim_engine timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) rejectPromise(new Error(`sim_engine exited with code ${code}: ${stderr.trim()}`));
      else resolvePromise(stdout);
    });
    if (stdinPayload !== undefined) {
      proc.stdin.write(stdinPayload);
      proc.stdin.end();
    }
  });
}

/** Run one job-spec through the engine. Returns null on ANY failure — the
 *  caller decides the fallback; the engine is an accelerator, not a dep. */
export async function runSimJob(jobSpec: Record<string, unknown>): Promise<EngineJobResult | null> {
  if (engineKillSwitchOff()) return null;
  const version = await probeSimEngine();
  if (version === null) return null;
  try {
    const stdout = await spawnEngine([], ENGINE_TIMEOUT_MS, JSON.stringify(jobSpec));
    const result = JSON.parse(stdout) as EngineJobResult;
    if (result.engine !== "python-sim-engine" || !Array.isArray(result.cases) || result.cases.length === 0) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}
