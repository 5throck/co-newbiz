// @version 1.0.0
/**
 * GET /api/companies?scope=targets (design 2026-10-11-companies-list-exclude-
 * group-affiliates): hides group/affiliate profile companies and the
 * synergy-registry sentinel; unscoped response stays complete.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, readFileSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-companies-list-scope.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = new Date().toISOString();
let cookie = "";

function company(id: string, name: string, dart: string | null) {
  db.run("INSERT INTO md_company (id, name_ko, dart_corp_code, created_at) VALUES (?,?,?,?)", [id, name, dart, NOW]);
}
function member(id: string, name: string, dart: string | null, deleted = false) {
  db.run("INSERT INTO company_group_member (id, group_id, company_name, dart_corp_code, role, created_at, deleted_at) VALUES (?,?,?,?,?,?,?)",
    [id, "g1", name, dart, "affiliate", NOW, deleted ? NOW : null]);
}
async function names(qs: string): Promise<string[]> {
  const res = await nextRequest(`/api/companies${qs}`, { headers: { cookie } });
  const body = (await res.json()) as { data: { companies: { name_ko: string }[] } };
  return body.data.companies.map((c) => c.name_ko);
}

beforeAll(async () => {
  db.run("INSERT INTO company_group (id, name, created_at, created_by) VALUES ('g1','G',?,'t')", [NOW]);
  company("c-code", "CodeCo", "00135111");
  member("m1", "Other Name Inc", "00135111");
  company("c-nocode", "NameOnly", null);
  member("m2", "  NameOnly ", null);
  company("c-diff", "SameName", "99999999");
  member("m3", "SameName", "11111111");
  company("c-del", "DeletedMember", "55555555");
  member("m4", "DeletedMember", "55555555", true);
  company("c-keep", "Keeper Target", "77777777");
  await createUser(db, { userId: "cls1", role: "analyst", password: "pw-cls-12345678", createdBy: "test", now: NOW });
  approveUser(db, { userId: "cls1", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "cls1", password: "pw-cls-12345678" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("GET /api/companies scope=targets", () => {
  test("excludes member matched by corp code", async () => {
    expect(await names("?scope=targets")).not.toContain("CodeCo");
  });
  test("excludes member matched by trimmed name when company has no corp code", async () => {
    expect(await names("?scope=targets")).not.toContain("NameOnly");
  });
  test("keeps same-name company with a different non-null corp code", async () => {
    expect(await names("?scope=targets")).toContain("SameName");
  });
  test("excludes the synergy-registry sentinel", async () => {
    expect((await names("?scope=targets")).some((n) => n.includes("시너지 레지스트리"))).toBe(false);
  });
  test("ignores deleted members", async () => {
    expect(await names("?scope=targets")).toContain("DeletedMember");
  });
  test("unscoped response is unchanged (everything listed)", async () => {
    const all = await names("");
    for (const n of ["CodeCo", "NameOnly", "SameName", "DeletedMember", "Keeper Target"]) expect(all).toContain(n);
    expect(all.some((n) => n.includes("시너지 레지스트리"))).toBe(true);
  });
  test("q works together with scope", async () => {
    expect(await names("?scope=targets&q=Keeper")).toEqual(["Keeper Target"]);
    expect(await names("?scope=targets&q=CodeCo")).toEqual([]);
  });
});

describe("callers", () => {
  const page = readFileSync("app/web-next/app/companies/page.tsx", "utf8");
  const panel = readFileSync("app/web-next/components/FinancialAnalysisPanel.tsx", "utf8");
  test("/companies passes scope=targets; connect search does not", () => {
    expect(page).toContain("scope=targets");
    expect(panel).toContain("/api/companies?q=");
    expect(panel).not.toContain("scope=targets");
  });
});
