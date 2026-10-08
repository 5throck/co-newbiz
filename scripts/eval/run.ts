#!/usr/bin/env bun
// @version 1.1.0
/**
 * run.ts — `bun run eval`: AI evaluation harness (Wave B-2).
 * Design of record: docs/designs/2026-10-08-wave-b-ai-eval-design.md §4.
 *
 *   bun run eval                      deterministic suites only (rag, kill, antitrust); offline
 *   bun run eval -- --llm             also LLM suites; needs CO_NEWBIZ_EVAL_LLM=1 and a configured provider
 *   bun run eval -- --suite <name>    one suite
 *   bun run eval -- --max-cost-usd 2  hard budget for LLM suites (default 2.00)
 *   bun run eval -- --repeat 3        run each LLM suite k times (variance)
 *   bun run eval -- --no-report       do not write docs/reports/eval/
 *
 * Eval scores are evidence for people, not a pass stamp (design boundary 2).
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCalibrationSuite } from "./calibration.ts";
import { checkThresholds, runDeterministicSuites } from "./deterministic.ts";
import { checkInventory } from "./inventory.ts";
import { BudgetExceeded, LLM_SUITES, RunLedger, metered, promptHashes, realEvalLlm, type EvalLlm, type LlmSuiteName } from "./llm-suites.ts";
import { loadGoldenSet, ROOT, type GoldenSet } from "./loader.ts";
import { meanScore, type SuiteResult } from "./types.ts";

export const DETERMINISTIC_SUITES = ["rag", "kill", "antitrust", "calibration"] as const;
export const DEFAULT_MAX_COST_USD = 2.0;
export const REPORT_DIR = join(ROOT, "docs", "reports", "eval");

export interface EvalOptions {
  llm: boolean;
  suite?: string;
  maxCostUsd: number;
  repeat: number;
  report: boolean;
  runId?: string;
  /** Environment for the opt-in guard (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

export interface ProviderInfo {
  provider: string;
  baseUrlHost: string;
  model: string;
}

export interface EvalRun {
  goldenVersion: string;
  suites: SuiteResult[];
  skipped: string[];
  provider: ProviderInfo;
  promptHashes: Record<string, string>;
  ledger: RunLedger;
  repeat: number;
  thresholdFailures: string[];
  inventoryProblems: string[];
  budgetStop: string | null;
}

export function parseArgs(argv: string[]): EvalOptions {
  const o: EvalOptions = { llm: false, maxCostUsd: DEFAULT_MAX_COST_USD, repeat: 1, report: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--llm") o.llm = true;
    else if (a === "--no-report") o.report = false;
    else if (a === "--suite") o.suite = argv[++i];
    else if (a === "--run-id") o.runId = argv[++i];
    else if (a === "--max-cost-usd") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--max-cost-usd needs a positive number");
      o.maxCostUsd = n;
    } else if (a === "--repeat") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error("--repeat needs a positive integer");
      o.repeat = n;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

/** Average repeated runs of one LLM suite; spread metric exposes run-to-run variance. */
function mergeRepeats(runs: SuiteResult[]): SuiteResult {
  if (runs.length === 1) return runs[0];
  const byCase = new Map<string, number[]>();
  for (const r of runs) for (const c of r.cases) byCase.set(`${c.caseId}|${c.fn}`, [...(byCase.get(`${c.caseId}|${c.fn}`) ?? []), c.score ?? 0]);
  const first = runs[0];
  let spread = 0;
  const cases = first.cases.map((c) => {
    const s = byCase.get(`${c.caseId}|${c.fn}`) ?? [c.score ?? 0];
    spread = Math.max(spread, Math.max(...s) - Math.min(...s));
    const failures = [...new Set(runs.flatMap((r) => r.cases.filter((x) => x.caseId === c.caseId && x.fn === c.fn).flatMap((x) => x.failures)))];
    return { ...c, score: s.reduce((a, b) => a + b, 0) / s.length, failures };
  });
  const rate = runs.reduce((a, r) => a + (r.metrics.schema_valid_rate ?? 0), 0) / runs.length;
  return { ...first, cases, metrics: { ...first.metrics, schema_valid_rate: rate, max_score_spread: spread } };
}

