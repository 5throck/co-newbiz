// M11: audit-token scan for state-changing routes + competitor registry audit rows.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRouteAllowlist, reachesAudit, scanRouteAudit, writeMethods } from "../../scripts/co-newbiz/route-audit-scan.ts";

const TEST_DB_PATH = "db/data/test-route-audit-competitors.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { registerCompetitor, updateCompetitor, excludeCompetitor, restoreCompetitor } = await import("../../app/web-next/lib/company-competitors.ts");

const NOW = new Date().toISOString();
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

function seedApi(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "route-audit-"));
  tmpDirs.push(dir);
  for (const [rel, src] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, src);
  }
  return dir;
}

describe("route audit scan (M11)", () => {
  test("detects write methods", () => {
    expect(writeMethods("export async function POST() {}\nexport function GET() {}")).toEqual(["POST"]);
    expect(writeMethods("export async function GET() {}")).toEqual([]);
  });

  test("fails on a seeded write route without audit; passes with audit or allowlist", () => {
    const api = seedApi({
      "a/route.ts": "export async function POST() { return 1; }",
      "b/route.ts": "export async function POST(){ appendAudit(db, {}); }",
      "c/route.ts": "export async function GET(){ return 1; }",
    });
    expect(scanRouteAudit(api, {}).unaudited).toEqual(["a/route.ts"]);
    expect(scanRouteAudit(api, { "a/route.ts": "Draft generator, nothing persisted." }).unaudited).toEqual([]);
  });

  test("follows local imports but ignores a helper definition", () => {
    const api = seedApi({
      "d/route.ts": 'import { save } from "./lib.ts";\nexport async function PATCH(){ save(); }',
      "d/lib.ts": "export function save(){ appendAudit(db, {}); }",
      "e/route.ts": 'import { def } from "./def.ts";\nexport async function PUT(){ def(); }',
      "e/def.ts": "export function appendAudit(db, e){ }",
    });
    expect(reachesAudit(join(api, "d/route.ts"))).toBe(true);
    expect(reachesAudit(join(api, "e/route.ts"))).toBe(false);
  });

  test("rejects wildcard, reasonless and stale allowlist entries", () => {
    const api = seedApi({ "a/route.ts": "export async function POST(){ appendAudit(db,{}); }" });
    const r = scanRouteAudit(api, { "a/*": "wildcard reason text here", "a/route.ts": "short", "z/route.ts": "stale entry reason text" });
    expect(r.allowlistErrors.length).toBe(4);
  });

  test("the four former gap routes audit themselves and are not allowlisted", () => {
    const apiRoot = join(import.meta.dirname, "../../app/web-next/app/api");
    const routes = [
      "opportunities/[id]/committee-sessions/route.ts",
      "opportunities/[id]/route-decision/draft/route.ts",
      "our-company/members/[memberId]/upload/route.ts",
      "synergy/upload/route.ts",
    ];
    const allow = loadRouteAllowlist();
    for (const r of routes) {
      expect(allow[r]).toBeUndefined();
      expect(reachesAudit(join(apiRoot, r))).toBe(true);
    }
    expect(Object.values(allow).some((v) => v.startsWith("KNOWN GAP"))).toBe(false);
  });

  test("the real tree is clean", () => {
    const r = scanRouteAudit();
    expect(r.unaudited).toEqual([]);
    expect(r.allowlistErrors).toEqual([]);
  });
});

describe("competitor registry writes land in audit_log (M11)", () => {
  test("register, update, exclude, restore each append an audit row", () => {
    db.run("INSERT INTO company_group (id, name, created_at, created_by) VALUES ('g1','G',?,'t')", [NOW]);
    db.run("INSERT INTO company_group_member (id, group_id, company_name, dart_corp_code, role, created_at) VALUES ('m1','g1','Acme',NULL,'affiliate',?)", [NOW]);
    const subject = { kind: "member" as const, id: "m1", companyName: "Acme", dartCorpCode: null, groupName: "G" };
    const { id } = registerCompetitor(db, subject, { name: "Rival", dart_corp_code: null, note: null, discovery_source: "manual" }, "analyst1");
    updateCompetitor(db, subject, id, { note: "n" }, "analyst1");
    excludeCompetitor(db, subject, id, "out of scope", "analyst1");
    restoreCompetitor(db, subject, id, "analyst1");
    const actions = (db.query("SELECT action FROM audit_log WHERE actor_user_id = 'analyst1' ORDER BY created_at, rowid").all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(["competitor.register", "competitor.update", "competitor.exclude", "competitor.restore"]);
  });
});
