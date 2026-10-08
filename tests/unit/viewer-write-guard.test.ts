// @version 1.0.0
/**
 * R2-C 9 — the UI disables actions for the read-only viewer ("보기 권한만 있습니다"), but the server
 * stays authoritative: every main write route must answer a viewer with 403 before doing any work.
 * Each case sends a plausible body so a 403 can only come from the role guard (CSRF is supplied by
 * the dispatcher), and the analyst control proves the same request is not simply malformed.
 */
import { test, expect, beforeAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-viewer-write-guard.sqlite";
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

const NOW = new Date().toISOString();
let analystCookie = "";
let viewerCookie = "";
let oppId = "";
let projectId = "";

async function login(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: "analyst1", role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "analyst1", approvedBy: "test", now: NOW });
  await createUser(db, { userId: "viewer1", role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "viewer1", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await login("analyst1", "pw-analyst-12345");
  viewerCookie = await login("viewer1", "pw-viewer-12345");

  oppId = `opp-${ulid().slice(-8)}`;
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [oppId, "viewer guard 기회", "테스트 산업", "selected", "analyst1", NOW]);
  db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [`${oppId}-rd`, oppId, "greenfield", "신설", "analyst1", NOW]);
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [`${oppId}-gf`, oppId, "build", "파트너십", "역량 확보", "analyst1", NOW, NOW],
  );
  db.run("UPDATE opportunity SET capability_gap_json = ? WHERE id = ?", [JSON.stringify({ rows: [{ id: "g1", capability: "c", resolution: "hire" }], updatedAt: NOW }), oppId]);
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", "analyst1", NOW]);
  }
  projectId = promoteOpportunity(oppId, { promotedBy: "analyst1", needToKnowBasis: "viewer guard test" }).project.id;
  // The viewer is a member of the project, so a rejection cannot be explained by invisibility (404).
  db.run(
    `INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)`,
    [projectId, "viewer1", "member", "test", NOW, "viewer guard test"],
  );
});

interface WriteCase { method: "POST" | "PUT" | "PATCH" | "DELETE"; path: () => string; body?: unknown }

const CASES: WriteCase[] = [
  { method: "POST", path: () => `/api/projects/${projectId}/deal-structure`, body: { action: "hypothesize", vehicle: "spc", rationale: "x" } },
  { method: "POST", path: () => `/api/projects/${projectId}/debt`, body: { principal: 100, rate_type: "fixed", rate: 0.05 } },
  { method: "POST", path: () => `/api/projects/${projectId}/wacc`, body: { action: "start" } },
  { method: "POST", path: () => `/api/projects/${projectId}/sites`, body: { name: "후보 부지" } },
  { method: "POST", path: () => `/api/projects/${projectId}/permits`, body: { name: "인허가" } },
  { method: "POST", path: () => `/api/projects/${projectId}/incentives`, body: { name: "인센티브" } },
  { method: "POST", path: () => `/api/projects/${projectId}/interviews`, body: { expert: "전문가" } },
  { method: "POST", path: () => `/api/projects/${projectId}/gate-decisions`, body: { gate: "dd", decision: "go", rationale: "근거" } },
  { method: "POST", path: () => `/api/projects/${projectId}/business-case`, body: { name: "케이스" } },
  { method: "POST", path: () => `/api/projects/${projectId}/business-case/adopt`, body: { run_id: "x", rationale: "근거" } },
  { method: "POST", path: () => `/api/projects/${projectId}/waivers`, body: { checklist: "ma-special-topics", clause: "x", reason: "사유" } },
  { method: "PUT", path: () => `/api/projects/${projectId}/dd-checklist/state`, body: { item_id: "x", status: "met" } },
  { method: "POST", path: () => `/api/projects/${projectId}/charter`, body: { purpose: "목적" } },
  { method: "POST", path: () => `/api/projects/${projectId}/transition-decision`, body: { decision: "graduate_to_core", rationale: "근거" } },
  { method: "POST", path: () => `/api/projects/${projectId}/target-selection`, body: { target_id: "x", rationale: "근거" } },
  { method: "POST", path: () => `/api/projects/${projectId}/reports`, body: { kind: "snapshot" } },
  { method: "POST", path: () => `/api/projects/${projectId}/close`, body: { closure_type: "withdrawn", reason: "사유 사유 사유 사유 사유 사유" } },
  { method: "POST", path: () => `/api/projects/${projectId}/share-links`, body: { ttl_hours: 1 } },
  { method: "PUT", path: () => `/api/projects/${projectId}/establishment`, body: { step: "prep", status: "done" } },
  { method: "POST", path: () => `/api/projects/${projectId}/industries`, body: { industry_id: "x" } },
  { method: "DELETE", path: () => `/api/projects/${projectId}` },
  { method: "POST", path: () => `/api/opportunities`, body: { name: "viewer 신규" } },
  { method: "POST", path: () => `/api/opportunities/${oppId}/promote`, body: {} },
  { method: "POST", path: () => `/api/opportunities/${oppId}/gate-decisions`, body: { gate: "screening", decision: "go", rationale: "근거" } },
  { method: "POST", path: () => `/api/opportunities/${oppId}/close`, body: { closure_type: "withdrawn", reason: "사유 사유 사유 사유 사유 사유" } },
  { method: "POST", path: () => `/api/opportunities/${oppId}/synergy-confirm`, body: {} },
  { method: "POST", path: () => `/api/opportunities/${oppId}/pipeline/start`, body: {} },
  { method: "POST", path: () => `/api/market-overview/analyses`, body: { industry_name: "viewer 산업" } },
  { method: "POST", path: () => `/api/synergy/analyses`, body: { name: "viewer 시너지" } },
  { method: "POST", path: () => `/api/our-company/groups`, body: { name: "viewer 그룹" } },
  { method: "POST", path: () => `/api/brownfield/${oppId}/targets`, body: { name: "viewer 대상" } },
  { method: "POST", path: () => `/api/greenfield/${oppId}`, body: { entry_strategy: "build" } },
  { method: "POST", path: () => `/api/comments`, body: { body: "viewer 코멘트" } },
];

describe("viewer role: the server rejects writes on the main write routes (R2-C 9)", () => {
  for (const c of CASES) {
    test(`${c.method} ${c.path().replace(/opp-[a-z0-9]+|[0-9A-Z]{26}/gi, ":id")} -> 403 role guard for a viewer`, async () => {
      const init = (cookie: string): RequestInit => ({
        method: c.method,
        headers: { cookie },
        ...(c.body === undefined ? {} : { body: JSON.stringify(c.body) }),
      });
      const before = (db.query("SELECT COUNT(*) c FROM opportunity").get() as { c: number }).c;
      const res = await nextRequest(c.path(), init(viewerCookie));
      const text = await res.text();
      expect(res.status, text).toBe(403);
      const code = (JSON.parse(text) as { error?: { code?: string } }).error?.code ?? "";
      expect(code.startsWith("csrf"), `rejected by CSRF, not by the role guard: ${code}`).toBe(false);
      // A rejected viewer write leaves no new opportunity behind.
      expect((db.query("SELECT COUNT(*) c FROM opportunity").get() as { c: number }).c).toBe(before);
    });
  }

  test("control: the same kind of request is not a 403 for an analyst (guard, not malformed input)", async () => {
    const res = await nextRequest(`/api/projects/${projectId}/debt`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ principal: 100, rate_type: "fixed", rate: 0.05 }),
    });
    expect(res.status).toBe(201);
  });
});
