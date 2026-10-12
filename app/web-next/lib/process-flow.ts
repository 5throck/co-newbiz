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
import { hasScreeningEvidence, listTargets, longListCandidateGaps, screeningSummary } from "./brownfield-targets.ts";
import { countSourcedCapabilityRows } from "./capability-gap.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";
import { latestPmiKickoff, pmiKickoffApplies } from "./pmi-kickoff.ts";
import { executionBaselineS11Check } from "./greenfield-execution.ts";
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
  { id: "S1", name: "시장분석", sequence: 1, objective: "어디에 기회가 있는가? — 시장 규모·성장·경쟁구조와 가치사슬을 파악한다", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["시장 규모·성장 추정", "경쟁 구조", "가치사슬 구조"] },
  { id: "S2", name: "기회 발굴", sequence: 2, objective: "무엇을 할 것인가? — 가치사슬상 사업 기회를 등록·평가한다", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["기회 등록(가치사슬 노드·매력도)"] },
  { id: "S3", name: "시너지·전략적 적합성", sequence: 3, objective: "우리가 해야 하는가? — 자사 역량과의 시너지를 평가한다", applicableTracks: ["all"], gateIds: ["screening"], requiredArtifacts: ["시너지 평가", "전략적 적합성 판단"] },
  { id: "S4", name: "진출방식 결정", sequence: 4, objective: "어떻게 들어갈 것인가? — Greenfield(자체 역량 진출) vs Brownfield(기존 기업·자산 결합)를 결정한다. Brownfield ≠ M&A — M&A·JV·전략적 투자·소수점 지분·파트너십·R&BD·사내벤처(CVC) 중 Route를 고른다", applicableTracks: ["all"], gateIds: ["screening", "pre_fs"], requiredArtifacts: ["트랙 결정(GF/BF)·근거", "Brownfield 선택 시 Route 유형(M&A/JV/전략적 투자/소수점 지분/파트너십/R&BD/CVC)", "5criteria 채점 결과(통제 필요도·역량 결정성·시장 불확실성·통합 역량·역량확보 속도 각 20%)", "검토한 대안"] },
  { id: "S5", name: "자체 진출", sequence: 5, objective: "스스로 진입할 수 있는가? — 자체 역량을 평가하고 격차를 구축 방안(Build/Partner/Hire/Invest)으로 해소해 진출전략을 세운다 (Greenfield 전용 — Target Company 객체가 존재하지 않는다)", applicableTracks: ["greenfield"], gateIds: ["pre_fs"], requiredArtifacts: ["역량 격차 평가", "진출전략(Build/Partner/Hire/Invest 결정·근거)"] },
  { id: "S6", name: "대상 후보 발굴", sequence: 6, objective: "누구와 결합할 것인가? — Opportunity에 진입 가능한 기존 기업·자산의 Target Universe를 정의하고 Target Company Long List를 작성한다 (Brownfield 전용)", applicableTracks: ["brownfield"], gateIds: ["pre_fs"], requiredArtifacts: ["Target Universe 정의", "Target Company Long List"] },
  { id: "S7", name: "대상 선정", sequence: 7, objective: "어떤 대상이 유망한가? — Long List를 전략·역량·재무·소유권·규제 기준으로 스크리닝해 Target Company Short List로 좁힌다 (Brownfield 전용 — CDD/TDD는 Short List 확정 후 S9에서 수행한다)", applicableTracks: ["brownfield"], gateIds: ["target_screening"], requiredArtifacts: ["Target Company Short List", "Target Ranking/Score", "Exclusion Reasons"] },
  { id: "S8", name: "사업성 분석", sequence: 8, objective: "돈이 되는가? — Greenfield는 진출전략 기반 Business Case, Brownfield는 Short List 대상별 밸류에이션을 정량화해 비교·선정한다", applicableTracks: ["all"], gateIds: ["fs"], requiredArtifacts: ["Business Case(비용·수익 라인 또는 밸류에이션 — brownfield는 대상별)", "시뮬레이션 NPV 분위수", "BEP 시점과 시뮬레이션 입력 스냅샷", "Target 비교 분석 (brownfield)", "대상 선정 기록 (brownfield)"] },
  { id: "S9", name: "실사·검증", sequence: 9, objective: "사실인가? 위험은 무엇인가? — 트랙별 실사 체크리스트를 수행한다 (brownfield는 S8에서 선정된 대상 DD, 선택적으로 다른 Short List 대상 DD를 비교 근거로 열 수 있다. greenfield는 실현가능성 검증)", applicableTracks: ["all"], gateIds: ["dd"], requiredArtifacts: ["DD 체크리스트 판정(필수 항목 해소)"] },
  { id: "S10", name: "투자구조 설계", sequence: 10, objective: "어떤 그릇으로, 어떤 자금으로 들어갈 것인가? — 투자 주체(direct/SPC/holdco/내부 스핀오프/JV)과 ADR-0045 4대 축(절세 구조·책임 격리·재무 레버리지·엑싯 구조)을 검토하고 자금조달 계획(sources & uses)을 균형시킨다 (IC 심의의 입력 설계)", applicableTracks: ["all"], gateIds: [], requiredArtifacts: ["투자구조 가설(4축 검토 완료)", "자금조달 계획(sources & uses 균형)"] },
  { id: "S11", name: "투자심사·실행", sequence: 11, objective: "투자할 것인가? — S10에서 설계한 투자 구조와 자금 조달 계획을 IC 패키지로 묶어 Entity/Group IC 심사를 통과하고, 승인되면 트랙에 맞는 실행에 들어간다(인수 종결, 법인 설립, greenfield 실행 기준선 확정)", applicableTracks: ["all"], gateIds: ["entity_ic", "group_ic"], requiredArtifacts: ["IC 패키지", "추진계획(차터) 기준선 — 목적·트랙 근거·진출 범위·KPI 선커밋", "사람 최종 승인(reviewer 기록)", "설립 실행 기록(설립준비·등기·인허가 분류·인력이전·완료확인 — chk-entity-formation 증적, origin∈{internal,joint})"] },
  { id: "S12", name: "사후 관리", sequence: 12, objective: "투자 후 사업이 궤도에 올랐는가? — 포트폴리오 성과를 모니터링한다", applicableTracks: ["all"], gateIds: [], requiredArtifacts: ["벤처 스코어카드", "사람 전환 결정 기록(어휘 5종, decided_by=venture-portfolio-ic, rationale 필수 — venture_transition_decision 원장)", "전환별 결정 부속 기록: 차기 트랜치 조건(next_tranche_released/held_evidence_incomplete), 핵심사업 인계 기록(graduate_to_core), 매각/청산 계획(reduce_or_divest), 학습 포착 기록(kill_with_learning_captured — group-review-agent 기록, risk-officer가 S1/S2 기본률에 환류)", "실행 기준선 대비 차이(greenfield)"] },
];

