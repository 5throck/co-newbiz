// @version 1.11.0
// Idempotent S1→S12 demo chain seeds — BROWNFIELD (seedS1ToS12Demo) and
// GREENFIELD (seedGreenfieldS1ToS12Demo), one full lifecycle per track.
//
// The operational DB is intentionally gitignored, so a fresh/local database
// can pass schema checks while still lacking a deal that demonstrates
// the full S1-S12 lifecycle. Each seed creates one compact, clearly-labelled
// demo chain that satisfies the process-flow predicates without fabricating it
// as production data. v1.11.0 also seeds the predicate-optional demo surfaces
// the S9/S11/S12 tool cards read (T-20261022-042): DD tool rows, PMI
// monitoring (brownfield), and the milestone register (both tracks).
//
// Usage:
//   bun scripts/co-newbiz/seed-s1-s12-demo.ts [--db-path <path>]
import { getDb } from "../../db/client.ts";
import { writeTargetScope } from "../../db/repositories/entry-market.repository.ts";
import type { SizingMatrix } from "../../app/web-next/lib/market-sizing.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { DD_WORKSPACE_CHECKLISTS, SUB_TRACK_DD_CHECKLISTS, getChecklistItems } from "../../app/web-next/lib/library.ts";
import { currentReviewCycle } from "../../app/web-next/lib/portfolio.ts";
import { SCREENING_CHECKLIST_ID, screeningItems } from "../../app/web-next/lib/brownfield-targets.ts";

const DEMO = {
  /** Realistic job-spec snapshot so the S8 params panel shows the real
   *  execution contract instead of a legacy placeholder. */
  inputsSnapshot: {
    job_id: "s8:demo-s1-s12-project:base:market_forward",
    seed_policy: { base: "demo-s1-s12-project", hash: "fnv1a" },
    device: "cpu",
    iterations: 2000,
    horizon_years: 5,
    discount_rate: { value: 0.09, subject: "target", source: "user" },
    cases: [
      {
        case_id: "base:market_forward",
        drivers: {
          revenue_y1: { dist: "constant", value: 15000, unit: "KRW_M", source: "시장규모 × 시장점유율 0.5%" },
          ramp_up: { dist: "constant", value: [0.4, 0.7, 0.9, 1.0, 1.0], source: "기본값" },
          revenue_growth: { dist: "normal", mean: 0.08, sigma: 0.05, unit: "ratio", source: "시장 성장률" },
          opex_ratio: { dist: "constant", value: 0.6, unit: "ratio", source: "기본값" },
          capex_ratio: { dist: "constant", value: 0.1, unit: "ratio", source: "기본값" },
          initial_investment: { dist: "constant", value: 7500, unit: "KRW_M", source: "ADR-0106" },
        },
      },
    ],
  },
  industryId: "demo-s1-s12-industry",
  companyId: "demo-s1-s12-company",
  oppId: "demo-s1-s12-opportunity",
  projectId: "demo-s1-s12-project",
  analysisId: "demo-s1-s12-analysis",
  versionId: "demo-s1-s12-analysis-v1",
  routeId: "demo-s1-s12-route",
  modelId: "demo-s1-s12-business-case",
  runId: "demo-s1-s12-run",
  selectionRunId: "demo-s1-s12-selection-run",
  targetId: "demo-s1-s12-target-1",
  adoptionRunId: "demo-s1-s12-adoption-run",
  structureId: "demo-s1-s12-structure",
};

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** Demo S3 provenance: a completed synergy analysis linked to the opportunity so
 *  the S3 list agrees with the confirmed score on the opportunity (without it the
 *  list says "no synergy analysis" while S2/S4 show a confirmed score — D-15). */
function seedSynergyAnalysis(db: ReturnType<typeof getDb>, id: string, oppId: string, oppName: string, score: number, now: string, actor: string): void {
  db.run(
    `INSERT OR IGNORE INTO synergy_analysis
     (id, company_id, status, current_step, created_by, created_at, completed_at, opportunity_id)
     VALUES (?, 'md-synergy-registry-sentinel', 'completed', 3, ?, ?, ?, ?)`,
    [id, actor, now, now, oppId],
  );
  db.run(
    `INSERT OR IGNORE INTO synergy_version (id, analysis_id, version_no, payload, changelog, created_by, created_at)
     VALUES (?, ?, 1, ?, 'S1-S12 demo synergy baseline', ?, ?)`,
    [
      `${id}-v1`, id,
      json({
        company: { name: oppName, dartCorpCode: null },
        acquirer: null,
        dartFinancials: { available: false },
        researchSources: [],
        financialStrengths: [],
        financialWeaknesses: [],
        businessAssessment: "데모 시드 — 실제 분석이 아닙니다.",
        marketLinkage: { marketSummaries: [], synergyAreas: [] },
        shortList: [],
        stepSummaries: [],
        opportunity: { id: oppId, name: oppName },
        synergyScore: score,
        synergyRationale: "demo seed",
      }),
      actor, now,
    ],
  );
}

/** Demo operating policy so the timeline page shows SLA targets (an unset policy renders "정책 미설정"). */
function seedStageSla(db: ReturnType<typeof getDb>, now: string, actor: string): void {
  const targets: Array<[string, number]> = [["S1", 14], ["S2", 7], ["S3", 14], ["S4", 7], ["S5", 14], ["S6", 21], ["S7", 14], ["S8", 21], ["S9", 45], ["S10", 14], ["S11", 60], ["S12", 90]];
  for (const [stage, days] of targets) {
    db.run("INSERT OR IGNORE INTO stage_sla (stage_id, target_days, updated_by, updated_at) VALUES (?, ?, ?, ?)", [stage, days, actor, now]);
  }
}

export interface SeedOptions {
  /** Default true: also write the human gate decisions and the S12 transition
   *  decision. The E2E harness passes false so those human acts are performed
   *  through the UI instead of being pre-seeded. */
  humanDecisions?: boolean;
  /** Default true: pre-judge the M&A sub-track DD checklists (brownfield
   *  feasibility + M&A special topics). The E2E passes false to judge them in
   *  the DD workspace UI. */
  subTrackDd?: boolean;
}

