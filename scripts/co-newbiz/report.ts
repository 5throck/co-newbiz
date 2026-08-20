#!/usr/bin/env bun
// @version 1.0.0
/**
 * report — renders a Markdown deliverable to docx / pdf / hwpx through the
 * shared AST (python/report/), with the glossary appendix auto-appended
 * from glossary/*.yaml. Design v1.0 sections 3-3 (glossary tooling
 * integration), 4-8 (document renderer + CLI command).
 *
 * All three renderers consume mdast.parse_markdown() so the formats cannot
 * drift apart in layout structure. The PDF side registers a Korean TTF pair
 * resolved by theme.py (Malgun Gothic on Windows, OFL drop-ins elsewhere).
 *
 * Subprocess-safety pattern reused verbatim from driver-tree.ts /
 * fin-analyze.ts (Windows shell:true + winQuote() argument escaping).
 *
 * Usage:
 *   bun scripts/co-newbiz/report.ts <markdown-path> [--format docx,pdf,hwpx]
 *                                   [--out-dir <dir>] [--no-glossary]
 */

import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { existsSync } from "node:fs";

export type ReportFormat = "docx" | "pdf" | "hwpx";

export interface RenderResult {
  format: ReportFormat;
  output: string;
  headings: number;
  paragraphs: number;
  tables: number;
  bullets: number;
  glossary_terms: number;
  validation?: string;
  font?: string;
  font_source?: string;
}

export interface RenderOptions {
  outDir?: string;
  noGlossary?: boolean;
}

const RENDER_SCRIPTS: Record<ReportFormat, string> = {
  docx: "render_docx.py",
  pdf: "render_pdf.py",
  hwpx: "render_hwpx.py",
};

function winQuote(path: string): string {
  return process.platform === "win32" ? `"${path.replace(/"/g, '\\"')}"` : path;
}

function runPythonRenderer(scriptName: string, args: string[]): Promise<string> {
  return new Promise((resolveFn, reject) => {
    const scriptDir = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const scriptPath = resolve(scriptDir, "..", "..", "python", "report", scriptName);
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
        reject(new Error(`${scriptName} exited with code ${code}: ${stderr || stdout}`));
      } else {
        resolveFn(stdout);
      }
    });
  });
}

export async function renderReport(
  markdownPath: string,
  formats: ReportFormat[],
  options: RenderOptions = {},
): Promise<RenderResult[]> {
  const absInput = resolve(markdownPath);
  if (!existsSync(absInput)) {
    throw new Error(`Markdown file not found: ${absInput}`);
  }
  for (const fmt of formats) {
    if (!(fmt in RENDER_SCRIPTS)) {
      throw new Error(`Unsupported report format: ${fmt} (expected docx | pdf | hwpx)`);
    }
  }

  const outDir = options.outDir ? resolve(options.outDir) : dirname(absInput);
  const baseName = markdownPath.replace(/[\\/]/g, "/").split("/").pop()!.replace(/\.[^.]+$/, "");

  const results: RenderResult[] = [];
  for (const fmt of formats) {
    const outputPath = join(outDir, `${baseName}.${fmt}`);
    const args = [absInput, outputPath];
    if (options.noGlossary) {
      args.push("--no-glossary");
    }
    const stdout = await runPythonRenderer(RENDER_SCRIPTS[fmt], args);
    // The renderer prints exactly one JSON summary line on stdout.
    const jsonLine = stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    if (!jsonLine) {
      throw new Error(`${RENDER_SCRIPTS[fmt]} produced no JSON summary: ${stdout}`);
    }
    results.push(JSON.parse(jsonLine));
  }
  return results;
}

if (import.meta.main) {
  const [markdownPath, ...rest] = process.argv.slice(2);
  if (!markdownPath) {
    console.error("Usage: bun scripts/co-newbiz/report.ts <markdown-path> [--format docx,pdf,hwpx] [--out-dir <dir>] [--no-glossary]");
    process.exit(1);
  }
  const fmtIdx = rest.indexOf("--format");
  const outDirIdx = rest.indexOf("--out-dir");
  const formats = (fmtIdx >= 0 ? rest[fmtIdx + 1] : "docx,pdf,hwpx")
    .split(",")
    .map((s) => s.trim()) as ReportFormat[];
  const outDir = outDirIdx >= 0 ? rest[outDirIdx + 1] : undefined;
  const noGlossary = rest.includes("--no-glossary");

  try {
    const results = await renderReport(markdownPath, formats, { outDir, noGlossary });
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error(`report failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