export async function runEval(
  opts: EvalOptions,
  deps: { set?: GoldenSet; llm?: EvalLlm; provider?: () => ProviderInfo | null } = {},
): Promise<EvalRun> {
  const set = deps.set ?? loadGoldenSet();
  const env = opts.env ?? process.env;
  const known = new Set<string>([...DETERMINISTIC_SUITES, ...Object.keys(LLM_SUITES)]);
  if (opts.suite && !known.has(opts.suite)) throw new Error(`unknown suite "${opts.suite}"; known: ${[...known].join(", ")}`);
  const wantsLlmSuite = opts.suite !== undefined && opts.suite in LLM_SUITES;
  if (wantsLlmSuite && !opts.llm) throw new Error(`suite "${opts.suite}" calls an LLM; pass --llm (and set CO_NEWBIZ_EVAL_LLM=1)`);
  if (opts.llm && env.CO_NEWBIZ_EVAL_LLM !== "1") throw new Error("--llm refused: set CO_NEWBIZ_EVAL_LLM=1 to confirm that this run may spend provider budget");

  const detAll = [...runDeterministicSuites(set), runCalibrationSuite(set)];
  const suites: SuiteResult[] = detAll.filter((s) => !opts.suite || s.name === opts.suite);
  const skipped: string[] = [];
  const ledger = new RunLedger(opts.maxCostUsd);
  let provider: ProviderInfo = { provider: "none (offline, deterministic suites only)", baseUrlHost: "-", model: "-" };
  let budgetStop: string | null = null;

  const llmNames = (Object.keys(LLM_SUITES) as LlmSuiteName[]).filter((n) => !opts.suite || n === opts.suite);
  if (!opts.llm) {
    if (!opts.suite) skipped.push(...llmNames.map((n) => `${n} (LLM suites skipped: pass --llm with CO_NEWBIZ_EVAL_LLM=1 and a configured provider)`));
  } else {
    const info = (deps.provider ?? defaultProvider)();
    if (!info) throw new Error("--llm needs a configured provider (CO_NEWBIZ_LLM_PROVIDER / _API_KEY / _MODEL)");
    provider = info;
    const llm = metered(deps.llm ?? realEvalLlm, ledger);
    for (const name of llmNames) {
      if (budgetStop) {
        skipped.push(`${name} (not run: ${budgetStop})`);
        continue;
      }
      try {
        const runs: SuiteResult[] = [];
        for (let k = 0; k < opts.repeat; k++) runs.push(await LLM_SUITES[name](set, llm));
        suites.push(mergeRepeats(runs));
      } catch (err) {
        if (!(err instanceof BudgetExceeded)) throw err;
        budgetStop = err.message;
        skipped.push(`${name} (stopped mid-suite: ${err.message})`);
      }
    }
  }

  return {
    goldenVersion: set.version,
    suites,
    skipped,
    provider,
    promptHashes: promptHashes(),
    ledger,
    repeat: opts.repeat,
    thresholdFailures: checkThresholds(suites.filter((s) => s.kind === "deterministic")),
    inventoryProblems: checkInventory(),
    budgetStop,
  };
}

function defaultProvider(): ProviderInfo | null {
  // Imported lazily so offline runs never touch provider configuration.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- keep offline path free of env loading
  const { getProviderConfig } = require("../../app/web-next/lib/llm.ts") as typeof import("../../app/web-next/lib/llm.ts");
  const cfg = getProviderConfig();
  if (!cfg) return null;
  let host = "-";
  try {
    host = cfg.baseUrl ? new URL(cfg.baseUrl).host : "-";
  } catch {
    host = "(invalid base url)";
  }
  return { provider: cfg.provider, baseUrlHost: host, model: cfg.model ?? "unknown" };
}

// ── scoreboard ─────────────────────────────────────────────────────────────

const pct = (n: number | null): string => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);

