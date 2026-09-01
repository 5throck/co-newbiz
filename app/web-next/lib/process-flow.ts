// Process engine — docs/process-flow.md. Computes the derived process state
// for an Opportunity (S1→S3) from persisted artifacts and gate decisions.
// current_stage is NEVER stored: UI and (future) agent orchestrators both call
// evaluateProcess().
//
// S4 이후(트랙 결정·딜/프로젝트 워크플로우)는 flow.spec v2.0.0 재설계에 따라
// 재구축 예정 — 기존 S4~S7 웹 기능은 제거되었다.
import { getDb } from "../../../db/client.ts";

export type StageId = "S1" | "S2" | "S3";
export type GateId = "screening" | "pre_fs" | "fs" | "dd" | "entity_ic" | "group_ic";
export type GateVerdict = "pending" | "go" | "hold" | "kill";

export interface StageDefinition {
  id: StageId;
  name: string;
  sequence: number;
  objective: string;
  applicableTracks: Array<"greenfield" | "brownfield" | "all">;
  gateIds: GateId[];
  requiredArtifacts: string[]; // human-readable artifact identifiers
}

export const STAGES: StageDefinition[] = [
  { id: "S1", name: "시장분석", sequence: 1, objective: "어디에 기회가 있는가?", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["시장 규모·성장 추정", "가치사슬 구조"] },
  { id: "S2", name: "기회 발굴", sequence: 2, objective: "무엇을 할 것인가?", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["기회 등록(가치사슬 노드·매력도)"] },
  { id: "S3", name: "시너지·전략적 적합성", sequence: 3, objective: "우리가 해야 하는가?", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["시너지 평가", "전략적 적합성 판단"] },
];

export type ProcessEntity =
  | { type: "opportunity"; id: string }
  | { type: "project"; id: string };

export interface ProcessEvaluation {
  entity: ProcessEntity;
  currentStage: StageId | null;
  completedStages: StageId[];
  blockedStages: StageId[];
  nextStage: StageId | null;
  blockers: string[];
  requiredArtifacts: string[];
  gateStatus: Partial<Record<GateId, GateVerdict>>;
  track: "greenfield" | "brownfield" | null;
  subTrack: string | null;
  terminated: boolean; // KILL recorded — process ends
  stages: Array<StageDefinition & { status: "complete" | "current" | "blocked" | "locked" | "terminated" }>;
}

function latestGateDecisions(entityType: "opportunity" | "project", entityId: string): Map<GateId, { decision: GateVerdict; missing: string[] | null; rationale: string }> {
  const rows = getDb()
    .query(
      `SELECT gate, decision, missing_artifacts_json, rationale FROM (
         SELECT gate, decision, missing_artifacts_json, rationale,
                ROW_NUMBER() OVER (PARTITION BY gate ORDER BY decided_at DESC, id DESC) AS rn
         FROM gate_decision WHERE entity_type = ? AND entity_id = ?
       ) WHERE rn = 1`,
    )
    .all(entityType, entityId) as Array<{ gate: GateId; decision: GateVerdict; missing_artifacts_json: string | null; rationale: string }>;
  return new Map(rows.map((r) => [r.gate, { decision: r.decision, missing: r.missing_artifacts_json ? JSON.parse(r.missing_artifacts_json) : null, rationale: r.rationale }]));
}

