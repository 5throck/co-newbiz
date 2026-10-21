// @version 1.0.0
/**
 * T-20261022-011 — the IC sequence rule (flow.spec.yaml group_ic: "법인
 * 투자심의위원회 승인이 선행되었다") is enforced SERVER-SIDE on the project
 * gate-decisions route, not only in the panel's UI lock: a group_ic GO without
 * a prior entity_ic GO is 409 gate_prerequisites_incomplete; once the entity
 * GO exists the group GO records. HOLD stays allowed anytime (boundary #2 —
 * the sequence binds GO only).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-gate-decisions-ic-sequence.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { judgeAllStandardDdItems } = await import("./_dd-standard.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = "2026-10-22T09:00:00Z";
const ANALYST = "ic-seq-analyst";
let cookie = "";

const post = (projectId: string, body: Record<string, unknown>) =>
  nextRequest(`/api/projects/${projectId}/gate-decisions`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const rowsOf = (projectId: string, gate: string) =>
  db.query("SELECT decision FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate = ?").all(projectId, gate) as Array<{ decision: string }>;

/** S10 투자구조 설계 완료 픽스처 — 4축 검토 완료 가설 1건 + sources == uses > 0. */
function seedS10Complete(pid: string) {
  db.run(
    `INSERT INTO deal_structure_hypothesis
       (id, project_id, asset_or_stock, stake_type, instrument_mix, vehicle,
        tax_structure_note, liability_isolation_note, financing_leverage_note,
        exit_structure_note, four_axis_review_completed, hypothesized_by, hypothesized_at, rationale)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [ulid(), pid, "stock", "majority", "mixed", "spc", "법인세 특례 검토", "SPC 자산 격리", "AC 대출 60%", "5년 후 매각", ANALYST, NOW, "4축 검토 완료"],
  );
  for (const [kind, name] of [["source", "출자금"], ["use", "주식 인수 대금"]] as const) {
    db.run("INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at) VALUES (?,?,?,?,?,?,?)", [ulid(), pid, kind, name, 1000, ANALYST, NOW]);
  }
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-ic-seq-123456", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-ic-seq-123456" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

/** Promote a greenfield opportunity and seed S8/S9/S10 so gateGoPrerequisiteGaps
 *  passes — the suite isolates the SEQUENCE rule from the stage-prerequisite rule. */
function seedReadyProject(): string {
  const opp = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [opp, "IC 시퀀스 기회", "산업", "selected", ANALYST, NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)", [ulid(), opp, "greenfield", "test", "M&A 대안", ANALYST, NOW]);
  db.run("INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), opp, "직접 진출", "M&A 대안", "test", ANALYST, NOW, NOW]);
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), opp]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", opp, gate, "go", "test", ANALYST, NOW]);
  }
  const pid = promoteOpportunity(opp, { promotedBy: ANALYST, needToKnowBasis: "ic sequence test" }).project.id;
  seedS10Complete(pid);
  // S8: one case + one persisted simulation percentile.
  db.run("INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)", [ulid(), pid, "greenfield_cost", "케이스", 5, ANALYST, NOW, "{}"]);
  db.run("INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at, bep_year, payback_discounted_years) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [ulid(), pid, (db.query("SELECT id FROM business_case_model WHERE project_id = ?").get(pid) as { id: string }).id, "base", "p50", 12000, 0.14, "seed", NOW, 2.5, 2.5]);
  // S9: judged checklist states.
  judgeAllStandardDdItems(db, pid, ANALYST, NOW);
  return pid;
}

describe("POST /api/projects/[id]/gate-decisions — IC sequence (T-20261022-011)", () => {
  test("group_ic GO without a prior entity_ic GO -> 409, nothing recorded", async () => {
    const p = seedReadyProject();
    const res = await post(p, { gate: "group_ic", decision: "go", rationale: "순서 역전 GO 시도", gap_rationale: "갭 예외 근거" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("gate_prerequisites_incomplete");
    expect(body.error.message).toContain("entity_ic");
    expect(rowsOf(p, "group_ic")).toHaveLength(0);
  });

  test("accepted after the entity GO: entity_ic 201 then group_ic 201", async () => {
    const p = seedReadyProject();
    const entity = await post(p, { gate: "entity_ic", decision: "go", rationale: "법인 투자심의 승인", gap_rationale: "절차 갭 예외 근거" });
    expect(entity.status).toBe(201);
    const group = await post(p, { gate: "group_ic", decision: "go", rationale: "그룹 투자심의 승인", gap_rationale: "절차 갭 예외 근거" });
    expect(group.status).toBe(201);
    expect(rowsOf(p, "entity_ic").map((r) => r.decision)).toEqual(["go"]);
    expect(rowsOf(p, "group_ic").map((r) => r.decision)).toEqual(["go"]);
  });

  test("the sequence binds GO only — a group_ic HOLD before the entity GO stays allowed", async () => {
    const p = seedReadyProject();
    const res = await post(p, { gate: "group_ic", decision: "hold", rationale: "보류", missing_artifacts: ["미완료 산출물"] });
    expect(res.status).toBe(201);
    expect(rowsOf(p, "group_ic")).toMatchObject([{ decision: "hold" }]);
  });
});
