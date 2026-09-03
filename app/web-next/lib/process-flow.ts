// Process engine — docs/process-flow.md. Computes the derived process state
// for an Opportunity (S1→S7) from persisted artifacts and gate decisions.
// current_stage is NEVER stored: UI and (future) agent orchestrators both call
// evaluateProcess().
//
// Opportunity는 S1~S7 라이프사이클 캐리어다 (ADR-0094) — spec의 project 엔티티는
// S8+ 승격 시점에 도입하며, S5~S7 화면·API는 모두 opportunityId 기준으로 동작한다.
// 비적용 단계(brownfield의 S5, greenfield의 S6/S7)는 'skipped'로 표시된다.
import { getDb } from "../../../db/client.ts";
import { listTargets, screeningSummary } from "./brownfield-targets.ts";

export type StageId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";
export type GateId = "screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic";
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
  { id: "S4", name: "진출방식 결정", sequence: 4, objective: "어떻게 들어갈 것인가?", applicableTracks: ["all"], gateIds: ["screening", "pre_fs"], requiredArtifacts: ["route_decision(트랙)", "brownfield: sub_track + 5-criteria 채점"] },
  { id: "S5", name: "역량 평가·진출전략", sequence: 5, objective: "스스로 진입할 수 있는가?", applicableTracks: ["greenfield"], gateIds: ["pre_fs"], requiredArtifacts: ["역량 격차·해소 방식", "진출전략", "검토한 대안"] },
  { id: "S6", name: "대상 후보 발굴", sequence: 6, objective: "누구와 결합할 것인가?", applicableTracks: ["brownfield"], gateIds: ["pre_fs"], requiredArtifacts: ["Target Universe 정의", "Long List 최소 커버리지"] },
  { id: "S7", name: "대상 스크리닝", sequence: 7, objective: "어떤 대상이 유망한가?", applicableTracks: ["brownfield"], gateIds: ["target_screening"], requiredArtifacts: ["후보별 스크리닝 근거", "Short List 또는 제외 사유"] },
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
  stages: Array<StageDefinition & { status: "complete" | "current" | "blocked" | "locked" | "skipped" | "terminated" }>;
}

