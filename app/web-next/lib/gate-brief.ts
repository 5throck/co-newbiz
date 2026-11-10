// Gate brief — the LLM decision support behind GateDecisionPanel (ADR-0118).
// Each gate's context is an EXPLICIT manifest: the artifacts flow.spec declares
// for the gate's stage plus the stage's own state — never a bulk dump. The LLM
// proposes go/hold/kill + a rationale draft; the human records the gate
// (boundary #2). Nothing is persisted; every generation is audit-logged by the
// routes that call into this module.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { readRagView } from "../../../db/lib/rag-service.ts";
import { effectiveState } from "../../../db/lib/gate-effective.ts";
import { getCurrentRouteDecision } from "../../../db/repositories/route-decision.repository.ts";
import { listBusinessCases, latestAdoption } from "./business-case.ts";
import { irrGuardBand, IRR_GUARD_CHIP_LABEL } from "./irr-guard.ts";
import { resolveAnchorScopeFlag, type AnchorScopeFlag } from "./anchor-scope.ts";
import { resolveBusinessCaseParams } from "./business-case-generator.ts";
import { SHARE_UN_SOURCED_LABEL, isShareUnsourced, resolveRatioGuardFlag } from "./share-guard.ts";
import {
  ATTAINABILITY_GRADE_LABEL,
  HELD_STATUS_LABEL,
  NECESSITY_LABEL,
  NECESSITY_UNSET_LABEL,
  RESOLUTION_LABEL,
  gapCautions,
  parseGapRegister,
  summarizeGap,
  type CapabilityGapRow,
} from "./capability-gap.ts";
import { attainabilitySummary } from "./capability-attainability.ts";
import { entryStrategyText } from "./greenfield-entry-strategy.ts";
import { isStale } from "./capability-linkage.ts";
import { buildS8LensSummary } from "./s8-lens-summary.ts";
import { buildInvestUncertainty, investUncertaintyBriefText } from "./investment-uncertainty-s8.ts";
import { technicalLensBriefLine } from "./s8-lens-status.ts";
import { ddCompletionSummary } from "./dd-checklist-tailor.ts";
import { gateRecommendation } from "./opportunity-screening.ts";
import { computeTrackAdvisory, type TrackAdvisory } from "./track-advisory.ts";
import { buildSubjectMarketContext } from "./entry-market-context.ts";

export const OPPORTUNITY_GATE_BRIEFS = ["screening", "pre_fs", "target_screening"] as const;
export const PROJECT_GATE_BRIEFS = ["fs", "dd", "entity_ic", "group_ic"] as const;
export type OpportunityGateBriefId = (typeof OPPORTUNITY_GATE_BRIEFS)[number];
export type ProjectGateBriefId = (typeof PROJECT_GATE_BRIEFS)[number];
export type GateBriefEntity = "opportunity" | "project";

export interface GateBrief {
  recommendation: "go" | "hold" | "kill" | null;
  confidence: "high" | "medium" | "low" | null;
  rationale_draft: string;
  key_evidence: string[];
  cautions: string[];
}

// ADR-0118 manifests — the ONLY artifacts each gate's brief reads. The UI
// renders this list verbatim ("이 제안이 본 산출물") so the LLM's field of
// view is auditable.
const MANIFESTS: Record<string, string[]> = {
  screening: [
    "S1 시장 규모·성장 추정",
    "S1 경쟁 구조",
    "S2 기회 퍼널(매력도·요인)",
    "S3 적합성·시너지 초안",
    "S3 필요 역량 수준 요약",
    "결정론 스크리닝 권고",
  ],
  pre_fs: [
    "S1 시장 규모·성장 추정",
    "S1 경쟁 구조",
    "S3 적합성·시너지 초안",
    "S3 필요 역량 수준 요약",
    "S4 트랙 결정·라우트",
    "S5 역량 격차·진출전략 또는 BF 쇼트리스트",
  ],
  target_screening: ["S4 트랙 결정·라우트", "S6 Target Universe·Long List", "S7 대상 선정 판정"],
  fs: [
    "S4 트랙 결정",
    "S8 채택 Business Case·밸류에이션 요약",
    "S8 기술적 타당성 요약(참고)",
    "S8 투자 불확실성(S5 시뮬레이션 산출물, 참고)",
  ],
  dd: ["S8 채택 BC 요약", "체크리스트 판정 집계", "DD 발견사항(dd_finding)", "waiver 연결"],
  entity_ic: ["채택 BC 요약", "DD 완료 요약", "RAG 제안(승인 아님)", "검토/안건구조 가설(S10)", "선행 의사결정(fs·dd)"],
  group_ic: [
    "채택 BC 요약",
    "DD 완료 요약",
    "RAG 제안(승인 아님)",
    "검토/안건구조 가설(S10)",
    "선행 의사결정(entity_ic·dd)",
  ],
};

export function gateManifest(entityType: GateBriefEntity, gate: string): string[] | null {
  if (entityType === "opportunity" && (OPPORTUNITY_GATE_BRIEFS as readonly string[]).includes(gate))
    return MANIFESTS[gate] ?? null;
  if (entityType === "project" && (PROJECT_GATE_BRIEFS as readonly string[]).includes(gate))
    return MANIFESTS[gate] ?? null;
  return null;
}

