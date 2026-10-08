/**
 * typecheck-baseline.ts — ratchet gate for the baselined TypeScript trees.
 * @version 1.0.0
 *
 * Runs `tsc -p tsconfig.json --noEmit` and compares diagnostics, keyed as
 * "file|TSxxxx" -> count (line numbers excluded so unrelated edits do not
 * churn the baseline), against quality/typecheck-baseline.json.
 *
 * Usage:
 *   bun scripts/typecheck-baseline.ts            # check (CI)
 *   bun scripts/typecheck-baseline.ts --update   # rewrite the baseline
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASELINE_PATH = "quality/typecheck-baseline.json";
const DIAGNOSTIC = /^(.+?)\(\d+,\d+\): error (TS\d+):/;

export function parseDiagnostics(output: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of output.split("\n")) {
    const m = DIAGNOSTIC.exec(line);
    if (!m) continue;
    const key = `${m[1].replaceAll("\\", "/")}|${m[2]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function compare(
  baseline: Record<string, number>,
  current: Record<string, number>,
): { regressions: string[]; improvements: string[] } {
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const [key, count] of Object.entries(current)) {
    const allowed = baseline[key] ?? 0;
    if (count > allowed) regressions.push(`${key}: ${allowed} -> ${count}`);
  }
  for (const [key, allowed] of Object.entries(baseline)) {
    const count = current[key] ?? 0;
    if (count < allowed) improvements.push(`${key}: ${allowed} -> ${count}`);
  }
  return { regressions, improvements };
}

function sortKeys(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function main(): Promise<number> {
  const update = process.argv.includes("--update");
  const proc = Bun.spawnSync([process.execPath, "x", "tsc", "-p", "tsconfig.json", "--noEmit", "--pretty", "false"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = proc.stdout.toString() + proc.stderr.toString();
  const current = parseDiagnostics(output);
  const total = Object.values(current).reduce((a, b) => a + b, 0);

  if (proc.exitCode !== 0 && total === 0) {
    console.error("tsc failed without diagnostics:\n" + output);
    return 1;
  }

  if (update) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(sortKeys(current), null, 2) + "\n");
    console.log(`typecheck baseline written: ${total} errors in ${Object.keys(current).length} keys`);
    return 0;
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error(`${BASELINE_PATH} missing; run: bun scripts/typecheck-baseline.ts --update`);
    return 1;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, number>;
  const { regressions, improvements } = compare(baseline, current);

  if (regressions.length > 0) {
    console.error(`typecheck-baseline: ${regressions.length} new/increased error group(s):`);
    for (const r of regressions) console.error(`  ${r}`);
    return 1;
  }
  if (improvements.length > 0) {
    console.log(`typecheck-baseline: ${improvements.length} group(s) improved. Run --update and commit the baseline:`);
    for (const i of improvements) console.log(`  ${i}`);
  }
  console.log(`typecheck-baseline: OK (${total} baselined errors, no new errors)`);
  return 0;
}

if (import.meta.main) process.exit(await main());
