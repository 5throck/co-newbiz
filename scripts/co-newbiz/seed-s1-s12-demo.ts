// @version 1.4.1
// Idempotent S1→S12 brownfield demo chain seed.
//
// The operational DB is intentionally gitignored, so a fresh/local database
// can pass schema checks while still lacking a single deal that demonstrates
// the full S1-S12 lifecycle. This script creates one compact, clearly-labelled
// demo chain that satisfies the process-flow predicates without fabricating it
// as production data.
//
// Usage:
//   bun scripts/co-newbiz/seed-s1-s12-demo.ts [--db-path <path>]
import { getDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { DD_WORKSPACE_CHECKLISTS, getChecklistItems } from "../../app/web-next/lib/library.ts";
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
          revenue_y1: { dist: "constant", value: 15000, unit: "KRW_M", source: "시장규모 × 포획률 0.5%" },
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

export function seedS1ToS12Demo(dbPath?: string): { opportunityId: string; projectId: string } {
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
       (id, analysis_id, version_no, payload, changelog, created_by, created_at)
       VALUES (?, ?, 1, ?, 'S1-S12 demo market sizing baseline', ?, ?)`,
      [
        DEMO.versionId,
        DEMO.analysisId,
        json({
          matrix: {
            tam_krw_m: 120000,
            cagr: 0.13,
            competitive: {
              concentration: "moderate",
              key_players: ["S1-S12 데모 대상회사", "대체 후보 A", "대체 후보 B"],
            },
          },
        }),
        actor,
        now,
      ],
    );

    db.run(
      `INSERT OR IGNORE INTO opportunity
       (id, project_id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate,
        attractiveness_score, synergy_score, status, rationale, decided_by, decided_at, created_by, created_at,
        target_universe_json, capability_gap_json, synergy_score_confirmed_at, synergy_score_confirmed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'selected', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEMO.oppId,
        null,
        "S1-S12 데모 Brownfield 기회",
        "S1-S12 데모 산업",
        "핵심 부품/서비스 밸류체인 노드",
        120000,
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
            { capability: "핵심 기술/IP", held: { status: "partial" }, mitigation: "인수 후 통합" },
            { capability: "레퍼런스 고객", held: { status: "partial" }, mitigation: "채널 결합" },
          ],
        }),
        now,
        actor,
      ],
    );

    db.run(
      `INSERT OR IGNORE INTO md_project
       (id, project_no, created_at, current_stage_gate, company_id, origin, source_opportunity_id, track,
        project_name, charter_json, charter_confirmed_at, status, subject_company_rationale)
       VALUES (?, 'DEMO-S1-S12', ?, 'group_ic', ?, 'acquisition', ?, 'brownfield', ?, ?, ?, 'open', ?)`,
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
         (id, opportunity_id, company_name, universe_note, status, rank, exclusion_reason, screening_json, created_at, updated_at, discovery_source, proposal_accepted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
        [
          `demo-s1-s12-target-${i}`,
          DEMO.oppId,
          i === 1 ? "S1-S12 데모 대상회사" : `S1-S12 대체 후보 ${i - 1}`,
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
      [DEMO.adoptionRunId, DEMO.projectId, DEMO.projectId, actor, now, now, json({ adopted_model_id: DEMO.modelId })],
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
    for (const checklistId of Object.values(DD_WORKSPACE_CHECKLISTS)) {
      for (const item of getChecklistItems(checklistId) ?? []) {
        db.run(
          `INSERT OR IGNORE INTO project_checklist_item_state
           (id, project_id, checklist_id, item_id, status, note, assessed_by, assessed_at)
           VALUES (?, ?, ?, ?, 'pass', 'Demo DD completed', ?, ?)`,
          [`demo-s1-s12-dd-${checklistId}-${item.id}`, DEMO.projectId, checklistId, item.id, actor, now],
        );
      }
    }

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

    for (const [entityType, entityId, gate] of [
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
    db.run(
      `INSERT OR IGNORE INTO venture_transition_decision
         (id, run_id, project_id, review_cycle, decision, decided_by, decided_at, rationale, learning_capture, core_handoff, created_at)
       VALUES (?, ?, ?, ?, 'graduate_to_core', 'venture-portfolio-ic', ?, ?, ?, ?, ?)`,
      ["demo-s1-s12-transition", DEMO.runId, DEMO.projectId, cycle, now, "S1-S12 demo — 핵심사업 인계: 사업부 운영으로 이관하고 별도 트랜치 투자를 종료한다", null,
        "핵심사업 인계: 사업부 운영으로 이관하고 별도 트랜치 투자를 종료한다 (ADR-0151 core_handoff)", now],
    );
  })();

  return { opportunityId: DEMO.oppId, projectId: DEMO.projectId };
}

if (import.meta.main) {
  const result = seedS1ToS12Demo(argValue(process.argv.slice(2), "--db-path"));
  console.log(`S1-S12 demo seed ready: opportunity=${result.opportunityId}, project=${result.projectId}`);
}
