// Bootstrap seeding for the E2E scenarios (runs BEFORE the server starts).
// Master data and S1-S11 evidence are bootstrap fixtures; every human act that
// the process reserves for people (gate decisions, S12 transition, closure,
// proposal confirmation) is left out so the scenario performs it in the UI.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import { writeTargetScope } from "../../../db/repositories/entry-market.repository.ts";
import { seedS1ToS12Demo } from "../../../scripts/co-newbiz/seed-s1-s12-demo.ts";

export const BROWNFIELD = {
  opportunityId: "demo-s1-s12-opportunity",
  projectId: "demo-s1-s12-project",
} as const;

export function grantProjectLead(dbPath: string, projectId: string, userId: string): void {
  getDb(dbPath).run(
    `INSERT OR IGNORE INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis)
     VALUES (?, ?, 'lead', 'e2e-bootstrap', ?, 'e2e scenario')`,
    [projectId, userId, new Date().toISOString()],
  );
}

/** S1-S10 evidence for the brownfield M&A demo deal; gates, S11 approvals' decisions, S12 and sub-track DD are performed in the UI. */
export function seedBrownfieldDeal(dbPath: string, analystId: string, opts: { subTrackDd?: boolean } = {}): typeof BROWNFIELD {
  seedS1ToS12Demo(dbPath, { humanDecisions: false, subTrackDd: opts.subTrackDd ?? true });
  grantProjectLead(dbPath, BROWNFIELD.projectId, analystId);
  return BROWNFIELD;
}

