// Process engine — docs/process-flow.md. Computes the derived process state
// for an Opportunity (S1→S7) or a promoted Project (S8→S12, ADR-0095) from
// persisted artifacts and gate decisions. current_stage is NEVER stored: UI and
// (future) agent orchestrators both call evaluateProcess().
//
// Opportunity는 S1~S7 라이프사이클 캐리어다 (ADR-0094) — 승격(promotion,
// ADR-0095) 이후 project가 S8~S12 캐리어가 되며, S5~S7 화면·API는 모두
// opportunityId 기준으로 동작한다. 비적용 단계(brownfield의 S5, greenfield의
// S6/S7)는 'skipped'로 표시된다.
import { getDb } from "../../../db/client.ts";
import { listTargets, screeningSummary } from "./brownfield-targets.ts";
import { ddCompletionSummary } from "./dd-checklist-tailor.ts";
import { establishmentProgress } from "./establishment.ts";
import { isFreshReviewCycle } from "./portfolio.ts";

export type StageId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9" | "S10" | "S11" | "S12";
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
// Derived verbatim from process/flow.spec.yaml (id·name·sequence·objective·
// gates·requiredArtifacts). Parity is enforced by
// tests/unit/process-flow.test.ts — regenerate via that script path, do not
// hand-edit divergent strings. applicableTracks ["all"] == spec
// [greenfield, brownfield] (engine normalization for the skip logic).
  { id: "S1", name: "시장분석", sequence: 1, objective: "어디에 기회가 있는가? — 시장 규모·성장·경쟁구조와 가치사슬을 파악한다", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["시장 규모·성장 추정", "가치사슬 구조"] },
  { id: "S2", name: "기회 발굴", sequence: 2, objective: "무엇을 할 것인가? — 가치사슬상 사업 기회를 등록·평가한다", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["기회 등록(가치사슬 노드·매력도)"] },
  { id: "S3", name: "시너지·전략적 적합성", sequence: 3, objective: "우리가 해야 하는가? — 자사 역량과의 시너지를 평가한다", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["시너지 평가", "전략적 적합성 판단"] },
  { id: "S4", name: "진출방식 결정", sequence: 4, objective: "어떻게 들어갈 것인가? — Greenfield(자체 역량 진출) vs Brownfield(기존 기업·자산 결합)를 결정한다. Brownfield ≠ M&A — M&A·JV·전략적 투자·소수점 지분·파트너십·R&BD·사내벤처(CVC) 중 Route를 고른다", applicableTracks: ["all"], gateIds: ["screening", "pre_fs"], requiredArtifacts: ["트랙 결정(GF/BF)·근거", "Brownfield 선택 시 Route 유형(M&A/JV/전략적 투자/소수점 지분/파트너십/R&BD/CVC)", "5criteria 채점 결과(통제 필요도·역량 결정성·시장 불확실성·통합 역량·역량확보 속도 각 20%)", "검토한 대안"] },
  { id: "S5", name: "역량 평가·진출전략", sequence: 5, objective: "스스로 진입할 수 있는가? — 자체 역량을 평가하고 격차를 구축 방안(Build/Partner/Hire/Invest)으로 해소해 진출전략을 세운다 (Greenfield 전용 — Target Company 객체가 존재하지 않는다)", applicableTracks: ["greenfield"], gateIds: ["pre_fs"], requiredArtifacts: ["역량 격차 평가", "진출전략(Build/Partner/Hire/Invest 결정·근거)"] },
  { id: "S6", name: "대상 후보 발굴", sequence: 6, objective: "누구와 결합할 것인가? — Opportunity에 진입 가능한 기존 기업·자산의 Target Universe를 정의하고 Target Company Long List를 작성한다 (Brownfield 전용)", applicableTracks: ["brownfield"], gateIds: ["pre_fs"], requiredArtifacts: ["Target Universe 정의", "Target Company Long List"] },
  { id: "S7", name: "대상 스크리닝", sequence: 7, objective: "어떤 대상이 유망한가? — Long List를 전략·역량·재무·소유권·규제 기준으로 스크리닝해 Target Company Short List로 좁힌다 (Brownfield 전용 — CDD/TDD는 Short List 확정 후 S9에서 수행한다)", applicableTracks: ["brownfield"], gateIds: ["target_screening"], requiredArtifacts: ["Target Company Short List", "Target Ranking/Score", "Exclusion Reasons"] },
  { id: "S8", name: "사업성 분석", sequence: 8, objective: "돈이 되는가? — Greenfield는 진출전략 기반 Business Case, Brownfield는 Short List 대상 밸류에이션을 정량화한다", applicableTracks: ["all"], gateIds: ["fs"], requiredArtifacts: ["Business Case(비용·수익 라인 또는 밸류에이션)", "시뮬레이션 NPV 분위수"] },
  { id: "S9", name: "실사·검증", sequence: 9, objective: "사실인가? 위험은 무엇인가? — 트랙별 실사 체크리스트를 수행한다 (brownfield는 Short List 대상 DD, greenfield는 실현가능성 검증)", applicableTracks: ["all"], gateIds: ["dd"], requiredArtifacts: ["DD 체크리스트 판정(필수 항목 해소)"] },
  { id: "S10", name: "투자구조 설계", sequence: 10, objective: "어떤 그릇으로, 어떤 자금으로 들어갈 것인가? — 비히클(direct/SPC/holdco/내부 스핀오프/JV)과 ADR-0045 4대 축(절세 구조·책임 격리·재무 레버리지·엑싯 구조)을 검토하고 자금조달 계획(sources & uses)을 균형시킨다 (IC 심의의 입력 설계)", applicableTracks: ["all"], gateIds: [], requiredArtifacts: ["투자구조 가설(4축 검토 완료)", "자금조달 계획(sources & uses 균형)"] },
  { id: "S11", name: "투자심사·실행", sequence: 11, objective: "투자할 것인가? — 투자 구조(Deal/Investment Structure: 비히클·자금 조달·지급 구조)를 설계하고 IC 패키지로 Entity/Group IC 심사를 받는다", applicableTracks: ["all"], gateIds: ["entity_ic", "group_ic"], requiredArtifacts: ["IC 패키지", "추진계획(차터) 기준선 — 목적·트랙 근거·진출 범위·KPI 선커밋", "사람 최종 승인(reviewer 기록)", "설립 실행 기록(설립준비·등기·인허가 분류·인력이전·완료확인 — chk-entity-formation 증적, origin∈{internal,joint})"] },
  { id: "S12", name: "사후 관리", sequence: 12, objective: "투자 후 사업이 궤도에 올랐는가? — 포트폴리오 성과를 모니터링한다", applicableTracks: ["all"], gateIds: [], requiredArtifacts: ["벤처 스코어카드"] },
];

