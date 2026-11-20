#!/usr/bin/env bun
// @version 1.4.0
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
 *   bun scripts/co-newbiz/committee-deliberation.ts "topic" [--agents a,b] [--rounds N] [--dialogue] [--deterministic] [--engine turns|rounds]
 *
 *   --agents   comma-separated member keys (default: industry-lead,region-lead,
 *              market-intelligence-agent,risk-officer — the 5-seat skeleton
 *              minus the track agent; risk-officer's veto dissent is
 *              preserved verbatim by the engine)
 *   --rounds   deliberation rounds, default 2 (round 2+ members see all
 *              other members' prior positions verbatim)
 *   --dialogue alias kept for back-compat with the stub's advertised flag —
 *              multi-round rebuttal IS the engine's only mode
 *   --engine   turns | rounds (ADR-0204). Default: CO_NEWBIZ_COMMITTEE_ENGINE,
 *              else turns (rounds is the explicit opt-out). turns runs the turn-based meeting (runTurnMeeting:
 *              one short move per turn, bounded budgets, chair consensus + votes)
 *              and writes minutes v2 (ADR-0204 phase 3): the same chair pass and the
 *              same markdown as the app's .md download — per-issue participants,
 *              consensus and votes, appendix A (full transcript), appendix B when a
 *              sitting was abandoned. --rounds is ignored. --deterministic uses the
 *              deterministic minutes fallback. An invalid value is refused, never coerced.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, resetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { runDeliberationRounds, type CommitteeMember } from "../../app/web-next/lib/deliberation.ts";
import {
  committeeEngineDefault,
  parseCommitteeEngine,
  type CommitteeEngine,
} from "../../app/web-next/lib/committee-flags.ts";
import {
  deterministicTurnCaller,
  loadTurnRecords,
  runTurnMeeting,
  seatDisplayName,
  type SeatInfo,
} from "../../app/web-next/lib/committee-turns.ts";
import { AGENT_REGISTRY } from "../../app/web-next/lib/agent-registry.generated.ts";
import { makeLlmTurnCaller } from "../../app/web-next/lib/committee-llm.ts";
import {
  COMMITTEE_LLM_GUIDANCE,
  committeeLlmAvailable,
  deterministicCallAgent,
  getCommitteeCallAgent,
} from "../../app/web-next/lib/committee-agents.ts";
import {
  runChairAgenda,
  runChairOpeningAgenda,
  runChairMinutes,
  runChairMinutesV2,
  type AgendaMeta,
  type MinutesDraft,
} from "../../app/web-next/lib/committee-chair.ts";
import type { MinutesPassResult } from "../../app/web-next/lib/deliberation.ts";
import { buildCommitteeMinutes } from "../../app/web-next/lib/committee-scorecard.ts";

const DEFAULT_AGENTS = ["industry-lead", "region-lead", "market-intelligence-agent", "risk-officer"];

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "meeting"
  );
}

interface MeetingArgs {
  topic: string;
  agents: string[];
  rounds: number;
  dialogue: boolean;
  /** Explicit pilot opt-in (owner decision 10): bypasses the LLM guard. */
  deterministic: boolean;
  engine: CommitteeEngine;
}

function parseArgs(argv: string[]): MeetingArgs {
  const positional: string[] = [];
  let agents = DEFAULT_AGENTS;
  let rounds = 2;
  let dialogue = false;
  let deterministic = false;
  let engineArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agents") {
      const list = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0) agents = list;
    } else if (a === "--rounds") {
      rounds = Math.max(1, Number(argv[++i] ?? 2) || 2);
    } else if (a === "--dialogue") {
      dialogue = true;
    } else if (a === "--deterministic") {
      deterministic = true;
    } else if (a === "--engine") {
      engineArg = argv[++i];
    } else {
      positional.push(a);
    }
  }
  const topic = positional.join(" ").trim();
  if (!topic) {
    console.error(
      'Usage: bun scripts/co-newbiz/committee-deliberation.ts "topic" [--agents a,b] [--rounds N] [--dialogue] [--deterministic] [--engine turns|rounds]',
    );
    process.exit(1);
  }
  let engine: CommitteeEngine;
  try {
    // explicit flag > CO_NEWBIZ_COMMITTEE_ENGINE > turns; an invalid value is never coerced
    engine = engineArg !== undefined ? parseCommitteeEngine(engineArg) : committeeEngineDefault();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  return { topic, agents, rounds, dialogue, deterministic, engine };
}