/** Start a pipeline_run on the demo project as the app would after the deal enters the pipeline (bootstrap fixture). */
export function seedRunningPipeline(dbPath: string, projectId: string, status: "running" | "paused_for_human" = "paused_for_human"): string {
  const db = getDb(dbPath);
  const id = ulid();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO pipeline_run (id, entity_type, entity_id, industry_id, initiating_company_id, status, current_stage, paused_reason, started_by, started_at, updated_at)
     VALUES (?, 'project', ?, 'demo-s1-s12-industry', 'demo-s1-s12-company', ?, 'S11', 'gate_decision:entity_ic', 'analyst', ?, ?)`,
    [id, projectId, status, now, now],
  );
  return id;
}

export const GREENFIELD = {
  opportunityId: "e2e-gf-opportunity",
  projectId: "e2e-gf-project",
} as const;

/**
 * Greenfield (new establishment) deal with S1-S5 and S8-S10 evidence in place.
 * Pre-FS / FS / DD / IC gates, the S11 establishment steps, the S12 transition
 * and the closure are performed in the UI.
 */
export async function seedGreenfieldDeal(dbPath: string, analystId: string): Promise<typeof GREENFIELD> {
  const { DD_WORKSPACE_CHECKLISTS, getChecklistItems } = await import("../../../app/web-next/lib/library.ts");
  const { currentReviewCycle } = await import("../../../app/web-next/lib/portfolio.ts");
  const db = getDb(dbPath);
  const now = new Date().toISOString();
  const actor = "e2e-bootstrap";
  const industryId = "e2e-gf-industry";
  const companyId = "e2e-gf-company";
  const { opportunityId: oppId, projectId } = GREENFIELD;
  const json = (v: unknown): string => JSON.stringify(v);

  db.transaction(() => {
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at, pinned) VALUES (?, 'E2E-GF', ?, ?, ?, 1)", [industryId, "E2E 신설 산업", "E2E Greenfield Industry", now]);
    db.run("INSERT INTO md_company (id, dart_corp_code, name_ko, name_en, created_at) VALUES (?, NULL, ?, ?, ?)", [companyId, "E2E 신설 법인", "E2E NewCo", now]);
    db.run(
      `INSERT INTO market_sizing_analysis (id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at)
       VALUES ('e2e-gf-analysis', ?, 'completed', 6, 'e2e', ?, ?, ?)`,
      [industryId, actor, now, now],
    );
    db.run(
      `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, changelog, created_by, created_at, data_confidence_grade, chain_hops, confidence_basis)
       VALUES ('e2e-gf-analysis-v1', 'e2e-gf-analysis', 1, ?, 'E2E baseline', ?, ?, 'B', 0, 'e2e fixture: no statistical hop')`,
      [json({ matrix: { tam_krw_m: 80000, cagr: 0.11, competitive: { concentration: "moderate", key_players: ["A사", "B사"] } } }), actor, now],
    );
    db.run(
      `INSERT INTO opportunity
       (id, project_id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate, attractiveness_score, synergy_score, status, rationale,
        decided_by, decided_at, created_by, created_at, capability_gap_json, synergy_score_confirmed_at, synergy_score_confirmed_by, industry_id, sizing_version_id)
       VALUES (?, NULL, ?, ?, ?, 80000, 0.11, 78, 81, 'selected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        oppId, "E2E 신설 사업 기회", "E2E 신설 산업", "신규 법인 설립을 통한 직접 진출 노드",
        "자체 역량과 그룹 고객 접점으로 직접 진출이 가능함", actor, now, actor, now,
        json({ rows: [{ capability: "생산 설비 운영", source: "manual", held: { status: "partial" }, mitigation: "신규 채용" }] }),
        now, actor, industryId, "e2e-gf-analysis-v1",
      ],
    );
    // S2 entry-market predicate (ADR-0180): S1 sizing link (above) plus a person-set target scope.
    writeTargetScope(db, oppId, { regions: ["KR"], segments: ["e2e_core"], unit_basis: "krw_m_year" }, actor, now);
    db.run(
      `INSERT INTO md_project (id, project_no, created_at, current_stage_gate, company_id, origin, establishment_mode, source_opportunity_id, track, project_name, charter_json, charter_confirmed_at, status, subject_company_rationale)
       VALUES (?, 'E2E-GF', ?, 'fs', ?, 'internal', 'new_entity', ?, 'greenfield', ?, ?, ?, 'open', ?)`,
      [projectId, now, companyId, oppId, "E2E 신설 법인 프로젝트", json({ milestones: ["설립", "가동"], owner: actor }), now, "자체 역량으로 신설 진출"],
    );
    db.run("UPDATE opportunity SET project_id = ?, promoted_at = ? WHERE id = ?", [projectId, now, oppId]);

    db.run(
      `INSERT INTO route_decision (id, opportunity_id, project_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at, intent, total_score, status, updated_at, is_current)
       VALUES ('e2e-gf-route', ?, ?, 'greenfield', NULL, ?, ?, ?, ?, 'integration', 13, 'final', ?, 1)`,
      [oppId, projectId, "자체 역량으로 신설하는 편이 통제력이 높음", "M&A/JV 검토 후 통제력·속도 측면에서 후순위", actor, now, now],
    );
    for (const [idx, criterion] of ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"].entries()) {
      db.run(
        "INSERT INTO route_decision_score (id, decision_id, intent, criterion, score, evidence_note, created_at) VALUES (?, 'e2e-gf-route', 'integration', ?, ?, 'E2E route scoring', ?)",
        [`e2e-gf-route-score-${criterion}`, criterion, idx === 3 ? 2 : 3, now],
      );
    }
    db.run(
      `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES ('e2e-gf-assessment', ?, ?, ?, ?, ?, ?, ?)`,
      [oppId, "신설 법인 + 설비 투자 후 단계적 가동", "JV·M&A 대안 검토 후 제외", "E2E 진출전략", actor, now, now],
    );

    db.run("INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?, ?, 'lead', ?, ?, 'e2e scenario')", [projectId, analystId, actor, now]);
    db.run("INSERT INTO project_classification (project_id, sensitivity, mnpi_flag, wall_group, classified_by, classified_at) VALUES (?, 'internal', 0, NULL, ?, ?)", [projectId, actor, now]);

    const inputs = {
      job_id: "s8:e2e-gf:base:market_forward", seed_policy: { base: "e2e-gf", hash: "fnv1a" }, device: "cpu", iterations: 2000, horizon_years: 5,
      discount_rate: { value: 0.09, subject: "target", source: "user" },
      cases: [{ case_id: "base:market_forward", drivers: { revenue_y1: { dist: "constant", value: 9000, unit: "KRW_M", source: "시장규모 × 시장점유율" } } }],
    };
    db.run(
      `INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, variant, target_id, inputs_json)
       VALUES ('e2e-gf-model', ?, 'investment_return', 'E2E base case', 5, ?, ?, 'market_forward', NULL, ?)`,
      [projectId, actor, now, json(inputs)],
    );
    for (const [id, category, name, amount] of [["revenue", "revenue", "Year-1 revenue", 9000], ["opex", "opex", "Operating cost", -5400], ["capex", "capex", "Plant capex", -4000]] as const) {
      db.run(
        "INSERT INTO business_case_line (id, model_id, category, name, annual_amount_krw_m, start_year, growth_rate, created_by, created_at) VALUES (?, 'e2e-gf-model', ?, ?, ?, 1, 0.08, ?, ?)",
        [`e2e-gf-bcl-${id}`, category, name, amount, actor, now],
      );
    }
    for (const [scenario, npv, irr] of [["downside", 900, 0.08], ["base", 4100, 0.15], ["upside", 8200, 0.22]] as const) {
      db.run(
        `INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at, bep_year, payback_discounted_years)
         VALUES (?, ?, 'e2e-gf-model', ?, 'p50', ?, ?, 'E2E valuation percentile', ?, 3.0, 3.0)`,
        [`e2e-gf-val-${scenario}`, projectId, scenario, npv, irr, now],
      );
    }
    db.run(
      `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
       VALUES ('e2e-gf-adopt', 'project', ?, ?, 'e2e', 's8_case_adopt', 'done', 'human', ?, ?, ?, ?)`,
      [projectId, projectId, actor, now, now, json({ model_id: "e2e-gf-model" })],
    );

    for (const checklistId of Object.values(DD_WORKSPACE_CHECKLISTS)) {
      for (const item of getChecklistItems(checklistId) ?? []) {
        db.run(
          `INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, note, assessed_by, assessed_at)
           VALUES (?, ?, ?, ?, 'pass', 'E2E DD fixture', ?, ?)`,
          [`e2e-gf-dd-${checklistId}-${item.id}`, projectId, checklistId, item.id, actor, now],
        );
      }
    }
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES ('e2e-gf-run', ?, 'E2E scorecard run', 'e2e-hash', ?, ?)", [projectId, actor, now]);
    db.run(
      `INSERT INTO deal_structure_hypothesis
       (id, project_id, run_id, asset_or_stock, stake_type, instrument_mix, vehicle, commercialization_path, tax_structure_note, liability_isolation_note, financing_leverage_note, exit_structure_note,
        four_axis_review_completed, hypothesized_by, hypothesized_at, rationale)
       VALUES ('e2e-gf-structure', ?, 'e2e-gf-run', 'asset', 'majority', 'primary', 'direct', 'build', ?, ?, ?, ?, 1, ?, ?, 'E2E four-axis structure')`,
      [projectId, "신설 법인 세무 검토 완료", "법인 격리", "자기자본 중심", "단계적 확장", actor, now],
    );
    for (const [id, kind, name, amount] of [["equity", "source", "Equity", 6000], ["debt", "source", "Loan", 2000], ["plant", "use", "Plant", 6500], ["wc", "use", "Working capital", 1500]] as const) {
      db.run(
        "INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'E2E balanced plan', ?, ?)",
        [`e2e-gf-fin-${id}`, projectId, kind, name, amount, actor, now],
      );
    }
    const cycle = currentReviewCycle();
    for (const [section, measure, target, actual] of [["financial", "revenue_ramp", ">=40%", "42%"], ["strategic", "plant_commissioning", "on schedule", "on schedule"]] as const) {
      db.run(
        `INSERT INTO venture_scorecard (id, run_id, project_id, source_procedure, review_cycle, venture_class, section, measure_key, target_value, actual_value, status, evidence_ref, observed_at, created_at)
         VALUES (?, 'e2e-gf-run', ?, 'portfolio-venture-monitoring', ?, 'driving', ?, ?, ?, ?, 'on_target', ?, ?, ?)`,
        [`e2e-gf-score-${measure}`, projectId, cycle, section, measure, target, actual, `e2e:scorecard:${measure}`, now, now],
      );
    }
  })();
  return GREENFIELD;
}

