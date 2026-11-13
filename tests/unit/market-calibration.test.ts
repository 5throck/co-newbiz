/**
 * Unit tests for the S1 growth-gap calibration loop (design
 * 2026-09-18-s1-growth-gap-calibration; goal-line unification design
 * 2026-11-13-calibration-loop-convergence §3.1): trigger math on the relative
 * CAGR gap with the unified 15% convergence goal line (trigger = unconverged;
 * boundary pinned at 14.9 / 15.0), external-reference resolution order,
 * constraint building, and the accept/dismiss decision flow with audit —
 * lib-level against real scratch SQLite (the tables come from migration 0113).
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
  insertExclusionProposal,
  isCalibrationTriggered,
  relativeCagrGapPct,
  resolveExternalReference,
  CONVERGENCE_GOAL_PCT,
  EXCLUSION_NOISE_BAND_PCT,
  EXCLUSION_PROPOSAL_BY,
} = await import("../../app/web-next/lib/market-calibration.ts");
const { runCalibrationSweep } = await import("../../app/web-next/lib/calibration-sweep.ts");

const NOW = new Date().toISOString();
let industryId: string;

beforeAll(() => {
  industryId = `ind-${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [
    industryId,
    "99001",
    "보정테스트 산업",
    "calibration-test",
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

function seedVersion(id: string): void {
  // FK 순서 — market_sizing_version은 분석 행을 참조하므로 분석을 먼저 시드한다.
  db.run(
    "INSERT OR IGNORE INTO market_sizing_analysis (id, industry_id, status, created_by, created_at, completed_at) VALUES (?,?,?,?,?,?)",
    ["msa-cal", industryId, "completed", "test", NOW, NOW],
  );
  // version_no는 UNIQUE(analysis_id, version_no)라 시드마다 MAX+1로 올린다 —
  // 제외 제안 교체 주기 테스트가 여러 버전을 시드한다.
  const next =
    ((
      db.query("SELECT MAX(version_no) m FROM market_sizing_version WHERE analysis_id = 'msa-cal'").get() as {
        m: number | null;
      }
    ).m ?? 0) + 1;
  db.run(
    `INSERT INTO market_sizing_version (id, analysis_id, version_no, payload, created_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [id, "msa-cal", next, "{}", "test", NOW],
  );
}

describe("trigger math (relative CAGR gap)", () => {
  test("relative gap is |our−external|/external", () => {
    expect(relativeCagrGapPct(12, 10)).toBe(20);
    expect(relativeCagrGapPct(8, 10)).toBe(20);
    expect(relativeCagrGapPct(9.4, 10)).toBe(6);
  });

  test("trigger (= unconverged) fires at and above the 15% goal line only", () => {
    expect(CONVERGENCE_GOAL_PCT).toBe(15);
    // gap 15.0 — unconverged: the loop keeps presenting the next action.
    expect(isCalibrationTriggered(12, 10)).toBe(true);
    expect(isCalibrationTriggered(11.5, 10)).toBe(true);
    // gap 14.9 — converged: the loop ends (no proposals, no unconverged badge).
    expect(isCalibrationTriggered(11.49, 10)).toBe(false);
    expect(isCalibrationTriggered(9.4, 10)).toBe(false);
    expect(isCalibrationTriggered(50, 10)).toBe(true);
  });

  test("non-positive external CAGR never triggers", () => {
    expect(relativeCagrGapPct(5, 0)).toBeNull();
    expect(isCalibrationTriggered(5, 0)).toBe(false);
  });
});

describe("external reference resolution", () => {
  test("the newest recorded reference wins and user writes are audited", () => {
    const auditsBefore = (
      db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'market_external_reference.set'").get() as {
        n: number;
      }
    ).n;
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
    const auditsAfter = (
      db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'market_external_reference.set'").get() as {
        n: number;
      }
    ).n;
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
    const text = buildCalibrationConstraints({
      industry: "테스트",
      externalCagrPct: null,
      previousGapPct: null,
      acceptedDrivers: [],
    });
    expect(text).toBe("");
  });

  test("accept then dismiss-decision flow records the decider and audits", () => {
    seedVersion("msv-cal-1");
    db.run(
      `INSERT INTO industry_driver_calibration (id, industry_id, version_id, driver, direction, impact_pct, rationale, status, proposed_by, created_at)
       VALUES ('idc-test-1', ?, 'msv-cal-1', 'AI 데이터센터 수요', 'upside', 2.5, '근거', 'proposed', 'pipeline', ?)`,
      [industryId, NOW],
    );
    const auditsBefore = (
      db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'market_calibration.%'").get() as { n: number }
    ).n;
    const accepted = decideCalibrationDriver(db, "idc-test-1", "accept", "analyst");
    expect(accepted!.status).toBe("accepted");
    expect(accepted!.decided_by).toBe("analyst");
    expect(acceptedCalibrationDrivers(db, industryId).map((d) => d.driver)).toContain("AI 데이터센터 수요");
    const dismissed = decideCalibrationDriver(db, "idc-test-1", "dismiss", "analyst");
    expect(dismissed!.status).toBe("dismissed");
    expect(acceptedCalibrationDrivers(db, industryId).map((d) => d.driver)).not.toContain("AI 데이터센터 수요");
    const auditsAfter = (
      db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'market_calibration.%'").get() as { n: number }
    ).n;
    expect(auditsAfter).toBe(auditsBefore + 2);
  });

  test("unknown row id resolves to null", () => {
    expect(decideCalibrationDriver(db, "idc-missing", "accept", "analyst")).toBeNull();
  });
});

// Amendment 2026-11-13a — the pipeline-run sweep injected into the constraints
// as a PROMPT-LEVEL SOFT CONSTRAINT (AC 11–13 lib level; the pipeline wiring is
// pinned by the sizing-matrix-guard suite's real pipeline runs).
describe("constraint builder — Monte Carlo sweep injection (amendment 2026-11-13a)", () => {
  const sweepView = {
    feasibleRatio: 0.123,
    goalPct: CONVERGENCE_GOAL_PCT,
    p50GapPct: 34.2,
    p90GapPct: 88.7,
    sampleCount: 20000,
    topDrivers: [
      { driver: "AI 데이터센터 수요", p50: 12.3 },
      { driver: "전방 수요 확대", p50: 6.1 },
      { driver: "규제 완화", p50: 2.0 },
    ],
  };
  const baseInput = {
    industry: "테스트",
    externalCagrPct: 10,
    previousGapPct: 30,
    acceptedDrivers: [{ driver: "AI 데이터센터 수요", direction: "upside", impact_pct: 2.5, rationale: "근거" }],
  };

  test("AC-11 — unconverged + sweep view injects the soft-constraint block with goal line, gap quantiles, top contributors, guidance", () => {
    const text = buildCalibrationConstraints({ ...baseInput, sweepView });
    expect(text).toContain("몬테카를로 스윕");
    expect(text).toContain("12.3%가 15%선 이내 수렴 가능");
    expect(text).toContain("격차 P50 34.2% / P90 88.7%");
    expect(text).toContain("상위 기여 드라이버: AI 데이터센터 수요 기여 P50 ±12.3%p");
    expect(text).toContain("셀별 CAGR 산출에 우선 반영");
  });

  test("AC-12 — no sweep view (converged or no drivers) → no sweep block at all", () => {
    const text = buildCalibrationConstraints(baseInput);
    expect(text).not.toContain("몬테카를로");
    expect(text).not.toContain("상위 기여 드라이버");
  });

  test("AC-13 — identical inputs produce an identical constraint string (determinism)", () => {
    const a = buildCalibrationConstraints({ ...baseInput, sweepView });
    const b = buildCalibrationConstraints({ ...baseInput, sweepView });
    expect(a).toBe(b);
  });

  test("an empty topDrivers list still injects the ratio/quantile lines without the contributor line", () => {
    const text = buildCalibrationConstraints({ ...baseInput, sweepView: { ...sweepView, topDrivers: [] } });
    expect(text).toContain("몬테카를로 스윕");
    expect(text).not.toContain("상위 기여 드라이버");
  });
});

// Amendment 2026-11-13b — driver exclusion PROPOSAL mechanism. The pipeline
// proposes, a person confirms via the dismiss flow; nothing auto-excludes.
describe("driver exclusion mechanism (amendment 2026-11-13b)", () => {
  function insertDriverRow(id: string, versionId: string, driver: string, status: string, proposedBy: string): void {
    db.run(
      `INSERT INTO industry_driver_calibration (id, industry_id, version_id, driver, direction, impact_pct, rationale, status, proposed_by, decided_by, decided_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        industryId,
        versionId,
        driver,
        "upside",
        2.5,
        "근거",
        status,
        proposedBy,
        status === "accepted" ? "analyst" : null,
        status === "accepted" ? NOW : null,
        NOW,
      ],
    );
  }

  test("the noise band pins the observed same-input drift (10.6→10.3 ≈ 0.3pp) with headroom", () => {
    expect(EXCLUSION_NOISE_BAND_PCT).toBe(3);
  });

  test("insertExclusionProposal replaces the previous OPEN exclusion proposal — one live row, newest evidence", () => {
    seedVersion("msv-exc-1");
    seedVersion("msv-exc-2");
    insertExclusionProposal(db, {
      industryId,
      versionId: "msv-exc-1",
      driver: "과도한 상승 가정",
      direction: "upside",
      impact_pct: 45,
      rationale: "1차 근거",
    });
    const second = insertExclusionProposal(db, {
      industryId,
      versionId: "msv-exc-2",
      driver: "소폭 수요 상승",
      direction: "upside",
      impact_pct: 5,
      rationale: "2차 근거",
    });
    const rows = db
      .query(
        "SELECT * FROM industry_driver_calibration WHERE industry_id = ? AND proposed_by = ? AND status = 'proposed'",
      )
      .all(industryId, EXCLUSION_PROPOSAL_BY) as Array<{ id: string; version_id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(second.id);
    expect(rows[0].version_id).toBe("msv-exc-2");
  });

  test("a person-confirmed exclusion removes the driver from the accepted set — a proposed exclusion and a dismissed NORMAL proposal do not", () => {
    seedVersion("msv-exc-3");
    insertDriverRow("idc-exc-a", "msv-exc-3", "과도한 상승 가정", "accepted", "pipeline");
    insertDriverRow("idc-exc-b", "msv-exc-3", "소폭 수요 상승", "accepted", "pipeline");
    const names = () => acceptedCalibrationDrivers(db, industryId).map((d) => d.driver);
    expect(names()).toContain("과도한 상승 가정");
    expect(names()).toContain("소폭 수요 상승");
    // A merely PROPOSED exclusion binds nobody (R6 — proposal only).
    const proposal = insertExclusionProposal(db, {
      industryId,
      versionId: "msv-exc-3",
      driver: "과도한 상승 가정",
      direction: "upside",
      impact_pct: 45,
      rationale: "제외 근거",
    });
    expect(names()).toContain("과도한 상승 가정");
    // A dismissed NORMAL attribution proposal sharing the name must NOT exclude
    // the accepted driver (row kinds are distinguished by the proposed_by marker).
    insertDriverRow("idc-exc-n", "msv-exc-3", "소폭 수요 상승", "proposed", "market-sizing-pipeline");
    decideCalibrationDriver(db, "idc-exc-n", "dismiss", "analyst");
    expect(names()).toContain("소폭 수요 상승");
    // The person confirms the exclusion via the dismiss flow — decided_by is the person.
    const decided = decideCalibrationDriver(db, proposal.id, "dismiss", "analyst-1");
    expect(decided!.status).toBe("dismissed");
    expect(decided!.decided_by).toBe("analyst-1");
    expect(names()).not.toContain("과도한 상승 가정");
    expect(names()).toContain("소폭 수요 상승");
  });

  test("accept on an exclusion proposal is forbidden (dismiss-only — accepting would re-admit the excluded driver)", () => {
    seedVersion("msv-exc-4");
    const proposal = insertExclusionProposal(db, {
      industryId,
      versionId: "msv-exc-4",
      driver: "제외 수용 금지 드라이버",
      direction: "upside",
      impact_pct: 9,
      rationale: "근거",
    });
    expect(() => decideCalibrationDriver(db, proposal.id, "accept", "analyst")).toThrow();
    // The row stays open — nothing changed.
    const row = db.query("SELECT status FROM industry_driver_calibration WHERE id = ?").get(proposal.id) as {
      status: string;
    };
    expect(row.status).toBe("proposed");
  });
});

// AC-9 (design §5) — the sweep stays the loop's planning tool on the unified
// goal line: feasible_ratio measured against 15, verdict messages carry no
// escalation suggestion (the ×0.85 escalation they used to suggest is gone).
describe("calibration sweep on the unified goal line (AC-9)", () => {
  test("convergence_target_pct is the goal line, external_source is carried, and the infeasible message suggests no escalation", () => {
    seedVersion("msv-sweep-1");
    const view = runCalibrationSweep(db, {
      industryId,
      ourCagrPct: 5,
      externalCagrPct: 10,
      externalSourceLabel: "스윕 테스트 출처",
      drivers: [{ driver: "과대 상승 가정", direction: "upside", impact_pct: 45 }],
      createdBy: "test",
    });
    expect(view.convergence_target_pct).toBe(CONVERGENCE_GOAL_PCT);
    expect(view.convergence_target_pct).toBe(15);
    expect(view.external_source).toBe("스윕 테스트 출처");
    // The driver's impact ±50% cannot land the calibrated CAGR near the 10%
    // reference — no combination reaches the goal line.
    expect(view.verdict).toBe("infeasible");
    expect(view.feasible_ratio).toBe(0);
    expect(view.message).toContain("목표선 도달이 어렵습니다");
    expect(view.message).not.toContain("에스컬레이션");
  });

  test("the feasible message names the goal line and suggests no escalation either", () => {
    seedVersion("msv-sweep-2");
    const view = runCalibrationSweep(db, {
      industryId,
      ourCagrPct: 5,
      externalCagrPct: 10,
      externalSourceLabel: null,
      drivers: [{ driver: "소폭 수요 상승", direction: "upside", impact_pct: 5 }],
      createdBy: "test",
    });
    expect(view.verdict).toBe("feasible");
    expect(view.feasible_ratio).toBeGreaterThanOrEqual(0.05);
    expect(view.message).toContain(`목표선(${CONVERGENCE_GOAL_PCT}%)`);
    expect(view.message).not.toContain("에스컬레이션");
  });
});
