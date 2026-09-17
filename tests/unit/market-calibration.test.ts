/**
 * Unit tests for the S1 growth-gap calibration loop (design
 * 2026-09-18-s1-growth-gap-calibration): trigger math on the relative CAGR
 * gap, external-reference resolution order, constraint building, and the
 * accept/dismiss decision flow with audit — lib-level against real scratch
 * SQLite (the tables come from migration 0113).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-market-calibration.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const {
  appendExternalReference,
  acceptedCalibrationDrivers,
  buildCalibrationConstraints,
  decideCalibrationDriver,
  isCalibrationTriggered,
  relativeCagrGapPct,
  resolveExternalReference,
  CALIBRATION_TRIGGER_PCT,
} = await import("../../app/web-next/lib/market-calibration.ts");

const NOW = new Date().toISOString();
let industryId: string;

beforeAll(() => {
  industryId = `ind-${Math.random().toString(36).slice(2, 10)}`;
  db.run(
    "INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)",
    [industryId, "99001", "보정테스트 산업", "calibration-test", NOW],
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

function seedVersion(id: string): void {
  // FK 순서 — market_sizing_version은 분석 행을 참조하므로 분석을 먼저 시드한다.
  db.run(
    "INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    ["msa-cal", industryId, "completed", "test", NOW, NOW],
  );
  db.run(
    `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [id, "msa-cal", 1, "{}", "test", NOW],
  );
}

describe("trigger math (relative CAGR gap)", () => {
  test("relative gap is |our−external|/external", () => {
    expect(relativeCagrGapPct(12, 10)).toBe(20);
    expect(relativeCagrGapPct(8, 10)).toBe(20);
    expect(relativeCagrGapPct(9.4, 10)).toBe(6);
  });

  test("trigger fires at and above the 20% boundary only", () => {
    expect(CALIBRATION_TRIGGER_PCT).toBe(20);
    expect(isCalibrationTriggered(12, 10)).toBe(true);
    expect(isCalibrationTriggered(11.9, 10)).toBe(false);
    expect(isCalibrationTriggered(50, 10)).toBe(true);
  });

  test("non-positive external CAGR never triggers", () => {
    expect(relativeCagrGapPct(5, 0)).toBeNull();
    expect(isCalibrationTriggered(5, 0)).toBe(false);
  });
});

describe("external reference resolution", () => {
  test("the newest recorded reference wins and user writes are audited", () => {
    const auditsBefore = (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'market_external_reference.set'").get() as { n: number }).n;
    appendExternalReference(db, {
      industry_id: industryId,
      source_label: "구 리포트",
      target_year: 2030,
      external_cagr_pct: 5,
      captured_from: "llm_prior",
      created_by: "pipeline",
    });
    const latest = appendExternalReference(db, {
      industry_id: industryId,
      source_label: "Goldman 2030 전망",
      source_url: "https://example.com/report",
      target_year: 2030,
      external_cagr_pct: 12.5,
      external_size_b: 42,
      captured_from: "user",
      created_by: "analyst",
    });
    expect(latest.external_cagr_pct).toBe(12.5);
    expect(resolveExternalReference(db, industryId)!.source_label).toBe("Goldman 2030 전망");
    const auditsAfter = (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'market_external_reference.set'").get() as { n: number }).n;
    expect(auditsAfter).toBe(auditsBefore + 1);
  });
});

describe("constraint builder + decision flow", () => {
  test("constraint text carries the reference, previous gap, and accepted drivers", () => {
    const text = buildCalibrationConstraints({
      industry: "테스트",
      externalCagrPct: 12.5,
      previousGapPct: 32.9,
      acceptedDrivers: [{ driver: "AI 데이터센터 수요", direction: "upside", impact_pct: 2.5, rationale: "근거" }],
    });
    expect(text).toContain("12.5%");
    expect(text).toContain("32.9%");
    expect(text).toContain("AI 데이터센터 수요");
    expect(text).toContain("잔여 격차");
  });

  test("nothing to inject yields an empty constraint string", () => {
    const text = buildCalibrationConstraints({ industry: "테스트", externalCagrPct: null, previousGapPct: null, acceptedDrivers: [] });
    expect(text).toBe("");
  });

  test("accept then dismiss-decision flow records the decider and audits", () => {
    seedVersion("msv-cal-1");
    db.run(
      `INSERT INTO industry_driver_calibration (id, industry_id, version_id, driver, direction, impact_pct, rationale, status, proposed_by, created_at)
       VALUES ('idc-test-1', ?, 'msv-cal-1', 'AI 데이터센터 수요', 'upside', 2.5, '근거', 'proposed', 'pipeline', ?)`,
      [industryId, NOW],
    );
    const auditsBefore = (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'market_calibration.%'").get() as { n: number }).n;
    const accepted = decideCalibrationDriver(db, "idc-test-1", "accept", "analyst");
    expect(accepted!.status).toBe("accepted");
    expect(accepted!.decided_by).toBe("analyst");
    expect(acceptedCalibrationDrivers(db, industryId).map((d) => d.driver)).toContain("AI 데이터센터 수요");
    const dismissed = decideCalibrationDriver(db, "idc-test-1", "dismiss", "analyst");
    expect(dismissed!.status).toBe("dismissed");
    expect(acceptedCalibrationDrivers(db, industryId).map((d) => d.driver)).not.toContain("AI 데이터센터 수요");
    const auditsAfter = (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'market_calibration.%'").get() as { n: number }).n;
    expect(auditsAfter).toBe(auditsBefore + 2);
  });

  test("unknown row id resolves to null", () => {
    expect(decideCalibrationDriver(db, "idc-missing", "accept", "analyst")).toBeNull();
  });
});