/** S12 포트폴리오 전환 결정 어휘 5종 (flow.spec S12, portfolio-venture-monitoring). */
export const PORTFOLIO_TRANSITIONS = [
  "next_tranche_released",
  "held_evidence_incomplete",
  "graduate_to_core",
  "reduce_or_divest",
  "kill_with_learning_captured",
] as const;

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

// ── Stage completion predicate registry ──────────────────────────────────
// Each stage's completion predicate is REGISTERED here, keyed by stage id,
// instead of living in an if/else chain inside the evaluator body. A new
// stage or case type adds its own entry (and the evaluator falls back to the
// documented default for unmapped stages) — the engine body stays untouched.
// Entries return the full evaluation (blockers/missing included) so early
// returns behave identically to the original inline branches.
type StageEvaluation = { complete: boolean; blockers: string[]; missing: string[] };
interface OpportunityStageArgs {
  opp: OpportunityRow;
}
interface ProjectStageArgs {
  project: ProjectRowLite;
  gateStatus: Partial<Record<GateId, GateVerdict>>;
}

const OPPORTUNITY_STAGE_COMPLETION: Partial<Record<StageId, (args: OpportunityStageArgs) => StageEvaluation>> = {
  S1: ({ opp }) => {
    let blockers: string[] = [];
    const missing: string[] = [];
    let complete = false;
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
    return { complete, blockers, missing };
  },
  S2: ({ opp }) => {
    let blockers: string[] = [];
    const missing: string[] = [];
    let complete = false;
    if (opp.attractiveness_score === null) { blockers.push("매력도 평가가 필요합니다"); missing.push("기회 매력도 평가"); }
    complete = blockers.length === 0;
    return { complete, blockers, missing };
  },
  S3: ({ opp }) => {
    let blockers: string[] = [];
    const missing: string[] = [];
    let complete = false;
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
    return { complete, blockers, missing };
  },
  S4: ({ opp }) => {
    let blockers: string[] = [];
    const missing: string[] = [];
    let complete = false;
    // flow.spec S4 completionCriteria: route_decision 존재(트랙 필수).
    // brownfield는 sub_track(7 라우트 중 1)을 요구하고, 5-criteria 채점은
    // 양 트랙 모두 의무다 (스펙 v2.2.0+ "Greenfield인 경우에도 5criteria 채점
    // 결과를 기록한다" — ADR-0104 트랙 간 비교 가능성).
    const decision = latestRouteDecision(opp.id);
    if (!decision) {
      blockers.push("진출방식 결정(route_decision)이 필요합니다");
      missing.push("route_decision(트랙)");
    } else {
      if (decision.track === "brownfield" && !decision.sub_track) { blockers.push("brownfield 라우트 유형(sub_track) 선택이 필요합니다"); missing.push("brownfield sub_track"); }
      const scoreCount = (getDb().query("SELECT COUNT(*) c FROM route_decision_score WHERE decision_id = ?").get(decision.id) as { c: number }).c;
      if (scoreCount < 5) { blockers.push(`5-criteria 채점 부족 (${scoreCount}/5)`); missing.push("5-criteria 채점"); }
    }
    complete = missing.length === 0;
    return { complete, blockers, missing };
  },
  S5: ({ opp }) => {
    let blockers: string[] = [];
    const missing: string[] = [];
    let complete = false;
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
    return { complete, blockers, missing };
  },
  S6: ({ opp }) => {
    let blockers: string[] = [];
    const missing: string[] = [];
    let complete = false;
    // flow.spec S6 (brownfield only): Target Universe 정의 + Long List 최소 커버리지.
    let universe: { min_long_list?: number } | null = null;
    try { universe = opp.target_universe_json ? JSON.parse(opp.target_universe_json) as { min_long_list?: number } : null; } catch { /* treat as undefined */ }
    if (!universe) {
      blockers.push("Target Universe 정의가 필요합니다 (선정 기준·커버리지·최소 후보 수)");
      missing.push("Target Universe 정의");
      return { complete, blockers, missing };
    }
    const minLongList = typeof universe.min_long_list === "number" && universe.min_long_list > 0 ? universe.min_long_list : 3;
    // Coverage measures how many candidates the Long List DISCOVERED — all
    // registered rows regardless of status. Exclusions are the legitimate
    // OUTCOME of S7 screening; counting only non-excluded made every
    // post-screening exclusion retroactively regress S6 and re-lock S7+.
    const longList = (getDb().query("SELECT COUNT(*) c FROM brownfield_target WHERE opportunity_id = ?").get(opp.id) as { c: number }).c;
    if (longList < minLongList) {
      blockers.push(`Long List 커버리지 부족 (${longList}/${minLongList})`);
      missing.push("Long List 최소 커버리지");
    }
    complete = missing.length === 0;
    return { complete, blockers, missing };
  },
  S7: ({ opp }) => {
    let blockers: string[] = [];
    const missing: string[] = [];
    let complete = false;
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
    return { complete, blockers, missing };
  },
};