export function renderScoreboard(run: EvalRun, meta: { runId: string; date: string; sha: string }): string {
  const l: string[] = [];
  const llmRan = run.suites.some((s) => s.kind === "llm");
  l.push(`# Eval scoreboard — ${meta.date} — ${meta.runId}`, "");
  l.push("> Evidence for people, not a pass stamp. Scores come from deterministic comparison against the golden set (no LLM judge). Pilot outcomes are public and likely in model training data; that contamination cannot be removed.", "");
  l.push("| Field | Value |", "|---|---|");
  l.push(`| Golden version | ${run.goldenVersion} |`, `| Git SHA | ${meta.sha} |`, `| Provider | ${run.provider.provider} |`, `| Base URL host | ${run.provider.baseUrlHost} |`, `| Model id | ${run.provider.model} |`);
  l.push(`| Temperature | ${llmRan ? "0" : "-"} |`, `| Repeat | ${run.repeat} |`);
  l.push(`| Tokens (input / output / cache-read / cache-write) | ${run.ledger.input} / ${run.ledger.output} / ${run.ledger.cacheRead} / ${run.ledger.cacheWrite} |`);
  l.push(`| Cost (USD) | ${run.ledger.calls === 0 ? "0 (no LLM calls)" : run.ledger.unpriced ? "unknown (model has no price in config/llm-pricing.yaml)" : run.ledger.costUsd.toFixed(4)} |`, `| LLM calls | ${run.ledger.calls} |`, "");
  l.push("## Prompt hashes (SHA-256 of the system prompt)", "", "| Function | Hash |", "|---|---|");
  for (const [k, v] of Object.entries(run.promptHashes)) l.push(`| ${k} | \`${v}\` |`);
  l.push("");
  l.push("## Summary", "", "| Suite | Kind | Cases scored | Mean score | Could not evaluate |", "|---|---|---|---|---|");
  for (const s of run.suites) l.push(`| ${s.name} | ${s.kind} | ${s.cases.length} | ${pct(meanScore(s.cases))} | ${s.couldNotEvaluate.length} |`);
  l.push("");
  for (const s of run.suites) {
    l.push(`## Suite: ${s.name}`, "");
    if (s.detail) l.push(...s.detail, "");
    else {
      const extra = Object.entries(s.metrics).map(([k, v]) => `${k} ${pct(v)}`);
      if (extra.length) l.push(`Metrics: ${extra.join(", ")}`, "");
    }
    l.push("| Case | Stage | Function | Score | Failures |", "|---|---|---|---|---|");
    for (const c of s.cases) l.push(`| ${c.caseId} | ${c.stage} | ${c.fn} | ${pct(c.score)} | ${c.failures.length ? c.failures.join("; ").replace(/\|/g, "/") : "-"} |`);
    l.push("");
  }
  l.push("## Could not evaluate", "");
  const cne = run.suites.flatMap((s) => s.couldNotEvaluate.map((c) => ({ suite: s.name, ...c })));
  if (cne.length === 0) l.push("None.");
  else {
    l.push("These expectations were NOT scored (neither pass nor fail): the fixture does not carry the structured input the engine needs.", "", "| Suite | Case | Function | Reason |", "|---|---|---|---|");
    for (const c of cne) l.push(`| ${c.suite} | ${c.caseId} | ${c.fn} | ${c.reason.replace(/\|/g, "/")} |`);
  }
  l.push("");
  if (run.skipped.length) l.push("## Skipped", "", ...run.skipped.map((s) => `- ${s}`), "");
  l.push("## Gates", "", run.thresholdFailures.length ? `Threshold regressions: ${run.thresholdFailures.join("; ")}` : "Deterministic thresholds: held.", "", run.inventoryProblems.length ? `Call-site inventory problems: ${run.inventoryProblems.length}` : "LLM call-site inventory: complete.", "");
  return l.join("\n");
}

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export function writeReport(run: EvalRun, runId: string, now: Date = new Date()): { md: string; json: string } {
  const date = now.toISOString().slice(0, 10);
  mkdirSync(REPORT_DIR, { recursive: true });
  const base = join(REPORT_DIR, `${date}-${runId}`);
  const meta = { runId, date, sha: gitSha() };
  writeFileSync(`${base}.md`, renderScoreboard(run, meta));
  const { ledger, ...rest } = run;
  writeFileSync(`${base}.json`, JSON.stringify({ meta, ...rest, usage: { input: ledger.input, output: ledger.output, cacheRead: ledger.cacheRead, cacheWrite: ledger.cacheWrite, costUsd: ledger.unpriced ? null : ledger.costUsd, calls: ledger.calls } }, null, 2) + "\n");
  return { md: `${base}.md`, json: `${base}.json` };
}

if (import.meta.main) {
  (async () => {
    const opts = parseArgs(process.argv.slice(2));
    const run = await runEval(opts);
    for (const s of run.suites) console.log(`${s.name.padEnd(14)} ${s.kind.padEnd(14)} cases=${s.cases.length} mean=${pct(meanScore(s.cases))} could-not-evaluate=${s.couldNotEvaluate.length}`);
    const cal = run.suites.find((s) => s.name === "calibration");
    if (cal) console.log(`calibration    n_engine=${cal.metrics.n_engine} n_reference=${cal.metrics.n_reference} brier_reference=${cal.metrics.brier_reference?.toFixed(3) ?? "n/a"} (insufficient for weight changes)`);
    for (const k of run.skipped) console.log(`skipped: ${k}`);
    if (opts.report) {
      const id = opts.runId ?? `${run.provider.model === "-" ? "offline" : "llm"}-${Date.now().toString(36)}`;
      console.log(`scoreboard: ${writeReport(run, id).md}`);
    }
    const problems = [...run.thresholdFailures, ...run.inventoryProblems];
    if (problems.length) {
      console.error(`eval gates FAILED:\n- ${problems.join("\n- ")}`);
      process.exit(1);
    }
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