/** S12 포트폴리오 전환 결정 어휘 5종 (flow.spec S12, portfolio-venture-monitoring). */
export const PORTFOLIO_TRANSITIONS = [
  "next_tranche_released",
  "held_evidence_incomplete",
  "graduate_to_core",
  "reduce_or_divest",
  "kill_with_learning_captured",
] as const;

/**
 * ADR-0151 migration date — decisions with decided_at >= this date must carry
 * their transition's dedicated record column (tranche_condition /
 * core_handoff / divest_plan; learning_capture for kills, unchanged). Earlier
 * ledger rows are grandfathered: a non-empty rationale suffices. No backfill
 * (ADR-0151 Accepted decision 2).
 */
export const ADR_0151_MIGRATION_DATE = "2026-10-02";

/**
 * Wave F-6 migration date (migrations 0125/0126). The F4 predicate tightenings
 * (S1 confidence grade, S3 capability list, S6 per-candidate source/attributes,
 * S7 per-candidate screening evidence, S11 PMI kickoff + human reviewer record)
 * apply only to entities created on/after this date. Earlier entities keep
 * the legacy predicates — design §9, ADR-0151 precedent: tightening a
 * predicate never retroactively un-completes in-flight work.
 *  - opportunity: opportunity.created_at
 *  - project: the earliest project_policy_pin.pinned_at (the policy version
 *    the project was pinned to when it entered the pipeline), falling back to
 *    md_project.created_at when it has no pin.
 */
export { WAVE_F_PREDICATE_DATE } from "./wave-f-date.ts";
import { WAVE_F_PREDICATE_DATE } from "./wave-f-date.ts";
import { cleanList, holdBlockerText } from "./review/review-display.ts";

function opportunityGrandfathered(opp: { created_at: string | null }): boolean {
  return (opp.created_at ?? "") < WAVE_F_PREDICATE_DATE;
}

function projectGrandfathered(project: { id: string; created_at: string | null }): boolean {
  const pin = getDb()
    .query("SELECT MIN(pinned_at) AS at FROM project_policy_pin WHERE project_id = ?")
    .get(project.id) as { at: string | null };
  return (pin.at ?? project.created_at ?? "") < WAVE_F_PREDICATE_DATE;
}

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
  /** opportunity 전용 — 이미 프로젝트로 추진(승격)됐다면 그 project id. 승격
   * 후에는 팀 배정 등 세부 내용을 다시 노출하지 않고 이 값만으로 판단한다. */
  projectId: string | null;
}