/** Unmapped opportunity stages default to not-complete (no blockers recorded). */
function evaluateOpportunityStage(stage: StageDefinition, opp: OpportunityRow): StageEvaluation {
  const predicate = OPPORTUNITY_STAGE_COMPLETION[stage.id];
  return predicate ? predicate({ opp }) : { complete: false, blockers: [], missing: [] };
}

interface ProjectRowLite {
  id: string;
  project_no: string;
  origin: string | null;
  track: "greenfield" | "brownfield" | null;
  source_opportunity_id: string | null;
}

/**
 * Project stage completion (S8–S12), registered per stage id in
 * PROJECT_STAGE_COMPLETION below (same registry pattern as the opportunity
 * stages — a new project stage registers a predicate instead of editing the
 * evaluator body). Each check is deliberately a SIMPLE existing-schema probe —
 * Phase 3 (FS), Phase 4 (DD), Phase 5 (IC/설립) and Phase 6 (포트폴리오)
 * refine each one against their own richer artifacts; this skeleton
 * (ADR-0095) only pins the type and the spec port. Every check is now a real
 * predicate: S8 = ADR-0098, S9 = ADR-0099, S11 = ADR-0100, S12 = ADR-0101
 * (latest-cycle freshness) — no REFINEMENT markers remain.
 */
