/**
 * Unit tests for the deterministic CAGR scaling escalation (design
 * 2026-09-20-calibration-escalation): scaling math (exact 15% residual), the
 * apply flow against a real scratch SQLite (migration 0119), and the guard
 * rails — already-converged rejection, mandatory calibration block.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-calibration-escalation.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const {
  applyCalibrationEscalation,
  computeDeterministicScaling,
  latestCalibrationEscalation,
  CONVERGENCE_TARGET_PCT,
  EscalationError,
} = await import("../../app/web-next/lib/market-calibration.ts");

const NOW = new Date().toISOString();
let industryId: string;

beforeAll(() => {
  industryId = `ind-${Math.random().toString(36).slice(2, 10)}`;
  db.run(
    "INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [industryId, "99002", "에스컬레이션 테스트 산업", "escalation-test", NOW],
  );
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

function seedVersionWithCalibration(versionNo: number, our: number, external: number, gap: number): string {
  const analysisId = `msa-esc-${versionNo}`;
  const versionId = `msv-esc-${versionNo}`;
  db.run(
    "INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    [analysisId, industryId, "completed", "test", NOW, NOW],
  );
  db.run(
    `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [versionId, analysisId, versionNo, JSON.stringify({ matrix: { calibration: { triggered: true, ourCagrPct: our, externalCagrPct: external, gapPct: gap } } }), "test", NOW],
  );
  return versionId;
}

describe("deterministic scaling math (pure)", () => {
  test("scaled CAGR is external × 0.85 with exactly the 15% residual gap", () => {
    const { scaledCagrPct, residualGapPct } = computeDeterministicScaling(47.1);
    expect(scaledCagrPct).toBe(40.0);
    expect(residualGapPct).toBe(15);
    expect(CONVERGENCE_TARGET_PCT).toBe(15);
  });
  test("invalid external reference is rejected, never repaired", () => {
    expect(() => computeDeterministicScaling(0)).toThrow();
    expect(() => computeDeterministicScaling(-3)).toThrow();
    expect(() => computeDeterministicScaling(Number.NaN)).toThrow();
  });
});

describe("apply flow (scratch SQLite, migration 0119)", () => {
  test("applies against the LATEST completed version and records the decision", () => {
    seedVersionWithCalibration(1, 18.3, 47.1, 61.1);
    const { escalation } = applyCalibrationEscalation(db, industryId, "qa-tester", "3사이클 미수렴 — 외부 참조 채택", NOW);
    expect(escalation.base_our_cagr_pct).toBe(18.3);
    expect(escalation.external_cagr_pct).toBe(47.1);
    expect(escalation.scaled_cagr_pct).toBe(40.0);
    expect(escalation.residual_gap_pct).toBe(15);
    expect(escalation.decided_by).toBe("qa-tester");
    expect(latestCalibrationEscalation(db, industryId)?.id).toBe(escalation.id);
  });
  test("a later version moves the base and allows a fresh escalation (append-only)", () => {
    seedVersionWithCalibration(2, 22.0, 47.1, 53.3);
    const { escalation } = applyCalibrationEscalation(db, industryId, "qa-tester", "재분석 후에도 미수렴 — 재적용", NOW);
    expect(escalation.base_our_cagr_pct).toBe(22.0);
    expect(escalation.version_id).toBe("msv-esc-2");
  });
  test("already-converged gap is rejected", () => {
    seedVersionWithCalibration(3, 40.2, 47.1, 14.6);
    expect(() => applyCalibrationEscalation(db, industryId, "qa-tester", "근거", NOW)).toThrow(EscalationError);
    try {
      applyCalibrationEscalation(db, industryId, "qa-tester", "근거", NOW);
    } catch (err) {
      expect((err as EscalationError).code).toBe("already_converged");
    }
  });
  test("missing calibration block is rejected", () => {
    const other = `ind-${Math.random().toString(36).slice(2, 10)}`;
    db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [other, "99003", "빈 산업", "empty", NOW]);
    db.run(
      "INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
      ["msa-esc-empty", other, "completed", "test", NOW, NOW],
    );
    db.run(
      "INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at) VALUES (?,?,?,?,?,?)",
      ["msv-esc-empty", "msa-esc-empty", 1, "{}", "test", NOW],
    );
    expect(() => applyCalibrationEscalation(db, other, "qa-tester", "근거", NOW)).toThrow(EscalationError);
  });
});