/** The seats of an ad-hoc turn meeting as the chair and the engine see them (risk-officer is always mandatory). */
function adhocRoster(agents: readonly string[]): SeatInfo[] {
  return agents.map((key) => ({
    key,
    name: seatDisplayName(key),
    role: AGENT_REGISTRY.find((a) => a.key === key)?.role.slice(0, 110),
    mandatory: key === "risk-officer",
  }));
}

/**
 * ADR-0204 phase 3 (CLI parity): the turn-based ad-hoc meeting. The minutes are minutes v2 — the same
 * chair pass (runChairMinutesV2) and the same markdown renderer (buildCommitteeMinutes) as the app —
 * so the written file matches the app's .md download. The full transcript is appendix A there.
 * A proposal is not a decision.
 */
async function runTurnCli(args: MeetingArgs, ctx: { dateStr: string; anchorId: string }): Promise<void> {
  const chair = "process-governance-manager";
  const roster = adhocRoster(args.agents);
  const startedAt = new Date().toISOString();
  const opening = await runChairOpeningAgenda(args.topic, roster);
  const agenda = opening.agenda;
  const attempts = [{ attempt: 1, started_at: startedAt }];

  const minutesPass = async (runId: string): Promise<MinutesPassResult> => {
    const records = loadTurnRecords(runId);
    return runChairMinutesV2({
      topic: args.topic,
      agenda,
      records,
      currentAttempt: Math.max(1, ...records.map((r) => r.attempt)),
      chairSeat: chair,
      seats: args.agents,
      attempts,
      heldAt: startedAt,
      deterministic: args.deterministic,
    });
  };

  const result = await runTurnMeeting(
    { entityType: "project", entityId: ctx.anchorId },
    {
      committeeKey: "meeting-adhoc",
      seats: args.agents,
      mandatorySeats: roster.filter((r) => r.mandatory).map((r) => r.key),
      seatInfo: roster,
      topic: args.topic,
      chair,
      agenda,
      callTurn: args.deterministic ? deterministicTurnCaller() : makeLlmTurnCaller(),
      actor: "meeting-cli",
      source: "cli",
      stage: "meeting",
      startedAt,
      chairMinutesPass: async (c) => minutesPass(c.processRunId),
    },
  );

  // The engine swallows a failing chair pass; the file must still carry minutes, so retry once
  // deterministically (never an empty minutes, never a dropped dialogue).
  let draft = result.minutesDraft;
  if (!draft) {
    console.warn("[committee-deliberation] chair minutes pass produced no draft — using the deterministic minutes.");
    draft = await runChairMinutesV2({
      topic: args.topic,
      agenda,
      records: loadTurnRecords(result.processRunId),
      currentAttempt: 1,
      chairSeat: chair,
      seats: args.agents,
      attempts,
      heldAt: startedAt,
      deterministic: true,
    });
  }

  // Persist the meeting form the way the app does (meta_json), so buildCommitteeMinutes renders it.
  const meta: Record<string, unknown> = {
    committee_key: "meeting-adhoc",
    engine: "turns",
    gate: "meeting",
    decision_mode: "agent_team",
    synthesized: true,
    agenda,
    agenda_meta: {
      source: opening.source,
      ...(opening.model ? { model: opening.model } : {}),
      prompt_version: opening.promptVersion,
      input_hash: opening.inputHash,
      created_at: opening.createdAt,
      ...(opening.participantsMeta ? { participants: opening.participantsMeta } : {}),
    },
    attempts: [{ ...attempts[0], ended_at: new Date().toISOString() }],
    minutes_draft: {
      json: draft.json,
      fallback: draft.fallback,
      ...(draft.model ? { model: draft.model } : {}),
      prompt_version: draft.promptVersion,
      input_hash: draft.inputHash,
      created_at: draft.createdAt,
      ...(draft.fallback ? {} : { degraded_resolutions: draft.degradedResolutions ?? 0 }),
    },
    ...(result.evaluation ? { evaluation_id: result.evaluation.gateEvaluationId } : {}),
    ...(result.notParticipating ? { not_participating: result.notParticipating } : {}),
    turn_state: result.turnState,
  };
  getDb().run("UPDATE process_run SET meta_json = ? WHERE id = ?", [JSON.stringify(meta), result.processRunId]);

  const minutes = buildCommitteeMinutes(getDb(), result.processRunId) ?? "";
  const lines: string[] = [
    `# Meeting — ${args.topic}`,
    "",
    `- Date: ${ctx.dateStr}`,
    `- Members: ${args.agents.join(", ")}`,
    `- Engine: turns (ADR-0204) via /meeting (ADR-0097 §7)`,
    "",
    ...(minutes ? [minutes, ""] : []),
  ];
  const memoryDir = join(process.cwd(), "memory");
  mkdirSync(memoryDir, { recursive: true });
  const outFile = join(memoryDir, `committee-${ctx.dateStr}-${slug(args.topic)}.md`);
  writeFileSync(outFile, lines.join("\n"));
  console.log(`Meeting minutes written: ${outFile}`);
  console.log(
    `Proposal: ${result.evaluation?.recommendation.toUpperCase() ?? "n/a"} (process_run ${result.processRunId})`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Owner decision 10 (ADR-0196 amendment 2026-11-09): without a configured
  // LLM and without the explicit --deterministic pilot flag, refuse instead
  // of printing template positions.
  if (!committeeLlmAvailable() && !args.deterministic) {
    console.error(`지금은 소집할 수 없습니다 — ${COMMITTEE_LLM_GUIDANCE}`);
    process.exit(1);
  }
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
  getDb().run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [
    anchorId,
    "MEETING",
    now.toISOString(),
  ]);

  if (args.engine === "turns") {
    await runTurnCli(args, { dateStr, anchorId });
    resetDb();
    return;
  }

  const members: CommitteeMember[] = args.agents.map((key) => ({ agentKey: key }));
  const result = await runDeliberationRounds(
    { entityType: "project", entityId: anchorId },
    {
      committeeKey: "meeting-adhoc",
      agents: members,
      rounds: args.rounds,
      topic: args.topic,
      callAgent: args.deterministic ? deterministicCallAgent() : getCommitteeCallAgent(),
      actor: "meeting-cli",
      source: "cli",
      stage: "meeting",
      // ADR-0196 phase B (owner decision 8): the CLI persists the same
      // agenda/minutes meta keys as the session engine (S2) and renders the
      // same minutes layout. LLM-less runs take the deterministic fallbacks.
      chairAgendaPass:
        args.rounds >= 2
          ? async (ctx) => {
              const rows = (
                getDb()
                  .query(
                    "SELECT id, agent_key, human_user_id, round, position_md FROM agent_position WHERE process_run_id = ? ORDER BY round, created_at, id",
                  )
                  .all(ctx.processRunId) as Array<{
                  id: string;
                  agent_key: string | null;
                  human_user_id: string | null;
                  round: number;
                  position_md: string;
                }>
              )
                .filter((r) => r.round <= 1)
                .map((r) => ({
                  id: r.id,
                  seat: r.agent_key ?? r.human_user_id ?? "member",
                  memberType: "agent",
                  round: r.round,
                  positionMd: r.position_md,
                }));
              const pass = await runChairAgenda({ topic: ctx.topic, rows });
              return {
                agenda: pass.agenda,
                source: pass.source,
                model: pass.model,
                promptVersion: pass.promptVersion,
                inputHash: pass.inputHash,
                createdAt: pass.createdAt,
              };
            }
          : undefined,
      chairMinutesPass: async (ctx) => {
        const rows = (
          getDb()
            .query(
              "SELECT id, agent_key, human_user_id, round, position_md FROM agent_position WHERE process_run_id = ? ORDER BY round, created_at, id",
            )
            .all(ctx.processRunId) as Array<{
            id: string;
            agent_key: string | null;
            human_user_id: string | null;
            round: number;
            position_md: string;
          }>
        ).map((r) => ({
          id: r.id,
          seat: r.agent_key ?? r.human_user_id ?? "member",
          memberType: "agent",
          round: r.round,
          positionMd: r.position_md,
        }));
        // Design §8.4: the topic leads the minutes material, same as the agenda pass above.
        const pass = await runChairMinutes({
          topic: ctx.topic,
          agenda: ctx.agenda,
          rows,
          seats: rows.map((r) => r.seat),
        });
        return {
          json: pass.json,
          fallback: pass.fallback,
          model: pass.model,
          promptVersion: pass.promptVersion,
          inputHash: pass.inputHash,
          createdAt: pass.createdAt,
        };
      },
    },
  );

  // Persist the meeting form (S2): agenda + AI-drafted minutes in meta_json
  // — the same keys the committee-session engine writes (decision 8).
  let agendaMeta: AgendaMeta | undefined;
  let minutesDraft: MinutesDraft | undefined;
  if (result.agenda) {
    agendaMeta = {
      source: result.agenda.source,
      ...(result.agenda.model ? { model: result.agenda.model } : {}),
      prompt_version: result.agenda.promptVersion,
      input_hash: result.agenda.inputHash,
      created_at: result.agenda.createdAt,
    };
    getDb().run("UPDATE process_run SET meta_json = ? WHERE id = ?", [
      JSON.stringify({ committee_key: "meeting-adhoc", agenda: result.agenda.agenda, agenda_meta: agendaMeta }),
      result.processRunId,
    ]);
  }
  if (result.minutesDraft) {
    minutesDraft = {
      json: result.minutesDraft.json as MinutesDraft["json"],
      fallback: result.minutesDraft.fallback,
      ...(result.minutesDraft.model ? { model: result.minutesDraft.model } : {}),
      prompt_version: result.minutesDraft.promptVersion,
      input_hash: result.minutesDraft.inputHash,
      created_at: result.minutesDraft.createdAt,
    };
    const row = getDb().query("SELECT meta_json FROM process_run WHERE id = ?").get(result.processRunId) as
      | { meta_json: string | null }
      | undefined;
    const meta = row?.meta_json
      ? (JSON.parse(row.meta_json) as Record<string, unknown>)
      : { committee_key: "meeting-adhoc" };
    meta.minutes_draft = minutesDraft;
    getDb().run("UPDATE process_run SET meta_json = ? WHERE id = ?", [JSON.stringify(meta), result.processRunId]);
  }

  // The meeting-form minutes (ADR-0196 §2.4 — decision 8): the same renderer
  // the web route uses, driven by the persisted meta + transcript. The header
  // keeps the /meeting-specific context lines.
  const minutes = buildCommitteeMinutes(getDb(), result.processRunId) ?? "";
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
    ...(minutes ? [minutes, ""] : []),
  ];
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
    lines.push(
      "## Action items",
      "",
      "- Recorded in this transcript only — owners are assigned by the human convener.",
      "",
    );
  }

  const memoryDir = join(process.cwd(), "memory");
  mkdirSync(memoryDir, { recursive: true });
  const outFile = join(memoryDir, `committee-${dateStr}-${slug(args.topic)}.md`);
  writeFileSync(outFile, lines.join("\n"));
  console.log(`Meeting transcript written: ${outFile}`);
  console.log(
    `Proposal: ${result.evaluation?.recommendation.toUpperCase() ?? "n/a"} (process_run ${result.processRunId})`,
  );
  resetDb();
}

await main();
