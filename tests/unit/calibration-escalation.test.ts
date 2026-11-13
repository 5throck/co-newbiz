/**
 * Removal regression suite for the deterministic CAGR scaling escalation
 * (design 2026-09-20-calibration-escalation — SUPERSEDED and REMOVED by
 * design 2026-11-13-calibration-loop-convergence §3.2). The filename is kept
 * deliberately: this suite now pins that escalation is INERT —
 *  - the escalation write path and ×0.85 math no longer exist;
 *  - resolveEffectiveCagr is bottom-up-only: a preserved calibration_escalation
 *    row in the DB does NOT change its output (no destructive migration — the
 *    table and its rows survive as read-only history);
 *  - the calibration GET still surfaces the preserved record for the panel's
 *    read-only history card.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-calibration-escalation.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { resolveEffectiveCagr, latestCalibrationEscalation } = await import(
  "../../app/web-next/lib/market-calibration.ts"
);

const NOW = new Date().toISOString();
let industryId: string;

beforeAll(() => {
  industryId = `ind-${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryId,
    "99002",
    "에스컬레이션 이력 테스트 산업",
    "escalation-history-test",
    NOW,
  ]);
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

function seedVersionWithCalibration(
  ind: string,
  versionNo: number,
  our: number,
  external: number,
  gap: number,
  createdAt: string = NOW,
): string {
  const analysisId = `${ind}-msa-${versionNo}`;
  const versionId = `${ind}-msv-${versionNo}`;
  db.run(
    "INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [analysisId, ind, "completed", "test", createdAt, createdAt],
  );
  db.run(
    `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [
      versionId,
      analysisId,
      versionNo,
      JSON.stringify({
        matrix: { calibration: { triggered: true, ourCagrPct: our, externalCagrPct: external, gapPct: gap } },
      }),
      "test",
      createdAt,
    ],
  );
  return versionId;
}

/** The preserved historical row, inserted the way the removed apply path used
 * to (direct SQL — the write path no longer exists to call). */