/** Small, clearly demo-labelled but structurally complete matrix: the S1 report UI dereferences every field below. */
const DEMO_MATRIX: SizingMatrix = {
  industryLabel: "S1-S12 데모 산업 (데모 데이터)",
  provenance: "llm-estimate",
  synthesized: true,
  anchor: { sources: [{ label: "데모 앵커 (실제 출처 아님)", estimate: 0.9, status: "consensus", note: "demo seed — not a real estimate" }], total: 0.9 },
  segments: [
    { code: "demo_core", label: "핵심 수요처 (데모)" },
    { code: "demo_aftermarket", label: "애프터마켓 (데모)" },
  ],
  regions: [
    { code: "KR", label: "한국 (데모)", weight: 60, mix: { demo_core: 70, demo_aftermarket: 30 }, adjustment: "demo seed" },
    { code: "ROW", label: "기타 지역 (데모)", weight: 40, mix: { demo_core: 60, demo_aftermarket: 40 }, adjustment: "demo seed" },
  ],
  baseline2026: { KR: { demo_core: 0.4, demo_aftermarket: 0.2 }, ROW: { demo_core: 0.2, demo_aftermarket: 0.1 } },
  cagrBase: { KR: { demo_core: 0.13, demo_aftermarket: 0.1 }, ROW: { demo_core: 0.1, demo_aftermarket: 0.08 } },
  chainGrade: { grade: "B", statisticalHops: 0, note: "demo seed: no statistical hop, llm-estimate source cap" },
  chainDirection: { position: "midstream", note: "demo seed", relatedIndustries: [{ relation: "전방", name: "데모 수요 산업" }] },
  qualitative: { opportunityFactors: ["데모 기회 요인"], riskFactors: ["데모 위험 요인"] },
  consistency: { bottomUpCagr: 13, topDownCagr: 13, tolerance: "demo seed" }, // percent, like the pipeline (market-sizing-pipeline stores *100)
  crossValidation: [],
  limitations: ["데모 시드 데이터 — 실제 시장 분석이 아닙니다."],
  competitive: {
    structure: "데모 경쟁 구조 — 과점 (실제 데이터 아님)",
    players: [
      { name: "S1-S12 데모 대상회사", tier: "leader", note: "demo seed" },
      { name: "대체 후보 A", tier: "challenger", note: "demo seed" },
      { name: "대체 후보 B", tier: "niche", note: "demo seed" },
    ],
  },
};

