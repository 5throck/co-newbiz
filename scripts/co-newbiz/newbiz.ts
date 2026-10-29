#!/usr/bin/env bun
// @version 1.22.0
/**
 * co-newbiz analysis-engine CLI — design v1.0 §4-8.
 *
 * Usage:
 *   bun scripts/co-newbiz/newbiz.ts <command> [options]
 *
 * Commands implemented so far (Stage 5 Waves 5.1-5.5 + CLI batch):
 *   db:migrate      Apply pending db/migrations/*.sql
 *   status          Print migration status
 *   proc:resolve    Merge a shared procedure with region/entity overrides
 *   fin:analyze     KPI report from a canonical financial model
 *   fin:pipeline    Full DART → canonical-model pipeline
 *   fin:driver-tree 5-level ROIC value driver tree
 *   simulate        Monte-Carlo simulation (contingent liabilities)
 *   rag             Six-dimension RAG assessment from a scenario JSON
 *   watch:run       Monitoring cycle — change detection, auto re-assess, notify
 *   model           Create a versioned run — input snapshot + overrides (v1:
 *                   records inputs only; valuation output arrives with the
 *                   model engine, scripts/co-newbiz/model.ts)
 *   diff            Variable-level bridge between two runs (model.ts)
 *   report          Render Markdown to docx/pdf/hwpx with glossary appendix
 *   hwp-extract     Extract text from a legacy binary .hwp file
 *   scorecard:rollup  Portfolio venture-scorecard rollup as JSON (ADR-0059;
 *                   empty DB is a valid zero point, exit 0)
 *   user:create     Create an account (pending) — password via stdin
 *   user:approve    Approve a pending account
 *   user:list       List accounts (identity columns only, never hashes)
 *   user:reset-password  Admin reset — temp password via stdin, forces change
 *   assume          Register an assumption row — same write path as
 *                   POST /api/assumptions (db/lib/assumption.ts, FR-DATA-07)
 *   glossary:lint   Weekly undefined-term report over skills/ + docs/
 *                   (ADR-0022; report-only, exit 0 — glossary-lint.ts)
 *   adr:new         Scaffold docs/adr/NNNN-<slug>.md from next free number
 *                   (workspace ADR format; refuses a duplicate title)
 *   db:export       SQLite → postgres-dialect schema+data dump (ADR-0002's
 *                   portability verification mechanism; db-export.ts)
 *   graph           Multi-element graph projection over skills/agents/
 *                   procedures/rules/decisions (design 2026-08-24 pilot;
 *                   --check drift-gates, --include-consumes enables the
 *                   suppressed exact-token consumes inference)
 *   context         Contextual bundle over the derived graph
 *                   (--skill <name> | --gate <Gate>)
 *
 *   fetch           Source-adapter data collection — k-dart/k-kosis/k-opendata/
 *                   k-law adapters (source-adapters.ts, design 2026-09-09);
 *                   observation series go through ensure_fresh (ADR-0004),
 *                   catalog sources produce natural-key upserts
 *   md:sync         Master-data catalog sync from the adapters
 *                   (md_company/md_statute/md_source; idempotent)
 *
 *   calibrate       Statistical proxy-hop calibration — python/correlation.py
 *                   (OLS + lead-lag + 95% CI) → proxy_link + single-hop
 *                   proxy_chain (grade B/C per R² eligibility; Wave A2)
 *   convert         Same-dimension unit conversion via md_unit.si_coefficient,
 *                   or proxy-chain conversion with compounded-CI band
 *                   (cross-dimension ad hoc math refused, FR-DATA-03)
 *
 *   policy:sync     Scan the policies/ tree into the policy registry
 *                   (migration 0011) — idempotent by doc_path; an edited
 *                   policy supersedes the old version row (append-mostly)
 *   governance:sync Scan the five governance layers (policies, procedures,
 *                   checklists, guidelines, templates) into the governance_doc
 *                   registry via the committed manifest
 *                   docs/governance/governance-registry.generated.json;
 *                   [--dry-run] plans only, [--check] fails on manifest drift
 *   policy:impact   Reference index for one policy: skills/procedures/
 *                   checklists/docs references + in-flight pinned projects
 *                   (the mechanical core of policy-change-impact-analysis)
 *   fin:project     One project's financial rollup as JSON — business-case
 *                   year-1 nets per scenario, valuation simulation
 *                   percentiles, charter KPI targets (read-only)
 *   wacc:derivation Rebuild the CAPM/WACC derivation — formulas and
 *                   substituted numbers — from a project's persisted `wacc.*`
 *                   component rows (ADR-0115) as markdown for S5/S8
 *                   deliverables (read-only)
 *
 * All documented commands are implemented. glossary ENTRY validation stays
 * at `bun glossary/_validate.ts` (package.json alias glossary:validate).
 * law:sync is served by `fetch --source law`. Unbuilt commands are not
 * stubbed here to avoid a command that silently does nothing.
 */