function seedHistoricalEscalation(ind: string, versionId: string, createdAt: string): string {
  const id = `esc-${Math.random().toString(36).slice(2, 10)}`;
  db.run(
    `INSERT INTO calibration_escalation
     (id, industry_id, version_id, method, base_our_cagr_pct, external_cagr_pct, scaled_cagr_pct, residual_gap_pct, rationale, decided_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      ind,
      versionId,
      "deterministic_scaling",
      18.3,
      47.1,
      40.0,
      15,
      "3사이클 미수렴 — 외부 참조 채택 (역사 기록)",
      "qa-tester",
      createdAt,
    ],
  );
  return id;
}

describe("escalation write path is gone (design 2026-11-13 §3.2)", () => {
  const LIB_PATH = "../../app/web-next/lib/market-calibration.ts";
  test("the ×0.85 write path exports no longer exist", async () => {
    const lib = (await import(LIB_PATH)) as Record<string, unknown>;
    expect(lib.applyCalibrationEscalation).toBeUndefined();
    expect(lib.computeDeterministicScaling).toBeUndefined();
    expect(lib.EscalationError).toBeUndefined();
    expect(lib.DeterministicScaling).toBeUndefined();
    // the escalation-local goal constant is unified into CONVERGENCE_GOAL_PCT
    expect(lib.CONVERGENCE_TARGET_PCT).toBeUndefined();
    expect(lib.CALIBRATION_TRIGGER_PCT).toBeUndefined();
    expect(lib.CONVERGENCE_GOAL_PCT).toBe(15);
  });
  test("the escalate route file and its openapi entry are gone", () => {
    expect(existsSync("app/web-next/app/api/market-overview/industry/[industryId]/calibration/escalate/route.ts")).toBe(
      false,
    );
    const openapi = readFileSync("docs/architecture/openapi.yaml", "utf8");
    expect(openapi).not.toContain("calibration/escalate");
    expect(openapi).not.toContain("applyCalibrationEscalation");
  });
});

describe("resolveEffectiveCagr is bottom-up-only", () => {
  test("a preserved escalation row does NOT change the resolver output (inert history)", () => {
    const ind = `ind-${Math.random().toString(36).slice(2, 10)}`;
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
      ind,
      `99${ind.slice(4)}`,
      "바텀업 전용 산업",
      "bottom-up-only",
      NOW,
    ]);
    const versionId = seedVersionWithCalibration(ind, 1, 18.3, 47.1, 61.1, "2026-09-20T01:00:00.000Z");
    seedHistoricalEscalation(ind, versionId, "2026-09-20T02:00:00.000Z");
    // The old resolver would return the scaled 40.0 with source "escalated"
    // (decision newer than the version). Now the raw bottom-up wins.
    const eff = resolveEffectiveCagr(db, ind);
    expect(eff).toEqual({ cagrPct: 18.3, source: "bottom_up" });
    expect(Object.keys(eff ?? {}).sort()).toEqual(["cagrPct", "source"]);
  });
  test("an escalation-only industry (payload without numbers) resolves null, not the scaled value", () => {
    const ind = `ind-${Math.random().toString(36).slice(2, 10)}`;
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
      ind,
      `99${ind.slice(4)}`,
      "빈 페이로드 산업",
      "empty-payload",
      NOW,
    ]);
    db.run(
      "INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
      [`${ind}-msa-1`, ind, "completed", "test", NOW, NOW],
    );
    db.run(
      "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
      [`${ind}-msv-1`, `${ind}-msa-1`, 1, "{}", "test", NOW],
    );
    seedHistoricalEscalation(ind, `${ind}-msv-1`, NOW);
    // The old fallback branch (:364-370) returned the scaled value here.
    expect(resolveEffectiveCagr(db, ind)).toBeNull();
  });
  test("industry without any version returns null", () => {
    expect(resolveEffectiveCagr(db, "ind-nonexistent")).toBeNull();
  });
  test("consistency.bottomUpCagr fallback still applies when the calibration block is absent", () => {
    const ind = `ind-${Math.random().toString(36).slice(2, 10)}`;
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
      ind,
      `99${ind.slice(4)}`,
      "컨시스턴시 폴백 산업",
      "consistency-fallback",
      NOW,
    ]);
    db.run(
      "INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
      [`${ind}-msa-1`, ind, "completed", "test", NOW, NOW],
    );
    db.run(
      "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
      [
        `${ind}-msv-1`,
        `${ind}-msa-1`,
        1,
        JSON.stringify({ matrix: { consistency: { bottomUpCagr: 7.7 } } }),
        "test",
        NOW,
      ],
    );
    expect(resolveEffectiveCagr(db, ind)).toEqual({ cagrPct: 7.7, source: "bottom_up" });
  });
});

describe("preserved history stays readable for the panel's read-only card", () => {
  test("latestCalibrationEscalation still returns the preserved row (calibration GET escalation field)", () => {
    const ind = `ind-${Math.random().toString(36).slice(2, 10)}`;
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
      ind,
      `99${ind.slice(4)}`,
      "이력 보존 산업",
      "history-preserved",
      NOW,
    ]);
    const versionId = seedVersionWithCalibration(ind, 1, 18.3, 47.1, 61.1, NOW);
    const escId = seedHistoricalEscalation(ind, versionId, NOW);
    const esc = latestCalibrationEscalation(db, ind);
    expect(esc?.id).toBe(escId);
    expect(esc?.scaled_cagr_pct).toBe(40.0);
    expect(esc?.residual_gap_pct).toBe(15);
    expect(esc?.decided_by).toBe("qa-tester");
    expect(esc?.method).toBe("deterministic_scaling");
  });
  test("industry without escalation history resolves null", () => {
    expect(latestCalibrationEscalation(db, "ind-nonexistent")).toBeNull();
  });
});
