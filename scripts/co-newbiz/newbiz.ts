#!/usr/bin/env bun
// @version 1.8.0
/**
 * co-newbiz analysis-engine CLI — design v1.0 §4-8.
 *
 * Usage:
 *   bun scripts/co-newbiz/newbiz.ts <command> [options]
 *
 * Commands implemented so far (Stage 5 Waves 5.1-5.4):
 *   db:migrate      Apply pending db/migrations/*.sql
 *   status          Print migration status
 *   proc:resolve    Merge a shared procedure with region/entity overrides
 *   fin:analyze     KPI report from a canonical financial model
 *   fin:pipeline    Full DART → canonical-model pipeline
 *   fin:driver-tree 5-level ROIC value driver tree
 *   simulate        Monte-Carlo simulation (contingent liabilities)
 *   rag             Six-dimension RAG assessment from a scenario JSON
 *   watch:run       Monitoring cycle — change detection, auto re-assess, notify
 *   report          Render Markdown to docx/pdf/hwpx with glossary appendix
 *
 * Remaining commands (md:sync, fetch, law:sync, policy:sync, policy:impact,
 * glossary:lint [reuse bun glossary/_validate.ts directly for now — see
 * package.json], fin:project, assume, calibrate, convert, model, diff,
 * export, adr:new, user:*) land in their respective Wave 5.5-5.7 PRs per
 * docs/dev-plan.md — not stubbed here to avoid a command that silently does
 * nothing.
 */

import { runMigrations } from "../../db/migrate.ts";
import { getDb } from "../../db/client.ts";
import { resolveProcedure } from "./proc-resolve.ts";
import { computeKpis } from "./fin-analyze.ts";
import { runSimulation } from "./simulate.ts";
import { runFullPipeline } from "./fin-pipeline.ts";
import { computeDriverTree } from "./driver-tree.ts";
import { renderReport, type ReportFormat } from "./report.ts";
import { runRagAssessment } from "./rag.ts";
import { runWatchCycle, loadRescenariosDir } from "./watch-run.ts";

const [command, ...args] = process.argv.slice(2);

function printUsage(): void {
  console.log("Usage: bun scripts/co-newbiz/newbiz.ts <command>");
  console.log("Commands: db:migrate, status, proc:resolve --procedure <name> [--entity <code>] [--region <code>] [--json], fin:analyze <canonical-model-json-path>, fin:pipeline <dart-json-path>, fin:driver-tree <canonical-model-json-path>, simulate <scenario-json-path>, rag <scenario-json-path> [--db-path <path>], watch:run [--rescenarios-dir <dir>] [--db-path <path>], report <markdown-path> [--format docx,pdf,hwpx] [--out-dir <dir>] [--no-glossary]");
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
  default:
    printUsage();
    if (command) process.exit(1);
}
