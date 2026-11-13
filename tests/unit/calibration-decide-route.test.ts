// @version 1.0.0
/**
 * POST /api/market-overview/industry/:industryId/calibration/:rowId — the
 * decide route's exclusion-row contract (design 2026-11-13-calibration-loop-
 * convergence amendment 2026-11-13b; AC-17 route half, fix-iteration 1).
 * An exclusion proposal is DISMISS-ONLY: accept is 400
 * exclusion_accept_forbidden (accepting would re-admit the excluded driver
 * into the accepted set — a contract violation, 경계 #2), the person's dismiss
 * records decided_by and the confirmed driver stops appearing in
 * acceptedCalibrationDrivers, and accept on a NORMAL attribution row still
 * works (the marker, not the route, separates the row kinds).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-calibration-decide-route.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { acceptedCalibrationDrivers, insertExclusionProposal } = await import(
  "../../app/web-next/lib/market-calibration.ts"
);

const NOW = new Date().toISOString();
let analystCookie: string;
let industryId: string;

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const decide = (rowId: string, action: string) =>
  nextRequest(
    `/api/market-overview/industry/${encodeURIComponent(industryId)}/calibration/${encodeURIComponent(rowId)}`,
    {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ action }),
    },
  );

let exclusionRowId: string;
let normalRowId: string;

beforeAll(async () => {
  await createUser(db, { userId: "ana", role: "analyst", password: "pw-ana-1234567", createdBy: "test", now: NOW });
  await approveUser(db, { userId: "ana", approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie("ana", "pw-ana-1234567");
  industryId = `ind-decide-${Math.random().toString(36).slice(2, 8)}`;
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryId,
    "99102",
    "제외 결정 라우트 테스트 산업",
    "decide-route-test",
    NOW,
  ]);
  db.run(
    "INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    ["msa-decide", industryId, "completed", "test", NOW, NOW],
  );
  db.run(
    `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)`,
    ["msv-decide-1", "msa-decide", 1, "{}", "test", NOW],
  );
  // One accepted driver the exclusion proposal targets + one normal attribution
  // proposal as the accept-still-works contrast.
  db.run(
    `INSERT INTO industry_driver_calibration (id, industry_id, version_id, driver, direction, impact_pct, rationale, status, proposed_by, decided_by, decided_at, created_at)
     VALUES ('idc-decide-accepted', ?, 'msv-decide-1', '과대 상승 가정', 'upside', 45, '테스트 근거', 'accepted', 'test', 'analyst', ?, ?)`,
    [industryId, NOW, NOW],
  );
  db.run(
    `INSERT INTO industry_driver_calibration (id, industry_id, version_id, driver, direction, impact_pct, rationale, status, proposed_by, created_at)
     VALUES ('idc-decide-normal', ?, 'msv-decide-1', '소폭 수요 상승', 'upside', 5, '테스트 근거', 'proposed', 'market-sizing-pipeline', ?)`,
    [industryId, NOW],
  );
  exclusionRowId = insertExclusionProposal(db, {
    industryId,
    versionId: "msv-decide-1",
    driver: "과대 상승 가정",
    direction: "upside",
    impact_pct: 45,
    rationale: "제외 검토 근거 — 테스트",
  }).id;
  normalRowId = "idc-decide-normal";
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

describe("POST calibration/[rowId] — exclusion rows are dismiss-only (AC-17 route half)", () => {
  test("accept on an exclusion proposal → 400 exclusion_accept_forbidden, row stays open", async () => {
    const res = await decide(exclusionRowId, "accept");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("exclusion_accept_forbidden");
    const row = db.query("SELECT status FROM industry_driver_calibration WHERE id = ?").get(exclusionRowId) as {
      status: string;
    };
    expect(row.status).toBe("proposed");
  });

  test("dismiss on an exclusion proposal records the person and the driver leaves the accepted set", async () => {
    const res = await decide(exclusionRowId, "dismiss");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { status?: string; decided_by?: string } };
    expect(body.data?.status).toBe("dismissed");
    expect(body.data?.decided_by).toBe("ana");
    expect(acceptedCalibrationDrivers(db, industryId).map((d) => d.driver)).not.toContain("과대 상승 가정");
  });

  test("accept on a NORMAL attribution row still works — the marker separates row kinds, not the route", async () => {
    const res = await decide(normalRowId, "accept");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { status?: string; decided_by?: string } };
    expect(body.data?.status).toBe("accepted");
    expect(body.data?.decided_by).toBe("ana");
    expect(acceptedCalibrationDrivers(db, industryId).map((d) => d.driver)).toContain("소폭 수요 상승");
  });
});
