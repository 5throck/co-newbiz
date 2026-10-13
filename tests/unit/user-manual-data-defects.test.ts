// @version 1.0.0
/**
 * User-manual data defects (D-13, D-15, D-16, W1-05, W1-07, W1-12, W1-14).
 * Runs the real demo seeds into a scratch DB under the OS temp dir and the real
 * route handlers; never touches db/data.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const dir = mkdtempSync(join(tmpdir(), "co-newbiz-manual-defects-"));
const DB_PATH = join(dir, "t.sqlite");
process.env.CO_NEWBIZ_DB_PATH = DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { computeTrackAdvisory } = await import("../../app/web-next/lib/track-advisory.ts");
const { fmtBillions } = await import("../../app/web-next/components/stages/market/marketFormat.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");

resetDb();
const bf = seedS1ToS12Demo(DB_PATH);
const gf = await seedGreenfieldS1ToS12Demo(DB_PATH);
const db = getDb(DB_PATH);
const NOW = new Date().toISOString();
let cookie = "";

beforeAll(async () => {
  await createUser(db, { userId: "analyst1", role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: "analyst1", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  for (const pid of [bf.projectId, gf.projectId]) {
    db.run("INSERT OR IGNORE INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?, 'analyst1', 'lead', 'test', ?, 'test')", [pid, NOW]);
  }
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId: "analyst1", password: "pw-analyst-12345" }) });
  cookie = (res.headers.getSetCookie()[0] ?? "").split(";")[0];
});

afterAll(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("W1-05 / D-13 market figures agree across S1, S2, S4", () => {
  test("seeded bottomUpCagr is a percent number equal to the opportunity growth rate", () => {
    for (const [oppId, analysisId] of [[bf.opportunityId, "demo-s1-s12-analysis"], [gf.opportunityId, "demo-gf-analysis"]] as const) {
      const opp = db.query("SELECT growth_rate, market_size_krw_m FROM opportunity WHERE id = ?").get(oppId) as { growth_rate: number; market_size_krw_m: number };
      const v = db.query("SELECT payload FROM market_sizing_version WHERE analysis_id = ?").get(analysisId) as { payload: string };
      const m = (JSON.parse(v.payload) as { matrix: { consistency: { bottomUpCagr: number }; anchor: { total: number } } }).matrix;
      // consumers print `${bottomUpCagr}%` / toFixed(1)% — a fraction would show 0.1%
      expect(m.consistency.bottomUpCagr).toBeGreaterThanOrEqual(1);
      expect(m.consistency.bottomUpCagr).toBeCloseTo(opp.growth_rate * 100, 0);
      // KRW 백만 vs $B at ~1,350 KRW/USD: within 15%
      const usdFromKrw = opp.market_size_krw_m / 1_350_000;
      expect(Math.abs(usdFromKrw - m.anchor.total) / m.anchor.total).toBeLessThan(0.15);
    }
  });
  test("fmtBillions keeps decimals below $10B (0.9 is not rounded to 1)", () => {
    expect(fmtBillions(0.9)).toBe("0.90");
    expect(fmtBillions(12.4)).toBe("12");
  });
});

describe("W1-14 NPV labels use the right unit", () => {
  test("backtest page converts 백만 KRW to 억원 instead of appending 억", () => {
    const src = readFileSync(join(PROJECT_ROOT, "app/web-next/app/projects/[id]/backtest/page.tsx"), "utf8");
    expect(src).not.toMatch(/fmtNpvInteger\(r\.\w+_npv_krw_m\)\}?억/);
    expect(src).toContain("fmtNpvEok(r.forecast_npv_krw_m)");
  });
});

describe("W1-12 timeline status follows the stage rail", () => {
  test("not-applicable stages are flagged, nothing shows in progress when the rail is complete, SLA is seeded", async () => {
    for (const [pid, skipped] of [[bf.projectId, ["S5"]], [gf.projectId, ["S6", "S7"]]] as const) {
      const res = await nextRequest(`/api/projects/${pid}/timeline`, { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { stages: Array<{ stage_id: string; in_progress: boolean; not_applicable: boolean; sla_set: boolean; status: string | null }> } };
      const byId = new Map(body.data.stages.map((s) => [s.stage_id, s]));
      for (const sid of skipped) expect(byId.get(sid)?.not_applicable).toBe(true);
      // S1/S3 have no timestamp-less "in progress" artefact any more
      for (const sid of ["S1", "S3", "S5"]) if (!skipped.includes(sid as never)) expect(byId.get(sid)?.in_progress).toBe(false);
      expect(body.data.stages.every((s) => s.sla_set)).toBe(true);
    }
  });
});

describe("D-15 / D-16 seed consistency", () => {
  test("confirmed synergy score has a linked completed analysis", () => {
    for (const oppId of [bf.opportunityId, gf.opportunityId]) {
      const c = db.query("SELECT COUNT(*) c FROM synergy_analysis WHERE opportunity_id = ? AND status = 'completed'").get(oppId) as { c: number };
      expect(c.c).toBe(1);
    }
  });
  test("opportunity list exposes route_decided so the board does not say S4 waiting", async () => {
    const res = await nextRequest("/api/opportunities?includePromoted=1", { headers: { cookie } });
    const rows = ((await res.json()) as { data: Array<{ id: string; route_decided: number }> }).data;
    expect(rows.find((r) => r.id === bf.opportunityId)?.route_decided).toBe(1);
  });
});

describe("W1-07 / W2-06 route advisory agrees with the recorded track", () => {
  test("greenfield demo leans greenfield, brownfield demo leans brownfield", () => {
    expect(computeTrackAdvisory(db, gf.opportunityId).recommendedTrack).toBe("greenfield");
    expect(computeTrackAdvisory(db, bf.opportunityId).recommendedTrack).toBe("brownfield");
  });
  test("a competitive structure that says dispersed is not read as concentrated by the leader ratio", () => {
    const adv = computeTrackAdvisory(db, gf.opportunityId);
    const comp = adv.signals.find((s) => s.key === "competitive_structure");
    expect(comp?.leans).toBe("neutral");
  });
});
