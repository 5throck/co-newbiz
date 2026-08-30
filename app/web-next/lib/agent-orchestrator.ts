// Agent Orchestrator (ADR-0074 Phase 2) — executes a process stage through
// the agents the flow spec assigns. Flow:
//   context collection → per-activity agent positions (LLM or deterministic
//   synthesis) → pm synthesis (stage conclusion + gate recommendation) →
//   gate evaluation → decision record.
// The orchestrator owns NO process logic: everything stage-shaped comes from
// process/flow.spec.yaml. Humans decide IC gates; agent decisions at the
// other gates are overridable via the normal gate_decision flow.
import { getDb } from "../../../db/client.ts";
import { appendAudit } from "../../../db/lib/access-control.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { completeOrFallback, type LlmMessage } from "./llm.ts";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

// flow.spec.yaml lives at the repo root; resolve upward from this file so the
// orchestrator works under next dev/start/bun test alike.
// import.meta.dirname is unavailable under Turbopack's server bundle —
// walk up from cwd instead (same pattern as glossary-lint's findProjectRoot).
function specPath(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "process", "flow.spec.yaml");
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // keep walking
    }
    dir = join(dir, "..");
  }
  throw new Error("process/flow.spec.yaml not found (walked up from cwd).");
}

interface GateDef {
  id: string;
  name: string;
  decisionCriteria: string[];
  killCriteria: string[];
  fundingDecision: string;
}
interface Activity {
  id: string;
  agent: string;
  skills: string[];
  procedure: string[];
}
interface StageDef {
  id: string;
  name: string;
  objective: string;
  inputs: string[];
  outputs: string[];
  entryCriteria: string[];
  activities: Activity[];
  requiredArtifacts: string[];
  completionCriteria: string[];
  applicableTracks: string[];
  stateTransitions: { onComplete: string; onHold: string; onKill: string };
  gates: string[];
}
interface FlowSpec {
  meta: { version: string; entity_lifecycles: Record<string, string[]> };
  gates: GateDef[];
  stages: StageDef[];
}

let cachedSpec: FlowSpec | null = null;
let cachedMtime: number | null = null;

export function loadSpec(): FlowSpec {
  const path = specPath();
  const mtime = statSync(path).mtimeMs;
  if (cachedSpec && cachedMtime === mtime) return cachedSpec;
  cachedSpec = yaml.load(readFileSync(path, "utf8")) as FlowSpec;
  cachedMtime = mtime;
  return cachedSpec;
}

export function getStageDef(stageId: string): StageDef | null {
  return loadSpec().stages.find((s) => s.id === stageId) ?? null;
}

