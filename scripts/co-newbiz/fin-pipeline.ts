#!/usr/bin/env bun
// @version 1.0.0
/**
 * fin:pipeline — full DART-JSON -> validate -> normalize -> KPI pipeline,
 * design v1.0 §4-4 ("DART 수집 → 회계 정합성 검증 → IFRS 캐노니컬 정규화 →
 * KPI"). Reuses python/{validate,normalize}.py verbatim from co-consult
 * (Projects/co-consult/python/{validate,normalize}.py) plus the
 * already-ported python/kpi.py (see fin-analyze.ts).
 *
 * Subprocess-safety pattern reused from fin-analyze.ts / co-consult's
 * financial-pipeline.ts:36-60.
 *
 * Usage:
 *   bun scripts/co-newbiz/fin-pipeline.ts <dart-json-path>
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
      // validate.py/normalize.py print an error JSON AND exit 1 on bad
      // input — still resolve with stdout in that case so the caller can
      // inspect the error payload, rather than only getting a bare Error.
      if (code !== 0 && stdout.trim() === "") {
        reject(new Error(`${scriptName} exited with code ${code}: ${stderr}`));
      } else {
        resolveFn(stdout);
      }
    });
  });
}

export interface PipelineResult {
  validation: unknown;
  canonicalModel: unknown;
  kpiReport: unknown;
}

export async function runFullPipeline(dartJsonPath: string): Promise<PipelineResult> {
  const absPath = resolve(dartJsonPath);
  if (!existsSync(absPath)) {
    throw new Error(`DART JSON file not found: ${absPath}`);
  }

  const validationStdout = await runPythonScript("validate.py", [absPath]);
  const validation = JSON.parse(validationStdout);

  const normalizeStdout = await runPythonScript("normalize.py", [absPath]);
  const canonicalModel = JSON.parse(normalizeStdout);

  // kpi.py reads a file path, not stdin — write the canonical model to a
  // temp file next to the source so the existing single-purpose script
  // doesn't need a stdin-reading mode added just for this orchestrator.
  const tmpPath = absPath.replace(/\.json$/, ".canonical-model.tmp.json");
  await Bun.write(tmpPath, normalizeStdout);
  try {
    const kpiStdout = await runPythonScript("kpi.py", [tmpPath]);
    const kpiReport = JSON.parse(kpiStdout);
    return { validation, canonicalModel, kpiReport };
  } finally {
    await Bun.file(tmpPath)
      .exists()
      .then((exists) => exists && Bun.write(tmpPath, "")); // best-effort clear; unlink below
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tmpPath);
    } catch {
      // non-fatal — a leftover temp file is not a pipeline failure
    }
  }
}

if (import.meta.main) {
  const [dartPath] = process.argv.slice(2);
  if (!dartPath) {
    console.error("Usage: bun scripts/co-newbiz/fin-pipeline.ts <dart-json-path>");
    process.exit(1);
  }
  try {
    const result = await runFullPipeline(dartPath);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`fin:pipeline failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
