#!/usr/bin/env bun
// @version 1.13.1
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
 * Remaining commands (fetch, md:sync, law:sync, policy:sync, policy:impact,
 * fin:project, calibrate, convert) land in their later PRs per
 * docs/planning/dev-plan.md — assume, glossary:lint and adr:new landed with the CLI
 * batch wave (scripts/co-newbiz/assume.ts, glossary-lint.ts, adr-new.ts);
 * glossary ENTRY validation stays at `bun glossary/_validate.ts` (package.json
 * alias glossary:validate). Unbuilt commands are not stubbed here to avoid a
 * command that silently does nothing.
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
import {
  createUser,
  approveUser,
  listUsers,
  resetPassword,
} from "../../db/lib/accounts.ts";

const [command, ...args] = process.argv.slice(2);

function printUsage(): void {
  console.log("Usage: bun scripts/co-newbiz/newbiz.ts <command>");
  console.log("Commands: db:migrate, status, db:export [--dialect postgres] [--out <file>] [--db-path <path>], proc:resolve --procedure <name> [--entity <code>] [--region <code>] [--json], graph [--check] [--no-consumes], context --skill <name> | --gate <Gate>, fin:analyze <canonical-model-json-path>, fin:pipeline <dart-json-path>, fin:driver-tree <canonical-model-json-path>, simulate <scenario-json-path>, rag <scenario-json-path> [--db-path <path>], watch:run [--rescenarios-dir <dir>] [--db-path <path>], model --project <id> --label <label> [--from-run <id>] [--set key=value ...] [--db-path <path>], diff <runA> <runB> [--db-path <path>], report <markdown-path> [--format docx,pdf,hwpx] [--out-dir <dir>] [--no-glossary], scorecard:rollup [--review-cycle <YYYY-Qn>] [--db-path <path>], user:create <user-id> --role <admin|analyst|viewer> [--display-name <name>] [--db-path <path>], user:approve <user-id> [--db-path <path>], user:list [--db-path <path>], user:reset-password <user-id> [--db-path <path>], assume --run <id> --key <key> --kind <live|user|derived|assumed> --value <n> [--rationale \"...\"] [--anchor-ref <ref>] [--ttl-days <N>] [--as-of YYYY-MM-DD] [--db-path <path>], glossary:lint [--root <dir>]... [--quiet-known], adr:new --title \"...\" [--status <status>] [--date YYYY-MM-DD] [--dir <dir>]");
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
