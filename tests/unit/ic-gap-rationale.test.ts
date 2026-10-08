// @version 1.0.0
/**
 * R2-B item 3 - IC GO with missing artifacts (UX round 2).
 *
 * Boundary #2: the system never blocks a recorded human GO. When the screen collected an
 * override rationale, the route re-derives the gaps itself, stores the rationale with the
 * decision (existing gate_decision.rationale column, no migration) and the IC package
 * returns it parsed. Proves: (a) the package lists what a GO is missing; (b) a GO with a
 * typed rationale persists it and the gaps; (c) the IC package and the gate history show it;
 * (d) a GO without the rationale still records (never blocked) and carries no override;
 * (e) a client cannot forge the gap list; (f) the compose/parse pair round-trips.
 */

import { judgeAllStandardDdItems } from "./_dd-standard.ts";
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-ic-gap-rationale.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
let standardCount = 0;

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");

const NOW = new Date().toISOString();

/** S10 투자구조 설계 완료 픽스처 (flow.spec v2.2.0 술어) — 4축 검토 완료된
 * 가설 1건 + sources == uses > 0 인 자금조달 행. 정합 술어 검사가 S10을
 * 통과하도록 직접 INSERT 한다 (거버넌스 레이어는 별도 테스트에서 검증). */
function seedS10Complete(pid: string) {
  db.run(
    `INSERT INTO deal_structure_hypothesis
       (id, project_id, asset_or_stock, stake_type, instrument_mix, vehicle,
        tax_structure_note, liability_isolation_note, financing_leverage_note,
        exit_structure_note, four_axis_review_completed, hypothesized_by, hypothesized_at, rationale)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [ulid(), pid, "stock", "majority", "mixed", "spc",
     "법인세 특례 검토", "SPC 자산 격리", "AC 대출 60%", "5년 후 매각",
     ANALYST, NOW, "SPC 경유 구조 — 4축 검토 완료"],
  );
  db.run(
    `INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), pid, "source", "출자금 + AC 대출", 1000, ANALYST, NOW],
  );
  db.run(
    `INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), pid, "use", "주식 인수 대금", 1000, ANALYST, NOW],
  );
}

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "analyst1"; // project member (lead)
const VIEWER = "viewer1"; // authenticated, viewer role
const OUTSIDER = "outsider1"; // authenticated analyst, NOT a member
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";
let sourceOppId = "";

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  await createUser(db, { userId: OUTSIDER, role: "analyst", password: "pw-outsider-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: OUTSIDER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-analyst-12345");
  viewerCookie = await loginCookie(VIEWER, "pw-viewer-12345");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-outsider-12345");

  // Promote a greenfield opportunity into a project (ADR-0095) — the
  // promoter becomes the lead member, which gives the deny-by-default checks
  // a real membership boundary.
  sourceOppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [sourceOppId, "S11 테스트 기회", "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, alternatives_considered, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), sourceOppId, "greenfield", "test route", "M&A 대안 검토 후 제외", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [ulid(), sourceOppId, "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  // ADR-0136: 역량 격차 건수는 S3 레지스터(opportunity.capability_gap_json)에서 센다.
  db.run(
    "UPDATE opportunity SET capability_gap_json = ? WHERE id = ?",
    [JSON.stringify({ rows: [{ id: "gap-1", capability: "g1", resolution: "hire" }], updatedAt: NOW }), sourceOppId],
  );
  // Promotion preconditions (2026-09-12): screening + pre_fs must be GO.
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", sourceOppId, gate, "go", "test", ANALYST, NOW]);
  }
  projectId = promoteOpportunity(sourceOppId, { promotedBy: ANALYST, needToKnowBasis: "S11 test promoter" }).project.id;
  seedS10Complete(projectId);
  // S11 establishment applies to origin∈{internal,joint} (ADR-0047) — pin it.
  db.run("UPDATE md_project SET origin = 'internal' WHERE id = ?", [projectId]);

  // S8 artifact: one case + one persisted simulation percentile.
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, inputs_json) VALUES (?,?,?,?,?,?,?,?)",
    ["bc-ic1", projectId, "greenfield_cost", "IC 패키지 케이스", 5, ANALYST, NOW, "{}"],
  );
  // S11 charter baseline JSON exists from promotion (ADR-0104); the human
  // CONFIRMATION act is exercised through the confirm endpoint in describe (e).
  db.run("UPDATE md_project SET charter_json = ? WHERE id = ?", [JSON.stringify({ versions: [{ version: 1, purpose: "IC 테스트 목적" }] }), projectId]);
  db.run(
    "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at, bep_year, payback_discounted_years) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [ulid(), projectId, "bc-ic1", "base", "p50", 12000, 0.14, "seed=42", NOW, 2.5, 2.5],
  );

  // S9 artifact: one judged state row (approved-custom path — judged pass),
  // plus one finding.
  db.run(
    "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), projectId, "custom:commercial", ulid(), "pass", ANALYST, NOW],
  );
  standardCount = judgeAllStandardDdItems(db, projectId, ANALYST, NOW);
  db.run(
    "INSERT INTO dd_finding (id, project_id, category, description, value_impact, created_at) VALUES (?,?,?,?,?,?)",
    [ulid(), projectId, "commercial", "핵심 고객 계약 변경 통제 조항 발견", -500, NOW],
  );

  // AI-proposed RAG: overall amber + data_confidence amber (the cap).
  const runId = ulid();
  db.run(
    "INSERT INTO run (id, project_id, input_hash, created_by, created_at) VALUES (?,?,?,?,?)",
    [runId, projectId, "h-ic", "rag-engine", NOW],
  );
  for (const dimension of ["overall", "data_confidence"]) {
    db.run(
      "INSERT INTO rag_assessment (id, run_id, project_id, dimension, grade, rationale, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), runId, projectId, dimension, "amber", "테스트 근거", NOW],
    );
  }
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});


const { composeRationale, parseRationale, icGoGapItems } = await import("../../app/web-next/lib/ic-gap-override.ts");

async function pkg(): Promise<{ gates: { go_gaps: string[]; latest: Array<{ gate: string; gap_override: { items: string[]; rationale: string } | null; rationale: string | null }>; history: Array<{ gate: string; gap_override: { items: string[]; rationale: string } | null }> } }> {
  const res = await req(`/api/projects/${projectId}/ic-package`, { headers: { cookie: analystCookie } });
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

describe("R2-B item 3 - IC GO warning rationale", () => {
  test("(a) the IC package lists what an IC GO is missing", async () => {
    const data = await pkg();
    expect(data.gates.go_gaps.some((g) => g.includes("Business Case"))).toBe(true);
    expect(data.gates.go_gaps.some((g) => g.includes("설립 실행"))).toBe(true);
    expect(icGoGapItems(projectId)).toEqual(data.gates.go_gaps);
  });

  test("(d) a GO without a rationale is still recorded - the human is never blocked", async () => {
    const res = await req(`/api/projects/${projectId}/gate-decisions`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ gate: "entity_ic", decision: "go", rationale: "근거 없이 갭 경고 없는 GO" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.gap_override).toBeNull();
    const row = db.query("SELECT rationale FROM gate_decision WHERE gate = 'entity_ic' AND entity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1").get(projectId) as { rationale: string };
    expect(row.rationale).toBe("근거 없이 갭 경고 없는 GO");
  });

  test("(b)(e) a GO with the typed rationale stores it with server-derived gaps (client cannot forge them)", async () => {
    const res = await req(`/api/projects/${projectId}/gate-decisions`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({
        gate: "group_ic", decision: "go", rationale: "그룹 투자심사: 위원회가 위험을 감수하기로 함",
        gap_rationale: "채택 전 선행 투자 시급성 - 위원회 합의 사항", gap_items: ["위조된 항목"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()).data as { gap_override: { items: string[]; rationale: string } };
    expect(body.gap_override.rationale).toBe("채택 전 선행 투자 시급성 - 위원회 합의 사항");
    expect(body.gap_override.items.join()).not.toContain("위조");
    expect(body.gap_override.items.some((i) => i.includes("Business Case"))).toBe(true);
    const row = db.query("SELECT rationale FROM gate_decision WHERE gate = 'group_ic' AND entity_id = ?").get(projectId) as { rationale: string };
    expect(row.rationale).toContain("[누락 산출물 예외 근거]");
    expect(row.rationale.startsWith("그룹 투자심사: 위원회가 위험을 감수하기로 함")).toBe(true);
  });

  test("(c) the IC package and the gate history show the stored override", async () => {
    const data = await pkg();
    const g = data.gates.latest.find((x) => x.gate === "group_ic")!;
    expect(g.rationale).toBe("그룹 투자심사: 위원회가 위험을 감수하기로 함"); // human rationale, marker stripped
    expect(g.gap_override?.rationale).toBe("채택 전 선행 투자 시급성 - 위원회 합의 사항");
    expect(data.gates.history.filter((h) => h.gap_override).length).toBe(1);
    const hist = await (await req(`/api/projects/${projectId}/gate-decisions`, { headers: { cookie: analystCookie } })).json();
    expect(hist.data.history.some((h: { gap_override: unknown }) => h.gap_override)).toBe(true);
  });

  test("(f) compose / parse round-trip, and plain rationales pass through untouched", () => {
    const stored = composeRationale("본문 근거", { items: ["a", "b"], rationale: "예외 사유" });
    expect(parseRationale(stored)).toEqual({ rationale: "본문 근거", gap_override: { items: ["a", "b"], rationale: "예외 사유" } });
    expect(parseRationale("그냥 근거")).toEqual({ rationale: "그냥 근거", gap_override: null });
    expect(composeRationale("본문", null)).toBe("본문");
  });
});