const PROJECT_STAGE_COMPLETION: Partial<Record<StageId, (args: ProjectStageArgs) => StageEvaluation>> = {
  S8: ({ project }) => {
    const blockers: string[] = [];
    const missing: string[] = [];
    const db = getDb();
    // ADR-0098 (Phase 3): "민감도가 포함된 정량 평가가 존재한다 (시뮬레이션
    // 또는 밸류에이션 범위)" — mechanically checkable: ≥1 business_case_model
    // for the project AND ≥1 valuation_simulation row (the persisted NPV
    // percentiles). Both write paths (automatic generation and manual CRUD)
    // land in the same tables, so this check is write-path-agnostic. The
    // ADR-0095 placeholder ("REFINEMENT (Phase 3)" latest-model probe) is
    // paid off here; S9~S12 keep theirs.
    const model = db
      .query("SELECT id, kind FROM business_case_model WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(project.id) as { id: string; kind: string } | undefined;
    if (!model) {
      blockers.push("Business Case / 밸류에이션 모델이 필요합니다");
      missing.push("Business Case(비용·수익 라인 또는 밸류에이션)");
    } else {
      const sims = (db
        .query("SELECT COUNT(*) c FROM valuation_simulation WHERE project_id = ? AND model_id = ?")
        .get(project.id, model.id) as { c: number }).c;
      if (sims === 0) {
        blockers.push("민감도가 포함된 정량 평가(시뮬레이션 NPV 분위수)가 필요합니다");
        missing.push("시뮬레이션 NPV 분위수");
      }
    }
    return { complete: missing.length === 0, blockers, missing };
  },
  S9: ({ project }) => {
    const blockers: string[] = [];
    const missing: string[] = [];
    // 적용 체크리스트 범위·필수 미충족 0건 검사
    // (ADR-0099 §5 — completion summary is the single source of the counts).
    const state = ddCompletionSummary(project.id);
    if (state.total === 0) {
      blockers.push("DD 체크리스트 판정이 필요합니다");
      missing.push("DD 체크리스트 판정(필수 항목 해소)");
    } else {
      if (state.pending > 0) {
        blockers.push(`판정 대기 체크리스트 항목 ${state.pending}건이 있습니다`);
        missing.push("DD 체크리스트 판정(필수 항목 해소)");
      }
      if (state.mandatoryUnmet > 0) {
        blockers.push(`필수 항목 미충족 ${state.mandatoryUnmet}건이 있습니다 (필수 미충족 0건 필요)`);
        missing.push("필수 항목 해소");
      }
    }
    return { complete: missing.length === 0, blockers, missing };
  },
  S10: ({ project }) => {
    const blockers: string[] = [];
    const missing: string[] = [];
    const db = getDb();
    // 투자구조 설계 (flow.spec v2.2.0): 4축 검토 완료 + sources & uses 균형.
    const latest = db
      .query(
        `SELECT id, four_axis_review_completed FROM deal_structure_hypothesis
         WHERE project_id = ? ORDER BY hypothesized_at DESC, id DESC LIMIT 1`,
      )
      .get(project.id) as { id: string; four_axis_review_completed: number } | undefined;
    if (!latest) {
      blockers.push("투자구조 가설이 필요합니다");
      missing.push("투자구조 가설(4축 검토 완료)");
    } else if (latest.four_axis_review_completed !== 1) {
      blockers.push("최신 투자구조 가설의 4축 검토(절세·책임격리·레버리지·엑싯)가 완료되지 않았습니다");
      missing.push("투자구조 가설(4축 검토 완료)");
    }
    const fin = db
      .query(
        `SELECT
           COALESCE(SUM(CASE WHEN kind = 'source' THEN amount_krw_m END), 0) AS sources,
           COALESCE(SUM(CASE WHEN kind = 'use' THEN amount_krw_m END), 0) AS uses
         FROM financing_sources_uses WHERE project_id = ?`,
      )
      .get(project.id) as { sources: number; uses: number };
    if (fin.sources <= 0 || fin.uses <= 0 || Math.abs(fin.sources - fin.uses) > 0.001) {
      blockers.push(
        `자금조달 sources & uses 균형이 필요합니다 (조달 ${fin.sources} / 사용 ${fin.uses} 백만 KRW)`,
      );
      missing.push("자금조달 계획(sources & uses 균형)");
    }
    return { complete: missing.length === 0, blockers, missing };
  },
  S11: ({ project, gateStatus }) => {
    const blockers: string[] = [];
    const missing: string[] = [];
    const db = getDb();
    // IC 승인은 게이트 기록으로만 판단한다 (사람 최종 승인, ADR-0053).
    if (gateStatus.entity_ic !== "go") {
      blockers.push("Entity IC 승인 기록이 필요합니다");
      missing.push("Entity IC 승인");
    }
    if (gateStatus.group_ic !== "go") {
      blockers.push("Group IC 승인 기록이 필요합니다");
      missing.push("Group IC 승인");
    }
    // 스펙 requiredArtifacts 정합 (flow.spec S11): 채택된 Business Case(IC 패키지의
    // 정량 축 — latestAdoption과 동일 키: process_run s8_case_adopt/done)와
    // 추진계획(차터) 기준선 확정 — 0074 charter_json/charter_confirmed_at.
    const adoption = db
      .query(
        `SELECT id FROM process_run
         WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_case_adopt' AND status = 'done'
         ORDER BY started_at DESC, id DESC LIMIT 1`,
      )
      .get(project.id) as { id: string } | undefined;
    if (!adoption) {
      blockers.push("채택된 Business Case가 필요합니다 (IC 패키지 입력)");
      missing.push("IC 패키지(채택 Business Case)");
    }
    const charter = db
      .query("SELECT charter_json, charter_confirmed_at FROM md_project WHERE id = ?")
      .get(project.id) as { charter_json: string | null; charter_confirmed_at: string | null } | undefined;
    if (!charter?.charter_json || !charter.charter_confirmed_at) {
      blockers.push("추진계획(차터) 기준선 확정이 필요합니다");
      missing.push("추진계획(차터) 기준선");
    }
    // 설립 실행 기록은 project_id 키로 직접 조회한다 (0070 백필, ADR-0100 §5);
    // 백필 이전 행만 source_opportunity_id 백링크로 대체 조회한다.
    if (project.origin === "internal" || project.origin === "joint") {
      const done = establishmentProgress(project.id).done;
      if (done < 5) {
        blockers.push(`설립 실행 미완료 (${done}/5단계)`);
        missing.push("설립 실행 기록(5단계 완료)");
      }
    }
    return { complete: missing.length === 0, blockers, missing };
  },
  S12: ({ project }) => {
    const blockers: string[] = [];
    const missing: string[] = [];
    const db = getDb();
    // ADR-0101 §4 (Phase 6): "분기별 스코어카드가 갱신되었다"를 기계적으로
    // 검사한다 — 프로젝트의 MAX(review_cycle)가 존재하고 그 주기가 신선해야
    // 한다 (현재 분기 또는 직전 분기; lib/portfolio.ts의 isFreshReviewCycle
    // 참고 — 분기 단위 cadence라 직전 분기 스코어카드도 현 분기 IC 심의의
    // 정당한 근거다). 어긋나면 낡은 주기를 이름으로 지적한다. 이로써 S8~S12
    // 프로젝트 브랜치의 모든 완료기준이 실재 술어가 된다 (REFINEMENT 잔여 0).
    const latest = db
      .query("SELECT MAX(review_cycle) AS c FROM venture_scorecard WHERE project_id = ?")
      .get(project.id) as { c: string | null };
    if (!latest.c) {
      blockers.push("벤처 스코어카드가 필요합니다");
      missing.push("벤처 스코어카드");
    } else if (!isFreshReviewCycle(latest.c)) {
      blockers.push(`스코어카드 주기가 낡았습니다 (최신 ${latest.c} — 현재 분기 기준 갱신 필요)`);
      missing.push("분기별 스코어카드 갱신");
    }
    return { complete: missing.length === 0, blockers, missing };
  },
};

/**
 * Unmapped project stages default to NOT-complete (fail-closed) — mirrors the
 * opportunity branch. A future S8–S12 stage added to STAGES without a predicate
 * must surface as incomplete, never silently auto-complete (2026-09-12: the
 * previous default-complete fall-through would have shipped an unguarded gate).
 */
function evaluateProjectStage(stage: StageDefinition, project: ProjectRowLite, gateStatus: Partial<Record<GateId, GateVerdict>>): StageEvaluation {
  const predicate = PROJECT_STAGE_COMPLETION[stage.id];
  return predicate ? predicate({ project, gateStatus }) : { complete: false, blockers: [], missing: [] };
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
    if (!opp) throw new Error(`opportunity ${entity.id} not found`);    const gates = latestGateDecisions("opportunity", entity.id);
    gateStatus = Object.fromEntries([...gates.entries()].map(([g, v]) => [g, v.decision]));
    terminated = [...gates.values()].some((g) => g.decision === "kill");

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
    // HOLD 게이트는 재평가를 막을 뿐 작업 자체를 막지 않는다 — current 단계의
    // 모든 게이트(flow.spec S4는 screening+pre_fs 둘 다 보유)에 대해 HOLD 기록이
    // 있으면 블로커로 노출한다. S4에서 pre_fs HOLD가 조용히 무시되던 결함 수정.
    if (!terminated && currentStage !== null) {
      const current = STAGES.find((s) => s.id === currentStage);
      for (const g of current?.gateIds ?? []) {
        const verdict = gates.get(g);
        if (verdict?.decision === "hold") {
          blockers.push(`${g} 게이트 HOLD — 보완 필요: ${(verdict.missing ?? []).join(", ") || "근거 확인"}`);
          requiredArtifacts = verdict.missing ?? requiredArtifacts;
        }
      }
    }
  }

  else if (entity.type === "project") {
    // S8~S12 캐리어 (ADR-0095). S1~S7은 opportunity 캐리어에서 완료된 선행
    // 단계다 — 승격 전제조건(promoteOpportunity)이 트랙별 선행 산출(S5 또는 S7
    // Short List)을 이미 검증했으므로 프로젝트 평가에서는 모두 complete로 표시한다.
    const project = db
      .query("SELECT id, project_no, origin, track, source_opportunity_id FROM md_project WHERE id = ?")
      .get(entity.id) as ProjectRowLite | undefined;
    if (!project) throw new Error(`project ${entity.id} not found`);
    const gates = latestGateDecisions("project", entity.id);
    gateStatus = Object.fromEntries([...gates.entries()].map(([g, v]) => [g, v.decision]));
    terminated = [...gates.values()].some((g) => g.decision === "kill");
    track = project.track;
    subTrack = project.source_opportunity_id
      ? (latestRouteDecision(project.source_opportunity_id)?.sub_track ?? null)
      : null;

    let priorComplete = true;
    for (const stage of STAGES) {
      if (terminated) {
        stages.push({ ...stage, status: "terminated" });
        continue;
      }
      if (track !== null && !stage.applicableTracks.includes("all") && !stage.applicableTracks.includes(track)) {
        stages.push({ ...stage, status: "skipped" });
        continue;
      }
      // 선행 opportunity 캐리어 단계(S1~S7): 승격된 프로젝트에서는 완료로 단정한다.
      if (stage.sequence <= 7) {
        if (!priorComplete) {
          blockedStages.push(stage.id);
          stages.push({ ...stage, status: "locked" });
          continue;
        }
        completedStages.push(stage.id);
        stages.push({ ...stage, status: "complete" });
        continue;
      }
      if (!priorComplete) {
        blockedStages.push(stage.id);
        stages.push({ ...stage, status: "locked" });
        continue;
      }
      const res = evaluateProjectStage(stage, project, gateStatus);
      if (res.complete) {
        completedStages.push(stage.id);
        stages.push({ ...stage, status: "complete" });
      } else {
        priorComplete = false;
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
    // HOLD 게이트는 재평가를 막을 뿐 작업 자체를 막지 않는다 — current 단계의
    // 게이트에 HOLD 기록이 있으면 블로커로 노출한다 (기회 평가와 동일 규칙).
    if (!terminated && currentStage !== null) {
      const current = STAGES.find((s) => s.id === currentStage);
      for (const g of current?.gateIds ?? []) {
        const verdict = gates.get(g);
        if (verdict?.decision === "hold") {
          blockers.push(`${g} 게이트 HOLD — 보완 필요: ${(verdict.missing ?? []).join(", ") || "근거 확인"}`);
          requiredArtifacts = verdict.missing ?? requiredArtifacts;
        }
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