/**
 * ADR-0186 P1 (design 3.11 / R5): two distinct human-role grant holders for scenarios that exercise
 * waiver approval, `na` confirmation and, from P3, the IC countersign. Bootstrap fixture (runs before
 * the server starts, like the other seeds): creates the accounts and issues the grants through the
 * repository the admin route uses. Production grants are created by the admin route only.
 */
export async function seedGrantedReviewers(
  dbPath: string,
  adminId: string,
  reviewers: { entity: { userId: string; password: string }; group: { userId: string; password: string } },
): Promise<void> {
  const { createUser, approveUser } = await import("../../../db/lib/accounts.ts");
  const { issueHumanRoleGrant } = await import("../../../db/lib/human-roles.ts");
  const db = getDb(dbPath);
  const now = new Date().toISOString();
  for (const [who, role] of [[reviewers.entity, "entity-ic-reviewer"], [reviewers.group, "group-ic-reviewer"]] as const) {
    await createUser(db, { userId: who.userId, role: "analyst", password: who.password, displayName: who.userId, createdBy: "e2e-bootstrap", now });
    approveUser(db, { userId: who.userId, approvedBy: "e2e-bootstrap", now });
    db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id = ?", [who.userId]);
    issueHumanRoleGrant(db, { userId: who.userId, roleKey: role, grantedBy: adminId, now });
  }
}
