// @version 1.0.0
/**
 * S8 investment uncertainty is S5 greenfield simulation output: brownfield projects have none, so the
 * S8 lens, the fs gate brief (context, fallback evidence, manifest) and the adoption-recommendation
 * context omit it. Greenfield (and unset track) keep it. Scratch SQLite.
 */
import { test, expect, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-investment-uncertainty-brownfield.sqlite");
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
const { insertProject, addMember } = await import("./_gate-integrity-support.ts");
const unc = await import("../../app/web-next/lib/investment-uncertainty-s8.ts");
const applies = await import("../../app/web-next/lib/investment-uncertainty-applies.ts");
const lens = await import("../../app/web-next/lib/s8-lens-summary.ts");
const brief = await import("../../app/web-next/lib/gate-brief.ts");

const MARKER = "투자 불확실성";
const NONE_LINE = "투자 불확실성: 확정된 S5";
const SECTION = "[S8 투자 불확실성";

const brownfieldId = insertProject(db, null, "brownfield");
const greenfieldId = insertProject(db, null, "greenfield");
const nullTrackId = insertProject(db, null, "greenfield");
db.run("UPDATE md_project SET track = NULL WHERE id = ?", [nullTrackId]);

const NOW = new Date().toISOString();
const USER = "iub-analyst";
await createUser(db, { userId: USER, role: "analyst", password: "pw-iub-analyst-1", createdBy: "test", now: NOW });
approveUser(db, { userId: USER, approvedBy: "test", now: NOW });
db.run("UPDATE app_user SET must_change_password = 0");
for (const id of [brownfieldId, greenfieldId]) addMember(db, id, USER, "lead");
const login = await nextRequest("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ userId: USER, password: "pw-iub-analyst-1" }),
});
const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0];

async function adoptionManifest(projectId: string): Promise<string[]> {
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at, variant) VALUES (?,?,?,?,?,?,?,?)",
    [ulid(), projectId, "valuation", "case", 5, "t", NOW, "market_forward"],
  );
  const res = await nextRequest(`/api/projects/${projectId}/business-case/adoption-recommendation`, {
    method: "POST",
    body: JSON.stringify({}),
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { manifest: string[] } }).data.manifest;
}

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("investUncertaintyApplies", () => {
  test("false only for brownfield; greenfield, null track and unknown project apply", () => {
    expect(applies.investUncertaintyApplies(db, brownfieldId)).toBe(false);
    expect(applies.investUncertaintyApplies(db, greenfieldId)).toBe(true);
    expect(applies.investUncertaintyApplies(db, nullTrackId)).toBe(true);
    expect(applies.investUncertaintyApplies(db, "no-such-project")).toBe(true);
  });
});

describe("brownfield omits S5 investment uncertainty", () => {
  test("S8 lens invest_uncertainty is null", () => {
    expect(lens.buildS8LensSummary(db, brownfieldId).invest_uncertainty).toBeNull();
  });

  test("fs gate context, fallback evidence and manifest lack the section", () => {
    const ctx = brief.buildGateContext(db, "project", brownfieldId, "fs");
    expect(ctx).not.toContain(MARKER);
    expect(ctx).not.toContain(SECTION);
    const manifest = brief.projectGateManifest(db, brownfieldId, "fs") ?? [];
    expect(manifest.some((m) => m.includes(MARKER))).toBe(false);
    const b = brief.synthesisGateBrief(db, "project", brownfieldId, "fs", manifest);
    expect(b.key_evidence.join("\n")).not.toContain(MARKER);
  });
});

describe("greenfield keeps S5 investment uncertainty", () => {
  for (const [label, id] of [
    ["greenfield", greenfieldId],
    ["null track", nullTrackId],
  ] as const) {
    test(`${label}: lens, context, evidence, manifest still carry it`, () => {
      expect(lens.buildS8LensSummary(db, id).invest_uncertainty).not.toBeNull();
      const ctx = brief.buildGateContext(db, "project", id, "fs");
      expect(ctx).toContain(SECTION);
      expect(ctx).toContain(NONE_LINE);
      const manifest = brief.projectGateManifest(db, id, "fs") ?? [];
      expect(manifest.some((m) => m.includes(MARKER))).toBe(true);
      const b = brief.synthesisGateBrief(db, "project", id, "fs", manifest);
      expect(b.key_evidence.some((e) => e.includes(NONE_LINE))).toBe(true);
    });
  }
});

describe("adoption-recommendation manifest", () => {
  test("brownfield omits the investment-uncertainty entry; greenfield keeps it", async () => {
    expect((await adoptionManifest(brownfieldId)).some((m) => m.includes(MARKER))).toBe(false);
    expect((await adoptionManifest(greenfieldId)).some((m) => m.includes(MARKER))).toBe(true);
  });
});