export function latestGateDecisions(entityType: "opportunity" | "project", entityId: string): Map<GateId, { decision: GateVerdict; missing: string[] | null; rationale: string }> {
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
// Latest gate_decision per gate is shared by the process engine and the
// gate-decisions API so the tie-breaking rule cannot drift between surfaces.

export function latestRouteDecision(opportunityId: string): { id: string; track: "greenfield" | "brownfield"; sub_track: string | null } | undefined {
  return getDb()
    .query("SELECT id, track, sub_track FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1")
    .get(opportunityId) as { id: string; track: "greenfield" | "brownfield"; sub_track: string | null } | undefined;
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
    // flow.spec S3 completionCriteria: 최소 1개 기회가 selected. 이 기회 자체가
    // 진출 검토 대상으로 선택되지 않았으면 S4로 진행할 수 없다.
    if (opp.status === "dropped") {
      blockers.push("제외(dropped)된 기회입니다 — S4 진행 대상이 아닙니다");
      missing.push("기회 선택(selected)");
    } else if (opp.status !== "selected") {
      blockers.push("기회 선택(selected)이 필요합니다 — 시너지·적합성 평가 후 진출 대상으로 선택");
      missing.push("기회 선택(selected)");
    }
    complete = missing.length === 0;
  } else if (stage.id === "S4") {
    // flow.spec S4 completionCriteria: route_decision 존재(트랙 필수).
    // brownfield는 sub_track(7 라우트 중 1)과 5-criteria 채점까지 요구한다.
    const decision = latestRouteDecision(opp.id);
    if (!decision) {
      blockers.push("진출방식 결정(route_decision)이 필요합니다");
      missing.push("route_decision(트랙)");
    } else if (decision.track === "brownfield") {
      if (!decision.sub_track) { blockers.push("brownfield 라우트 유형(sub_track) 선택이 필요합니다"); missing.push("brownfield sub_track"); }
      const scoreCount = (getDb().query("SELECT COUNT(*) c FROM route_decision_score WHERE decision_id = ?").get(decision.id) as { c: number }).c;
      if (scoreCount < 5) { blockers.push(`5-criteria 채점 부족 (${scoreCount}/5)`); missing.push("5-criteria 채점"); }
    }
    complete = missing.length === 0;
  } else if (stage.id === "S5") {
    // flow.spec S5 (greenfield only): 역량 격차+해소 방식, 진출전략, 검토한 대안.
    const a = getDb()
      .query("SELECT capability_gaps_json, entry_strategy, alternatives_considered FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get(opp.id) as { capability_gaps_json: string | null; entry_strategy: string | null; alternatives_considered: string | null } | undefined;
    if (!a) { blockers.push("역량 평가가 필요합니다"); missing.push("역량 격차 평가"); }
    else {
      let gapCount = 0;
      try { gapCount = a.capability_gaps_json ? (JSON.parse(a.capability_gaps_json) as unknown[]).length : 0; } catch { /* unparseable = empty */ }
      if (gapCount === 0) { blockers.push("역량 격차 항목이 필요합니다"); missing.push("역량 격차·해소 방식"); }
      if (!a.entry_strategy) { blockers.push("진출전략이 필요합니다"); missing.push("진출전략"); }
      if (!a.alternatives_considered) { blockers.push("검토한 대안 기록이 필요합니다"); missing.push("검토한 대안"); }
    }
    complete = missing.length === 0;
  } else if (stage.id === "S6") {
    // flow.spec S6 (brownfield only): Target Universe 정의 + Long List 최소 커버리지.
    let universe: { min_long_list?: number } | null = null;
    try { universe = opp.target_universe_json ? JSON.parse(opp.target_universe_json) as { min_long_list?: number } : null; } catch { /* treat as undefined */ }
    if (!universe) {
      blockers.push("Target Universe 정의가 필요합니다 (선정 기준·커버리지·최소 후보 수)");
      missing.push("Target Universe 정의");
      return { complete, blockers, missing };
    }
    const minLongList = typeof universe.min_long_list === "number" && universe.min_long_list > 0 ? universe.min_long_list : 3;
    const longList = (getDb().query("SELECT COUNT(*) c FROM brownfield_target WHERE opportunity_id = ? AND status != 'excluded'").get(opp.id) as { c: number }).c;
    if (longList < minLongList) {
      blockers.push(`Long List 커버리지 부족 (${longList}/${minLongList})`);
      missing.push("Long List 최소 커버리지");
    }
    complete = missing.length === 0;
  } else if (stage.id === "S7") {
    // flow.spec S7 (brownfield only): 전 후보가 shortlisted(스크리닝 근거 포함) 또는
    // exclusion_reason 보유. Kill criterion: knock-out 통과 후보 0건 → KILL 검토.
    const targets = listTargets(opp.id);
    if (targets.length === 0) {
      blockers.push("스크리닝 대상 후보가 필요합니다 (Long List에서 추가)");
      missing.push("대상 후보 스크리닝");
      return { complete, blockers, missing };
    }
    const unresolved = targets.filter((t) => t.status !== "shortlisted" && !(t.status === "excluded" && t.exclusion_reason));
    if (unresolved.length > 0) {
      blockers.push(`판정 대기 후보 ${unresolved.length}건 — Short List 승격 또는 제외 사유 기록 필요`);
      missing.push("후보별 스크리닝 판정");
    }
    const koPassed = targets.filter((t) => t.status === "shortlisted" && screeningSummary(t).knockOutsPassed);
    if (koPassed.length === 0) {
      blockers.push("knock-out 통과 후보 0건 — Target Screening 게이트 KILL 기준 검토가 필요합니다");
      missing.push("knock-out 통과 Short List");
    }
    complete = missing.length === 0;
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
  target_universe_json: string | null;
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
  let track: "greenfield" | "brownfield" | null = null;
  let subTrack: string | null = null;

  if (entity.type === "opportunity") {
    const opp = db
      .query("SELECT * FROM opportunity WHERE id = ?")
      .get(entity.id) as OpportunityRow | undefined;
    if (!opp) throw new Error(`opportunity ${entity.id} not found`);
    const gates = latestGateDecisions("opportunity", entity.id);
    gateStatus = Object.fromEntries([...gates.entries()].map(([g, v]) => [g, v.decision]));
    terminated = [...gates.values()].some((g) => g.decision === "kill");
    const screening = gates.get("screening");

    // 트랙은 S4 route_decision에서 도출한다 (S4 이전에는 unknown → S5~S7 locked).
    const routeDecision = latestRouteDecision(entity.id);
    track = routeDecision?.track ?? null;
    subTrack = routeDecision?.sub_track ?? null;

    let priorComplete = true;
    for (const stage of STAGES) {
      if (terminated) {
        stages.push({ ...stage, status: "terminated" });
        continue;
      }
      // 트랙 비적용 단계는 skipped — 완료·차단 어느 쪽도 아니며 다음 단계 진행을 막지 않는다.
      if (track !== null && !stage.applicableTracks.includes("all") && !stage.applicableTracks.includes(track)) {
        stages.push({ ...stage, status: "skipped" });
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

  // 다음 단계는 currentStage 바로 다음이 아니라, 트랙 비적용(skipped) 단계를
  // 건너뛴 첫 실제 단계다 (brownfield S4 → nextStage S6, S5는 skip).
  const currentSequence = currentStage ? STAGES.find((s) => s.id === currentStage)?.sequence ?? 0 : 0;
  const nextStage =
    currentStage && !terminated
      ? (stages.find((s) => s.sequence > currentSequence && s.status !== "skipped")?.id ?? null)
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
    track,
    subTrack,
    terminated,
    stages,
  };
}
