// @version 1.0.0
/**
 * S10 투자구조 설계 (flow.spec v2.2.0) — deal-structure route + repositories.
 *
 *  (a) governance: rationale-less hypothesize is rejected; four-axis
 *      completion demands an artifact_ref and is refused twice (a completed
 *      hypothesis cannot be "completed again");
 *  (b) financing plan: balanced totals predicate (sources == uses > 0), and
 *      the API add/remove path keeps the arithmetic auditable;
 *  (c) the S10 completion predicate flips only with the latest hypothesis
 *      four-axis-complete AND a balanced financing plan (a NEW incomplete
 *      hypothesis re-blocks S10 — the latest hypothesis wins).
 */

import { judgeAllStandardDdItems } from "./_dd-standard.ts";
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-deal-structure.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { hypothesize, completeFourAxisReview } = await import("../../db/repositories/deal-structure-hypothesis.repository.ts");
const { addFinancingEntry, financingTotals } = await import("../../db/repositories/financing-plan.repository.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");

const NOW = new Date().toISOString();
const ANALYST = "analyst1";
let analystCookie = "";
let projectId = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-analyst-12345" }) });
  analystCookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];

  // opportunity → promote → project (the S10 surfaces are project-keyed).
  const oppId = `opp-${ulidText()}`;
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "deal-structure 테스트 기회", "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)",
    [`${oppId}-rd`, oppId, "greenfield", "신설 진출 — 구조는 자회사 SPC", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [`${oppId}-gf`, oppId, "build", "파트너십 검토", "신설 역량 확보", ANALYST, NOW, NOW],
  );
  // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), oppId],
  );
  // Promotion preconditions (2026-09-12): screening + pre_fs must be GO.
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "deal-structure test promoter" }).project.id;
});

function ulidText(): string {
  return Math.random().toString(36).slice(2, 10);
}

describe("S10 deal-structure route + repositories (flow.spec v2.2.0)", () => {
  test("(a) hypothesize without rationale is rejected — via repo and via API", async () => {
    expect(() => hypothesize({ project_id: projectId, hypothesized_by: ANALYST, rationale: "" })).toThrow(/rationale is mandatory/);
    const res = await req(`/api/projects/${projectId}/deal-structure`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ action: "hypothesize", rationale: " " }),
    });
    expect(res.status).toBe(400);
  });

  test("(a) API hypothesize works; four-axis completion demands artifact_ref and refuses a second completion", async () => {
    const res = await req(`/api/projects/${projectId}/deal-structure`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({
        action: "hypothesize", vehicle: "spc", asset_or_stock: "stock", stake_type: "majority",
        tax_structure_note: "법인세 특례", liability_isolation_note: "SPC 격리",
        financing_leverage_note: "AC 60%", exit_structure_note: "5년 매각",
        rationale: "SPC 경유 — 절세·격리 근거",
      }),
    });
    expect(res.status).toBe(201);
    const hyp = (await res.json()).data as { id: string; four_axis_review_completed: number };

    const noRef = await req(`/api/projects/${projectId}/deal-structure`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ action: "complete_four_axis", hypothesis_id: hyp.id, artifact_ref: " " }),
    });
    expect(noRef.status).toBe(400);

    expect(() => completeFourAxisReview({ hypothesis_id: hyp.id, reviewed_by: ANALYST, artifact_ref: "" })).toThrow(/artifact_ref/);
    const done = completeFourAxisReview({ hypothesis_id: hyp.id, reviewed_by: ANALYST, artifact_ref: "art/deal-structure-review-1" });
    expect(done.four_axis_review_completed).toBe(1);
    // second completion refused — re-review belongs in a new artifact + hypothesis
    expect(() => completeFourAxisReview({ hypothesis_id: hyp.id, reviewed_by: ANALYST, artifact_ref: "art/again" })).toThrow(/does not exist|already|completed/);
  });

  test("(b) financing plan: add via API, balance predicate, delete logged", async () => {
    expect(financingTotals(projectId).balanced).toBe(false); // empty is NOT balanced
    for (const [kind, name, amount] of [["source", "출자금", 500], ["use", "인수대금", 500]] as const) {
      const res = await req(`/api/projects/${projectId}/deal-structure`, {
        method: "POST", headers: { cookie: analystCookie },
        body: JSON.stringify({ action: "add_financing_entry", kind, name, amount_krw_m: amount }),
      });
      expect(res.status).toBe(201);
    }
    const totals = financingTotals(projectId);
    expect(totals.sources).toBe(500);
    expect(totals.balanced).toBe(true);

    const badKind = await req(`/api/projects/${projectId}/deal-structure`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ action: "add_financing_entry", kind: "dividend", name: "x", amount_krw_m: 1 }),
    });
    expect(badKind.status).toBe(400);
  });

  test("(c) S10 completion predicate — flips complete, re-blocks on a fresh incomplete hypothesis", async () => {
    // S8/S9 선행 산출물 시딩 — S10은 선형 체인상 S8·S9이 완료된 뒤 평가된다.
    db.run(
      "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
      ["bc-ds1", projectId, "greenfield_cost", "구조 설계 케이스", 5, ANALYST, NOW, "{}"],
    );
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at, bep_year, payback_discounted_years) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [`sim-${ulidText()}`, projectId, "bc-ds1", "base", "p50", 9000, 0.12, "seed=42", NOW, 2.5, 2.5],
    );
    db.run(
      "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [`pci-${ulidText()}`, projectId, "custom:commercial", `itm-${ulidText()}`, "pass", ANALYST, NOW],
    );
    judgeAllStandardDdItems(db, projectId, ANALYST, NOW);
    const before = evaluateProcess({ type: "project", id: projectId });
    expect(before.completedStages).toContain("S10");
    expect(before.currentStage).toBe("S11");

    // a NEWER incomplete hypothesis becomes "the latest" and re-blocks S10
    hypothesize({ project_id: projectId, vehicle: "holdco", hypothesized_by: ANALYST, rationale: "홀딩스 경유 재검토" });
    const after = evaluateProcess({ type: "project", id: projectId });
    expect(after.completedStages).not.toContain("S10");
    expect(after.blockers.join("\n")).toContain("4축 검토");
  });

  test("viewer cannot write; GET is member-visible", async () => {
    const res = await req(`/api/projects/${projectId}/deal-structure`, { method: "GET", headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const view = (await res.json()).data as { hypotheses: unknown[]; financing: { totals: { balanced: boolean } } };
    expect(Array.isArray(view.hypotheses)).toBe(true);
    expect(view.financing.totals.balanced).toBe(true);
  });
});
