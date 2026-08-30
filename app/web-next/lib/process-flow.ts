// Process engine — docs/process-flow.md §6. Computes the derived process
// state for an Opportunity (S1→S4) or a Project/Deal (S5→S7) from persisted
// artifacts, route decisions, and gate decisions. current_stage is NEVER
// stored: UI and (future) agent orchestrators both call evaluateProcess().
import { getDb } from "../../../db/client.ts";
import { getChecklistItems } from "./library.ts";

export type StageId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";
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
  { id: "S4", name: "진출방식 결정", sequence: 4, objective: "어떻게 들어갈 것인가?", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["트랙 결정(GF/BF)·근거"] },
  { id: "S5", name: "사업성 분석", sequence: 5, objective: "돈이 되는가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["pre_fs", "fs"], requiredArtifacts: ["Business Case(비용·수익 라인 또는 밸류에이션)"] },
  { id: "S6", name: "실사·검증", sequence: 6, objective: "사실인가? 위험은 무엇인가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["dd"], requiredArtifacts: ["DD 체크리스트 판정(필수 항목 해소)"] },
  { id: "S7", name: "투자심사·실행", sequence: 7, objective: "투자할 것인가?", applicableTracks: ["greenfield", "brownfield"], gateIds: ["entity_ic", "group_ic"], requiredArtifacts: ["IC 패키지(사업계획·DD·RAG·검토)"] },
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

function trackOfProject(projectId: string): { track: "greenfield" | "brownfield" | null; subTrack: string | null } {
  const row = getDb()
    .query(
      `SELECT track, sub_track FROM (
         SELECT track, sub_track, ROW_NUMBER() OVER (ORDER BY decided_at DESC, id DESC) AS rn
         FROM route_decision WHERE project_id = ?
       ) WHERE rn = 1`,
    )
    .get(projectId) as { track: "greenfield" | "brownfield"; sub_track: string | null } | undefined;
  return row ? { track: row.track, subTrack: row.sub_track } : { track: null, subTrack: null };
}

// ── Opportunity stage completion (S1–S4) ─────────────────────────────────
function evaluateOpportunityStage(stage: StageDefinition, opp: OpportunityRow, gates: Map<GateId, { decision: GateVerdict; missing: string[] | null }>): { complete: boolean; blockers: string[]; missing: string[] } {
  let blockers: string[] = [];
  const missing: string[] = [];
  let complete = false;
  if (stage.id === "S1") {
    if (opp.market_size_krw_m === null || opp.growth_rate === null) { blockers.push("시장 규모·성장 추정이 필요합니다"); missing.push("시장 규모·성장 추정"); }
    if (!opp.value_chain_node) { blockers.push("가치사슬 노드가 필요합니다"); missing.push("가치사슬 구조"); }
    complete = blockers.length === 0;
  } else if (stage.id === "S2") {
    if (opp.attractiveness_score === null) { blockers.push("매력도 평가가 필요합니다"); missing.push("기회 매력도 평가"); }
    complete = blockers.length === 0;
  } else if (stage.id === "S3") {
    if (opp.synergy_score === null) { blockers.push("시너지 평가가 필요합니다"); missing.push("시너지 평가"); }
    if (!opp.rationale) { blockers.push("전략적 적합성 판단 근거가 필요합니다"); missing.push("전략적 적합성 판단"); }
    complete = blockers.length === 0;
  } else if (stage.id === "S4") {
    const decision = listRouteDecisionsForOpp(opp.id);
    if (decision.length === 0) { blockers.push("진출방식 결정(GF/BF)이 필요합니다"); missing.push("트랙 결정·근거"); }
    complete = decision.length > 0;
  }
  return { complete, blockers, missing };
}

function listRouteDecisionsForOpp(opportunityId: string) {
  return getDb()
    .query("SELECT id, track, sub_track FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC")
    .all(opportunityId) as Array<{ id: string; track: string; sub_track: string | null }>;
}

// ── Project stage completion (S5–S7) ─────────────────────────────────────
// A DD workspace is "fully assessed" when every checklist item defined in the
// gate-checklist YAML (the SSOT) has a recorded state and none is pending/fail
// — recorded-count-only would let a half-filled checklist pass.
function ddWorkspaceFullyAssessed(projectId: string, kind: string): { assessed: boolean; mandatoryOpen: number } {
  const checklistId = { commercial: "chk-commercial-dd-checklist", technical: "chk-technical-dd-checklist", legal: "chk-legal-dd-checklist" }[kind];
  if (!checklistId) return { assessed: false, mandatoryOpen: 0 };
  const items = getChecklistItems(checklistId);
  if (!items || items.length === 0) return { assessed: false, mandatoryOpen: 0 };
  const states = getDb()
    .query(
      "SELECT item_id, status FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = ?",
    )
    .all(projectId, checklistId) as Array<{ item_id: string; status: string }>;
  const byItem = new Map(states.map((s) => [s.item_id, s.status]));
  let mandatoryOpen = 0;
  let assessed = 0;
  for (const item of items) {
    const st = byItem.get(item.id) ?? "pending";
    if (st !== "pending") assessed++;
    if (item.mandatory && !["pass", "na", "waived"].includes(st)) mandatoryOpen++;
  }
  return { assessed: assessed === items.length && items.length > 0, mandatoryOpen };
}

function evaluateProjectStage(stage: StageDefinition, track: "greenfield" | "brownfield" | null, projectId: string): { complete: boolean; blockers: string[]; missing: string[] } {
  let blockers: string[] = [];
  const missing: string[] = [];
  const db = getDb();
  let complete = false;
  if (stage.id === "S5") {
    if (track === null) {
      blockers.push("진출방식 결정이 필요합니다 (S4)");
      missing.push("트랙 결정");
    } else if (track === "greenfield") {
      const model = db
        .query(
          `SELECT m.id,
                  (SELECT COUNT(*) FROM business_case_line l WHERE l.model_id = m.id) AS lines
           FROM business_case_model m WHERE m.project_id = ? AND m.kind = 'greenfield_cost' LIMIT 1`,
        )
        .get(projectId) as { id: string; lines: number } | undefined;
      if (!model || model.lines === 0) {
        blockers.push("Greenfield 비용·수익 모델(라인 포함)이 필요합니다");
        missing.push("Business Case(비용·수익 라인)");
      } else complete = true;
    } else {
      // Brownfield: Commercial-DD-led valuation — CDD checklist assessment started.
      const cdd = ddWorkspaceFullyAssessed(projectId, "commercial");
      if (!cdd.assessed) {
        blockers.push("Commercial DD(밸류에이션) 평가 시작이 필요합니다");
        missing.push("Commercial DD 밸류에이션");
      } else complete = true;
    }
  } else if (stage.id === "S6") {
    if (track === null) {
      blockers.push("진출방식 결정이 필요합니다 (S4)");
    } else {
      const kinds = track === "brownfield" ? ["commercial", "technical", "legal"] : ["technical", "legal"];
      const openKinds: string[] = [];
      for (const k of kinds) {
        const w = ddWorkspaceFullyAssessed(projectId, k);
        if (!w.assessed || w.mandatoryOpen > 0) openKinds.push(k);
      }
      if (openKinds.length > 0) {
        blockers.push(`DD 체크리스트 미완료: ${openKinds.join(", ")}`);
        missing.push("DD 체크리스트 판정(필수 항목 해소)");
      } else complete = true;
    }
  } else if (stage.id === "S7") {
    // S7 completion = Group IC approved; entry = all prior stages complete.
    const chain = db
      .query(
        `SELECT level, decision FROM (
            SELECT level, decision, ROW_NUMBER() OVER (PARTITION BY level ORDER BY decided_at DESC NULLS LAST, id DESC) AS rn
            FROM approval_chain WHERE project_id = ? AND level IN ('entity','group')
         ) WHERE rn = 1`,
      )
      .all(projectId) as Array<{ level: string; decision: string | null }>;
    const entity = chain.find((c) => c.level === "entity");
    const group = chain.find((c) => c.level === "group");
    // gate_decision mirrors (entity_type='project') count alongside the
    // approval_chain so the S7 flow can be driven via the API.
    const mirror = (gate: "entity_ic" | "group_ic") =>
      (
        db
          .query(
            "SELECT decision FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate = ? ORDER BY decided_at DESC LIMIT 1",
          )
          .get(projectId, gate) as { decision: GateVerdict } | undefined
      )?.decision;
    const entityGo = entity?.decision === "approved" || mirror("entity_ic") === "go";
    const groupGo = group?.decision === "approved" || mirror("group_ic") === "go";
    if (entityGo && groupGo) complete = true;
    else if (entityGo) blockers.push("Group IC 승인 대기");
  }
  return { complete, blockers, missing };
}

interface OpportunityRow {
  id: string;
  name: string;
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
  let track: "greenfield" | "brownfield" | null = null;
  let subTrack: string | null = null;
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
    const route = listRouteDecisionsForOpp(entity.id);
    if (route.length > 0) {
      track = route[0].track as "greenfield" | "brownfield";
      subTrack = route[0].sub_track;
    }

    let priorComplete = true;
    for (const stage of STAGES.filter((s) => ["S1", "S2", "S3", "S4"].includes(s.id))) {
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
      const res = evaluateOpportunityStage(stage, opp, gates);
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
  } else {
    // Project lifecycle: S5→S7. Track comes from the route decision.
    const route = trackOfProject(entity.id);
    track = route.track;
    subTrack = route.subTrack;
    const gates = latestGateDecisions("project", entity.id);
    // S7 gate status mirrors the human approval chain.
    const chain = db
      .query(
        `SELECT level, decision FROM (
            SELECT level, decision, ROW_NUMBER() OVER (PARTITION BY level ORDER BY decided_at DESC NULLS LAST, id DESC) AS rn
            FROM approval_chain WHERE project_id = ? AND level IN ('entity','group')
         ) WHERE rn = 1`,
      )
      .all(entity.id) as Array<{ level: string; decision: string | null }>;
    const entityDecision = chain.find((c) => c.level === "entity")?.decision ?? null;
    const groupDecision = chain.find((c) => c.level === "group")?.decision ?? null;
    // S7: approval_chain (human committee) is authoritative; a recorded
    // gate_decision mirror also counts so the flow can be driven via the API.
    const icOf = (gate: "entity_ic" | "group_ic", chainDecision: string | null): GateVerdict => {
      const mirror = gates.get(gate)?.decision;
      if (mirror) return mirror;
      if (chainDecision === "approved") return "go";
      if (chainDecision === "rejected") return "kill";
      return "pending";
    };
    gateStatus = {
      ...Object.fromEntries([...gates.entries()].map(([g, v]) => [g, v.decision])),
      entity_ic: icOf("entity_ic", entityDecision),
      group_ic: icOf("group_ic", groupDecision),
    };
    terminated = [...Object.values(gateStatus)].some((d) => d === "kill");

    const projectStages = STAGES.filter((s) => ["S5", "S6", "S7"].includes(s.id));
    let priorComplete2 = true;
    for (const stage of projectStages) {
      if (terminated) {
        stages.push({ ...stage, status: "terminated" });
        continue;
      }
      if (track === null && stage.id !== "S5") {
        blockedStages.push(stage.id);
        stages.push({ ...stage, status: "locked" });
        blockers.push("진출방식 결정이 필요합니다 (S4)");
        continue;
      }
      const res = evaluateProjectStage(stage, track, entity.id);
      if (!priorComplete2) {
        blockedStages.push(stage.id);
        stages.push({ ...stage, status: "locked" });
        continue;
      }
      if (res.complete) {
        completedStages.push(stage.id);
        stages.push({ ...stage, status: "complete" });
      } else {
        priorComplete2 = false;
        if (currentStage === null) {
          currentStage = stage.id;
          requiredArtifacts = res.missing;
          blockers = res.blockers;
          stages.push({ ...stage, status: "current" });
        } else {
          blockedStages.push(stage.id);
          stages.push({ ...stage, status: "locked" });
        }
      }
    }
    if (track === null && currentStage === null) {
      currentStage = "S5";
      blockers = ["진출방식 결정이 필요합니다 (S4)"];
      requiredArtifacts = ["트랙 결정"];
      stages.length = 0;
      for (const stage of projectStages) {
        stages.push({ ...stage, status: stage.id === "S5" ? "current" : "locked" });
      }
    }
    if (currentStage === null && !terminated) {
      currentStage = "S7";
      stages[stages.length - 1].status = "current";
    }
  }

  const nextStage =
    currentStage && !terminated
      ? (STAGES.find((s) => s.sequence === (STAGES.find((s) => s.id === currentStage)?.sequence ?? 0) + 1)?.id ?? null)
      : null;

  // Deduplicate blockers — the same blocker (e.g. S4 route undecided) can be
  // pushed by multiple stage evaluations; show it once.
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
    track,
    subTrack,
    terminated,
    stages,
  };
}

// Route decisions for the project lifecycle — re-exported for the API layer.
function listRouteDecisionsForProject(projectId: string) {
  return getDb()
    .query("SELECT id, track, sub_track FROM route_decision WHERE project_id = ? ORDER BY decided_at DESC")
    .all(projectId) as Array<{ id: string; track: string; sub_track: string | null }>;
}

// Compact S5–S7 summary for deal list cards (no opportunity context —
// callers wanting the full S1–S7 view use evaluateProcess on the linked
// opportunity). Same criteria as the project branch of evaluateProcess.
export function evaluateProjectStageSummary(projectId: string): {
  track: "greenfield" | "brownfield" | null;
  routeDecided: boolean;
  stages: Array<{ id: StageId; status: "complete" | "current" | "locked" }>;
} {
  const route = trackOfProject(projectId);
  const track = route.track;
  const routeDecided = track !== null;
  const db = getDb();
  const out: Array<{ id: StageId; status: "complete" | "current" | "locked" }> = [];
  let priorComplete = true;
  let currentAssigned = false;
  for (const stage of STAGES.filter((s) => ["S5", "S6", "S7"].includes(s.id))) {
    if (!routeDecided) {
      out.push({ id: stage.id, status: "locked" });
      continue;
    }
    const res = evaluateProjectStage(stage, track, projectId);
    if (res.complete) {
      out.push({ id: stage.id, status: "complete" });
    } else if (priorComplete && !currentAssigned) {
      currentAssigned = true;
      priorComplete = false;
      out.push({ id: stage.id, status: "current" });
    } else {
      priorComplete = false;
      out.push({ id: stage.id, status: "locked" });
    }
  }
  return { track, routeDecided, stages: out };
}
