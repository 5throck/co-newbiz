// @version 1.0.0
/**
 * T-20261022-007 — POST /api/greenfield/[oppId] (S5 assessment save) is a
 * greenfield-only write surface. The client gates it with TrackGate, but the
 * server must not trust that: an opportunity whose CURRENT route decision is
 * brownfield gets 409 not_applicable_track. Greenfield (and legacy rows with no
 * route decision yet) stay writable, unchanged.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-greenfield-route-track-guard.sqlite";
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
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = "2026-10-22T09:00:00Z";
const ANALYST = "gf-track-analyst";
let cookie = "";

const post = (oppId: string, body: unknown = { entry_strategy: "직접 진출", rationale: "트랙 가드 테스트" }) =>
  nextRequest(`/api/greenfield/${oppId}`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) });
const assessmentCount = (oppId: string) =>
  (db.query("SELECT COUNT(*) n FROM greenfield_assessment WHERE opportunity_id = ?").get(oppId) as { n: number }).n;

function seedOpp(track: "greenfield" | "brownfield" | null): string {
  const id = ulid();
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [id, `gf-track ${id.slice(-6)}`, "산업", "selected", ANALYST, NOW]);
  if (track) {
    db.run("INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at, is_current) VALUES (?,?,?,?,?,?,1)", [ulid(), id, track, "test", ANALYST, NOW]);
  }
  return id;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-gf-track-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: ANALYST, password: "pw-gf-track-12345" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("POST /api/greenfield/[oppId] — brownfield carriers are refused server-side", () => {
  test("brownfield route decision -> 409 not_applicable_track, nothing stored", async () => {
    const opp = seedOpp("brownfield");
    const res = await post(opp);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_applicable_track");
    expect(assessmentCount(opp)).toBe(0);
  });

  test("greenfield route decision -> unchanged 200 save", async () => {
    const opp = seedOpp("greenfield");
    const res = await post(opp);
    expect(res.status).toBe(200);
    expect(assessmentCount(opp)).toBe(1);
  });

  test("no route decision yet (legacy S5 drafting) -> unchanged 200 save", async () => {
    const opp = seedOpp(null);
    const res = await post(opp);
    expect(res.status).toBe(200);
    expect(assessmentCount(opp)).toBe(1);
  });
});
