#!/usr/bin/env bun
// @version 1.0.0
/**
 * hwp-extract — legacy HWP 5.0 text extraction wrapper.
 * Spawns python/extract_hwp.py with an args array (shell:false) and either
 * writes the extracted text to --output or returns it to callers/tests.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

export interface HwpExtractOptions { input: string; output?: string; timeoutMs?: number }

const PYTHON_BIN = process.platform === "win32" ? "python" : "python3";
const SCRIPT = resolve(dirname(import.meta.path), "..", "..", "python", "extract_hwp.py");

export function extractHwpText(opts: HwpExtractOptions): Promise<string> {
  const input = resolve(opts.input);
  if (!existsSync(input)) return Promise.reject(new Error(`HWP file not found: ${input}`));
  return new Promise((resolveFn, reject) => {
    const proc = spawn(PYTHON_BIN, [SCRIPT, input], { stdio: ["ignore", "pipe", "pipe"], shell: false, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, opts.timeoutMs ?? 60_000);
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`hwp-extract timed out after ${opts.timeoutMs ?? 60_000}ms`));
      if (code !== 0) return reject(new Error(`python/extract_hwp.py exited with code ${code}: ${stderr.trim()}`));
      if (opts.output) {
        const output = resolve(opts.output);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, stdout, "utf8");
      }
      resolveFn(stdout);
    });
  });
}

function usage(): never {
  console.error("Usage: bun scripts/co-newbiz/hwp-extract.ts <path-to.hwp> [--output <output-path>]");
  process.exit(1);
}

export async function runHwpExtractCommand(args: string[]): Promise<void> {
  const input = args.find((a, i) => i === 0 && !a.startsWith("--"));
  const outputIdx = args.indexOf("--output");
  if (!input) usage();
  const text = await extractHwpText({ input, output: outputIdx >= 0 ? args[outputIdx + 1] : undefined });
  if (outputIdx < 0) process.stdout.write(text);
  else console.log(`Extracted HWP text saved to: ${resolve(args[outputIdx + 1])}`);
}

if (import.meta.main) {
  runHwpExtractCommand(process.argv.slice(2)).catch((err) => {
    console.error(`hwp-extract failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