// ── Opportunity stage completion (S1–S3) ─────────────────────────────────
function evaluateOpportunityStage(stage: StageDefinition, opp: OpportunityRow): { complete: boolean; blockers: string[]; missing: string[] } {
  let blockers: string[] = [];
  const missing: string[] = [];
  let complete = false;
  if (stage.id === "S1") {
    // S1 산출물은 산업 단위 시장분석(market-sizing 매트릭스·프록시 체인)이다.
    // 기회가 분석된 산업(market_scope)에서 파생된 경우 산업 산출물로
    // 완료기준을 대체 충족한다 — 개별 기회 필드는 S2 평가 입력으로 보완된다.
    const industry = opp.market_scope
      ? getDb()
          .query("SELECT id FROM md_industry WHERE name_ko = ? LIMIT 1")
          .get(opp.market_scope) as { id: string } | undefined
      : undefined;
    const hasMatrix = !!industry
      && !!getDb()
        .query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? AND status = 'completed' LIMIT 1")
        .get(industry.id);
    const hasChain = !!industry
      && !!getDb()
        .query("SELECT id FROM proxy_link WHERE from_industry_id = ? OR to_industry_id = ? LIMIT 1")
        .get(industry.id, industry.id);
    if (opp.market_size_krw_m === null || opp.growth_rate === null) {
      if (hasMatrix) {
        blockers.push("산업 시장분석 매트릭스로 대체 충족 — 기회 필드(규모·성장률)는 S2 평가 전 입력 권장");
      } else {
        blockers.push("시장 규모·성장 추정이 필요합니다 (시장분석에서 산업 분석 후 기회 등록)");
        missing.push("시장 규모·성장 추정");
      }
    }
    if (!opp.value_chain_node) {
      if (hasChain || hasMatrix) {
        blockers.push("산업 가치사슬 구조로 대체 충족 — value_chain_node 입력 권장");
      } else {
        blockers.push("가치사슬 노드가 필요합니다");
        missing.push("가치사슬 구조");
      }
    }
    complete = !missing.length; // blockers에 권고 문구가 있어도 산출물이 있으면 완료
  } else if (stage.id === "S2") {
    if (opp.attractiveness_score === null) { blockers.push("매력도 평가가 필요합니다"); missing.push("기회 매력도 평가"); }
    complete = blockers.length === 0;
  } else if (stage.id === "S3") {
    if (opp.synergy_score === null) { blockers.push("시너지 평가가 필요합니다"); missing.push("시너지 평가"); }
    if (!opp.rationale) { blockers.push("전략적 적합성 판단 근거가 필요합니다"); missing.push("전략적 적합성 판단"); }
    complete = blockers.length === 0;
  }
  return { complete, blockers, missing };
}

interface OpportunityRow {
  id: string;
  name: string;
  market_scope: string | null;
  market_size_krw_m: number | null;
  growth_rate: number | null;
  value_chain_node: string | null;
  attractiveness_score: number | null;
  synergy_score: number | null;
  rationale: string | null;
  status: string;
}

export function evaluateProcess(entity: ProcessEntity): ProcessEvaluation {
  const db = getDb();
  const stages: ProcessEvaluation["stages"] = [];
  const completedStages: StageId[] = [];
  const blockedStages: StageId[] = [];
  let blockers: string[] = [];
  let currentStage: StageId | null = null;
  let requiredArtifacts: string[] = [];
  let terminated = false;
  let gateStatus: Partial<Record<GateId, GateVerdict>> = {};

  if (entity.type === "opportunity") {
    const opp = db
      .query("SELECT * FROM opportunity WHERE id = ?")
      .get(entity.id) as OpportunityRow | undefined;
    if (!opp) throw new Error(`opportunity ${entity.id} not found`);
    const gates = latestGateDecisions("opportunity", entity.id);
    gateStatus = Object.fromEntries([...gates.entries()].map(([g, v]) => [g, v.decision]));
    terminated = [...gates.values()].some((g) => g.decision === "kill");
    const screening = gates.get("screening");

    let priorComplete = true;
    for (const stage of STAGES) {
      if (terminated) {
        stages.push({ ...stage, status: "terminated" });
        continue;
      }
      if (!priorComplete) {
        // Sequential entry: a stage cannot be current/complete before its
        // predecessors complete (entry criteria, process-flow.md §3).
        blockedStages.push(stage.id);
        stages.push({ ...stage, status: "locked" });
        continue;
      }
      const res = evaluateOpportunityStage(stage, opp);
      if (res.complete) {
        completedStages.push(stage.id);
        stages.push({ ...stage, status: "complete" });
      } else {
        priorComplete = false;
        if (currentStage === null) {
          currentStage = stage.id;
          requiredArtifacts = res.missing;
          blockers = res.blockers;
          // HOLD blocks re-evaluation of the stage's gate, not the work itself.
          stages.push({ ...stage, status: "current" });
        } else {
          blockedStages.push(stage.id);
          stages.push({ ...stage, status: "locked" });
        }
      }
    }
    // Screening gate decision applies after S3 artifacts exist.
    if (screening && !terminated) {
      if (screening.decision === "hold") {
        blockers.push(`Screening 게이트 HOLD — 보완 필요: ${(screening.missing ?? []).join(", ") || "근거 확인"}`);
        requiredArtifacts = screening.missing ?? requiredArtifacts;
      }
    }
  }

  const nextStage =
    currentStage && !terminated
      ? (STAGES.find((s) => s.sequence === (STAGES.find((s) => s.id === currentStage)?.sequence ?? 0) + 1)?.id ?? null)
      : null;

  // Deduplicate blockers — the same blocker can be pushed by multiple stage
  // evaluations; show it once.
  const uniqueBlockers = [...new Set(blockers)];

  return {
    entity,
    currentStage,
    completedStages,
    blockedStages,
    nextStage,
    blockers: uniqueBlockers,
    requiredArtifacts,
    gateStatus,
    track: null,
    subTrack: null,
    terminated,
    stages,
  };
}
