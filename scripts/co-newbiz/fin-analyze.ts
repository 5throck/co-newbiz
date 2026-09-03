#!/usr/bin/env bun
// @version 1.0.0
/**
 * fin:analyze — runs python/kpi.py against a canonical financial model JSON
 * and prints the KPI report. Design v1.0 section 4-4 (financial-statement-
 * analysis pipeline, reused from co-consult) and section 4-8 (CLI command).
 *
 * Subprocess-safety pattern reused verbatim from
 * Projects/co-consult/scripts/co-consult/financial-pipeline.ts:36-60 —
 * Windows requires shell:true for AppExecutionAlias stub resolution, which
 * in turn requires quoting path arguments against shell-injection (Bun
 * strips backslashes from spawn args before shell:true forwards them to
 * cmd.exe, so an unescaped path with shell metacharacters is a real risk,
 * not a theoretical one).
 *
 * Usage:
 *   bun scripts/co-newbiz/fin-analyze.ts <canonical-model-json-path>
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";

/**
 * Quote a path argument for safe interpolation into the Windows shell.
 * No-op on non-Windows platforms where shell:false is used.
 */
function winQuote(path: string): string {
  return process.platform === "win32" ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function runPythonScript(scriptName: string, args: string[]): Promise<string> {
  return new Promise((resolveFn, reject) => {
    const scriptDir = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const scriptPath = resolve(scriptDir, "..", "..", "python", scriptName);
    const pythonBin = existsSync(resolve(scriptDir, "..", "..", ".venv", "bin", "python3"))
      ? resolve(scriptDir, "..", "..", ".venv", "bin", "python3")
      : process.platform === "win32"
        ? "python"
        : "python3"; // venv preferred (python/requirements.txt); PEP 668 systems lack deps
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

export async function computeKpis(canonicalModelPath: string): Promise<unknown> {
  const absPath = resolve(canonicalModelPath);
  if (!existsSync(absPath)) {
    throw new Error(`Canonical model file not found: ${absPath}`);
  }
  const stdout = await runPythonScript("kpi.py", [absPath]);
  return JSON.parse(stdout);
}

if (import.meta.main) {
  const [modelPath] = process.argv.slice(2);
  if (!modelPath) {
    console.error("Usage: bun scripts/co-newbiz/fin-analyze.ts <canonical-model-json-path>");
    process.exit(1);
  }
  try {
    const report = await computeKpis(modelPath);
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(`fin:analyze failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