import { resolve } from "node:path";
import { runMigrations } from "../../db/migrate.ts";
import { getDb } from "../../db/client.ts";
import { resolveProcedure } from "./proc-resolve.ts";
import { computeKpis } from "./fin-analyze.ts";
import { runSimulation } from "./simulate.ts";
import { runFullPipeline } from "./fin-pipeline.ts";
import { computeDriverTree } from "./driver-tree.ts";
import { renderReport, type ReportFormat } from "./report.ts";
import { runHwpExtractCommand } from "./hwp-extract.ts";
import { runScorecardRollup } from "./scorecard-rollup.ts";
import { runRagAssessment } from "./rag.ts";
import { runWatchCycle, loadRescenariosDir } from "./watch-run.ts";
import { runModelCreate, runModelDiff } from "./model.ts";
import { runAssume } from "./assume.ts";
import { ASSUMPTION_KINDS } from "../../db/lib/assumption.ts";
import { lintGlossaryUsage, printGlossaryLintReport } from "./glossary-lint.ts";
import { scaffoldAdr } from "./adr-new.ts";
import { runExportCommand } from "./db-export.ts";
import { runGraphCommand, runContextCommand } from "./graph.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { KOSIS_UNITS } from "./kosis-units.ts";
import {
  createUser,
  approveUser,
  listUsers,
  resetPassword,
} from "../../db/lib/accounts.ts";

const [command, ...args] = process.argv.slice(2);

/**
 * Upsert md_period for a YYYY-MM (month) or YYYY-MM-DD (day) key — the day
 * grain is new with the KRX beta series (ADR-0115), where start=end=the date.
 */
function upsertPeriod(db: ReturnType<typeof getDb>, periodKey: string): string {
  const isDay = /^\d{4}-\d{2}-\d{2}$/.test(periodKey);
  const [y, m] = periodKey.split("-").map(Number);
  const startDate = isDay ? periodKey : `${periodKey}-01`;
  const endDate = isDay ? periodKey : new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  // md_period CHECK allows date|month|quarter|year — the day grain is stored as "date".
  const periodType = isDay ? "date" : "month";
  const found = db
    .query("SELECT id FROM md_period WHERE period_type=? AND start_date=? AND end_date=?")
    .get(periodType, startDate, endDate) as { id: string } | undefined;
  if (found) return found.id;
  const id = ulid();
  db.run("INSERT INTO md_period (id, period_type, start_date, end_date, fiscal_year, created_at) VALUES (?,?,?,?,?,?)",
    [id, periodType, startDate, endDate, y, new Date().toISOString()]);
  return id;
}

