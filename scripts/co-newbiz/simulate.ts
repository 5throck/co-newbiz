#!/usr/bin/env bun
// @version 1.0.0
/**
 * simulate — runs python/monte_carlo.py against a scenario JSON. Design
 * v1.0 section 4-6 (ADR-0026), section 4-8 (CLI command), section 12
 * verification item 13 (seeded determinism).
 *
 * Subprocess-safety pattern reused from fin-analyze.ts / co-consult's
 * financial-pipeline.ts:36-60 (winQuote()/shell:true-on-Windows-only).
 *
 * Usage:
 *   bun scripts/co-newbiz/simulate.ts <scenario-json-path>
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

function winQuote(path: string): string {
  return process.platform === "win32" ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function runPythonScript(scriptName: string, args: string[]): Promise<string> {
  return new Promise((resolveFn, reject) => {
    const scriptDir = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const scriptPath = resolve(scriptDir, "..", "..", "python", scriptName);
    const pythonBin = process.platform === "win32" ? "python" : "python3";
    const quotedArgs = args.map(winQuote);
    const proc = spawn(pythonBin, [scriptPath, ...quotedArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${scriptName} exited with code ${code}: ${stderr}`));
      } else {
        resolveFn(stdout);
      }
    });
  });
}

export interface SimulationResult {
  seed: number;
  iterations: number;
  base_npv: number;
  p05: number;
  p50: number;
  p95: number;
  mean: number;
  std: number;
}

export async function runSimulation(scenarioPath: string): Promise<SimulationResult> {
  const absPath = resolve(scenarioPath);
  if (!existsSync(absPath)) {
    throw new Error(`Scenario file not found: ${absPath}`);
  }
  const stdout = await runPythonScript("monte_carlo.py", [absPath]);
  return JSON.parse(stdout);
}

if (import.meta.main) {
  const [scenarioPath] = process.argv.slice(2);
  if (!scenarioPath) {
    console.error("Usage: bun scripts/co-newbiz/simulate.ts <scenario-json-path>");
    process.exit(1);
  }
  try {
    const result = await runSimulation(scenarioPath);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`simulate failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