export function latestGateDecisions(entityType: "opportunity" | "project", entityId: string): Map<GateId, { decision: GateVerdict; missing: string[] | null; rationale: string }> {
  const rows = getDb()
    .query(
      `SELECT gate, decision, missing_artifacts_json, rationale FROM (
         SELECT gate, decision, missing_artifacts_json, rationale,
                ROW_NUMBER() OVER (PARTITION BY gate ORDER BY decided_at DESC, id DESC) AS rn
         FROM gate_decision g WHERE g.entity_type = ? AND g.entity_id = ?
           AND NOT EXISTS (SELECT 1 FROM gate_decision_stale s WHERE s.decision_id = g.id)
       ) WHERE rn = 1`,
    )
    .all(entityType, entityId) as Array<{ gate: GateId; decision: GateVerdict; missing_artifacts_json: string | null; rationale: string }>;
  return new Map(rows.map((r) => [r.gate, { decision: r.decision, missing: r.missing_artifacts_json ? JSON.parse(r.missing_artifacts_json) : null, rationale: r.rationale }]));
}
// Latest gate_decision per gate is shared by the process engine and the
// gate-decisions API so the tie-breaking rule cannot drift between surfaces.
// A decision marked stale (ADR-0157: the S8 selection changed after the dd
// decision) is kept in history but no longer counts — the gate must be re-judged.

