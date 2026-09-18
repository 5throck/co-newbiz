// @version 1.0.0
/**
 * Target costing (design 2026-09-18-s8-business-case-evaluation REQ-W2):
 *  (a) pure gap math — allowable cost, gap, threshold at exactly +10%;
 *  (b) input validation errors;
 *  (c) POST/GET route roundtrip (analyst+; viewer forbidden);
 *  (d) generation wiring — a beyond-threshold analysis uplifts the downside
 *      opex driver (job-spec source label + tc_downside_opex_uplift note) and
 *      leaves base/upside untouched (REQ-W2-3).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-target-costing.sqlite";
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

const NOW = new Date().toISOString();
const ANALYST = "tc-analyst";
const VIEWER = "tc-viewer";
let analystCookie = "";
let viewerCookie = "";
let projectId = "";

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-tc-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-tc-viewer-1", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  const login = async (userId: string, password: string) => {
    const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
    return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
  };
  analystCookie = await login(ANALYST, "pw-tc-12345");
  viewerCookie = await login(VIEWER, "pw-tc-viewer-1");

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "P-TC", NOW]);
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?,?,?,?,?,?)",
    [projectId, ANALYST, "lead", ANALYST, NOW, "target costing test"],
  );
});

afterAll(async () => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

// ── price-evidence drafts (design 2026-09-18-target-costing-price-anchor) ──

describe("price evidence drafts", () => {
  test("(e) query builder: three subject variants, never a long sentence", async () => {
    const { priceQueries } = await import("../../app/web-next/lib/price-evidence.ts");
    const queries = priceQueries("S1-S12 데모 대상회사 카메라 모듈");
    expect(queries.length).toBe(3);
    for (const q of queries) expect(q).toContain("S1-S12 데모 대상회사 카메라 모듈");
  });

  test("(f) unconfigured search: empty proposals + manual-entry note, flow unblocked", async () => {
    const { setWebResearchOverrideForTests } = await import("../../app/web-next/lib/web-research.ts");
    setWebResearchOverrideForTests({ configured: false, sources: [] });
    try {
      const { draftPriceEvidence } = await import("../../app/web-next/lib/price-evidence.ts");
      const draft = await draftPriceEvidence({ subject: "테스트 제품" });
      expect(draft.proposals).toEqual([]);
      expect(draft.note).toContain("수동");
      expect(draft.source).toBe("fallback");
    } finally {
      setWebResearchOverrideForTests(null);
    }
  });

  test("(g) search without LLM: fallback note, still no fabrication", async () => {
    const { setWebResearchOverrideForTests } = await import("../../app/web-next/lib/web-research.ts");
    setWebResearchOverrideForTests({
      configured: true,
      sources: [{ title: "가격표", url: "https://example.com/price", snippet: "단가 12,000원 (EA 기준)" }],
    });
    try {
      const { draftPriceEvidence } = await import("../../app/web-next/lib/price-evidence.ts");
      const draft = await draftPriceEvidence({ subject: "테스트 제품" });
      // No LLM configured in the test environment → the deterministic
      // fallback never invents a price.
      expect(draft.proposals).toEqual([]);
      expect(draft.note.length).toBeGreaterThan(0);
    } finally {
      setWebResearchOverrideForTests(null);
    }
  });

  test("(h) confirmed evidence persists; evidence without a source URL is rejected", async () => {
    const ok = await req(`/api/projects/${projectId}/target-costing`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        market_price: 12000,
        target_margin: 0.15,
        estimated_unit_cost: 11800,
        source: "peer_benchmark",
        price_evidence: {
          unit_price: 12000,
          currency: "KRW",
          unit: "EA",
          source_url: "https://example.com/price",
          source_name: "가격표",
          quote: "단가 12,000원 (EA 기준)",
        },
      }),
    });
    expect(ok.status).toBe(201);

    const get = await req(`/api/projects/${projectId}/target-costing`, { method: "GET", headers: { cookie: analystCookie } });
    const latest = (await get.json()).data.latest as { priceEvidence: { source_url: string; quote: string } | null };
    expect(latest.priceEvidence).not.toBeNull();
    expect(latest.priceEvidence!.source_url).toBe("https://example.com/price");

    const noUrl = await req(`/api/projects/${projectId}/target-costing`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        market_price: 12000,
        target_margin: 0.15,
        estimated_unit_cost: 11800,
        price_evidence: { unit_price: 12000, currency: "KRW", unit: "EA", quote: "no url" },
      }),
    });
    expect(noUrl.status).toBe(400);
  });
});

// ── pure math ───────────────────────────────────────────────────────────────

describe("computeTargetCostGap (pure)", () => {
  test("(a) allowable cost, gap, and threshold direction", async () => {
    const { computeTargetCostGap } = await import("../../app/web-next/lib/target-costing.ts");
    // price 12,000 x (1 - 0.15) = 10,200 allowable; cost 11,800 → gap +1,600
    const g = computeTargetCostGap({ marketPrice: 12000, targetMargin: 0.15, estimatedUnitCost: 11800 });
    expect(g.allowableCost).toBeCloseTo(10200, 6);
    expect(g.gap).toBeCloseTo(1600, 6);
    expect(g.gapRatio).toBeCloseTo(1600 / 10200, 6);
    expect(g.thresholdExceeded).toBe(true);

    const within = computeTargetCostGap({ marketPrice: 12000, targetMargin: 0.15, estimatedUnitCost: 11000 });
    expect(within.thresholdExceeded).toBe(false);

    // exactly at +10% is NOT exceeded (strictly beyond the threshold feeds downside)
    const exact = computeTargetCostGap({ marketPrice: 10000, targetMargin: 0, estimatedUnitCost: 11000 });
    expect(exact.gapRatio).toBeCloseTo(0.10, 6);
    expect(exact.thresholdExceeded).toBe(false);
  });

  test("(b) invalid inputs are rejected, never silently repaired", async () => {
    const { computeTargetCostGap } = await import("../../app/web-next/lib/target-costing.ts");
    expect(() => computeTargetCostGap({ marketPrice: -1, targetMargin: 0.1, estimatedUnitCost: 5 })).toThrow(/market_price/);
    expect(() => computeTargetCostGap({ marketPrice: 100, targetMargin: 1, estimatedUnitCost: 5 })).toThrow(/target_margin/);
    expect(() => computeTargetCostGap({ marketPrice: 100, targetMargin: 0.1, estimatedUnitCost: Number.NaN })).toThrow(/estimated_unit_cost/);
  });
});

// ── route + generation wiring ───────────────────────────────────────────────

describe("target-costing route + generation wiring", () => {
  test("(c) POST computes and persists; GET returns the latest; viewer forbidden", async () => {
    const viewerRes = await req(`/api/projects/${projectId}/target-costing`, {
      method: "POST",
      headers: { cookie: viewerCookie },
      body: JSON.stringify({ market_price: 12000, target_margin: 0.15, estimated_unit_cost: 11800 }),
    });
    expect(viewerRes.status).toBe(403);

    const bad = await req(`/api/projects/${projectId}/target-costing`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ market_price: 12000, target_margin: 1.5, estimated_unit_cost: 11800 }),
    });
    expect(bad.status).toBe(400);

    const post = await req(`/api/projects/${projectId}/target-costing`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({
        market_price: 12000,
        target_margin: 0.15,
        estimated_unit_cost: 11800,
        levers: ["설계-to-cost", "소싱 협상"],
        source: "user",
      }),
    });
    expect(post.status).toBe(201);
    const analysis = (await post.json()).data.analysis as { gapRatio: number; thresholdExceeded: boolean; allowableCost: number };
    expect(analysis.allowableCost).toBeCloseTo(10200, 6);
    expect(analysis.thresholdExceeded).toBe(true);

    const get = await req(`/api/projects/${projectId}/target-costing`, { method: "GET", headers: { cookie: analystCookie } });
    expect(get.status).toBe(200);
    const view = (await get.json()).data as { latest: { gapRatio: number } | null; threshold: number };
    expect(view.latest?.gapRatio).toBeCloseTo(analysis.gapRatio, 6);
    expect(view.threshold).toBe(0.1);
  });

  test("(d) a beyond-threshold analysis uplifts the downside opex driver only (REQ-W2-3)", async () => {
    const gen = await req(`/api/projects/${projectId}/business-case/generate`, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({}),
    });
    expect(gen.status).toBe(201);

    const rows = db
      .query(
        `SELECT vs.scenario, vs.note, m.inputs_json FROM valuation_simulation vs
         JOIN business_case_model m ON m.id = vs.model_id
         WHERE vs.project_id = ? AND vs.percentile = 'p50'`,
      )
      .all(projectId) as Array<{ scenario: string; note: string; inputs_json: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(3);

    for (const row of rows) {
      const spec = JSON.parse(row.inputs_json!) as { cases: Array<{ drivers: { opex_ratio: { value: number; source: string } } }> };
      const opex = spec.cases[0].drivers.opex_ratio;
      if (row.scenario === "downside") {
        expect(row.note).toMatch(/tc_downside_opex_uplift=1\.1[0-9]/);
        expect(opex.value).toBeCloseTo(0.6 * (1 + 1600 / 10200), 5); // 0.6 × (1 + gapRatio 15.686%)
        expect(opex.source).toContain("REQ-W2-3");
      } else {
        expect(row.note).not.toContain("tc_downside_opex_uplift=1.1");
        expect(opex.value).toBeCloseTo(0.6, 5);
      }
      expect(row.note).toMatch(/tc_gap_ratio=0\.15[0-9]/);
    }
  });
});
