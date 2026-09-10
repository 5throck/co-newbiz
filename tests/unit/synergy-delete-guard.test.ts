import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

// Synergy delete guard — a synergy analysis is the strategic basis of a deal.
// While its opportunity is selected or promoted (and not itself delete-marked),
// deleting the analysis is refused with 409 synergy_basis_in_use; the deal must
// be deleted/archived first. The delete itself is a deletion mark, not a row
// removal — the original stays inspectable.
const TEST_DB_PATH = "db/data/test-synergy-guard.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const NOW = "2026-09-10T00:00:00Z";
let cookie = "";
let oppSelected = "";
let synOnSelected = "";
let synFree = ""; // no opportunity attached

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

beforeAll(async () => {
  await createUser(db, { userId: "syn-guard", role: "analyst", password: "pw-syn-guard-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "syn-guard", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  cookie = await loginCookie("syn-guard", "pw-syn-guard-12345");

  oppSelected = ulid();
  db.run("INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)", [oppSelected, "선별 기회", "selected", "test", NOW]);
  synOnSelected = ulid();
  db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at, opportunity_id) VALUES (?,?,?,?,?,?,?)", [synOnSelected, "md-synergy-registry-sentinel", "completed", 3, "test", NOW, oppSelected]);
  synFree = ulid();
  db.run("INSERT INTO synergy_analysis (id, company_id, status, current_step, created_by, created_at) VALUES (?,?,?,?,?,?)", [synFree, "md-synergy-registry-sentinel", "completed", 3, "test", NOW]);
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("synergy analysis deletion — live-deal guard + mark", () => {
  test("refused with 409 while the opportunity is selected (strategic basis)", async () => {
    const res = await nextRequest(`/api/synergy/analyses/${synOnSelected}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } | null };
    expect(body.error?.code).toBe("synergy_basis_in_use");
    expect(db.query("SELECT deleted_at FROM synergy_analysis WHERE id = ?").get(synOnSelected)).toBeTruthy();
  });

  test("marking succeeds once the opportunity is delete-marked; the row survives", async () => {
    db.run("UPDATE opportunity SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?", [NOW, "test", "deal deleted", oppSelected]);
    const res = await nextRequest(`/api/synergy/analyses/${synOnSelected}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    const row = db.query("SELECT deleted_at FROM synergy_analysis WHERE id = ?").get(synOnSelected) as { deleted_at: string | null } | undefined;
    expect(row?.deleted_at).toBeTruthy();
    expect(count("synergy_version", "analysis_id = ?", synOnSelected)).toBe(0);

    // the marked analysis is filtered from the list
    const list = await nextRequest("/api/synergy/analyses", { headers: { cookie } });
    const body = (await list.json()) as { data: { analyses: Array<{ id: string }> } };
    expect(body.data.analyses.some((a) => a.id === synOnSelected)).toBe(false);
  });

  test("analysis without a live deal can be marked directly", async () => {
    const res = await nextRequest(`/api/synergy/analyses/${synFree}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    const row = db.query("SELECT deleted_at FROM synergy_analysis WHERE id = ?").get(synFree) as { deleted_at: string | null } | undefined;
    expect(row?.deleted_at).toBeTruthy();
  });
});

function count(table: string, where = "1=1", ...bind: unknown[]): number {
  return (db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...bind) as { n: number }).n;
}
