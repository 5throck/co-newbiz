#!/usr/bin/env bun
// @version 1.1.0
/**
 * committee-deliberation.ts — ad-hoc committee-style deliberation CLI
 * (ADR-0097 §7), the executable behind the committee-deliberation skill.
 *
 * It calls the dedicated deliberation engine (app/web-next/lib/deliberation.ts,
 * runDeliberationRounds — split out of agent-orchestrator.ts) with the
 * pluggable member executor from app/web-next/lib/committee-agents.ts.
 * The transcript is written to memory/committee-YYYY-MM-DD-[slug].md.
 *
 * Usage:
 *   bun scripts/co-newbiz/committee-deliberation.ts "topic" [--agents a,b] [--rounds N] [--dialogue]
 *
 *   --agents   comma-separated member keys (default: industry-lead,region-lead,
 *              market-intelligence-agent,risk-officer — the 5-seat skeleton
 *              minus the track agent; risk-officer's veto dissent is
 *              preserved verbatim by the engine)
 *   --rounds   deliberation rounds, default 2 (round 2+ members see all
 *              other members' prior positions verbatim)
 *   --dialogue alias kept for back-compat with the stub's advertised flag —
 *              multi-round rebuttal IS the engine's only mode
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, resetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { runDeliberationRounds, type CommitteeMember } from "../../app/web-next/lib/deliberation.ts";
import { getCommitteeCallAgent } from "../../app/web-next/lib/committee-agents.ts";

const DEFAULT_AGENTS = ["industry-lead", "region-lead", "market-intelligence-agent", "risk-officer"];

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "meeting";
}

interface MeetingArgs {
  topic: string;
  agents: string[];
  rounds: number;
  dialogue: boolean;
}

function parseArgs(argv: string[]): MeetingArgs {
  const positional: string[] = [];
  let agents = DEFAULT_AGENTS;
  let rounds = 2;
  let dialogue = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agents") {
      const list = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length > 0) agents = list;
    } else if (a === "--rounds") {
      rounds = Math.max(1, Number(argv[++i] ?? 2) || 2);
    } else if (a === "--dialogue") {
      dialogue = true;
    } else {
      positional.push(a);
    }
  }
  const topic = positional.join(" ").trim();
  if (!topic) {
    console.error("Usage: bun scripts/co-newbiz/committee-deliberation.ts \"topic\" [--agents a,b] [--rounds N] [--dialogue]");
    process.exit(1);
  }
  return { topic, agents, rounds, dialogue };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  // Scratch-local DB: the meeting record is the transcript file; the process
  // run still lands in the DB for auditability (ADR-0096 engine contract).
  const dbPath = `db/data/committee-${dateStr}-${slug(args.topic)}.sqlite`;
  process.env.CO_NEWBIZ_DB_PATH = dbPath;
  resetDb();
  runMigrations(dbPath);
  // The engine addresses runs via {entityType, entityId}; a project row is
  // the cheapest legal anchor for an ad-hoc meeting (project_id FK, 0064).
  const anchorId = `committee-${dateStr}-${slug(args.topic)}`;
  getDb().run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [anchorId, "MEETING", now.toISOString()]);

  const members: CommitteeMember[] = args.agents.map((key) => ({ agentKey: key }));
  const result = await runDeliberationRounds(
    { entityType: "project", entityId: anchorId },
    {
      committeeKey: "meeting-adhoc",
      agents: members,
      rounds: args.rounds,
      topic: args.topic,
      callAgent: getCommitteeCallAgent(),
      actor: "meeting-cli",
      source: "cli",
      stage: "meeting",
    },
  );

  const lines: string[] = [
    `# Meeting — ${args.topic}`,
    "",
    `- Date: ${dateStr}`,
    `- Members: ${args.agents.join(", ")}`,
    `- Rounds: ${args.rounds}${args.dialogue ? " (dialogue)" : ""}`,
    `- Engine: runDeliberationRounds (ADR-0096) via /meeting (ADR-0097 §7)`,
    "",
    "## Agenda and objectives",
    "",
    args.topic,
    "",
  ];
  for (const round of result.rounds) {
    lines.push(`## Round ${round.round}`, "");
    for (const p of round.positions) {
      lines.push(`### ${p.memberKey}`, "", p.positionMd, "");
    }
  }
  if (result.evaluation) {
    lines.push(
      "## Synthesized outcome (PROPOSAL — not a decision)",
      "",
      `- Recommendation: ${result.evaluation.recommendation.toUpperCase()}`,
      "",
    );
    if (result.evaluation.dissentJson) {
      const dissents = JSON.parse(result.evaluation.dissentJson) as Array<{ member_key: string; position_md: string }>;
      lines.push("## Dissent (verbatim)", "");
      for (const d of dissents) lines.push(`### ${d.member_key}`, "", d.position_md, "");
    }
    lines.push("## Action items", "", "- Recorded in this transcript only — owners are assigned by the human convener.", "");
  }

  const memoryDir = join(process.cwd(), "memory");
  mkdirSync(memoryDir, { recursive: true });
  const outFile = join(memoryDir, `committee-${dateStr}-${slug(args.topic)}.md`);
  writeFileSync(outFile, lines.join("\n"));
  console.log(`Meeting transcript written: ${outFile}`);
  console.log(`Proposal: ${result.evaluation?.recommendation.toUpperCase() ?? "n/a"} (process_run ${result.processRunId})`);
  resetDb();
}

await main();