export function latestRouteDecision(opportunityId: string): { id: string; track: "greenfield" | "brownfield"; sub_track: string | null; alternatives_considered: string | null } | undefined {
  return getDb()
    .query("SELECT id, track, sub_track, alternatives_considered FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1")
    .get(opportunityId) as { id: string; track: "greenfield" | "brownfield"; sub_track: string | null; alternatives_considered: string | null } | undefined;
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
    // S1 산출물은 산업 단위 시장분석(market-sizing 매트릭스·가치사슬 연계)이다.
    // 기회가 분석된 산업(market_scope)에서 파생된 경우 산업 산출물로
    // 완료기준을 대체 충족한다 — 개별 기회 필드는 S2 평가 입력으로 보완된다.
    // Wave F-6: the industry is the opportunity's real FK (migration 0126), not
    // a market_scope = name_ko string join.
    const industry = opp.industry_id ? { id: opp.industry_id } : undefined;
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
    // flow.spec S1 completionCriteria — 최신 완료 버전 매트릭스에 경쟁 구조
    // (집중도 요약·주요 플레이어)가 기록되어야 한다. v2.4.0 도입 당시에는 기존
    // 완료 분석 다수가 경쟁 구조 이전 버전이라 소프트 권고로 유지했으나, 그
    // 전환기는 종료했다(2026-09-18 스펙-엔진 정합): 미기록이면 완료를 막고
    // requiredArtifacts 누락으로 요구한다. 재분석으로 보강한다.
    if (hasMatrix && industry) {
      const latest = getDb()
        .query(
          `SELECT v.payload FROM market_sizing_version v
           JOIN market_sizing_analysis a ON a.id = v.analysis_id
           WHERE a.industry_id = ? AND a.status = 'completed'
           ORDER BY v.version_no DESC LIMIT 1`,
        )
        .get(industry.id) as { payload: string } | undefined;
      const hasCompetitive = !!latest && (() => {
        try { return Boolean((JSON.parse(latest.payload) as { matrix?: { competitive?: unknown } }).matrix?.competitive); } catch { return false; }
      })();
      if (!hasCompetitive) {
        blockers.push("S1 경쟁 구조 미기록 — 재분석으로 집중도·주요 플레이어를 보강해야 합니다");
        missing.push("경쟁 구조");
      }
    }
    // flow.spec S1 completionCriteria 3: "데이터 신뢰도 등급이 기록되었다"
    // (Wave F-6; the grade is persisted per sizing version by migration 0125).
    // Grandfathered opportunities keep the legacy predicate.
    if (!opportunityGrandfathered(opp)) {
      const graded = industry
        ? getDb()
            .query(
              `SELECT v.data_confidence_grade AS g FROM market_sizing_version v
               JOIN market_sizing_analysis a ON a.id = v.analysis_id
               WHERE a.industry_id = ? AND a.status = 'completed'
               ORDER BY v.version_no DESC LIMIT 1`,
            )
            .get(industry.id) as { g: string | null } | undefined
        : undefined;
      if (!graded?.g) {
        blockers.push("S1 데이터 신뢰도 등급(A|B|C)이 기록되지 않았습니다 — 산업 시장분석(재분석)으로 프록시 hop 수와 출처에서 산출해야 합니다");
        missing.push("데이터 신뢰도 등급");
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
    // flow.spec S3 / Wave F-6: the required-capability list must exist with a
    // recorded source per row (grandfathered opportunities exempt).
    if (!opportunityGrandfathered(opp) && countSourcedCapabilityRows(opp.capability_gap_json) === 0) {
      blockers.push("필요 역량 목록이 필요합니다 — 출처(source)가 있는 역량 1건 이상 (S3 역량 갭 레지스터)");
      missing.push("필요 역량 목록(출처 포함)");
    }
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
    // 결과를 기록한다" — ADR-0104 트랙 간 비교 가능성). 검토한 대안은
    // requiredArtifacts이므로 완료 검사에 포함한다 (v2.4.1 정합 — S5 선례와
    // 동일한 비어 있지 않은 문자열 검사).
    const decision = latestRouteDecision(opp.id);
    if (!decision) {
      blockers.push("진출방식 결정(route_decision)이 필요합니다");
      missing.push("route_decision(트랙)");
    } else {
      if (decision.track === "brownfield" && !decision.sub_track) { blockers.push("brownfield 라우트 유형(sub_track) 선택이 필요합니다"); missing.push("brownfield sub_track"); }
      const scoreCount = (getDb().query("SELECT COUNT(*) c FROM route_decision_score WHERE decision_id = ?").get(decision.id) as { c: number }).c;
      if (scoreCount < 5) { blockers.push(`5-criteria 채점 부족 (${scoreCount}/5)`); missing.push("5-criteria 채점"); }
      if (!decision.alternatives_considered?.trim()) { blockers.push("검토한 대안 기록이 필요합니다"); missing.push("검토한 대안"); }
    }
    complete = missing.length === 0;
    return { complete, blockers, missing };
  },
  S5: ({ opp }) => {
    let blockers: string[] = [];
    const missing: string[] = [];
    let complete = false;
    // flow.spec S5 (greenfield only): 역량 격차+해소 방식, 진출전략, 검토한 대안.
    // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서
    // 센다 — greenfield_assessment.capability_gaps_json은 더 이상 채워지지 않는다.
    let gapCount = 0;
    try { gapCount = opp.capability_gap_json ? ((JSON.parse(opp.capability_gap_json) as { rows?: unknown[] }).rows ?? []).length : 0; } catch { /* unparseable = empty */ }
    const a = getDb()
      .query("SELECT entry_strategy, alternatives_considered FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get(opp.id) as { entry_strategy: string | null; alternatives_considered: string | null } | undefined;
    if (gapCount === 0) { blockers.push("역량 격차 항목이 필요합니다(S3에서 필요 역량 정의)"); missing.push("역량 격차·해소 방식"); }
    if (!a) { blockers.push("역량 평가가 필요합니다"); missing.push("역량 격차 평가"); }
    else {
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
    // Wave F-6: only candidates that carry the required attributes AND a source
    // count toward coverage (brownfield-target-identification procedure).
    // Grandfathered opportunities keep the raw row count.
    let covered = longList;
    if (!opportunityGrandfathered(opp)) {
      const candidates = listTargets(opp.id);
      const incomplete = candidates.filter((t) => longListCandidateGaps(t).length > 0);
      covered = candidates.length - incomplete.length;
      if (incomplete.length > 0) {
        blockers.push(`필수 속성·출처가 없는 Long List 후보 ${incomplete.length}건 — ${incomplete.slice(0, 3).map((t) => t.company_name).join(", ")}${incomplete.length > 3 ? " 외" : ""} (식별자·Universe 적합 메모·발굴 출처 기록 필요)`);
        missing.push("Long List 후보 필수 속성·출처");
      }
    }
    if (covered < minLongList) {
      blockers.push(`Long List 커버리지 부족 (${covered}/${minLongList}${covered !== longList ? " — 필수 속성·출처를 갖춘 후보만 산입" : ""})`);
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
    // Wave F-6: a shortlisted candidate needs screening evidence (an excluded
    // one is covered by its explicit exclusion_reason above). Grandfathered
    // opportunities exempt.
    if (!opportunityGrandfathered(opp)) {
      const noEvidence = targets.filter((t) => t.status === "shortlisted" && !hasScreeningEvidence(t));
      if (noEvidence.length > 0) {
        blockers.push(`스크리닝 근거가 기록되지 않은 Short List 후보 ${noEvidence.length}건 — ${noEvidence.slice(0, 3).map((t) => t.company_name).join(", ")} (후보별 근거 저장 필요)`);
        missing.push("후보별 스크리닝 근거");
      }
    }
    const koPassed = targets.filter((t) => t.status === "shortlisted" && screeningSummary(t).knockOutsPassed);
    if (koPassed.length === 0) {
      blockers.push("knock-out 통과 후보 0건 — Target Screening 진행 KILL 기준 검토가 필요합니다");
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
  created_at: string | null;
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
    // ADR-0143 (flow.spec S8 subjectScope): brownfield의 분석 주체는 Short
    // List의 각 대상이다 — 전 대상이 각각 분석(모델 + p50 BEP + 입력 스냅샷)
    // 되어야 하고, 대상 비교와 사람의 대상 선정 기록(s8_target_select)까지
    // 완료 산물이다. greenfield는 프로젝트 자체가 주체 — 기존 술어 그대로.
    if (project.track === "brownfield") {
      if (!project.source_opportunity_id) {
        blockers.push("원 기회(source opportunity) 연결이 필요합니다");
        missing.push("Business Case(비용·수익 라인 또는 밸류에이션 — brownfield는 대상별)");
        return { complete: false, blockers, missing };
      }
      const targets = db
        .query(
          `SELECT id, company_name FROM brownfield_target
           WHERE opportunity_id = ? AND status = 'shortlisted'
           ORDER BY rank IS NULL, rank, created_at`,
        )
        .all(project.source_opportunity_id) as Array<{ id: string; company_name: string }>;
      if (targets.length === 0) {
        blockers.push("Short List 대상이 없습니다 — S7 Short List를 확인하세요");
        missing.push("Business Case(비용·수익 라인 또는 밸류에이션 — brownfield는 대상별)");
        return { complete: false, blockers, missing };
      }
      for (const target of targets) {
        // Gate-primary only (ADR-0117/0143): judge the market_forward model's
        // base-scenario p50 — a historical-variant model is comparison
        // evidence and must never satisfy the completion probe.
        const model = db
          .query(
            `SELECT m.id, m.inputs_json FROM business_case_model m
             WHERE m.project_id = ? AND m.archived_at IS NULL AND m.target_id = ? AND COALESCE(m.variant, 'market_forward') = 'market_forward'
               AND EXISTS (SELECT 1 FROM valuation_simulation v WHERE v.model_id = m.id AND v.scenario = 'base' AND v.percentile = 'p50')
             ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
          )
          .get(project.id, target.id) as { id: string; inputs_json: string | null } | undefined;
        if (!model) {
          blockers.push(`대상 [${target.company_name}]의 Business Case가 필요합니다 (Short List 대상별 분석)`);
          missing.push("Business Case(비용·수익 라인 또는 밸류에이션 — brownfield는 대상별)");
          continue;
        }
        const p50 = db
          .query(
            `SELECT bep_year FROM valuation_simulation
             WHERE model_id = ? AND scenario = 'base' AND percentile = 'p50' ORDER BY created_at DESC LIMIT 1`,
          )
          .get(model.id) as { bep_year: number | null } | undefined;
        if (!p50 || p50.bep_year == null || model.inputs_json == null) {
          blockers.push(`대상 [${target.company_name}]의 BEP 시점·입력 스냅샷이 필요합니다 (대상별 분석을 재생성하세요)`);
          missing.push("BEP 시점과 시뮬레이션 입력 스냅샷");
        }
      }
      // ADR-0143: the recorded selection must still point at a SHORTLISTED
      // target — a later exclusion invalidates it (re-selection required).
      const selection = db
        .query(
          `SELECT r.meta_json FROM process_run r
           WHERE r.entity_type = 'project' AND r.entity_id = ? AND r.stage = 's8_target_select' AND r.status = 'done'
           ORDER BY r.started_at DESC, r.id DESC LIMIT 1`,
        )
        .get(project.id) as { meta_json: string | null } | undefined;
      if (!selection?.meta_json) {
        blockers.push("대상 비교 분석과 사람의 대상 선정 기록이 필요합니다 (fs 진행 입력)");
        missing.push("대상 선정 기록 (brownfield)");
      } else {
        let selectedTargetId: string | null = null;
        try { selectedTargetId = (JSON.parse(selection.meta_json) as { target_id?: string }).target_id ?? null; } catch { /* malformed meta — treated as unselected */ }
        if (selectedTargetId) {
          const sel = db
            .query("SELECT status FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
            .get(selectedTargetId, project.source_opportunity_id ?? "") as { status: string } | undefined;
          if (!sel || sel.status !== "shortlisted") {
            blockers.push("선정된 대상이 Short List에서 제외되었습니다 — 대상을 재선정하세요");
            missing.push("대상 선정 기록 (brownfield)");
          }
        }
      }
      return { complete: missing.length === 0, blockers, missing };
    }
    const model = db
      .query(
        `SELECT id, kind, inputs_json FROM business_case_model
         WHERE project_id = ? AND archived_at IS NULL AND COALESCE(variant, 'market_forward') = 'market_forward'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(project.id) as { id: string; kind: string; inputs_json: string | null } | undefined;
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
      // 2026-09-18 spec update: BEP year + input snapshot are completion
      // artifacts too — both land on the latest model's p50 row / inputs_json.
      const p50 = db
        .query("SELECT bep_year FROM valuation_simulation WHERE project_id = ? AND model_id = ? AND percentile = 'p50' ORDER BY created_at DESC LIMIT 1")
        .get(project.id, model.id) as { bep_year: number | null } | undefined;
      if (!p50 || p50.bep_year == null || model.inputs_json == null) {
        blockers.push("BEP 시점과 시뮬레이션 입력 스냅샷이 필요합니다 (사업성 분석을 재생성하세요)");
        missing.push("BEP 시점과 시뮬레이션 입력 스냅샷");
      }
    }
    return { complete: missing.length === 0, blockers, missing };
  },
  S9: ({ project }) => {
    const blockers: string[] = [];
    const missing: string[] = [];
    // 적용 체크리스트 범위·필수 미충족 0건 검사
    // (ADR-0099 §5 — completion summary is the single source of the counts).
    // ADR-0157: the selected/legacy scope only (target_id IS NULL) — rows on an
    // opened comparison target can never move this predicate.
    const state = ddCompletionSummary(project.id, { targetId: null });
    if (state.total === 0 && state.unassessed === 0) {
      blockers.push("DD 체크리스트 판정이 필요합니다");
      missing.push("DD 체크리스트 판정(필수 항목 해소)");
    } else {
      if (state.unassessed > 0) {
        blockers.push(`아직 판정하지 않은 표준 체크리스트 항목 ${state.unassessed}건이 있습니다 (ADR-0148)`);
        missing.push("DD 체크리스트 판정(필수 항목 해소)");
      }
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
    // IC 승인은 진행 기록으로만 판단한다 (사람 최종 승인, ADR-0053).
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
    // Wave F-6 (grandfathered projects exempt):
    //  - 사람 최종 승인(reviewer 기록): the latest GO of each IC gate must be
    //    recorded by a person — decided_by present and not an agent persona id.
    //  - brownfield M&A/JV/전략적 투자: a human-recorded PMI kickoff (spec
    //    activity pmi-kickoff) — the integration-plan baseline.
    if (!projectGrandfathered(project)) {
      const reviewers = db
        .query(
          `SELECT gate, decided_by FROM (
             SELECT gate, decided_by, ROW_NUMBER() OVER (PARTITION BY gate ORDER BY decided_at DESC, id DESC) rn
             FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate IN ('entity_ic','group_ic')
           ) WHERE rn = 1`,
        )
        .all(project.id) as Array<{ gate: string; decided_by: string }>;
      const unreviewed = reviewers.filter((r) => !r.decided_by?.trim() || AGENT_KEYS.has(r.decided_by));
      if (unreviewed.length > 0) {
        blockers.push(`사람 최종 승인(reviewer) 기록이 필요합니다 — ${unreviewed.map((r) => r.gate).join(", ")} 진행 기록의 결정자가 사람이 아닙니다`);
        missing.push("사람 최종 승인(reviewer 기록)");
      }
      if (project.track === "brownfield") {
        const sub = project.source_opportunity_id ? (latestRouteDecision(project.source_opportunity_id)?.sub_track ?? null) : null;
        if (pmiKickoffApplies(project.track, sub) && !latestPmiKickoff(db, project.id)) {
          blockers.push("Brownfield PMI 킥오프 기록이 필요합니다 (통합 책임자·통합 계획 기준선 — S11 IC 승인 후 기록)");
          missing.push("PMI 킥오프 기록 (brownfield)");
        }
      }
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
    // ADR-0161 (Q2 retroactive): greenfield execution baseline confirmation —
    // blocking while S11 is not yet completed; recommended (never reopening the
    // stage) when S11 was already completed before the rule. Brownfield and
    // unclassified projects are untouched here.
    // Review R1-R4: a track-classification CONFLICT blocks with its own text; no
    // signal at all never blocks (warning on the execution-baseline surface only,
    // so brownfield output stays byte-identical); reconfirm_required blocks only
    // while S11 is not otherwise complete.
    {
      const gx = executionBaselineS11Check(project.id, { otherCriteriaMet: missing.length === 0 });
      if (gx.blocks && gx.blocker) {
        blockers.push(gx.blocker);
        missing.push(gx.requirement === "classification_conflict" ? "트랙 분류 정리 (case_type ↔ route)" : "실행 기준선 확인 (greenfield)");
      }
    }
    return { complete: missing.length === 0, blockers, missing };
  },
  S12: ({ project }) => {
    const blockers: string[] = [];
    const missing: string[] = [];
    const db = getDb();
    // ADR-0150 기준 1 (기존 ADR-0101 §4 술어 유지): "리뷰 주기별로 스코어카드
    // 검토가 존재한다"를 기계적으로 검사한다 — 프로젝트의 MAX(review_cycle)가
    // 존재하고 그 주기가 신선해야 한다 (현재 분기 또는 직전 분기;
    // lib/portfolio.ts의 isFreshReviewCycle 참고 — 분기 단위 cadence라 직전
    // 분기 스코어카드도 현 분기 IC 심의의 정당한 근거다). 어긋나면 낡은 주기를
    // 이름으로 지적한다.
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
    // ADR-0150 기준 2: 최신 리뷰 주기에 사람 전환 결정이 근거(rationale)와 함께
    // 기록되어 있어야 한다 (venture_transition_decision 원장, 0071). decided_by는
    // 스키마에서 인간 역할 'venture-portfolio-ic'로 CHECK 고정되지만(설계 경계 2),
    // 술어는 이를 다시 단언한다 (fail-closed, ADR-0053 사람 최종 승인).
    if (latest.c) {
      const decision = db
        .query(
          `SELECT decision, decided_by, decided_at, rationale, learning_capture,
                  tranche_condition, core_handoff, divest_plan
           FROM venture_transition_decision
           WHERE project_id = ? AND review_cycle = ?
           ORDER BY decided_at DESC, id DESC LIMIT 1`,
        )
        .get(project.id, latest.c) as
          | { decision: string; decided_by: string; decided_at: string; rationale: string; learning_capture: string | null;
              tranche_condition: string | null; core_handoff: string | null; divest_plan: string | null }
          | undefined;
      if (!decision) {
        blockers.push(`사람 전환 결정 기록이 필요합니다 (${latest.c} 주기 — venture_transition_decision)`);
        missing.push("사람 전환 결정 기록(어휘 5종)");
      } else {
        if (!decision.decided_by || decision.rationale.trim() === "") {
          blockers.push("전환 결정 기록의 decided_by(venture-portfolio-ic)·근거(rationale)가 필요합니다");
          missing.push("사람 전환 결정 기록(어휘 5종)");
        }
        // ADR-0150 기준 3~6 — 전환별 결정 부속 기록. 술어는 5개 전환을 모두
        // 요구하지 않는다: 기록된 결정(최신 1건)이 무엇이든 그 결정에 맞는
        // 부속 기록만 요구한다.
        // ADR-0151 (마이그레이션 0121, 2026-10-02): 기준 3~5의 전용 컬럼
        // (tranche_condition·core_handoff·divest_plan)이 0071에 추가되었다.
        // 백필은 없다(Accepted 결정 2) — decided_at이 마이그레이션 날짜 이후인
        // 결정만 전용 컬럼을 요구하고, 그 이전 rationale-only 원장 행은
        // 그랜드파더링되어 rationale-only로 유효하다. 중단 경로(기준 6)는
        // 변함없다.
        const grandfathered = decision.decided_at < ADR_0151_MIGRATION_DATE;
        if (!grandfathered) {
          if (
            (decision.decision === "next_tranche_released" || decision.decision === "held_evidence_incomplete") &&
            (decision.tranche_condition ?? "").trim() === ""
          ) {
            blockers.push(`${decision.decision} 결정의 차기 트랜치 조건(tranche_condition)이 필요합니다 (ADR-0151)`);
            missing.push("차기 트랜치 조건(tranche_condition)");
          }
          if (decision.decision === "graduate_to_core" && (decision.core_handoff ?? "").trim() === "") {
            blockers.push("핵심사업 진입 결정(graduate_to_core)의 인계 기록(core_handoff)이 필요합니다 (ADR-0151)");
            missing.push("핵심사업 인계 기록(core_handoff)");
          }
          if (decision.decision === "reduce_or_divest" && (decision.divest_plan ?? "").trim() === "") {
            blockers.push("매각/청산 결정(reduce_or_divest)의 처분 계획(divest_plan)이 필요합니다 (ADR-0151)");
            missing.push("매각/청산 계획(divest_plan)");
          }
        }
        if (decision.decision === "kill_with_learning_captured" && (decision.learning_capture ?? "").trim() === "") {
          blockers.push("중단 결정(kill_with_learning_captured)의 학습 포착 기록(learning_capture)이 필요합니다 — group-review-agent 기록, risk-officer가 S1/S2 기본률에 환류");
          missing.push("학습 포착 기록(kill_with_learning_captured)");
        }
      }
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
  capability_gap_json: string | null;
  project_id: string | null;
  industry_id: string | null;
  created_at: string | null;
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
  let projectId: string | null = null;

  if (entity.type === "opportunity") {
    const opp = db
      .query("SELECT * FROM opportunity WHERE id = ?")
      .get(entity.id) as OpportunityRow | undefined;
    if (!opp) throw new Error(`opportunity ${entity.id} not found`);
    projectId = opp.project_id;
    const gates = latestGateDecisions("opportunity", entity.id);
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
    // HOLD 진행은 재평가를 막을 뿐 작업 자체를 막지 않는다 — current 단계의
    // 모든 진행(flow.spec S4는 screening+pre_fs 둘 다 보유)에 대해 HOLD 기록이
    // 있으면 블로커로 노출한다. S4에서 pre_fs HOLD가 조용히 무시되던 결함 수정.
    if (!terminated && currentStage !== null) {
      const current = STAGES.find((s) => s.id === currentStage);
      for (const g of current?.gateIds ?? []) {
        const verdict = gates.get(g);
        if (verdict?.decision === "hold") {
          blockers.push(holdBlockerText(g, verdict.missing));
          {
            // A HOLD with a blank/empty `missing` list must not blank out the stage's own required artifacts.
            const heldMissing = cleanList(verdict.missing);
            if (heldMissing.length > 0) requiredArtifacts = heldMissing;
          }
        }
      }
    }
  }

  else if (entity.type === "project") {
    // S8~S12 캐리어 (ADR-0095). S1~S7은 opportunity 캐리어에서 완료된 선행
    // 단계다 — 승격 전제조건(promoteOpportunity)이 트랙별 선행 산출(S5 또는 S7
    // Short List)을 이미 검증했으므로 프로젝트 평가에서는 모두 complete로 표시한다.
    const project = db
      .query("SELECT id, project_no, origin, track, source_opportunity_id, created_at FROM md_project WHERE id = ?")
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
    // HOLD 진행은 재평가를 막을 뿐 작업 자체를 막지 않는다 — current 단계의
    // 진행에 HOLD 기록이 있으면 블로커로 노출한다 (기회 평가와 동일 규칙).
    if (!terminated && currentStage !== null) {
      const current = STAGES.find((s) => s.id === currentStage);
      for (const g of current?.gateIds ?? []) {
        const verdict = gates.get(g);
        if (verdict?.decision === "hold") {
          blockers.push(holdBlockerText(g, verdict.missing));
          {
            // A HOLD with a blank/empty `missing` list must not blank out the stage's own required artifacts.
            const heldMissing = cleanList(verdict.missing);
            if (heldMissing.length > 0) requiredArtifacts = heldMissing;
          }
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
    projectId,
  };
}

/**
 * Wave C-3 (pilot-009 D-4): the stages that must be complete before a GO can be
 * recorded on a gate. HOLD and KILL are never gated. Only NEW writes are
 * checked; rows already in the ledger are untouched (grandfathered).
 *  - screening        S1–S3
 *  - pre_fs           S4 + S5 (greenfield) | S6 (brownfield)
 *  - target_screening brownfield track + S7
 *  - fs / dd          S8 / S9
 *  - entity_ic / group_ic  S10 (S11 itself is completed BY the IC approvals)
 */
export function gateGoPrerequisiteGaps(entity: ProcessEntity, gate: GateId): string[] {
  const ev = evaluateProcess(entity);
  const stageName = (id: StageId) => `${id} ${STAGES.find((s) => s.id === id)?.name ?? ""}`.trim();
  const gaps: string[] = [];
  const need = (ids: StageId[]) => {
    for (const id of ids) if (!ev.completedStages.includes(id)) gaps.push(`${stageName(id)} 미완료`);
  };
  if (ev.terminated) return ["프로세스가 KILL로 종료되었습니다"];
  switch (gate) {
    case "screening": need(["S1", "S2", "S3"]); break;
    case "pre_fs":
      need(["S4"]);
      if (ev.track === "greenfield") need(["S5"]);
      else if (ev.track === "brownfield") need(["S6"]);
      break;
    case "target_screening":
      if (ev.track !== "brownfield") gaps.push("brownfield 트랙 결정(S4 route_decision)이 필요합니다");
      need(["S7"]);
      break;
    case "fs": need(["S8"]); break;
    case "dd": need(["S8", "S9"]); break;
    case "entity_ic":
    case "group_ic": need(["S8", "S9", "S10"]); break;
  }
  return gaps;
}