interface OppRow {
  id: string;
  name: string;
  market_scope: string | null;
  value_chain_node: string | null;
  rationale: string | null;
  attractiveness_score: number | null;
  synergy_score: number | null;
  synergy_score_confirmed_at: string | null;
  market_size_krw_m: number | null;
  growth_rate: number | null;
  target_universe_json: string | null;
  factors_json: string | null;
}

function oppRow(db: Database, id: string): OppRow | null {
  return db
    .query(
      `SELECT id, name, market_scope, value_chain_node, rationale, attractiveness_score, synergy_score,
              synergy_score_confirmed_at,
              market_size_krw_m, growth_rate, target_universe_json, factors_json
       FROM opportunity WHERE id = ?`,
    )
    .get(id) as OppRow | null;
}

// v2.4.0 — 경쟁 구조 라인 (flow.spec S1 requiredArtifacts "경쟁 구조"). 요약
// 문장 + 리더 플레이어 수만 노출한다 — 플레이어 명단은 S1 리포트의 경쟁 구조
// 탭이 1차 근거다.
function s1CompetitiveLine(comp?: { structure?: string; players?: Array<{ tier?: string }> }): string {
  if (!comp?.structure) return "경쟁 구조: 미기록 (재분석으로 집중도·주요 플레이어 보강 권장)";
  const players = comp.players ?? [];
  const leaders = players.filter((p) => p.tier === "leader").length;
  return `경쟁 구조: ${comp.structure}${leaders > 0 ? ` (리더 ${leaders}/${players.length})` : ""}`;
}

// S3 역량 갭 요약 (flow.spec v2.4.0) — 그룹/계열사 프로필 기준 보유 판정
// 요약. 내부(자사 단독) 역량 평가는 후속 보강 사항임을 브리프에 명시한다.
function s3GapSummary(db: Database, oppId: string): string {
  const row = db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(oppId) as
    | { capability_gap_json: string | null }
    | undefined;
  const reg = parseGapRegister(row?.capability_gap_json ?? null);
  if (reg.rows.length === 0)
    return "S3 필요 역량 수준: 미작성 (S3 시너지 화면 연계 시너지 탭에서 필요 역량과 보유 판정을 기록하세요)";
  const s = summarizeGap(reg.rows);
  const unmet = reg.rows
    .filter((r) => r.held.status === "none")
    .map((r) => r.capability)
    .slice(0, 5);
  return [
    `필요 역량 ${s.total}건 — 업계 리딩 ${s.leading}·업계 평균 ${s.average}·부분 보유 ${s.partial}·미보유 ${s.none}·미판정 ${s.unevaluated}${s.coveragePct !== null ? ` (보유율 ${s.coveragePct}%)` : ""}`,
    unmet.length > 0 ? `미보유: ${unmet.join(" / ")}` : "",
    "근거: 그룹/계열사 프로필 기준 — 내부(자사 단독) 역량 평가는 후속 보강",
  ]
    .filter(Boolean)
    .join("\n");
}

// S1 artifact — latest completed sizing for the opportunity's market.
function s1Summary(db: Database, marketScope: string | null): string {
  if (!marketScope) return "S1 시장분석: 없음 (market_scope 미지정)";
  const ind = db.query("SELECT id FROM md_industry WHERE name_ko = ? LIMIT 1").get(marketScope) as
    | { id: string }
    | undefined;
  const version = ind
    ? (db
        .query(
          `SELECT v.payload FROM market_sizing_version v
         JOIN market_sizing_analysis a ON a.id = v.analysis_id
         WHERE a.industry_id = ? AND a.status = 'completed'
         ORDER BY v.version_no DESC LIMIT 1`,
        )
        .get(ind.id) as { payload: string } | undefined)
    : undefined;
  if (!version) return "S1 시장분석: 없음";
  try {
    const m =
      (
        JSON.parse(version.payload) as {
          matrix?: {
            anchor?: { total?: number };
            consistency?: { bottomUpCagr?: number };
            competitive?: { structure?: string; players?: Array<{ tier?: string }> };
            qualitative?: { opportunityFactors?: string[]; riskFactors?: string[] };
          };
        }
      ).matrix ?? {};
    return (
      [
        `기준 규모: ${m.anchor?.total ? `$${m.anchor.total.toFixed(2)}B` : "미상"}`,
        `CAGR: ${m.consistency?.bottomUpCagr != null ? `${m.consistency.bottomUpCagr.toFixed(1)}%` : "미상"}`,
        s1CompetitiveLine(m.competitive),
        m.qualitative?.opportunityFactors?.length ? `기회 요인: ${m.qualitative.opportunityFactors.join(" / ")}` : "",
        m.qualitative?.riskFactors?.length ? `위험 요인: ${m.qualitative.riskFactors.join(" / ")}` : "",
      ]
        .filter(Boolean)
        .join("\n") || "S1 시장분석: 요약 없음"
    );
  } catch {
    return "S1 시장분석: payload 파싱 실패";
  }
}

