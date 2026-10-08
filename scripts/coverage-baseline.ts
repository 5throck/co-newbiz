/**
 * coverage-baseline.ts — coverage ratchet over coverage/lcov.info.
 * @version 1.0.0
 *
 * Totals cover non-test source files only (tests/ is excluded so test code
 * does not inflate the numbers). Fails when line or function coverage drops
 * more than TOLERANCE_PP below quality/coverage-baseline.json. Asks for
 * --update when coverage exceeds the baseline by >= BUMP_PP. The baseline only
 * moves up unless --update is used deliberately.
 *
 * Usage:
 *   bun scripts/coverage-baseline.ts [--lcov coverage/lcov.info]
 *   bun scripts/coverage-baseline.ts --update
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BASELINE_PATH = "quality/coverage-baseline.json";
const TOLERANCE_PP = 0.5;
const BUMP_PP = 1.0;

export interface Coverage {
  lines: number;
  functions: number;
}

export function parseLcov(text: string): Coverage {
  let lf = 0;
  let lh = 0;
  let fnf = 0;
  let fnh = 0;
  let skip = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      const file = line.slice(3).replaceAll("\\", "/");
      skip = file.startsWith("tests/") || file.includes("/tests/");
    } else if (skip) {
      continue;
    } else if (line.startsWith("LF:")) lf += Number(line.slice(3));
    else if (line.startsWith("LH:")) lh += Number(line.slice(3));
    else if (line.startsWith("FNF:")) fnf += Number(line.slice(4));
    else if (line.startsWith("FNH:")) fnh += Number(line.slice(4));
  }
  const pct = (hit: number, total: number) => (total === 0 ? 0 : Math.round((hit / total) * 1000) / 10);
  return { lines: pct(lh, lf), functions: pct(fnh, fnf) };
}

export function evaluate(baseline: Coverage, current: Coverage): { failures: string[]; bumpSuggested: boolean } {
  const failures: string[] = [];
  let bumpSuggested = false;
  for (const metric of ["lines", "functions"] as const) {
    const drop = baseline[metric] - current[metric];
    if (drop > TOLERANCE_PP) {
      failures.push(`${metric}: ${current[metric]}% is ${drop.toFixed(1)} pp below baseline ${baseline[metric]}%`);
    }
    if (current[metric] - baseline[metric] >= BUMP_PP) bumpSuggested = true;
  }
  return { failures, bumpSuggested };
}

function main(): number {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const lcovIdx = args.indexOf("--lcov");
  const lcovPath = lcovIdx >= 0 ? args[lcovIdx + 1] : "coverage/lcov.info";

  if (!existsSync(lcovPath)) {
    console.error(`${lcovPath} not found; run: bun run test:coverage`);
    return 1;
  }
  const current = parseLcov(readFileSync(lcovPath, "utf8"));
  console.log(`coverage: lines ${current.lines}%, functions ${current.functions}%`);

  if (update) {
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
    console.log(`coverage baseline written to ${BASELINE_PATH}`);
    return 0;
  }
  if (!existsSync(BASELINE_PATH)) {
    console.error(`${BASELINE_PATH} missing; run: bun scripts/coverage-baseline.ts --update`);
    return 1;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Coverage;
  const { failures, bumpSuggested } = evaluate(baseline, current);
  if (failures.length > 0) {
    console.error("coverage-baseline: regression");
    for (const f of failures) console.error(`  ${f}`);
    return 1;
  }
  if (bumpSuggested) {
    console.log(
      `coverage-baseline: coverage exceeds baseline (${baseline.lines}% / ${baseline.functions}%) by >= ${BUMP_PP} pp; run --update and commit.`,
    );
  }
  console.log("coverage-baseline: OK");
  return 0;
}

if (import.meta.main) process.exit(main());