export function seedS1ToS12Demo(dbPath?: string, opts: SeedOptions = {}): { opportunityId: string; projectId: string } {
  const humanDecisions = opts.humanDecisions ?? true;
  const subTrackDd = opts.subTrackDd ?? true;
  runMigrations(dbPath);
  const db = getDb(dbPath);
  const now = nowIso();
  const actor = "demo-seed";

  db.transaction(() => {
    db.run(
      `INSERT OR IGNORE INTO md_industry (id, ksic_code, name_ko, name_en, created_at, pinned)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [DEMO.industryId, "DEMO-S1S12", "S1-S12 데모 산업", "S1-S12 Demo Industry", now],
    );
    db.run(
      `INSERT OR IGNORE INTO md_company (id, dart_corp_code, name_ko, name_en, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [DEMO.companyId, null, "S1-S12 데모 대상회사", "S1-S12 Demo Target Co.", now],
    );
    db.run(
      `INSERT OR IGNORE INTO market_sizing_analysis
       (id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at)
       VALUES (?, ?, 'completed', 6, 'demo-s1-s12', ?, ?, ?)`,
      [DEMO.analysisId, DEMO.industryId, actor, now, now],
    );
    db.run(
      `INSERT OR IGNORE INTO market_sizing_version
       (id, analysis_id, version_no, payload, changelog, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis)
       VALUES (?, ?, 1, ?, 'S1-S12 demo market sizing baseline', ?, ?, 'B', 0, 'demo seed: no statistical hop, llm-estimate source cap (Wave F-5)')`,
      [
        DEMO.versionId,
        DEMO.analysisId,
        json({
          matrix: DEMO_MATRIX,
        }),
        actor,
        now,
      ],
    );

    db.run(
      `INSERT OR IGNORE INTO opportunity
       (id, project_id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
        attractiveness_score, synergy_score, status, rationale, decided_by, decided_at, created_by, created_at,
        target_universe_json, capability_gap_json, synergy_score_confirmed_at, synergy_score_confirmed_by, industry_id, sizing_version_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'selected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEMO.oppId,
        null,
        "S1-S12 데모 Brownfield 기회",
        "S1-S12 데모 산업",
        "핵심 부품/서비스 밸류체인 노드",
        1200000, // 백만원 = 1.2조원 ≈ $0.9B (matches the S1 anchor at ~1,350 KRW/USD)
        0.13,
        82,
        88,
        "시장성·시너지·실행 가능성을 모두 갖춘 end-to-end 데모 기회",
        actor,
        now,
        actor,
        now,
        json({
          definition: "핵심 역량과 기존 고객 접점을 가진 국내외 Brownfield 후보",
          criteria: ["기술/IP 보유", "상업화 고객 기반", "실사 가능성"],
          min_long_list: 3,
        }),
        json({
          rows: [
            { capability: "핵심 기술/IP", source: "manual", held: { status: "partial" }, mitigation: "인수 후 통합" },
            { capability: "레퍼런스 고객", source: "manual", held: { status: "partial" }, mitigation: "채널 결합" },
          ],
        }),
        now,
        actor,
        DEMO.industryId,
        DEMO.versionId,
      ],
    );
    // ADR-0181 slice 1 — the target scope lives in the 0151 FK tables.
    writeTargetScope(db, DEMO.oppId, { regions: ["KR"], segments: ["demo_core"], unit_basis: "usd_m_year" }, actor, now);

    db.run(
      `INSERT OR IGNORE INTO md_project
       (id, project_no, created_at, current_stage_gate, company_id, origin, source_opportunity_id, track,
        project_name, charter_json, charter_confirmed_at, status, subject_company_rationale)
       VALUES (?, 'DEMO-S1-S12', ?, 'group_ic', ?, 'external', ?, 'brownfield', ?, ?, ?, 'open', ?)`,
      [
        DEMO.projectId,
        now,
        DEMO.companyId,
        DEMO.oppId,
        "S1-S12 데모 Brownfield 프로젝트",
        json({ milestones: ["LOI", "SPA", "PMI Day-1"], owner: actor, note: "S1-S12 demo charter baseline" }),
        now,
        "Short List 1순위 후보와 기회 역량갭이 직접 연결됨",
      ],
    );
    db.run("UPDATE opportunity SET project_id = ?, promoted_at = COALESCE(promoted_at, ?) WHERE id = ?", [DEMO.projectId, now, DEMO.oppId]);
    seedSynergyAnalysis(db, "demo-s1-s12-synergy", DEMO.oppId, "S1-S12 데모 Brownfield 기회", 88, now, actor);
    seedStageSla(db, now, actor);

    db.run(
      `INSERT OR IGNORE INTO route_decision
       (id, opportunity_id, project_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at,
        intent, total_score, status, updated_at, is_current)
       VALUES (?, ?, ?, 'brownfield', 'm_and_a', ?, ?, ?, ?, 'capability_access', 13, 'final', ?, 1)`,
      [DEMO.routeId, DEMO.oppId, DEMO.projectId, "역량 확보 속도가 핵심이므로 M&A형 Brownfield로 진행", "greenfield/JV 검토 후 속도·IP 확보 측면에서 후순위", actor, now, now],
    );
    const criteria = ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"];
    for (const [idx, criterion] of criteria.entries()) {
      db.run(
        `INSERT OR IGNORE INTO route_decision_score
         (id, decision_id, intent, criterion, score, evidence_note, created_at)
         VALUES (?, ?, 'capability_access', ?, ?, ?, ?)`,
        [`demo-s1-s12-route-score-${criterion}`, DEMO.routeId, criterion, idx === 3 ? 2 : 3, "S1-S12 demo route scoring evidence", now],
      );
    }

    const screeningStates = Object.fromEntries(screeningItems().map((item) => [item.id, "pass"]));
    for (let i = 1; i <= 3; i++) {
      db.run(
        `INSERT OR IGNORE INTO brownfield_target
         (id, opportunity_id, company_name, dart_corp_code, universe_note, status, rank, exclusion_reason, screening_json, created_at, updated_at, discovery_source, proposal_accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
        [
          `demo-s1-s12-target-${i}`,
          DEMO.oppId,
          i === 1 ? "S1-S12 데모 대상회사" : `S1-S12 대체 후보 ${i - 1}`,
          `DEMO000${i}`,
          "Target Universe 기준 충족",
          i === 1 ? "shortlisted" : "excluded",
          i === 1 ? 1 : null,
          i === 1 ? null : "상대적 적합도 낮음 — 데모 제외",
          json(screeningStates),
          now,
          now,
          now,
        ],
      );
      // Wave F-6: per-candidate source (S6) and, for the shortlisted
      // candidate, screening evidence (S7) — the same rows createTarget /
      // the screening save route write in the live app.
      db.run(
        `INSERT OR IGNORE INTO brownfield_target_evidence (id, target_id, kind, title, detail, source_kind, created_by, created_at)
         VALUES (?, ?, 'discovery', '후보 등록 — 직접 등록', 'Target Universe 기준 충족', 'manual', ?, ?)`,
        [`demo-s1-s12-target-${i}-discovery`, `demo-s1-s12-target-${i}`, actor, now],
      );
      if (i === 1) {
        db.run(
          `INSERT OR IGNORE INTO brownfield_target_evidence (id, target_id, kind, title, detail, source_kind, created_by, created_at)
           VALUES (?, ?, 'screening', '스크리닝 판정 저장', 'S1-S12 demo knock-out checklist evidence', 'manual', ?, ?)`,
          [`demo-s1-s12-target-${i}-screening`, `demo-s1-s12-target-${i}`, actor, now],
        );
      }
    }

    db.run(
      `INSERT OR IGNORE INTO project_member
       (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis)
       VALUES (?, 'admin', 'lead', ?, ?, 'S1-S12 demo owner')`,
      [DEMO.projectId, actor, now],
    );
    db.run(
      `INSERT OR IGNORE INTO project_classification
       (project_id, sensitivity, mnpi_flag, wall_group, classified_by, classified_at)
       VALUES (?, 'internal', 0, NULL, ?, ?)`,
      [DEMO.projectId, actor, now],
    );

    db.run(
      `INSERT OR IGNORE INTO business_case_model
       (id, project_id, kind, name, horizon_years, created_by, created_at, variant, target_id, inputs_json)
       VALUES (?, ?, 'investment_return', 'S1-S12 demo base case', 5, ?, ?, 'market_forward', ?, ?)`,
      [DEMO.modelId, DEMO.projectId, actor, now, DEMO.targetId, JSON.stringify(DEMO.inputsSnapshot)],
    );
    for (const [id, category, name, amount] of [
      ["revenue", "revenue", "Year-1 revenue", 15000],
      ["opex", "opex", "Integration opex", -4200],
      ["capex", "capex", "Acquisition/integration capex", -7200],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO business_case_line
         (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 1, 0.08, ?, ?)`,
        [`demo-s1-s12-bcl-${id}`, DEMO.modelId, category, name, amount, actor, now],
      );
    }
    for (const [scenario, percentile, npv, irr] of [
      ["downside", "p50", 1800, 0.09],
      ["base", "p50", 6200, 0.17],
      ["upside", "p50", 11800, 0.24],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO valuation_simulation
         (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at, bep_year, payback_discounted_years)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'S1-S12 demo valuation percentile', ?, ?, ?)`,
        [`demo-s1-s12-val-${scenario}-${percentile}`, DEMO.projectId, DEMO.modelId, scenario, percentile, npv, irr, now, 2.5, 2.5],
      );
    }
    // ADR-0143: brownfield S8 requires the human target-selection record
    // BEFORE case adoption (adoption is constrained to the selected target).
    db.run(
      `INSERT OR IGNORE INTO process_run
       (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
       VALUES (?, 'project', ?, ?, 'demo-s1-s12', 's8_target_select', 'done', 'human', ?, ?, ?, ?)`,
      [DEMO.selectionRunId, DEMO.projectId, DEMO.projectId, actor, now, now, json({ target_id: DEMO.targetId, rationale: "S1-S12 demo — 유일한 Short List 생존 대상 선정" })],
    );
    db.run(
      `INSERT OR IGNORE INTO process_run
       (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
       VALUES (?, 'project', ?, ?, 'demo-s1-s12', 's8_case_adopt', 'done', 'human', ?, ?, ?, ?)`,
      [DEMO.adoptionRunId, DEMO.projectId, DEMO.projectId, actor, now, now, json({ model_id: DEMO.modelId })],
    );

    // Wave F-6: brownfield M&A S11 requires the human-recorded PMI kickoff.
    db.run(
      `INSERT OR IGNORE INTO process_run
       (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
       VALUES ('demo-s1-s12-pmi-kickoff', 'project', ?, ?, 'demo-s1-s12', 's11_pmi_kickoff', 'done', 'human', ?, ?, ?, ?)`,
      [DEMO.projectId, DEMO.projectId, actor, now, now, json({ owner: actor, plan_note: "S1-S12 demo — Day-1 통합 계획 기준선: 인력·시스템·고객 이관 순서 확정" })],
    );

    db.run(
      `INSERT OR IGNORE INTO project_checklist_item_custom
       (id, project_id, domain, item_label, rationale, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at)
       VALUES ('demo-s1-s12-dd-custom', ?, 'commercial', 'S1-S12 demo DD required item', 'Demo DD coverage', 'C', ?, 'approved', ?, ?, ?)`,
      [DEMO.projectId, actor, actor, now, now],
    );
    db.run(
      `INSERT OR IGNORE INTO project_checklist_item_state
       (id, project_id, checklist_id, item_id, status, note, evidence_ref, assessed_by, assessed_at)
       VALUES ('demo-s1-s12-dd-state', ?, 'custom:commercial', 'demo-s1-s12-dd-custom', 'pass', 'Demo DD completed', 'demo:s1-s12-dd', ?, ?)`,
      [DEMO.projectId, actor, now],
    );
    // ADR-0148: a fresh project completes S9 only when every standard DD item is judged.
    for (const checklistId of [...Object.values(DD_WORKSPACE_CHECKLISTS), ...(subTrackDd ? (SUB_TRACK_DD_CHECKLISTS.m_and_a ?? []) : [])]) {
      for (const item of getChecklistItems(checklistId) ?? []) {
        db.run(
          `INSERT OR IGNORE INTO project_checklist_item_state
           (id, project_id, checklist_id, item_id, status, note, assessed_by, assessed_at)
           VALUES (?, ?, ?, ?, 'pass', 'Demo DD completed', ?, ?)`,
          [`demo-s1-s12-dd-${checklistId}-${item.id}`, DEMO.projectId, checklistId, item.id, actor, now],
        );
      }
    }

    // ── T-20261022-042 — predicate-optional demo surfaces ────────────────────
    // The S9 DD tool cards (contracts·compensation·interviews — the
    // tool_counts block of GET /api/projects/[id]/dd), the S11 PMI monitoring
    // tables and the S12 milestone register are predicate-optional: the
    // 2026-10-22 review (finding M5) noted a fresh DB leaves them empty,
    // weakening the smoke-test claim in this file's header. The rows below are
    // demo-labelled, stable-id INSERT OR IGNORE — purely additive, never a
    // gate input. PMI rows exist on the brownfield track only (ADR-0161).
    // S9 tool card — expert interviews (commercial-dd cdd-07 shape): two key
    // claims × two independent sources each, so the workspace triangulation
    // summary shows TRIANGULATED claims, not pending ones.
    for (const [idx, [claim, topic, interviewee, summary, ref]] of [
      [
        "데모 대상회사의 상위 고객 리텐션이 지배권 변경 조건에 민감하다",
        "고객 계약 지배권 변경(CoC) 조항 실태",
        "데모 전문가 A — 유통업계 사업개발 임원",
        "상위 고객 계약 다수에 CoC 해지 조항이 있어 인수 후 계약 유지 협상이 관건이라고 진술",
        "demo:dd-interview:1",
      ],
      [
        "데모 대상회사의 상위 고객 리텐션이 지배권 변경 조건에 민감하다",
        "고객 계약 지배권 변경(CoC) 조항 실태",
        "데모 전문가 B — 전략 컨설팅 파트너",
        "고객 이탈은 계약 조항보다 서비스 연속성 커뮤니케이션으로 방어한다고 진술",
        "demo:dd-interview:2",
      ],
      [
        "데모 대상회사의 핵심 생산 설비는 5년 내 교체 주기에 도달한다",
        "설비 수명과 교체 자본지출",
        "데모 전문가 C — 설비 정비 책임자",
        "주요 라인 설비가 10년 이상 운용돼 5년 내 단계 교체가 필요하다고 진술",
        "demo:dd-interview:3",
      ],
      [
        "데모 대상회사의 핵심 생산 설비는 5년 내 교체 주기에 도달한다",
        "설비 수명과 교체 자본지출",
        "데모 전문가 D — 산업 리서치 애널리스트",
        "동종 설비 교체 주기 벤치마크상 4~6년 내 자본지출이 합리적이라고 진술",
        "demo:dd-interview:4",
      ],
    ].entries()) {
      db.run(
        `INSERT OR IGNORE INTO dd_interview
         (id, project_id, interviewee, topic, response_summary, disagreement, follow_up, evidence_ref, claim, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
        [`demo-s1-s12-dd-interview-${idx + 1}`, DEMO.projectId, interviewee, topic, summary, ref, claim, actor, now, now],
      );
    }
    // S9 tool card — customer/supplier contract change-of-control
    // (customer-retention). Row 1 plots on the card (concentration >= 30).
    for (const [id, counterparty, direction, coc, clause, conc, exitLoss, ref] of [
      ["demo-s1-s12-coc-1", "데모 주요 고객사 A", "customer", 1, "지배권 변경 시 60일 내 계약 해지 가능 (데모)", 35, 1200, "demo:contract-coc:1"],
      ["demo-s1-s12-coc-2", "데모 주요 고객사 B", "customer", 0, null, 18, null, "demo:contract-coc:2"],
      ["demo-s1-s12-coc-3", "데모 주요 협력사 C", "supplier", 1, "지배권 변경 시 가격 재협약 조항 (데모)", 22, 400, "demo:contract-coc:3"],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO contract_coc
         (id, project_id, counterparty, direction, coc_clause_present, clause_summary, concentration_pct, est_exit_loss, evidence_ref, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, DEMO.projectId, counterparty, direction, coc, clause, conc, exitLoss, ref, actor, now, now],
      );
    }
    // S9 tool card — compensation (hr-integration). executive_ref/role_ref are
    // POSITION surrogates (ADR-0039 PII guard): never a real name. base_pay and
    // coc_payout_estimate are integer KRW won; value_impact is KRW millions
    // (day-one CoC cash outflow, bf-04).
    for (const [id, execRef, title, basePay, cocTrigger, payout, vesting, ncMonths, ncEnf, retention, flight, impact] of [
      ["demo-s1-s12-mgmt-1", "TARGET-CEO-01", "대표이사 (데모)", 250000000, 1, 800000000, 0, 24, 1, 600000000, "high", 800],
      ["demo-s1-s12-mgmt-2", "TARGET-CFO-01", "재무담당 임원 (데모)", 180000000, 1, 450000000, 1, 12, 1, 400000000, "medium", 400],
      ["demo-s1-s12-mgmt-3", "TARGET-CTO-01", "기술책임 임원 (데모)", 200000000, 0, null, 0, 12, 0, 500000000, "medium", 300],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO management_package
         (id, project_id, executive_ref, role_title, base_pay, coc_trigger, coc_payout_estimate, accelerated_vesting, non_compete_months, non_compete_enforceable, retention_plan_cost, flight_risk, value_impact, evidence_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, DEMO.projectId, execRef, title, basePay, cocTrigger, payout, vesting, ncMonths, ncEnf, retention, flight, impact, `demo:management-package:${execRef}`],
      );
    }
    for (const [id, family, grade, headcount, targetMedian, acquirerMedian, gapPct, delta] of [
      ["demo-s1-s12-comp-1", "생산운영", "P4", 12, 85000000, 78000000, 8.97, 84000000],
      ["demo-s1-s12-comp-2", "품질관리", "P3", 6, 72000000, 70000000, 2.86, 12000000],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO comp_benchmark
         (id, project_id, job_family, grade, headcount, target_median, acquirer_median, gap_pct, annual_cost_delta, evidence_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, DEMO.projectId, family, grade, headcount, targetMedian, acquirerMedian, gapPct, delta, `demo:comp-benchmark:${family}`],
      );
    }
    // S11 PMI monitoring (brownfield M&A only — ADR-0161): key-talent rows are
    // ROLE references (one retired from the register, exit dated) and two
    // signed cost-synergy certifications (run_rate_bp is basis points of the
    // committed run-rate; certified_by is a person, as the API route enforces).
    for (const [id, roleRef, status, exitDate] of [
      ["demo-s1-s12-talent-1", "C-OP-001", "active", null],
      ["demo-s1-s12-talent-2", "C-FN-001", "active", null],
      ["demo-s1-s12-talent-3", "T-RD-002", "departed_planned", "2027-06-30"],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO pmi_key_talent (id, project_id, role_ref, status, exit_date, locked_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, DEMO.projectId, roleRef, status, exitDate, now, now],
      );
    }
    for (const [id, runRateBp, quarters] of [
      ["demo-s1-s12-syn-cert-1", 7500, 2],
      ["demo-s1-s12-syn-cert-2", 6000, 4],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO pmi_synergy_certification (id, project_id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at, created_at)
         VALUES (?, ?, ?, ?, 'admin', ?, ?, ?)`,
        [id, DEMO.projectId, runRateBp, quarters, now, now, now],
      );
    }
    // S12 milestone register — the charter's promised milestones (LOI done,
    // SPA/PMI Day-1 open) so the schedule surface shows the derived-status
    // range. Status is computed from due_date/done_at and never stored.
    for (const [id, title, category, dueDate, doneAt, notes] of [
      ["demo-s1-s12-milestone-loi", "LOI 체결 (데모)", "contract", "2027-03-31", now, "S1-S12 데모 차터 마일스톤 — 완료 상태 데모"],
      ["demo-s1-s12-milestone-spa", "SPA 체결 (데모)", "contract", "2027-06-30", null, "S1-S12 데모 차터 마일스톤"],
      ["demo-s1-s12-milestone-pmi-day1", "PMI Day-1 (데모)", "custom", "2027-09-30", null, "S1-S12 데모 차터 마일스톤"],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO project_milestone (id, project_id, title, category, due_date, owner, source, done_at, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'admin', 'manual', ?, ?, ?, ?)`,
        [id, DEMO.projectId, title, category, dueDate, doneAt, notes, actor, now],
      );
    }
    // ── end T-20261022-042 demo surfaces ────────────────────────────────────

    db.run(
      `INSERT OR IGNORE INTO run (id, project_id, label, input_hash, created_by, created_at)
       VALUES (?, ?, 'S1-S12 demo scorecard run', ?, ?, ?)`,
      [DEMO.runId, DEMO.projectId, "demo-s1-s12-input-hash", actor, now],
    );
    db.run(
      `INSERT OR IGNORE INTO deal_structure_hypothesis
       (id, project_id, run_id, asset_or_stock, stake_type, instrument_mix, vehicle, commercialization_path,
        tax_structure_note, liability_isolation_note, financing_leverage_note, exit_structure_note,
        four_axis_review_completed, hypothesized_by, hypothesized_at, rationale)
       VALUES (?, ?, ?, 'stock', 'majority', 'mixed', 'spc', 'build', ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        DEMO.structureId,
        DEMO.projectId,
        DEMO.runId,
        "SPC 취득 후 세무 효율 검토 완료",
        "SPC를 통한 책임 격리",
        "인수금융과 자기자본 혼합",
        "3~5년 내 전략적 통합 또는 partial exit 가능",
        actor,
        now,
        "S10 four-axis demo structure completed",
      ],
    );
    for (const [id, kind, name, amount] of [
      ["equity", "source", "Equity contribution", 7000],
      ["debt", "source", "Acquisition debt", 5000],
      ["purchase", "use", "Purchase price", 10000],
      ["integration", "use", "Integration reserve", 2000],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO financing_sources_uses
         (id, project_id, kind, name, amount_krw_m, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'S1-S12 demo balanced plan', ?, ?)`,
        [`demo-s1-s12-fin-${id}`, DEMO.projectId, kind, name, amount, actor, now],
      );
    }

    if (humanDecisions) for (const [entityType, entityId, gate] of [
      ["opportunity", DEMO.oppId, "screening"],
      ["opportunity", DEMO.oppId, "pre_fs"],
      ["opportunity", DEMO.oppId, "target_screening"],
      ["project", DEMO.projectId, "fs"],
      ["project", DEMO.projectId, "dd"],
      ["project", DEMO.projectId, "entity_ic"],
      ["project", DEMO.projectId, "group_ic"],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO gate_decision
         (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at)
         VALUES (?, ?, ?, ?, 'go', 'S1-S12 demo human-final gate approval', ?, ?)`,
        [`demo-s1-s12-gate-${entityType}-${gate}`, entityType, entityId, gate, actor, now],
      );
    }

    const cycle = currentReviewCycle();
    for (const [section, measure, target, actual] of [
      ["financial", "revenue_growth", ">=10%", "13%"],
      ["strategic", "integration_milestone", "Day-1 readiness", "on-track"],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO venture_scorecard
         (id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key,
          target_value, actual_value, status, evidence_ref, observed_at, created_at)
         VALUES (?, ?, ?, 'portfolio-venture-monitoring', ?, 'driving', ?, ?, ?, ?, 'on_target', ?, ?, ?)`,
        [`demo-s1-s12-score-${section}-${measure}`, DEMO.runId, DEMO.projectId, cycle, section, measure, target, actual, `demo:s1-s12-scorecard:${measure}`, now, now],
      );
    }

    // ADR-0150 criterion 2 — S12 now also requires a human transition decision
    // (decided_by CHECK-pinned to 'venture-portfolio-ic') in the latest review
    // cycle. The demo records a graduate_to_core decision carrying its
    // dedicated hand-off record (criterion 4 — ADR-0151 column, required for
    // decisions recorded from the 2026-10-02 migration date onward).
    if (humanDecisions) db.run(
      `INSERT OR IGNORE INTO venture_transition_decision
         (id, run_id, project_id, review_cycle, decision, decided_by, decided_at, rationale, learning_capture, core_handoff, created_at)
       VALUES (?, ?, ?, ?, 'graduate_to_core', 'venture-portfolio-ic', ?, ?, ?, ?, ?)`,
      ["demo-s1-s12-transition", DEMO.runId, DEMO.projectId, cycle, now, "S1-S12 demo — 핵심사업 인계: 사업부 운영으로 이관하고 별도 트랜치 투자를 종료한다", null,
        "핵심사업 인계: 사업부 운영으로 이관하고 별도 트랜치 투자를 종료한다 (ADR-0151 core_handoff)", now],
    );
  })();

  return { opportunityId: DEMO.oppId, projectId: DEMO.projectId };
}

// ── Greenfield twin (2026-10-10) — S1→S12 with the track-appropriate stages ──
// Same lifecycle shape as the brownfield seed, but through the greenfield
// branch: S4 routes to 자체 진출, S5 carries the entry-strategy evidence
// (NO S6/S7 target axis), S8 runs the REAL generator (project-level,
// market-capture anchor — no DART company anchor, no acquisition pricing),
// S11 records the 설립 실행 5단계 instead of the brownfield PMI kickoff,
// and the gate set drops target_screening (brownfield-only).

const GF = {
  industryId: "demo-gf-industry",
  companyId: "demo-gf-company",
  oppId: "demo-gf-opportunity",
  projectId: "demo-gf-project",
  analysisId: "demo-gf-analysis",
  versionId: "demo-gf-analysis-v1",
  routeId: "demo-gf-route",
  assessmentId: "demo-gf-assessment",
  adoptionRunId: "demo-gf-adoption-run",
  runId: "demo-gf-run",
  structureId: "demo-gf-structure",
} as const;

/** Full SizingMatrix — the S1 report UI dereferences every field below
 *  (the E2E greenfield fixture's compact payload is NOT enough for the demo). */
const GF_MATRIX: SizingMatrix = {
  industryLabel: "S1-S12 데모 신설 산업 (데모 데이터)",
  provenance: "llm-estimate",
  synthesized: true,
  anchor: { sources: [{ label: "데모 앵커 (실제 출처 아님)", estimate: 0.8, status: "consensus", note: "demo seed — not a real estimate" }], total: 0.8 },
  segments: [
    { code: "demo_gf_core", label: "핵심 수요처 (데모)" },
    { code: "demo_gf_service", label: "연계 서비스 (데모)" },
  ],
  regions: [
    { code: "KR", label: "한국 (데모)", weight: 70, mix: { demo_gf_core: 75, demo_gf_service: 25 }, adjustment: "demo seed" },
    { code: "ROW", label: "기타 지역 (데모)", weight: 30, mix: { demo_gf_core: 65, demo_gf_service: 35 }, adjustment: "demo seed" },
  ],
  baseline2026: { KR: { demo_gf_core: 0.35, demo_gf_service: 0.15 }, ROW: { demo_gf_core: 0.15, demo_gf_service: 0.05 } },
  cagrBase: { KR: { demo_gf_core: 0.2, demo_gf_service: 0.16 }, ROW: { demo_gf_core: 0.18, demo_gf_service: 0.14 } },
  chainGrade: { grade: "B", statisticalHops: 0, note: "demo seed: no statistical hop, llm-estimate source cap" },
  chainDirection: { position: "upstream", note: "demo seed", relatedIndustries: [{ relation: "후방", name: "데모 소재 산업" }] },
  qualitative: { opportunityFactors: ["데모 기회 요인 — 신규 수요"], riskFactors: ["데모 위험 요인 — 진입 지연"] },
  consistency: { bottomUpCagr: 18, topDownCagr: 17, tolerance: "demo seed" }, // percent; >=15 reads as high growth in the route advisory
  crossValidation: [],
  limitations: ["데모 시드 데이터 — 실제 시장 분석이 아닙니다."],
  competitive: {
    structure: "데모 경쟁 구조 — 분산 (실제 데이터 아님)",
    players: [
      { name: "데모 경쟁사 A", tier: "leader", note: "demo seed" },
      { name: "데모 경쟁사 B", tier: "challenger", note: "demo seed" },
    ],
  },
};

export async function seedGreenfieldS1ToS12Demo(dbPath?: string, opts: SeedOptions = {}): Promise<{ opportunityId: string; projectId: string }> {
  const humanDecisions = opts.humanDecisions ?? true;
  runMigrations(dbPath);
  const db = getDb(dbPath);
  const now = nowIso();
  const actor = "demo-seed";

  db.transaction(() => {
    db.run(
      `INSERT OR IGNORE INTO md_industry (id, ksic_code, name_ko, name_en, created_at, pinned)
       VALUES (?, 'DEMO-GF', ?, ?, ?, 1)`,
      [GF.industryId, "S1-S12 데모 신설 산업", "S1-S12 Demo Greenfield Industry", now],
    );
    db.run(
      `INSERT OR IGNORE INTO md_company (id, dart_corp_code, name_ko, name_en, created_at)
       VALUES (?, NULL, ?, ?, ?)`,
      [GF.companyId, "S1-S12 데모 신설 법인", "S1-S12 Demo NewCo", now],
    );
    db.run(
      `INSERT OR IGNORE INTO market_sizing_analysis
       (id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at)
       VALUES (?, ?, 'completed', 6, 'demo-gf', ?, ?, ?)`,
      [GF.analysisId, GF.industryId, actor, now, now],
    );
    db.run(
      `INSERT OR IGNORE INTO market_sizing_version
       (id, analysis_id, version_no, payload, changelog, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis)
       VALUES (?, ?, 1, ?, 'S1-S12 greenfield demo market sizing baseline', ?, ?, 'B', 0, 'demo seed: no statistical hop, llm-estimate source cap')`,
      [GF.versionId, GF.analysisId, json({ matrix: GF_MATRIX }), actor, now],
    );

    db.run(
      `INSERT OR IGNORE INTO opportunity
       (id, project_id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
        attractiveness_score, synergy_score, status, rationale, decided_by, decided_at, created_by, created_at,
        capability_gap_json, synergy_score_confirmed_at, synergy_score_confirmed_by, industry_id,
        sizing_version_id)
       VALUES (?, ?, ?, ?, ?, 1080000, 0.18, 75, 55, 'selected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        GF.oppId, null, "S1-S12 데모 Greenfield 기회", "S1-S12 데모 신설 산업", "직접 진출 밸류체인 노드 (신설)",
        "시장 성장·자체 역량 조합에서 직접 진출 기회가 명확함", actor, now, actor, now,
        json({
          rows: [
            { capability: "핵심 생산 설비 운영", source: "manual", held: { status: "none" }, mitigation: "신규 채용 + 설비 도입" },
            { capability: "품질 인증 체계", source: "manual", held: { status: "partial" }, mitigation: "Build — 내재화" },
          ],
        }),
        now, actor, GF.industryId,
        GF.versionId,
      ],
    );
    writeTargetScope(db, GF.oppId, { regions: ["KR"], segments: ["demo_core"], unit_basis: "usd_m_year" }, actor, now);

    db.run(
      `INSERT OR IGNORE INTO md_project
       (id, project_no, created_at, current_stage_gate, company_id, origin, source_opportunity_id, track,
        project_name, charter_json, charter_confirmed_at, status, subject_company_rationale, establishment_mode)
       VALUES (?, 'DEMO-GF', ?, 'group_ic', ?, 'internal', ?, 'greenfield', ?, ?, ?, 'open', ?, 'new_entity')`,
      [
        GF.projectId, now, GF.companyId, GF.oppId, "S1-S12 데모 Greenfield 프로젝트",
        json({ milestones: ["법인 설립", "설비 가동", "흑자 전환"], owner: actor, note: "S1-S12 greenfield demo charter baseline" }),
        now, "자체 역량 격차를 Build/Hire로 해소해 직접 진출",
      ],
    );
    db.run("UPDATE opportunity SET project_id = ?, promoted_at = COALESCE(promoted_at, ?) WHERE id = ?", [GF.projectId, now, GF.oppId]);
    seedSynergyAnalysis(db, "demo-gf-synergy", GF.oppId, "S1-S12 데모 Greenfield 기회", 55, now, actor);
    seedStageSla(db, now, actor);

    db.run(
      `INSERT OR IGNORE INTO route_decision
       (id, opportunity_id, project_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at,
        intent, total_score, status, updated_at, is_current)
       VALUES (?, ?, ?, 'greenfield', NULL, ?, ?, ?, ?, 'integration', 13, 'final', ?, 1)`,
      [GF.routeId, GF.oppId, GF.projectId, "통제력과 내재화가 핵심이므로 자체 신설(Greenfield)로 진행", "M&A/JV 검토 후 통제력·역량 내재화 측면에서 후순위", actor, now, now],
    );
    for (const [idx, criterion] of ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"].entries()) {
      db.run(
        `INSERT OR IGNORE INTO route_decision_score
         (id, decision_id, intent, criterion, score, evidence_note, created_at)
         VALUES (?, ?, 'integration', ?, ?, ?, ?)`,
        [`demo-gf-route-score-${criterion}`, GF.routeId, criterion, idx === 3 ? 2 : 3, "S1-S12 greenfield demo route scoring evidence", now],
      );
    }

    // S5 — 역량 격차 평가 + 진출전략 (greenfield 전용 단계의 필수 산출물).
    db.run(
      `INSERT OR IGNORE INTO greenfield_assessment
       (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [GF.assessmentId, GF.oppId, "신설 법인 설립 + 설비 투자 후 단계적 가동 (Build + Hire)", "JV·M&A 대안 검토 후 통제력·내재화 우선으로 제외", "S1-S12 greenfield demo 진출전략 — 격차는 채용·내재화로 해소", actor, now, now],
    );

    db.run(
      `INSERT OR IGNORE INTO project_classification
       (project_id, sensitivity, mnpi_flag, wall_group, classified_by, classified_at)
       VALUES (?, 'internal', 0, NULL, ?, ?)`,
      [GF.projectId, actor, now],
    );
    // The execution-baseline confirmation (ADR-0161) is a PROJECT-LEAD-only
    // human act — the demo lead doubles as the confirming person below.
    db.run(
      `INSERT OR IGNORE INTO project_member
       (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis)
       VALUES (?, 'admin', 'lead', ?, ?, 'S1-S12 greenfield demo owner')`,
      [GF.projectId, actor, now],
    );

    // S9 — greenfield sub_track은 없으므로 표준 DD만 (SUB_TRACK_DD_CHECKLISTS 미적용).
    db.run(
      `INSERT OR IGNORE INTO project_checklist_item_custom
       (id, project_id, domain, item_label, rationale, source_reliability, proposed_by_agent, status, approved_by, approved_at, created_at)
       VALUES ('demo-gf-dd-custom', ?, 'technical', 'S1-S12 greenfield demo DD required item', 'Demo DD coverage', 'C', ?, 'approved', ?, ?, ?)`,
      [GF.projectId, actor, actor, now, now],
    );
    db.run(
      `INSERT OR IGNORE INTO project_checklist_item_state
       (id, project_id, checklist_id, item_id, status, note, evidence_ref, assessed_by, assessed_at)
       VALUES ('demo-gf-dd-state', ?, 'custom:technical', 'demo-gf-dd-custom', 'pass', 'Demo DD completed', 'demo:gf-dd', ?, ?)`,
      [GF.projectId, actor, now],
    );
    for (const checklistId of Object.values(DD_WORKSPACE_CHECKLISTS)) {
      for (const item of getChecklistItems(checklistId) ?? []) {
        db.run(
          `INSERT OR IGNORE INTO project_checklist_item_state
           (id, project_id, checklist_id, item_id, status, note, assessed_by, assessed_at)
           VALUES (?, ?, ?, ?, 'pass', 'Demo DD completed', ?, ?)`,
          [`demo-gf-dd-${checklistId}-${item.id}`, GF.projectId, checklistId, item.id, actor, now],
        );
      }
    }

    // S10 — 투자 구조·자금조달 (greenfield: 자산 중심 build).
    db.run(
      `INSERT OR IGNORE INTO run (id, project_id, label, input_hash, created_by, created_at)
       VALUES (?, ?, 'S1-S12 greenfield demo scorecard run', 'demo-gf-input-hash', ?, ?)`,
      [GF.runId, GF.projectId, actor, now],
    );
    db.run(
      `INSERT OR IGNORE INTO deal_structure_hypothesis
       (id, project_id, run_id, asset_or_stock, stake_type, instrument_mix, vehicle, commercialization_path,
        tax_structure_note, liability_isolation_note, financing_leverage_note, exit_structure_note,
        four_axis_review_completed, hypothesized_by, hypothesized_at, rationale)
       VALUES (?, ?, ?, 'asset', 'full', 'primary', 'direct', 'build', ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        GF.structureId, GF.projectId, GF.runId,
        "신설 법인 세무 검토 완료", "신설 법인 자체로 책임 격리", "자기자본 중심 — 초기 부담 최소화",
        "단계적 증설 확장 (exit 아님)", actor, now, "S10 four-axis greenfield demo structure completed",
      ],
    );
    for (const [id, kind, name, amount] of [
      ["equity", "source", "Equity contribution", 9000],
      ["debt", "source", "Facility loan", 3000],
      ["plant", "use", "Plant & equipment", 10000],
      ["wc", "use", "Working capital", 2000],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO financing_sources_uses
         (id, project_id, kind, name, amount_krw_m, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'S1-S12 greenfield demo balanced plan', ?, ?)`,
        [`demo-gf-fin-${id}`, GF.projectId, kind, name, amount, actor, now],
      );
    }

    // S11 — greenfield 실행은 설립 5단계 (entity-establishment-execution,
    // ADR-0085). 완료확인(5단계)은 1~4 완료 후에만 유효한 순서로 기록.
    for (const stepNo of [1, 2, 3, 4, 5]) {
      db.run(
        `INSERT OR IGNORE INTO entity_establishment_step
         (id, opportunity_id, project_id, step_no, status, origin, checklist_item, evidence_url, note, owner, updated_at)
         VALUES (?, ?, ?, ?, 'done', 'internal', NULL, NULL, ?, ?, ?)`,
        [`demo-gf-est-${stepNo}`, GF.oppId, GF.projectId, stepNo, `S1-S12 greenfield demo 설립 ${stepNo}/5 완료`, actor, now],
      );
    }

    // T-20261022-042 — S12 milestone register (predicate-optional demo
    // surface): the charter's promised milestones, 법인 설립 marked done to
    // match the 5/5 establishment record above. Manual source only — the
    // execution-baseline import path (source='execution_baseline') stays the
    // sanctioned writer for baseline-derived rows.
    for (const [id, title, category, dueDate, doneAt, notes] of [
      ["demo-gf-milestone-establish", "법인 설립 완료 (데모)", "custom", "2027-03-31", now, "S1-S12 greenfield 데모 차터 마일스톤 — 설립 5단계 완료와 연동"],
      ["demo-gf-milestone-plant", "설비 가동 (데모)", "capex", "2027-09-30", null, "S1-S12 greenfield 데모 차터 마일스톤"],
      ["demo-gf-milestone-breakeven", "흑자 전환 (데모)", "custom", "2028-06-30", null, "S1-S12 greenfield 데모 차터 마일스톤"],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO project_milestone (id, project_id, title, category, due_date, owner, source, done_at, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'admin', 'manual', ?, ?, ?, ?)`,
        [id, GF.projectId, title, category, dueDate, doneAt, notes, actor, now],
      );
    }

    if (humanDecisions) for (const [entityType, entityId, gate] of [
      ["opportunity", GF.oppId, "screening"],
      ["opportunity", GF.oppId, "pre_fs"],
      ["project", GF.projectId, "fs"],
      ["project", GF.projectId, "dd"],
      ["project", GF.projectId, "entity_ic"],
      ["project", GF.projectId, "group_ic"],
    ] as const) {
      db.run(
        `INSERT OR IGNORE INTO gate_decision
         (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at)
         VALUES (?, ?, ?, ?, 'go', 'S1-S12 greenfield demo human-final gate approval', ?, ?)`,
        [`demo-gf-gate-${entityType}-${gate}`, entityType, entityId, gate, actor, now],
      );
    }

    const cycle = currentReviewCycle();
    // S12 venture scorecard is NOT raw-inserted here: the sanctioned write path is
    // recordGreenfieldScorecardFromRequest (the POST post-management/scorecard
    // service, greenfield-only) — recorded after the S8 block below.
    if (humanDecisions) db.run(
      `INSERT OR IGNORE INTO venture_transition_decision
         (id, run_id, project_id, review_cycle, decision, decided_by, decided_at, rationale, learning_capture, core_handoff, created_at)
       VALUES (?, ?, ?, ?, 'graduate_to_core', 'venture-portfolio-ic', ?, ?, ?, ?, ?)`,
      ["demo-gf-transition", GF.runId, GF.projectId, cycle, now, "S1-S12 greenfield demo — 핵심사업 인계: 설립 법인을 사업부 운영으로 이관한다", null,
        "핵심사업 인계: 설립 법인을 사업부 운영으로 이관한다 (ADR-0151 core_handoff)", now],
    );
  })();

  // S8 — run the REAL generator (greenfield path: project-level subjects,
  // market-capture anchor, no target axis). Guarded for idempotency: only
  // when the project has no cases yet, so re-running the seed against a
  // persistent DB does not stack models.
  const existing = db.query("SELECT id FROM business_case_model WHERE project_id = ? LIMIT 1").get(GF.projectId);
  if (!existing) {
    const { generateBusinessCases } = await import("../../app/web-next/lib/business-case-generator.ts");
    // source must satisfy the process_run CHECK ('web'|'claude-desktop'|'cli'|
    // 'system'|'agent'|'human') — a seed-driven run is 'system'.
    const result = await generateBusinessCases(GF.projectId, { actor, source: "system" });
    if (result.status !== "done") throw new Error(`greenfield demo S8 generation failed (run ${result.processRunId})`);
    const adopted = db
      .query(
        `SELECT m.id FROM business_case_model m
         WHERE m.project_id = ? AND COALESCE(m.variant, 'market_forward') = 'market_forward' AND m.target_id IS NULL
         ORDER BY m.created_at ASC LIMIT 1`,
      )
      .get(GF.projectId) as { id: string } | undefined;
    if (adopted) {
      db.run(
        `INSERT OR IGNORE INTO process_run
         (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
         VALUES (?, 'project', ?, ?, 'demo-gf', 's8_case_adopt', 'done', 'human', ?, ?, ?, ?)`,
        [GF.adoptionRunId, GF.projectId, GF.projectId, actor, now, now, json({ model_id: adopted.id })],
      );
    }
  }

  if (humanDecisions) {
    // ── S12 — record the venture scorecard through the ONLY sanctioned write
    // path (the POST post-management/scorecard service, greenfield-only).
    const geo = await import("../../app/web-next/lib/greenfield-execution.ts");
    const cycle = currentReviewCycle();
    const alreadyRecorded = db
      .query("SELECT 1 FROM venture_scorecard WHERE project_id = ? AND review_cycle = ? LIMIT 1")
      .get(GF.projectId, cycle);
    if (!alreadyRecorded) {
      const sc = geo.recordGreenfieldScorecardFromRequest(
        {
          projectId: GF.projectId,
          actor: "admin", // human lead (AGENT_KEYS fail-closed)
          now,
          body: {
            review_cycle: cycle,
            measures: [
              { measure_key: "revenue_vs_case", target_value: 100, value: 105, status: "on_target", evidence_ref: "src:demo-gf" },
              { measure_key: "headcount_vs_plan", target_value: 10, value: 11, status: "on_target", evidence_ref: "src:demo-gf" },
            ],
          },
        },
        db,
      );
      if (!sc.ok) throw new Error(`greenfield demo S12 scorecard failed (${sc.code}): ${sc.message}`);
    }

    // ── S11 — greenfield execution baseline (ADR-0161): record the entries and
    // confirm them through the same service functions the execution-baseline
    // route uses (recordBaselineEntries + confirmExecutionBaseline). Idempotent:
    // an already-confirmed baseline is never re-recorded (a fresh entries row
    // would supersede the confirmation).
    if (!geo.latestConfirmedBaseline(GF.projectId, db)) {
      const recorded = geo.recordBaselineEntries(
        {
          projectId: GF.projectId,
          actor: "admin", // record: any person; confirm below: project lead only
          now,
          entries: {
            permit_milestones: [],
            certification_milestones: [
              { name: "ISO 9001 품질경영 인증 (데모)", issuer: "데모 인증기관", target_date: "2027-06-30", gates_ref: null, certification_id: null },
            ],
            hiring_plan: [
              { role_family: "생산운영", quarter: "2027-Q1", headcount: 12 },
              { role_family: "품질관리", quarter: "2027-Q2", headcount: 4 },
            ],
            kpi_targets: [
              { metric_key: "revenue_vs_case", target_value: 100, unit: "ratio", due: "2027-Q4" },
            ],
            incentive_obligations: [],
          },
        },
        db,
      );
      if (!recorded.ok) throw new Error(`greenfield demo execution baseline entries failed (${recorded.code}): ${recorded.message}`);
      // A confirmation must acknowledge every open reconciliation finding (R3) —
      // the demo carries no capex tranches, so the findings (if any) are the
      // tranche-comparison notes a human would judge.
      const findings = geo.trancheReconciliation(GF.projectId, db).findings;
      const confirmed = geo.confirmExecutionBaseline(
        {
          projectId: GF.projectId,
          actor: "admin", // project lead (see project_member above)
          now,
          rationale: "S1-S12 greenfield demo — 설립 실행 기준선(트랜치·인증·채용·KPI)을 프로젝트 lead가 확인했다 (데모 시드).",
          acknowledgedFindings: findings.map((f) => ({ code: f.code, rationale: "S1-S12 greenfield demo — 데모 시드에서 인지한 대조 결과이다." })),
        },
        db,
      );
      if (!confirmed.ok) throw new Error(`greenfield demo execution baseline confirm failed (${confirmed.code}): ${confirmed.message}`);
    }
  }

  return { opportunityId: GF.oppId, projectId: GF.projectId };
}

if (import.meta.main) {
  const dbPath = argValue(process.argv.slice(2), "--db-path");
  const bf = seedS1ToS12Demo(dbPath);
  console.log(`S1-S12 demo seed ready: opportunity=${bf.opportunityId}, project=${bf.projectId}`);
  const gf = await seedGreenfieldS1ToS12Demo(dbPath);
  console.log(`S1-S12 greenfield twin seed ready: opportunity=${gf.opportunityId}, project=${gf.projectId}`);
}