function s2Factors(opp: OppRow): string {
  if (!opp.factors_json) return "S2 요인: 없음";
  try {
    const f = JSON.parse(opp.factors_json) as { opportunity?: string[]; risk?: string[] };
    return (
      [
        f.opportunity?.length ? `기회 요인: ${f.opportunity.join(" / ")}` : "",
        f.risk?.length ? `위험 요인: ${f.risk.join(" / ")}` : "",
      ]
        .filter(Boolean)
        .join("\n") || "S2 요인: 없음"
    );
  } catch {
    return "S2 요인: 파싱 실패";
  }
}

function s3Summary(opp: OppRow): string {
  return [
    `매력도: ${opp.attractiveness_score ?? "미평가"}`,
    // 경계 #2 — 파이프라인 기록값은 권고이며, 사람 확정 여부를 브리프가 그대로 노출한다.
    `시너지 점수: ${opp.synergy_score ?? "미평가"}${opp.synergy_score !== null ? (opp.synergy_score_confirmed_at ? " (사람 확정)" : " (권고·사람 미확정)") : ""}`,
  ].join("\n");
}

function s4Summary(db: Database, oppId: string): string {
  // ADR-0135: 권위 행은 is_current=1로 읽는다 — getCurrentRouteDecision 재사용.
  const row = getCurrentRouteDecision(oppId, db);
  if (!row) return "S4 트랙 결정: 없음";
  return [
    `트랙: ${row.track}${row.sub_track ? ` / 라우트: ${row.sub_track}` : ""}${row.intent ? ` / 의도: ${row.intent}` : ""}`,
    row.total_score != null ? `5기준 합산: ${row.total_score}/3.0` : "",
    row.rationale ? `결정 근거: ${row.rationale.slice(0, 300)}` : "",
    row.staging_recommended ? `스테이징 권고: ${row.staging_recommended}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * One capability row in the ADR-0172 order: 필요도, 보유 판정; 해소 방식, 기대 수준 (only when
 * short), 개월, 달성 가능성. Narrative text is never compared; this is a plain readout.
 */
export function capabilityBriefLine(r: CapabilityGapRow): string {
  const a = r.attainability;
  const stale = isStale(r);
  const necessity = r.necessity ? NECESSITY_LABEL[r.necessity] : NECESSITY_UNSET_LABEL;
  const expected = a?.expectedLevel && a.expectedLevel.length <= 40 ? `기대 수준 ${a.expectedLevel}` : "";
  const grade = stale
    ? "재판정 필요"
    : a?.grade
      ? `달성 가능성 ${ATTAINABILITY_GRADE_LABEL[a.grade]}${a.confirmedAt ? "(확정)" : "(확정 전)"}`
      : "달성 가능성 미판정";
  const judgement = [
    r.resolution ? RESOLUTION_LABEL[r.resolution] : "해소 방식 미정",
    expected,
    a?.monthsToAttain != null ? `${a.monthsToAttain}개월` : "",
    grade,
  ]
    .filter(Boolean)
    .join(", ");
  return `${r.capability}(필요도 ${necessity}, 보유 판정 ${HELD_STATUS_LABEL[r.held.status]}; ${judgement})`;
}

function s5Summary(db: Database, oppId: string): string {
  const row = db
    .query(
      "SELECT entry_strategy, alternatives_considered, rationale FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
    )
    .get(oppId) as
    | { entry_strategy: string | null; alternatives_considered: string | null; rationale: string | null }
    | undefined;
  // ADR-0136: 역량 격차는 S3 레지스터(opportunity.capability_gap_json)가 유일한
  // 출처다 — greenfield_assessment.capability_gaps_json은 더 이상 채워지지 않는다.
  const oppRow = db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(oppId) as
    | { capability_gap_json: string | null }
    | undefined;
  const register = parseGapRegister(oppRow?.capability_gap_json ?? null);
  const gaps =
    register.rows.length > 0
      ? `역량 격차 ${register.rows.length}건: ` + register.rows.slice(0, 6).map(capabilityBriefLine).join(", ")
      : "";
  // ADR-0171: the pre_fs brief carries the S5 capability-check line (warning-only, never a gate condition).
  const largeGaps = register.rows
    .filter((r) => gapCautions(r).some((c) => c.key === "large_gap"))
    .map((r) => r.capability)
    .slice(0, 5);
  const check =
    register.rows.length > 0
      ? (() => {
          const s = attainabilitySummary(register.rows);
          return `필요 역량 점검(S5): 확정 ${s.confirmed} · 확정 전 ${s.awaitingConfirmation} · 재판정 필요 ${s.stale} · 미판정 ${s.grades.unjudged - s.stale}건 — 참고 정보이며 승인 조건이 아닙니다`;
        })()
      : "";
  if (!row && !gaps) return "S5 역량 평가: 없음";
  return (
    [
      gaps,
      largeGaps.length > 0 ? `큰 격차 주의: ${largeGaps.join(" / ")}` : "",
      check,
      row?.entry_strategy ? `진출전략: ${entryStrategyText(row.entry_strategy).slice(0, 300)}` : "",
      row?.rationale ? `평가 근거: ${row.rationale.slice(0, 200)}` : "",
    ]
      .filter(Boolean)
      .join("\n") || "S5 역량 평가: 요약 없음"
  );
}

function bfSummary(db: Database, oppId: string): string {
  const targets = db
    .query(
      "SELECT company_name, status, exclusion_reason, screening_json FROM brownfield_target WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 12",
    )
    .all(oppId) as Array<{
    company_name: string;
    status: string;
    exclusion_reason: string | null;
    screening_json: string | null;
  }>;
  const lines = targets.map(
    (t) => `- ${t.company_name}: ${t.status}${t.exclusion_reason ? ` (제외: ${t.exclusion_reason})` : ""}`,
  );
  return (
    [
      `Long/Short List ${targets.length}건`,
      ...lines,
      // 2026-10-20 decider: the S7 per-target capability-check line is gone — capability
      // verification lives in S9 (capability-dd) and S7/S9 are not linked.
    ]
      .filter(Boolean)
      .join("\n") || "S6/S7 대상: 없음"
  );
}

// Project-side summaries (import-based — the same data the IC package composes).
function s8Summary(projectId: string): string {
  const db = getDb();
  try {
    const { cases, adoption } = { cases: listBusinessCases(projectId).cases, adoption: latestAdoption(projectId) };
    if (cases.length === 0) return "S8 Business Case: 없음";
    // ADR-0179 slice 1 - IRR ceiling guard markers per case (display metadata
    // for the gate-brief so risk-officer's optimism-bias review sees it; never
    // a gate condition).
    let bc = null;
    try {
      bc = resolveBusinessCaseParams(getDb(), projectId);
    } catch {
      bc = null;
    }
    // ADR-0179 slice 2 - anchor scope-compatibility flag as one labeled
    // decision-support line (design §5.2: gate-brief text surface). Non-ok
    // flags are recorded as confidence-lowering evidence per non-negotiable
    // #4; the wording says so and never blocks.
    let scopeFlag: AnchorScopeFlag | null = null;
    try {
      scopeFlag = resolveAnchorScopeFlag(getDb(), projectId);
    } catch {
      scopeFlag = null;
    }
    const scopeLine =
      scopeFlag && scopeFlag.status !== "ok"
        ? [`시장 범위: ${scopeFlag.label} — ${scopeFlag.reason} (참고 정보이며 승인 조건이 아닙니다)`]
        : [];
    // ADR-0179 slice 3 - sourced-share and ratio-guard decision-support lines
    // (design §6.1/§7.1 gate-brief surface). Reference evidence the human
    // reviewer weighs; never a gate condition.
    const trackRow = db.query("SELECT track FROM md_project WHERE id = ?").get(projectId) as
      | { track: string | null }
      | undefined;
    const gf = trackRow?.track === "greenfield";
    const shareLine =
      gf && bc && isShareUnsourced(bc.captureSource)
        ? [
            `시장점유율: ${SHARE_UN_SOURCED_LABEL} (${((bc.captureRate ?? 0) * 100).toFixed(1)}%) — 사람이 근거를 남긴 값이 아닙니다 (참고 정보이며 승인 조건이 아닙니다)`,
          ]
        : [];
    let ratioLine: string[] = [];
    try {
      const pg = resolveRatioGuardFlag(getDb(), projectId);
      if (pg?.tripped)
        ratioLine = [`${pg.label} (매출/투자 ${pg.ratio?.toFixed(1)}배 > ${pg.threshold}배) — ${pg.diagnostic}`];
    } catch {
      /* omit on read failure */
    }
    const lines = cases.slice(0, 8).map((c) => {
      const p50 = c.simulations?.find((s) => s.percentile === "p50") ?? null;
      const band = irrGuardBand(p50?.irr, bc?.irrFlagThreshold, bc?.irrCautionThreshold);
      const guard = band ? ` [IRR ${IRR_GUARD_CHIP_LABEL[band]}]` : "";
      return `- ${c.name} (${c.kind}${c.scenario ? `, ${c.scenario}` : ""}${c.variant ? `, ${c.variant}` : ""})${c.adopted ? " [채택]" : ""}${c.recommended ? " [결정론 RECOMMENDED]" : ""}${guard}`;
    });
    return [
      `채택: ${adoption ? `${adoption.adoptedBy} @ ${adoption.adoptedAt.slice(0, 10)}` : "없음"}`,
      ...scopeLine,
      ...shareLine,
      ...ratioLine,
      ...lines,
    ].join("\n");
  } catch (err) {
    return `S8 Business Case: 요약 실패 (${err instanceof Error ? err.message : "unknown"})`;
  }
}

/** ADR-0176 slice 4: investment-uncertainty simulation output as labeled decision support. Never a gate condition. */
export function investUncertaintyLine(db: Database, projectId: string): string {
  try {
    return investUncertaintyBriefText(buildInvestUncertainty(db, projectId));
  } catch {
    return "투자 불확실성: 요약 실패 - 참고 정보이며 승인 조건이 아닙니다";
  }
}

/** One informational line: the S8 technical lens status (ADR-0169). Never a gate condition. */
function technicalLensLine(db: Database, projectId: string): string {
  try {
    const t = buildS8LensSummary(db, projectId).technical;
    return technicalLensBriefLine({
      status: t.status,
      judged: t.judged,
      total: t.total,
      cautionItems: t.items.filter((i) => i.status === "caution").map((i) => i.label),
      staleCount: t.staleCount,
    });
  } catch {
    return "기술적 타당성: 요약 실패 — 참고 정보이며 승인 조건이 아닙니다";
  }
}

function ddSummary(db: Database, projectId: string): string {
  try {
    const s = ddCompletionSummary(projectId);
    const findings = db
      .query(
        "SELECT category, description, value_impact FROM dd_finding WHERE project_id = ? AND target_id IS NULL ORDER BY created_at DESC LIMIT 8",
      )
      .all(projectId) as Array<{ category: string; description: string; value_impact: string | null }>;
    const waiverCount = db
      .query("SELECT COUNT(*) c FROM waiver WHERE project_id = ? AND target_id IS NULL")
      .get(projectId) as unknown as { c: number };
    return (
      [
        `체크리스트: 전체 ${s.total}건, 미판정 ${s.pending + s.unassessed}건, 필수 미충족 ${s.mandatoryUnmet}건`,
        `waiver ${waiverCount.c}건`,
        ...findings.map(
          (f) =>
            `- [${f.category}] ${f.description.slice(0, 160)}${f.value_impact ? ` (가치영향: ${f.value_impact})` : ""}`,
        ),
      ]
        .filter(Boolean)
        .join("\n") || "S9 DD: 데이터 없음"
    );
  } catch (err) {
    return `S9 DD: 요약 실패 (${err instanceof Error ? err.message : "unknown"})`;
  }
}

function dealSummary(db: Database, projectId: string): string {
  const rows = db
    .query(
      "SELECT vehicle, stake_type, instrument_mix, tax_structure_note, liability_isolation_note, financing_leverage_note, exit_structure_note, four_axis_review_completed, rationale FROM deal_structure_hypothesis WHERE project_id = ? ORDER BY hypothesized_at DESC, id DESC LIMIT 3",
    )
    .all(projectId) as Array<Record<string, string | number | null>>;
  if (rows.length === 0) return "S10 검토/안건구조 가설: 없음";
  return rows
    .map(
      (r) =>
        `- ${r.vehicle ?? "?"} / 지분 ${r.stake_type ?? "?"} / 수단 ${r.instrument_mix ?? "?"}${r.four_axis_review_completed ? " [4축 완료]" : ""}${r.rationale ? ` — ${String(r.rationale).slice(0, 160)}` : ""}`,
    )
    .join("\n");
}

function ragSummary(db: Database, projectId: string): string {
  const view = readRagView(db, projectId);
  const rows = Object.entries(view.dimensions);
  if (rows.length === 0) return "RAG 제안: 없음 (미산정)";
  const lines = rows.map(
    ([dim, r]) => `- ${dim}: ${r!.grade}${r!.rationale ? ` — ${r!.rationale.slice(0, 120)}` : ""}`,
  );
  lines.push(
    view.status === "graded"
      ? `- 종합: ${view.overall!.grade}`
      : `- 종합: 미산정 — 미평가 차원 ${view.missing_dimensions.join(", ")} (색상 없음)`,
  );
  return lines.join("\n") + " (AI 제안 — 승인 아님)";
}

function priorGates(db: Database, projectId: string, gates: string[]): string {
  const rows = db
    .query(
      `SELECT id, gate, decision, decided_by, rationale FROM (
         SELECT id, gate, decision, decided_by, rationale,
                ROW_NUMBER() OVER (PARTITION BY gate ORDER BY decided_at DESC, id DESC) AS rn
         FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate IN (${gates.map(() => "?").join(",")})
       ) WHERE rn = 1`,
    )
    .all(projectId, ...gates) as Array<{
    id: string;
    gate: string;
    decision: string;
    decided_by: string;
    rationale: string;
  }>;
  if (rows.length === 0) return `선행 진행(${gates.join(", ")}): 미기록`;
  // ADR-0186 D6: label an IC GO that still awaits its second-reviewer countersign (the brief must not present it as in force).
  return rows
    .map(
      (r) =>
        `- ${r.gate}: ${r.decision.toUpperCase()}${effectiveState(db, projectId, r).awaiting ? " (awaiting countersign - not yet in force)" : ""}${r.rationale ? ` — ${r.rationale.slice(0, 160)}` : ""}`,
    )
    .join("\n");
}

/** Build the prompt context for one gate — ONLY its manifest artifacts. */
export function buildGateContext(db: Database, entityType: GateBriefEntity, entityId: string, gate: string): string {
  if (entityType === "opportunity") {
    const opp = oppRow(db, entityId);
    if (!opp) return "기회를 찾을 수 없습니다.";
    const base = `기회명: ${opp.name}\n시장: ${opp.market_scope ?? "미정"}\n가치사슬: ${opp.value_chain_node ?? "미정"}\n발굴 근거: ${opp.rationale ?? "없음"}`;
    if (gate === "screening") {
      return [
        base,
        `\n[S1 시장 규모·성장]\n${s1Summary(db, opp.market_scope)}`,
        `\n[S3 필요 역량 수준 요약]\n${s3GapSummary(db, entityId)}`,
        `\n[S2 기회 퍼널]\n${s2Factors(opp)}`,
        `\n[S3 적합성·시너지 초안]\n${s3Summary(opp)}`,
      ].join("\n");
    }
    if (gate === "pre_fs") {
      const bf = opp.target_universe_json
        ? "\n[S5/BF 쇼트리스트 상태]\n" + bfSummary(db, entityId)
        : "\n[S5 역량 평가]\n" + s5Summary(db, entityId);
      return [
        base,
        `\n[S1 시장 규모·성장]\n${s1Summary(db, opp.market_scope)}`,
        `\n[S3 필요 역량 수준 요약]\n${s3GapSummary(db, entityId)}`,
        `\n[S3 적합성·시너지 초안]\n${s3Summary(opp)}`,
        `\n[S4 트랙 결정·라우트]\n${s4Summary(db, entityId)}`,
        bf,
      ].join("\n");
    }
    if (gate === "target_screening") {
      return [
        base,
        `\n[S4 트랙 결정·라우트]\n${s4Summary(db, entityId)}`,
        `\n[S6/S7 대상 목록·스크리닝]\n${bfSummary(db, entityId)}`,
      ].join("\n");
    }
    return base;
  }
  // project gates
  const project = db.query("SELECT id, project_name FROM md_project WHERE id = ?").get(entityId) as {
    id: string;
    project_name: string;
  } | null;
  if (!project) return "프로젝트를 찾을 수 없습니다.";
  const base = `프로젝트: ${project.project_name}`;
  if (gate === "fs") {
    return [
      base,
      `\n[S8 Business Case]\n${s8Summary(entityId)}`,
      `\n[S8 기술적 타당성(참고)]\n${technicalLensLine(db, entityId)}`,
      `\n[S8 투자 불확실성(S5 시뮬레이션 산출물, 참고)]\n${investUncertaintyLine(db, entityId)}`,
    ].join("\n");
  }
  if (gate === "dd") {
    return [base, `\n[S8 채택 BC 요약]\n${s8Summary(entityId)}`, `\n[S9 DD]\n${ddSummary(db, entityId)}`].join("\n");
  }
  if (gate === "entity_ic" || gate === "group_ic") {
    const prior = priorGates(db, entityId, gate === "entity_ic" ? ["fs", "dd"] : ["entity_ic", "dd"]);
    return [
      base,
      `\n[S8 채택 BC 요약]\n${s8Summary(entityId)}`,
      `\n[S9 DD 완료]\n${ddSummary(db, entityId)}`,
      `\n[RAG 제안]\n${ragSummary(db, entityId)}`,
      `\n[S10 검토/안건구조 가설]\n${dealSummary(db, entityId)}`,
      `\n[선행 진행]\n${prior}`,
    ].join("\n");
  }
  return base;
}

/** Whitelist-clamp the LLM's JSON — never trusted raw. */
export function normalizeGateBrief(raw: unknown): GateBrief {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rec = String(r.recommendation ?? "")
    .trim()
    .toLowerCase();
  const conf = String(r.confidence ?? "")
    .trim()
    .toLowerCase();
  const strList = (arr: unknown, max: number) =>
    Array.isArray(arr)
      ? arr
          .map((s) =>
            String(s ?? "")
              .trim()
              .slice(0, 300),
          )
          .filter(Boolean)
          .slice(0, max)
      : [];
  return {
    recommendation: ["go", "hold", "kill"].includes(rec) ? (rec as GateBrief["recommendation"]) : null,
    confidence: ["high", "medium", "low"].includes(conf) ? (conf as GateBrief["confidence"]) : null,
    rationale_draft: String(r.rationale_draft ?? "")
      .trim()
      .slice(0, 1500),
    key_evidence: strList(r.key_evidence, 8),
    cautions: strList(r.cautions, 8),
  };
}

/** Deterministic fallback — evidence summary only. A go/hold/kill is derived
 *  solely for the screening gate (the spec's published criteria); every other
 *  gate returns recommendation null rather than a fabricated verdict. */
export function synthesisGateBrief(
  db: Database,
  entityType: GateBriefEntity,
  entityId: string,
  gate: string,
  manifest: string[],
): GateBrief {
  const evidence: string[] = [];
  let recommendation: GateBrief["recommendation"] = null;
  let confidence: GateBrief["confidence"] = null;
  if (entityType === "opportunity") {
    const opp = oppRow(db, entityId);
    if (opp) {
      evidence.push(s3Summary(opp));
      if (gate === "screening" || gate === "pre_fs")
        evidence.push(s4Summary(db, entityId) === "S4 트랙 결정: 없음" ? "S4 트랙 결정: 없음" : "S4 트랙 결정: 기록됨");
      if (gate === "screening") {
        const rec = gateRecommendation(opp);
        if (rec) {
          recommendation = rec.recommendation.toLowerCase() as GateBrief["recommendation"];
          confidence = "medium";
          evidence.push(rec.rationale);
        }
      }
      if (gate === "target_screening" || gate === "pre_fs") evidence.push(bfSummary(db, entityId));
    }
  } else if (entityType === "project") {
    evidence.push(s8Summary(entityId));
    if (gate === "fs") {
      evidence.push(technicalLensLine(db, entityId));
      evidence.push(investUncertaintyLine(db, entityId));
    }
    if (gate === "dd" || gate === "entity_ic" || gate === "group_ic") evidence.push(ddSummary(db, entityId));
    if (gate === "entity_ic" || gate === "group_ic") {
      evidence.push(ragSummary(db, entityId));
      evidence.push(dealSummary(db, entityId));
    }
  }
  const found = evidence.filter((e) => e && !/없음|미평가|없다/.test(e.split("\n")[0])).length;
  return {
    recommendation,
    confidence,
    rationale_draft:
      `결정론 폴백 — 매니페스트 ${manifest.length}건 중 판돈 가능한 근거 ${found}건. ` +
      `권고는 ${recommendation ? "스펙 공개 기준으로만 산출했습니다" : "데이터만으로 산출할 수 없어 null입니다 (사람이 판단하세요)"}. ` +
      `LLM 구성 후 '브리프 생성'으로 제안을 받을 수 있습니다.`,
    key_evidence: evidence.slice(0, 8),
    cautions: ["LLM 미구성 또는 실패 — 결정론 폴백이며 권고는 스펙 공개 기준으로만 산출됩니다."],
  };
}

// ── S4 route-steering committee brief (design §8.2, amendment 2026-11-10) ──
//
// The pre_fs committee session convenes with this brief by default (§8.3,
// injected at createCommitteeSession): buildGateContext's ADR-0118 pre_fs
// manifest plus the track advisory rendered as JUDGMENT EVIDENCE (both
// directions visible — anchoring-bias guard), never as a judgment direction.
// Supplement A/C content discipline: every figure row carries its source
// version id and data-confidence grade where the data exposes one; unset
// states render honestly; NO silent defaults; undefined when no artifacts
// exist (the session then convenes with the plain one-liner topic — no
// fabrication).

// Supplement C — the leading scope line (Korean, product content): stops
// pre_fs resolution_notes from imitating viability conclusions without basis
// (quantitative financial evidence is produced at S5/S8, after the route
// decision; this brief grounds route/scope judgment only).
const PRE_FS_BRIEF_SCOPE_LINE = "재무 정량 근거는 S5/S8에서 산출 — 본 심의는 라우트·범위 판단 근거임";
// ADR-0181 honest-unset wording for the market figures (no silent defaults).
const S1_MARKET_UNSET_LABEL = "시장 근거 미산출";
const ENTRY_MARKET_UNSET_LABEL = "진입시장 미확정";

/** The market_sizing_version row a pre_fs S1 figure was read from — the
 * version identity plus the grade columns the table actually exposes
 * (data_confidence_grade A|B|C|U per ADR-0187, chain_hops, confidence_basis;
 * there is NO grade inside the payload). Resolved with the same
 * market_scope name join s1Summary uses, so the provenance line references
 * exactly the version whose figures the manifest section shows. */
interface SizingVersionRow {
  id: string;
  version_no: number;
  data_confidence_grade: string | null;
  chain_hops: number | null;
  confidence_basis: string | null;
}

function latestSizingVersion(db: Database, marketScope: string | null): SizingVersionRow | null {
  if (!marketScope) return null;
  const ind = db.query("SELECT id FROM md_industry WHERE name_ko = ? LIMIT 1").get(marketScope) as
    | { id: string }
    | undefined;
  if (!ind) return null;
  const row = db
    .query(
      `SELECT v.id, v.version_no, v.data_confidence_grade, v.chain_hops, v.confidence_basis
       FROM market_sizing_version v
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE a.industry_id = ? AND a.status = 'completed'
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(ind.id) as SizingVersionRow | undefined;
  return row ?? null;
}

/** Which pre_fs manifest areas hold REAL artifacts (vs the honest-unset
 * markers their summaries render). The §8.2 undefined rule: when every area
 * is unset the advisory has no computable signals either (all its signal
 * sources are these same artifacts), so the brief would be all markers —
 * return undefined and let the session convene without one. */
function preFsArtifactPresence(db: Database, opp: OppRow): boolean {
  const s1 = latestSizingVersion(db, opp.market_scope) !== null;
  const entry = buildSubjectMarketContext(db, opp.id) !== null; // S2-confirmed entry market (ADR-0181)
  const s3Scores = opp.attractiveness_score !== null || opp.synergy_score !== null;
  const gapRow = db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(opp.id) as
    | { capability_gap_json: string | null }
    | undefined;
  const s3Gaps = parseGapRegister(gapRow?.capability_gap_json ?? null).rows.length > 0;
  const s4 = getCurrentRouteDecision(opp.id, db) !== null;
  const s5 =
    (
      db.query("SELECT COUNT(*) c FROM greenfield_assessment WHERE opportunity_id = ?").get(opp.id) as unknown as {
        c: number;
      }
    ).c > 0;
  const bf =
    (
      db.query("SELECT COUNT(*) c FROM brownfield_target WHERE opportunity_id = ?").get(opp.id) as unknown as {
        c: number;
      }
    ).c > 0;
  return s1 || entry || s3Scores || s3Gaps || s4 || s5 || bf;
}

/** Figure provenance lines: version identity + data-confidence grade per
 * figure (supplement A). A grade is shown ONLY when the source table exposes
 * one — market_sizing_version.data_confidence_grade exists; the opportunity
 * S3 score columns carry no grade, so S3 rows are tagged proposal-only and
 * the absence of a grade is stated, never invented. */
function preFsProvenanceLines(db: Database, opp: OppRow): string[] {
  const lines: string[] = [];
  const v = latestSizingVersion(db, opp.market_scope);
  if (v) {
    const grade = v.data_confidence_grade ?? "미기록";
    const hops = v.chain_hops != null ? ` · 근거 사슬 홉 ${v.chain_hops}` : "";
    const basis = v.confidence_basis ? ` · 근거: ${v.confidence_basis.slice(0, 80)}` : "";
    lines.push(
      `- S1 시장 규모·성장·경쟁 구조: market_sizing_version v${v.version_no} · id ${v.id} · 데이터 신뢰도 등급 ${grade}${hops}${basis}`,
    );
  } else {
    lines.push(`- S1 시장 규모·성장·경쟁 구조: ${S1_MARKET_UNSET_LABEL}`);
  }
  const entry = buildSubjectMarketContext(db, opp.id);
  lines.push(
    entry?.growthRate != null
      ? `- 진입시장 성장률 (S2 확정 — ADR-0181 진입시장 근거): ${Math.round(entry.growthRate * 1000) / 10}%/년`
      : `- 진입시장 성장률: ${ENTRY_MARKET_UNSET_LABEL} (S2 확정 진입시장 없음)`,
  );
  if (opp.attractiveness_score !== null || opp.synergy_score !== null) {
    lines.push(
      `- S3 적합성·시너지 점수: proposal (AI 초안 — 사람 확정 여부는 위 점수 행 표기) · 등급 데이터 없음 (등급 산정 컬럼이 없어 표기하지 않음)`,
    );
  }
  return lines;
}

/** The track advisory as judgment evidence (supplement A, risk-officer):
 * one row per signal (label · leans · weight · note) with BOTH directions
 * visible, base rates and re-review triggers included; the advisory's own
 * recommendedTrack appears only as one labeled proposal line, matching the
 * flow.spec route-advisory comment ("산출물은 권고일 뿐이며 결정은 사람의
 * route_decision"). */
function preFsAdvisorySection(advisory: TrackAdvisory): string {
  const lines = advisory.signals.map((s) => `- ${s.label} · ${s.leans} · weight ${s.weight} — ${s.note}`);
  lines.push(
    advisory.baseRates.length > 0
      ? `- 베이스레이트 (과거 라우트 결정): ${advisory.baseRates
          .map(
            (b) =>
              `${b.track} ${b.decisions}건 (entity_ic GO ${b.with_entity_ic_go}건${b.killed_with_learning != null ? `, 학습 후 kill ${b.killed_with_learning}건` : ""})`,
          )
          .join(" / ")}`
      : "- 베이스레이트 (과거 라우트 결정): 기록 없음",
  );
  lines.push(
    advisory.reReviewTriggers.length > 0
      ? `- 재검토 트리거: ${advisory.reReviewTriggers.join(" / ")}`
      : "- 재검토 트리거: 없음",
  );
  lines.push(
    `- 결정론 트랙 권고: ${advisory.recommendedTrack} (proposal, not a decision — 권고일 뿐이며 결정은 사람의 route_decision)`,
  );
  return lines.join("\n");
}

/**
 * The default brief for a pre_fs route-steering committee session (§8.2):
 * the ADR-0118 pre_fs manifest context plus the track advisory as evidence.
 * Returns undefined when the opportunity has NO artifacts at all — the
 * caller convenes without a brief (declared-input grounding, never a gate
 * condition; §8.11: flow.spec S4 entry criteria gate only on S3 완료).
 */
export function buildPreFsCommitteeBrief(db: Database, opportunityId: string): string | undefined {
  const opp = oppRow(db, opportunityId);
  if (!opp) return undefined;
  if (!preFsArtifactPresence(db, opp)) return undefined;
  const advisory = computeTrackAdvisory(db, opportunityId);
  return [
    `[범위] ${PRE_FS_BRIEF_SCOPE_LINE}`,
    "",
    "## 판정 근거 매니페스트 (ADR-0118 pre_fs)",
    buildGateContext(db, "opportunity", opportunityId, "pre_fs"),
    "",
    "## 산출 근거 버전·등급",
    ...preFsProvenanceLines(db, opp),
    "",
    "## 트랙 어드바이저 판단 근거 (양방향 근거 — 권고는 결정이 아님)",
    preFsAdvisorySection(advisory),
  ].join("\n");
}