/** SHA-256 content hash for a raw KRX row — ensure_fresh's change probe. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function resolveMonthlyPeriods(fromArg: string | undefined, toArg: string | undefined): string[] {
  const ym = /^\d{4}-\d{2}$/;
  const year = new Date().getUTCFullYear();
  const from = fromArg ?? `${year}-01`;
  const to = toArg ?? `${year}-12`;
  if (!ym.test(from) || !ym.test(to)) {
    console.error("fetch: --from/--to must use YYYY-MM.");
    process.exit(2);
  }
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  if (fromMonth < 1 || fromMonth > 12 || toMonth < 1 || toMonth > 12) {
    console.error("fetch: --from/--to months must be 01-12.");
    process.exit(2);
  }
  const start = fromYear * 12 + fromMonth;
  const end = toYear * 12 + toMonth;
  if (start > end) {
    console.error("fetch: --from must be earlier than or equal to --to.");
    process.exit(2);
  }
  const periods: string[] = [];
  for (let cursor = start; cursor <= end; cursor++) {
    const y = Math.floor((cursor - 1) / 12);
    const m = ((cursor - 1) % 12) + 1;
    periods.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return periods;
}

function printUsage(): void {
  console.log("Usage: bun scripts/co-newbiz/newbiz.ts <command>");
  console.log("Commands: db:migrate, status, db:export [--dialect postgres] [--out <file>] [--db-path <path>], proc:resolve --procedure <name> [--entity <code>] [--region <code>] [--json], graph [--check] [--no-consumes], context --skill <name> | --gate <Gate>, fetch --source <dart|ecos|krx|kosis|law|opendata> [--series <id>] [--list] [--from YYYY-MM] [--to YYYY-MM] [--all], md:sync --source <dart|law> [--all], calibrate --from-industry <id> --to-industry <id> --from-series <id> --to-series <id> --from YYYY-MM --to YYYY-MM, convert --value <n> (--from-unit <code> --to-unit <code> | --chain <id>), policy:sync, governance:sync [--dry-run|--check], policy:impact --policy <id-or-doc-path>, fin:project --project <id>, fin:analyze <canonical-model-json-path>, fin:pipeline <dart-json-path>, fin:driver-tree <canonical-model-json-path>, simulate <scenario-json-path>, rag <scenario-json-path> [--db-path <path>], watch:run [--rescenarios-dir <dir>] [--db-path <path>], model --project <id> --label <label> [--from-run <id>] [--set key=value ...] [--db-path <path>], diff <runA> <runB> [--db-path <path>], report <markdown-path> [--format docx,pdf,hwpx] [--out-dir <dir>] [--no-glossary], scorecard:rollup [--review-cycle <YYYY-Qn>] [--db-path <path>], user:create <user-id> --role <admin|analyst|viewer> [--display-name <name>] [--db-path <path>], user:approve <user-id> [--db-path <path>], user:list [--db-path <path>], user:reset-password <user-id> [--db-path <path>], assume --run <id> --key <key> --kind <live|user|derived|assumed> --value <n> [--rationale \"...\"] [--anchor-ref <ref>] [--ttl-days <N>] [--as-of YYYY-MM-DD] [--db-path <path>], wacc:derivation --project <id> [--db-path <path>], glossary:lint [--root <dir>]... [--quiet-known], adr:new --title \"...\" [--status <status>] [--date YYYY-MM-DD] [--dir <dir>]");
}

switch (command) {
  case "db:migrate": {
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    const { applied, skipped } = runMigrations(dbPath);
    console.log(`✅ Applied ${applied.length} migration(s): ${applied.join(", ") || "(none)"}`);
    console.log(`   Skipped ${skipped.length} already-applied migration(s).`);
    break;
  }
  case "status": {
    const db = getDb();
    const rows = db.query("SELECT filename, applied_at FROM schema_migrations ORDER BY filename").all();
    console.log(`Applied migrations (${rows.length}):`);
    for (const r of rows as { filename: string; applied_at: string }[]) {
      console.log(`  ${r.filename} — ${r.applied_at}`);
    }
    break;
  }
  case "proc:resolve": {
    const procedureIdx = args.indexOf("--procedure");
    const entityIdx = args.indexOf("--entity");
    const regionIdx = args.indexOf("--region");
    const jsonMode = args.includes("--json");

    const procedureName = procedureIdx >= 0 ? args[procedureIdx + 1] : undefined;
    if (!procedureName) {
      console.error("proc:resolve requires --procedure <name>");
      process.exit(1);
    }
    const result = resolveProcedure(procedureName, {
      entity: entityIdx >= 0 ? args[entityIdx + 1] : undefined,
      region: regionIdx >= 0 ? args[regionIdx + 1] : undefined,
    });
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Procedure: ${result.procedureKey}`);
      console.log(`Layers applied: ${result.layersApplied.join(" -> ")}`);
      console.log(`\nSteps:`);
      for (const s of result.steps) {
        console.log(`  [${s._source}] ${s.id}. (${s.gate}) ${s.agent_key} / ${s.skill_key} -> ${s.output_type}`);
      }
      if (Object.keys(result.thresholds).length > 0) {
        console.log(`\nThresholds:`);
        for (const [k, v] of Object.entries(result.thresholds)) {
          console.log(`  ${k}: ${v}`);
        }
      }
    }
    break;
  }
  case "fin:analyze": {
    const [modelPath] = args;
    if (!modelPath) {
      console.error("fin:analyze requires a canonical-model JSON path");
      process.exit(1);
    }
    try {
      const report = await computeKpis(modelPath);
      console.log(JSON.stringify(report, null, 2));
    } catch (err) {
      console.error(`fin:analyze failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "simulate": {
    const [scenarioPath] = args;
    if (!scenarioPath) {
      console.error("simulate requires a scenario JSON path");
      process.exit(1);
    }
    try {
      const result = await runSimulation(scenarioPath);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`simulate failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "rag": {
    const [scenarioPath] = args;
    if (!scenarioPath) {
      console.error("rag requires a scenario JSON path");
      process.exit(1);
    }
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    try {
      const result = runRagAssessment(scenarioPath, dbPath);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`rag failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "watch:run": {
    const dirIdx = args.indexOf("--rescenarios-dir");
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    const db = getDb(dbPath);
    try {
      const rescenarios = dirIdx >= 0 ? loadRescenariosDir(args[dirIdx + 1]) : undefined;
      const result = runWatchCycle(db, { now: new Date().toISOString(), rescenarios });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`watch:run failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "fin:pipeline": {
    const [dartPath] = args;
    if (!dartPath) {
      console.error("fin:pipeline requires a DART JSON path");
      process.exit(1);
    }
    try {
      const result = await runFullPipeline(dartPath);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`fin:pipeline failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "fin:driver-tree": {
    const [modelPath] = args;
    if (!modelPath) {
      console.error("fin:driver-tree requires a canonical-model JSON path");
      process.exit(1);
    }
    try {
      const tree = await computeDriverTree(modelPath);
      console.log(JSON.stringify(tree, null, 2));
    } catch (err) {
      console.error(`fin:driver-tree failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "report": {
    const [markdownPath, ...rest] = args;
    if (!markdownPath) {
      console.error("report requires a Markdown path");
      process.exit(1);
    }
    const fmtIdx = rest.indexOf("--format");
    const outDirIdx = rest.indexOf("--out-dir");
    const formats = (fmtIdx >= 0 ? rest[fmtIdx + 1] : "docx,pdf,hwpx")
      .split(",")
      .map((s) => s.trim()) as ReportFormat[];
    try {
      const results = await renderReport(markdownPath, formats, {
        outDir: outDirIdx >= 0 ? rest[outDirIdx + 1] : undefined,
        noGlossary: rest.includes("--no-glossary"),
      });
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error(`report failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "scorecard:rollup": {
    // Group-operator aggregate view (ADR-0059 E.4) — no actor guard by
    // design; see scorecard-rollup.ts for the posture rationale.
    const cycleIdx = args.indexOf("--review-cycle");
    const dbPathIdx = args.indexOf("--db-path");
    const reviewCycle = cycleIdx >= 0 ? args[cycleIdx + 1] : undefined;
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    try {
      console.log(runScorecardRollup({ reviewCycle, dbPath }));
    } catch (err) {
      console.error(`scorecard:rollup failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "user:create": {
    const [userId] = args;
    const roleIdx = args.indexOf("--role");
    const dnIdx = args.indexOf("--display-name");
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    const role = roleIdx >= 0 ? args[roleIdx + 1] : undefined;
    if (!userId || !role) {
      console.error("user:create requires <user-id> and --role <admin|analyst|viewer>");
      process.exit(1);
    }
    // Password comes from stdin, never from argv — a shell history or a
    // process listing must not be able to capture it (FR-SEC-09).
    const password = (await Bun.stdin.text()).trim();
    if (!password) {
      console.error("user:create: password expected on stdin (piped or typed)");
      process.exit(1);
    }
    try {
      await createUser(getDb(dbPath), {
        userId,
        role: role as "admin" | "analyst" | "viewer",
        password,
        displayName: dnIdx >= 0 ? args[dnIdx + 1] : undefined,
        createdBy: "cli",
        now: new Date().toISOString(),
      });
      console.log(`✅ Account '${userId}' created (pending approval).`);
    } catch (err) {
      console.error(`user:create failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "user:approve": {
    const [userId] = args;
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    if (!userId) {
      console.error("user:approve requires <user-id>");
      process.exit(1);
    }
    try {
      approveUser(getDb(dbPath), { userId, approvedBy: "cli", now: new Date().toISOString() });
      console.log(`✅ Account '${userId}' approved.`);
    } catch (err) {
      console.error(`user:approve failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "user:list": {
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    const users = listUsers(getDb(dbPath));
    console.log(JSON.stringify(users, null, 2));
    break;
  }
  case "user:reset-password": {
    const [userId] = args;
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    if (!userId) {
      console.error("user:reset-password requires <user-id>");
      process.exit(1);
    }
    const tempPassword = (await Bun.stdin.text()).trim();
    if (!tempPassword) {
      console.error("user:reset-password: temporary password expected on stdin");
      process.exit(1);
    }
    try {
      await resetPassword(getDb(dbPath), { userId, tempPassword, resetBy: "cli", now: new Date().toISOString() });
      console.log(`✅ Password reset for '${userId}' — must_change_password=1, all sessions revoked.`);
    } catch (err) {
      console.error(`user:reset-password failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "model": {
    const projectIdx = args.indexOf("--project");
    const labelIdx = args.indexOf("--label");
    const fromRunIdx = args.indexOf("--from-run");
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    // Repeated flag: every "--set key=value" contributes one pair, so
    // collect values positionally rather than via indexOf (first-match only).
    const setPairs = args.filter((_, i) => i > 0 && args[i - 1] === "--set");
    const projectId = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
    const label = labelIdx >= 0 ? args[labelIdx + 1] : undefined;
    if (!projectId || !label) {
      console.error('model requires --project <id> and --label "v1 Pre-FS"');
      console.error("(v1 records the versioned input snapshot; valuation output arrives with the model engine)");
      process.exit(1);
    }
    try {
      const result = runModelCreate(
        {
          projectId,
          label,
          fromRunId: fromRunIdx >= 0 ? args[fromRunIdx + 1] : undefined,
          setPairs,
        },
        dbPath,
      );
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(`model failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "diff": {
    const [runA, runB] = args;
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    if (!runA || !runB) {
      console.error("diff requires <runA> <runB>");
      process.exit(1);
    }
    try {
      const bridge = runModelDiff(runA, runB, dbPath);
      console.log(JSON.stringify(bridge, null, 2));
    } catch (err) {
      console.error(`diff failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "assume": {
    const runIdx = args.indexOf("--run");
    const keyIdx = args.indexOf("--key");
    const kindIdx = args.indexOf("--kind");
    const valueIdx = args.indexOf("--value");
    const asOfIdx = args.indexOf("--as-of");
    const rationaleIdx = args.indexOf("--rationale");
    const anchorIdx = args.indexOf("--anchor-ref");
    const ttlIdx = args.indexOf("--ttl-days");
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    const runId = runIdx >= 0 ? args[runIdx + 1] : undefined;
    const key = keyIdx >= 0 ? args[keyIdx + 1] : undefined;
    const kind = kindIdx >= 0 ? args[kindIdx + 1] : undefined;
    const rawValue = valueIdx >= 0 ? args[valueIdx + 1] : undefined;
    if (!runId || !key || !kind || rawValue === undefined) {
      console.error("assume requires --run <id> --key <key> --kind <live|user|derived|assumed> --value <n>");
      console.error("(--as-of defaults to today; kind='assumed' requires --rationale, FR-DATA-07)");
      process.exit(1);
    }
    try {
      const row = runAssume(
        {
          runId,
          assumptionKey: key,
          kind,
          value: Number(rawValue),
          asOf: asOfIdx >= 0 ? args[asOfIdx + 1] : undefined,
          rationale: rationaleIdx >= 0 ? args[rationaleIdx + 1] : undefined,
          anchorRef: anchorIdx >= 0 ? args[anchorIdx + 1] : undefined,
          ttlDays: ttlIdx >= 0 ? Number(args[ttlIdx + 1]) : undefined,
        },
        dbPath,
      );
      console.log(JSON.stringify(row, null, 2));
    } catch (err) {
      console.error(`assume failed: ${(err as Error).message}`);
      console.error(`kinds: ${[...ASSUMPTION_KINDS].join("|")}`);
      process.exit(1);
    }
    break;
  }
  case "wacc:derivation": {
    // ADR-0115 — rebuild the CAPM/WACC build-up from persisted `wacc.*`
    // component rows as markdown, for pasting into S5/S8 deliverables.
    // Read-only: a missing component layer prints guidance, never a scalar.
    const projIdx = args.indexOf("--project");
    const projectId = projIdx >= 0 ? args[projIdx + 1] : undefined;
    const dbPathIdx = args.indexOf("--db-path");
    const dbPath = dbPathIdx >= 0 ? args[dbPathIdx + 1] : undefined;
    if (!projectId) {
      console.error("wacc:derivation: --project <id> is required.");
      process.exit(2);
    }
    const { loadProjectComponents, resolveProjectWacc, resolveProjectHurdleIrr } = await import("../../db/lib/wacc.ts");
    const { assembleDerivation, formatPct } = await import("../../db/lib/wacc-components.ts");
    const db = getDb(dbPath);
    const wacc = resolveProjectWacc(db, projectId);
    const hurdle = resolveProjectHurdleIrr(db, projectId);
    const { components } = loadProjectComponents(db, projectId);
    if (components.length === 0) {
      console.error(`wacc:derivation: no wacc.* components recorded for project '${projectId}'.`);
      console.error("Run the CAPM 분해 session first (POST /api/projects/{id}/wacc with mode='capm').");
      process.exit(1);
    }
    const derivation = assembleDerivation(components);
    const lines: string[] = [];
    lines.push("## WACC 산식 분해");
    lines.push("");
    lines.push(`확정 WACC: **${formatPct(wacc.value)}** (${wacc.source}${wacc.run_id ? `, run ${wacc.run_id}` : ""}) · Hurdle IRR: ${hurdle ? formatPct(hurdle.value) : "—"}`);
    lines.push("");
    lines.push(`베타 경로: ${derivation.betaPath ?? "—"}`);
    lines.push("");
    lines.push("| 항목 | 산식 | 대입 | 결과 |");
    lines.push("|---|---|---|---|");
    for (const s of derivation.steps) {
      lines.push(`| ${s.item} | \`${s.formula}\` | ${s.substitution} | **${s.resultLabel ?? formatPct(s.result)}** |`);
    }
    lines.push("");
    lines.push("| 가정 키 | 값 | kind | 출처 / 근거 | 기준일 |");
    lines.push("|---|---|---|---|---|");
    const RAW_KEYS = new Set(["wacc.beta_levered", "wacc.beta_unlevered", "wacc.observed_de", "wacc.target_de", "wacc.beta_r2"]);
    for (const c of components) {
      const raw = derivation.components[c.key];
      const shown = RAW_KEYS.has(c.key) ? String(raw) : formatPct(raw);
      lines.push(`| \`${c.key}\` | ${shown} | ${c.kind} | ${c.rationale ?? "—"}${c.anchor_ref ? ` (${c.anchor_ref})` : ""} | ${c.as_of} |`);
    }
    console.log(lines.join("\n"));
    break;
  }
  case "db:export": {
    // ADR-0002's portability verification mechanism — the export the ADR
    // promises but that never existed. Dialect is postgres (only target
    // named by the ADR); warnings print to stderr, dump to stdout/--out.
    const dialectIdx = args.indexOf("--dialect");
    const dialect = dialectIdx >= 0 ? args[dialectIdx + 1] : "postgres";
    if (dialect !== "postgres") {
      console.error(`db:export: unsupported dialect '${dialect}' — only 'postgres' (ADR-0002) is implemented.`);
      process.exit(1);
    }
    runExportCommand(args);
    break;
  }
  case "hwp-extract": {
    await runHwpExtractCommand(args);
    break;
  }
  case "glossary:lint": {
    // Report-only (exit 0 regardless of findings) — the glossary-curator
    // triages weekly; this is not a pipeline gate. See glossary-lint.ts.
    const roots: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--root" && args[i + 1]) roots.push(resolve(args[i + 1]));
    }
    printGlossaryLintReport(lintGlossaryUsage(roots.length > 0 ? { roots } : {}), {
      quietKnown: args.includes("--quiet-known"),
    });
    break;
  }
  case "fetch": {
    const sourceIdx = args.indexOf("--source");
    const source = sourceIdx >= 0 ? args[sourceIdx + 1] : undefined;
    if (!source || !["dart", "ecos", "krx", "kosis", "law", "opendata"].includes(source)) {
      console.error("fetch: --source is required (dart | ecos | kosis | law | opendata).");
      process.exit(2);
    }
    const { SOURCE_ADAPTERS, upsertCatalog } = await import("./source-adapters.ts");
    const { ensureFresh } = await import("../../db/repositories/observation.repository.ts");
    const adapter = SOURCE_ADAPTERS[source];
    const db = getDb();
    // md_source registration: every used adapter is a known source with a grade.
    const GRADE: Record<string, string> = { dart: "A", ecos: "A", krx: "A", kosis: "A", law: "A", opendata: "B" };
    const registerSource = () => {
      if (!db.query("SELECT id FROM md_source WHERE code = ?").get(source)) {
        db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)",
          [ulid(), source, GRADE[source] ?? "C", new Date().toISOString()]);
        console.log(`md_source: registered '${source}' (grade ${GRADE[source] ?? "C"})`);
      }
    };
    const seriesIdIdx = args.indexOf("--series");
    const seriesArg = seriesIdIdx >= 0 ? args[seriesIdIdx + 1] : undefined;
    const fromIdx = args.indexOf("--from");
    const toIdx = args.indexOf("--to");
    const fromArg = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
    const toArg = toIdx >= 0 ? args[toIdx + 1] : undefined;
    const all = args.includes("--all");
    let failures = 0;

    if (adapter.kind === "observations") {
      const catalog = await adapter.listSeries();
      if (args.includes("--list")) {
        for (const s of catalog) {
          console.log(`${s.seriesId}\t${s.tblId ?? "-"}\t${s.periodType}\t${s.unitCode}\tverified=${s._verified === true}\t${s.title}`);
        }
        break;
      }
      if (!adapter.isEnabled()) {
        console.error(`fetch: ${adapter.credentialEnv} is not set — the ${source} adapter (${adapter.kSkill}) is disabled.`);
        process.exit(2);
      }
      registerSource();
      const targets = seriesArg
        ? catalog.filter((s) => s.seriesId === seriesArg || s.tblId === seriesArg)
        : catalog;
      if (targets.length === 0) {
        console.error(`fetch: no series matched '${seriesArg ?? "(all)"}' — fetch --list shows the seeded catalog.`);
        process.exit(1);
      }
      for (const s of targets) {
        if (!s._verified) console.warn(`⚠ ${s.seriesId}: seed entry UNVERIFIED — confirm orgId/tblId against KOSIS before trusting outputs.`);
        const mapping = Object.values(KOSIS_UNITS).find((u) => u.unitCode === s.unitCode);
        if (!mapping) {
          failures++;
          console.error(`  isolated failure ${s.seriesId}: unit '${s.unitCode}' has no md_unit mapping (kosis-units.ts).`);
          continue;
        }
        const unitId = (() => {
          const row = db.query("SELECT id FROM md_unit WHERE code = ?").get(mapping.unitCode) as { id: string } | undefined;
          if (row) return row.id;
          const id = ulid();
          db.run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)",
            [id, mapping.unitCode, mapping.dimension, mapping.siCoefficient, new Date().toISOString()]);
          return id;
        })();
        const sourceId = (db.query("SELECT id FROM md_source WHERE code = ?").get(source) as { id: string }).id;
        // Day-grain series (KRX): one API call per (series × month) through
        // the adapter's listDailyRows hook; ensure_fresh runs per trading day.
        if (adapter.listDailyRows && s.periodType === "day") {
          for (const month of resolveMonthlyPeriods(fromArg, toArg)) {
            let rows: Awaited<ReturnType<NonNullable<typeof adapter.listDailyRows>>> = [];
            try {
              rows = await adapter.listDailyRows({ seriesId: s.seriesId, sourceId }, month);
            } catch (err) {
              failures++;
              console.error(`  isolated failure ${s.seriesId}@${month}: ${err instanceof Error ? err.message : err}`);
              continue;
            }
            for (const row of rows) {
              try {
                const periodId = upsertPeriod(db, row.date);
                const r = await ensureFresh({
                  seriesId: s.seriesId, periodId, unitId, sourceId,
                  fetcher: async () => ({ value: row.value, contentHash: await sha256Hex(row.raw), raw: row.raw }),
                });
                console.log(`${s.seriesId}@${row.date}: ${r.changeType ?? "cached"} (rev ${r.revisionNo})`);
              } catch (err) {
                failures++;
                console.error(`  isolated failure ${s.seriesId}@${row.date}: ${err instanceof Error ? err.message : err}`);
              }
            }
          }
          continue;
        }
        let rawFetcher: (periodKey: string) => Promise<{ value: number; contentHash: string; raw: string }>;
        try {
          rawFetcher = adapter.fetcher({ seriesId: s.seriesId, sourceId });
        } catch (err) {
          failures++;
          console.error(`  isolated failure ${s.seriesId}: ${err instanceof Error ? err.message : err}`);
          continue;
        }
        for (const periodKey of resolveMonthlyPeriods(fromArg, toArg)) {
          try {
            const periodId = upsertPeriod(db, periodKey);
            const periodFetcher = async () => rawFetcher(periodKey);
            const r = await ensureFresh({
              seriesId: s.seriesId, periodId, unitId, sourceId,
              fetcher: periodFetcher,
            });
            console.log(`${s.seriesId}@${periodKey}: ${r.changeType ?? "cached"} (rev ${r.revisionNo})`);
          } catch (err) {
            failures++;
            console.error(`  isolated failure ${s.seriesId}@${periodKey}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
      if (failures > 0) {
        console.error(`fetch: ${failures} isolated failure(s).`);
        process.exit(1);
      }
      break;
    }

    // catalog adapters: md:sync semantics. dart's corpCode dump is a full-market
    // dump (~100k rows) — require explicit opt-in so a typo'd fetch never
    // pulls it uninvited (law's whitelist default keeps it small).
    if (source === "dart" && !args.includes("--all")) {
      console.error("fetch: dart catalog is the full-market corpCode dump — pass --all explicitly.");
      process.exit(2);
    }
    registerSource();
    const upserts = await adapter.listCatalog({ all });
    const result = upsertCatalog(db, upserts);
    console.log(`${source}: ${result.inserted} inserted, ${result.existing} already present.`);
    break;
  }
  case "calibrate": {
    const opt = (name: string): string | undefined => {
      const i = args.indexOf(name);
      return i >= 0 ? args[i + 1] : undefined;
    };
    const fromIndustryId = opt("--from-industry");
    const toIndustryId = opt("--to-industry");
    const fromSeriesId = opt("--from-series");
    const toSeriesId = opt("--to-series");
    const periodFrom = opt("--from");
    const periodTo = opt("--to");
    if (!fromIndustryId || !toIndustryId || !fromSeriesId || !toSeriesId || !periodFrom || !periodTo) {
      console.error("calibrate: --from-industry --to-industry --from-series --to-series --from --to are all required.");
      process.exit(2);
    }
    const { runCalibrate } = await import("./calibrate.ts");
    const r = await runCalibrate({
      fromIndustryId, toIndustryId, fromSeriesId, toSeriesId, periodFrom, periodTo,
      maxLagMonths: opt("--max-lag") ? Number(opt("--max-lag")) : undefined,
      evidenceRef: opt("--evidence-ref"),
    });
    console.log(JSON.stringify(r, null, 2));
    break;
  }
  case "convert": {
    const { convertUnits, convertViaProxyChain } = await import("./convert.ts");
    const valueIdx = args.indexOf("--value");
    const value = valueIdx >= 0 ? Number(args[valueIdx + 1]) : NaN;
    if (!Number.isFinite(value)) {
      console.error("convert: --value <number> is required.");
      process.exit(2);
    }
    const chainIdx = args.indexOf("--chain");
    if (chainIdx >= 0) {
      console.log(JSON.stringify(convertViaProxyChain(value, args[chainIdx + 1]), null, 2));
      break;
    }
    const opt = (name: string): string | undefined => {
      const i = args.indexOf(name);
      return i >= 0 ? args[i + 1] : undefined;
    };
    const fromUnit = opt("--from-unit");
    const toUnit = opt("--to-unit");
    if (!fromUnit || !toUnit) {
      console.error("convert: --from-unit and --to-unit are required (or --chain <proxy_chain_id>).");
      process.exit(2);
    }
    console.log(JSON.stringify(convertUnits(value, fromUnit, toUnit), null, 2));
    break;
  }
  case "policy:sync": {
    const { syncPolicies } = await import("./policy-sync.ts");
    const r = await syncPolicies();
    console.log(`policy:sync — ${r.inserted} inserted, ${r.superseded} superseded, ${r.unchanged} unchanged.`);
    for (const d of r.docs) console.log(`  [${d.action}] ${d.path} (${d.policyId})`);
    break;
  }
  case "governance:sync": {
    const { runGovernanceSync } = await import("./governance-sync.ts");
    process.exitCode = await runGovernanceSync(args);
    break;
  }
  case "policy:impact": {
    const idx = args.indexOf("--policy");
    const ref = idx >= 0 ? args[idx + 1] : undefined;
    if (!ref) {
      console.error("policy:impact: --policy <id-or-doc-path> is required.");
      process.exit(2);
    }
    const { policyImpact } = await import("./policy-sync.ts");
    const report = policyImpact(ref);
    console.log(JSON.stringify(report, null, 2));
    break;
  }
  case "fin:project": {
    const idx = args.indexOf("--project");
    const projectId = idx >= 0 ? args[idx + 1] : undefined;
    if (!projectId) {
      console.error("fin:project: --project <id> is required.");
      process.exit(2);
    }
    const { projectFinancialRollup } = await import("./fin-project.ts");
    console.log(JSON.stringify(projectFinancialRollup(projectId), null, 2));
    break;
  }
  case "md:sync": {
    const sourceIdx = args.indexOf("--source");
    const source = sourceIdx >= 0 ? args[sourceIdx + 1] : undefined;
    if (!source || !["dart", "law"].includes(source)) {
      console.error("md:sync: --source is required (dart | law).");
      process.exit(2);
    }
    const { SOURCE_ADAPTERS, upsertCatalog } = await import("./source-adapters.ts");
    const adapter = SOURCE_ADAPTERS[source];
    if (!adapter.isEnabled()) {
      console.error(`md:sync: ${adapter.credentialEnv} is not set — the ${source} adapter (${adapter.kSkill}) is disabled.`);
      process.exit(2);
    }
    const db = getDb();
    const GRADE: Record<string, string> = { dart: "A", law: "A" };
    if (!db.query("SELECT id FROM md_source WHERE code = ?").get(source)) {
      db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES (?,?,?,?)",
        [ulid(), source, GRADE[source] ?? "C", new Date().toISOString()]);
      console.log(`md_source: registered '${source}' (grade ${GRADE[source] ?? "C"})`);
    }
    const upserts = await adapter.listCatalog({ all: args.includes("--all") });
    const result = upsertCatalog(db, upserts);
    console.log(`md:sync ${source}: ${result.inserted} inserted, ${result.existing} already present.`);
    break;
  }

  case "adr:new": {
    const titleIdx = args.indexOf("--title");
    const statusIdx = args.indexOf("--status");
    const dateIdx = args.indexOf("--date");
    const dirIdx = args.indexOf("--dir");
    const title = titleIdx >= 0 ? args[titleIdx + 1] : undefined;
    if (!title) {
      console.error('adr:new requires --title "..."  (--status and --date default to Proposed / today)');
      process.exit(1);
    }
    try {
      const result = scaffoldAdr({
        title,
        status: statusIdx >= 0 ? args[statusIdx + 1] : undefined,
        date: dateIdx >= 0 ? args[dateIdx + 1] : undefined,
        dir: dirIdx >= 0 ? args[dirIdx + 1] : undefined,
      });
      console.log(`Created ${result.file} (ADR-${String(result.number).padStart(4, "0")})`);
      console.log("Reminder: add the entry to docs/adr/README.md once the ADR content is written.");
    } catch (err) {
      console.error(`adr:new failed: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  }
  case "graph": {
    // Multi-element graph projection (design 2026-08-24) — emit or drift-check.
    runGraphCommand(args);
    break;
  }
  case "context": {
    // Contextual bundle over the derived graph — skill- or gate-scoped.
    runContextCommand(args);
    break;
  }
  default:
    printUsage();
    if (command) process.exit(1);
}
