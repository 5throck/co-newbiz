// @version 1.0.0
/**
 * S8 생성기의 대상별 WACC 소비 — ADR-0156 수정본 2 회귀.
 * design 2026-10-10-s8-per-target-wacc-consumption-design.
 *
 * 실제 라우트 핸들러 + 스크래치 SQLite로 증명:
 *  (a) 비바운드 대상의 자체 WACC 세션이 밸류에이션·스냅샷에 반영된다
 *      (note wacc=/wacc_scope=target, discount_rate.scope·subject_company_id);
 *  (b) 세션이 없는 대상은 프로젝트 스코프로 폴백하고 라벨로 구분한다;
 *  (c) 바운드 대상은 그 회사에 자체 세션이 있어도 프로젝트(게이트 기준)
 *      스코프를 쓴다;
 *  (d) 게이트 격리 — 대상별 세션 존재 하에서도 무스코프 resolveProjectWacc는
 *      프로젝트 수치를 반환한다.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-business-case-wacc-scope.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
process.env.CO_NEWBIZ_BUSINESS_CASE_AGENTS = "deterministic";

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { resolveProjectWacc } = await import("../../db/lib/wacc.ts");

const NOW = new Date().toISOString();

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "wacc-scope-analyst";
let analystCookie = "";
let projectId = "";
let oppId = "";
let targetAId = ""; // 바운드(rank-1, name_ko 매칭 compA)
let targetBId = ""; // 비바운드(dart_corp_code 매칭 compB)
let targetCId = ""; // 회사 미특정 — 세션을 가질 수 없는 폴백 대상

interface CaseRead {
  note: string | null;
  discount: { value?: number; source?: string; scope?: string; subject_company_id?: string };
}

function readBaseCase(targetId: string): CaseRead | null {
  const m = db
    .query(
      `SELECT m.id, m.inputs_json FROM business_case_model m
       WHERE m.project_id = ? AND m.target_id = ? AND m.name LIKE '%base%'
       ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
    )
    .get(projectId, targetId) as { id: string; inputs_json: string } | undefined;
  if (!m) return null;
  const sim = db
    .query("SELECT note FROM valuation_simulation WHERE model_id = ? AND percentile = 'p50'")
    .get(m.id) as { note: string } | undefined;
  const spec = JSON.parse(m.inputs_json ?? "{}") as { discount_rate?: CaseRead["discount"] };
  return { note: sim?.note ?? null, discount: spec.discount_rate ?? {} };
}

async function regenerate(): Promise<void> {
  const res = await req(`/api/projects/${projectId}/business-case/generate`, {
    method: "POST",
    headers: { cookie: analystCookie },
    body: JSON.stringify({ regenerate: true }),
  });
  expect(res.status).toBe(201);
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-waccscope-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-waccscope-1");

  oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, "WACC 스코프 기회", "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,?,1)",
    [ulid(), oppId, "brownfield", "m_and_a", "test route", ANALYST, NOW],
  );
  for (const gate of ["screening", "pre_fs", "target_screening"]) {
    db.run(
      "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)",
      [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW],
    );
  }
  targetAId = ulid();
  targetBId = ulid();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?), (?,?,?,?,?,?,?)`,
    [targetAId, oppId, "스코프대상A", "shortlisted", 1, NOW, NOW, targetBId, oppId, "스코프대상B", "shortlisted", 2, NOW, NOW],
  );
  // A: name_ko 폴백, B: dart_corp_code 우선 — ADR-0143 회사 해석 규칙.
  db.run("INSERT INTO md_company (id, name_ko, created_at) VALUES (?,?,?)", ["compA", "스코프대상A", NOW]);
  db.run("UPDATE brownfield_target SET dart_corp_code = ? WHERE id = ?", ["88888888", targetBId]);
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", ["compB", "스코프대상B회사", "88888888", NOW]);

  projectId = promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: "wacc scope test" }).project.id;
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("S8 대상별 WACC 소비 (ADR-0156 수정본 2)", () => {
  test("(a) 비바운드 대상의 자체 세션이 밸류에이션·스냅샷에 반영", async () => {
    // 프로젝트(게이트 기준) 8%, 대상 B 자체 세션 20%
    let res = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ wacc: 0.08, rationale: "project gate figure" }),
    });
    expect(res.status).toBe(201);
    res = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ wacc: 0.2, rationale: "target B own cost of capital", target_id: targetBId }),
    });
    expect(res.status).toBe(201);

    await regenerate();

    // 바운드 대상 A — 프로젝트 스코프
    const caseA = readBaseCase(targetAId)!;
    expect(caseA.note).toContain("wacc=0.08");
    expect(caseA.note).toContain("wacc_scope=project");
    expect(caseA.note).not.toContain("wacc_scope=target");
    expect(caseA.discount.scope).toBe("project");
    expect(caseA.discount.subject_company_id).toBeUndefined();

    // 비바운드 대상 B — 자체 세션 20%
    const caseB = readBaseCase(targetBId)!;
    expect(caseB.note).toContain("wacc=0.2");
    expect(caseB.note).toContain("wacc_scope=target");
    expect(caseB.discount.value).toBeCloseTo(0.2, 8);
    expect(caseB.discount.scope).toBe("target");
    expect(caseB.discount.subject_company_id).toBe("compB");
    // 시드 정책은 스코프와 무차게 동일 규칙(projectId:targetId) — 재현 계약 유지
    expect(caseB.note).toContain("seed=");
  });

  test("(b) 세션 없는/회사 미특정 대상은 프로젝트 스코프 폴백", async () => {
    targetCId = ulid();
    db.run(
      "INSERT INTO brownfield_target (id, opportunity_id, company_name, status, rank, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      [targetCId, oppId, "스코프대상C", "shortlisted", 3, NOW, NOW],
    );
    await regenerate();
    const caseC = readBaseCase(targetCId)!;
    expect(caseC.note).toContain("wacc=0.08");
    expect(caseC.note).toContain("wacc_scope=project");
    expect(caseC.discount.scope).toBe("project");
  });

  test("(c) 바운드 대상은 자체 세션이 있어도 프로젝트(게이트 기준) 스코프", async () => {
    // compA에 자체 세션 30% — 바운드 대상이지만 게이트 수치는 프로젝트 스코프
    const res = await req(`/api/projects/${projectId}/wacc`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ wacc: 0.3, rationale: "compA own session must not hijack gate scope", target_id: targetAId }),
    });
    expect(res.status).toBe(201);

    await regenerate();
    const caseA = readBaseCase(targetAId)!;
    expect(caseA.note).toContain("wacc=0.08");
    expect(caseA.note).toContain("wacc_scope=project");
    expect(caseA.discount.value).toBeCloseTo(0.08, 8);
  });

  test("(d) 게이트 격리 — 무스코프 조회는 프로젝트 수치를 그대로 반환", () => {
    // compA 30%·compB 20% 세션이 존재해도 게이트 경로(fs 게이트, 스냅샷)가
    // 읽는 무스코프 해상은 프로젝트 8%.
    const gate = resolveProjectWacc(db, projectId);
    expect(gate.value).toBeCloseTo(0.08, 8);
    expect(gate.run_id).toBeTruthy();
    const scopedA = resolveProjectWacc(db, projectId, { subjectCompanyId: "compA" });
    expect(scopedA.value).toBeCloseTo(0.3, 8);
  });
});