function dealEvidenceSnapshot(projectId: string): string {
  const db = getDb();
  const lines: string[] = [];
  const findings = db
    .query("SELECT COUNT(*) c FROM dd_finding WHERE project_id = ?")
    .get(projectId) as { c: number };
  lines.push(`- 조사내역 ${findings.c}건`);
  const assumptions = db
    .query(
      `SELECT COUNT(*) c FROM assumption a JOIN run r ON r.id = a.run_id WHERE r.project_id = ?`,
    )
    .get(projectId) as { c: number };
  lines.push(`- 가정 레코드 ${assumptions.c}건`);
  const rag = db
    .query(
      `SELECT grade, assessed_at FROM rag_assessment WHERE project_id = ? AND dimension = 'overall'
       ORDER BY assessed_at DESC LIMIT 1`,
    )
    .get(projectId) as { grade: string; assessed_at: string } | null;
  lines.push(`- 종합 RAG: ${rag ? rag.grade.toUpperCase() : "미평가"}`);
  const route = db
    .query(
      `SELECT track, sub_track FROM (
         SELECT track, sub_track, ROW_NUMBER() OVER (ORDER BY decided_at DESC, id DESC) rn
         FROM route_decision WHERE project_id = ?) WHERE rn = 1`,
    )
    .get(projectId) as { track: string; sub_track: string } | null;
  lines.push(`- 트랙: ${route ? `${route.track}${route.sub_track ? "/" + route.sub_track : ""}` : "미결정"}`);
  const checks = db
    .query(
      `SELECT checklist_id, status, COUNT(*) c FROM project_checklist_item_state
       WHERE project_id = ? GROUP BY checklist_id, status`,
    )
    .all(projectId) as Array<{ checklist_id: string; status: string; c: number }>;
  if (checks.length > 0) {
    lines.push(
      `- 체크리스트 판정: ${checks.map((c) => `${c.checklist_id.replace("chk-", "")} ${c.status}×${c.c}`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

export interface StageRunResult {
  process_run_id: string;
  stage: string;
  conclusion_md: string;
  recommendation: "go" | "hold" | "kill";
  gate: string | null;
  positions: Array<{ agent_key: string; position_md: string }>;
}

/**
 * Execute a stage through its mapped agents. positions come from the LLM when
 * configured, otherwise from deterministic synthesis over the deal's evidence
 * snapshot — both are recorded as agent positions (source=agent), and the pm
 * synthesis is recorded separately (source=system).
 */
export async function runStageAgents(
  projectId: string,
  projectNo: string,
  stageId: string,
  actor: string,
  source: string = "web",
): Promise<StageRunResult> {
  const spec = loadSpec();
  const stage = spec.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`Unknown stage ${stageId}`);

  const db = getDb();
  const now = new Date().toISOString();
  const runId = ulid();
  db.run(
    "INSERT INTO process_run (id, project_id, spec_version, stage, status, source, started_by, started_at) VALUES (?,?,?,?,?,?,?,?)",
    [runId, projectId, spec.meta.version, stageId, "running", source, actor, now],
  );

  const evidence = dealEvidenceSnapshot(projectId);
  const positions: Array<{ agent_key: string; position_md: string }> = [];

  for (const activity of stage.activities) {
    const agentRunId = ulid();
    const startedAt = new Date().toISOString();
    db.run(
      "INSERT INTO agent_run (id, process_run_id, activity_id, agent_key, status, source, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?)",
      [agentRunId, runId, activity.id, activity.agent, "done", "agent", startedAt, new Date().toISOString()],
    );
    const messages: LlmMessage[] = [
      { role: "system", content: `당신은 신규사업 검토 팀의 ${activity.agent}입니다. 아래 딜 데이터에 근거해 담당 활동을 수행하고 입장을 한국어 마크다운으로 제시합니다. 근거 없는 추측은 금지입니다.` },
      {
        role: "user",
        content: [
          `딜: ${projectNo}`,
          `스테이지: ${stageId} ${stage.name}`,
          `활동: ${activity.id} (skills: ${activity.skills.join(", ")}, procedure: ${activity.procedure.join(", ")})`,
          `필요 산출물: ${stage.requiredArtifacts.join(", ")}`,
          "",
          "## 딜 데이터 스냅샷",
          evidence,
          "",
          "위 데이터에 근거해 이 활동의 수행 결과(입장)를 작성하세요.",
        ].join("\n"),
      },
    ];
    const out = await completeOrFallback(messages, () =>
      [
        `**${activity.id} 활동 결과 (결정론적 합성)**`,
        "",
        `- 대상: ${projectNo}`,
        `- 현재 기록된 데이터: ${evidence.split("\n").join("\n- ")}`,
        "- 산출물: 활동 수행 결과는 저장된 데이터 범위 내에서만 기술됩니다.",
      ].join("\n"),
    );
    db.run(
      "INSERT INTO agent_position (id, process_run_id, agent_key, position_md, confidence, round, created_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), runId, activity.agent, out.text, out.source === "llm" ? 80 : 60, 1, new Date().toISOString()],
    );
    positions.push({ agent_key: activity.agent, position_md: out.text });
  }

  // pm synthesis — the stage conclusion + gate recommendation
  const allPositions = positions.map((p) => `### ${p.agent_key}\n${p.position_md}`).join("\n\n");
  const synthMessages: LlmMessage[] = [
    { role: "system", content: "당신은 신규사업 검토 팀의 PM입니다. 전문 에이전트들의 입장을 종합해 스테이지 결론과 게이트 권고를 작성합니다." },
    {
      role: "user",
      content: [
        `딜: ${projectNo} / 스테이지: ${stageId} ${stage.name}`,
        `완료 기준: ${stage.completionCriteria.join(" / ")}`,
        "",
        "## 에이전트 입장들",
        allPositions,
        "",
        "위 내용을 종합해 결론과 함께 마지막 줄에 `권고: GO|HOLD|KILL` 형식으로 권고를 제시하세요.",
      ].join("\n"),
    },
  ];
  const synthesis = await completeOrFallback(synthMessages, () =>
    [
      `## ${stageId} ${stage.name} 종합 (결정론적 합성)`,
      "",
      ...positions.map((p) => `- ${p.agent_key}: 수행 완료`),
      "",
      "저장된 데이터 범위 내에서 스테이지 활동이 수행되었습니다.",
    ].join("\n"),
  );

  const conclusionMd = synthesis.text;
  const recMatch = conclusionMd.match(/권고:\s*(GO|HOLD|KILL)/i);
  const recommendation = (recMatch?.[1]?.toLowerCase() ?? "hold") as "go" | "hold" | "kill";

  // Gate evaluation from the stage's primary gate
  const primaryGate = stage.gates[stage.gates.length - 1];
  const evalId = ulid();
  db.run(
    `INSERT INTO gate_evaluation (id, process_run_id, gate, criteria_json, score, evidence_json, recommendation, evaluated_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [evalId, runId, primaryGate, JSON.stringify(stage.gates.map((g) => ({ gate: g }))), null,
      JSON.stringify({ positions: positions.length, sources: positions.map(() => synthesis.source).slice(0, 1) }),
      recommendation, "agent", now],
  );
  // Non-IC gates: the agent decision is recorded directly (override_allowed —
  // a human can re-issue via gate-decisions). IC gates stay human: only the
  // evaluation/recommendation is recorded there.
  if (!["entity_ic", "group_ic"].includes(primaryGate)) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), "project", projectId, primaryGate, recommendation,
        conclusionMd.slice(0, 500), null, "agent:orchestrator", new Date().toISOString()],
    );
  }
  db.run("UPDATE process_run SET status = 'done', finished_at = ? WHERE id = ?", [new Date().toISOString(), runId]);

  return {
    process_run_id: runId,
    stage: stageId,
    conclusion_md: conclusionMd,
    recommendation,
    gate: primaryGate,
    positions: positions.map((p) => ({ agent_key: p.agent_key, position_md: p.position_md })),
  };
}

