// Wave B-3 calibration math on synthetic data, plus the golden-set wiring.
import { describe, expect, test } from "bun:test";
import { bootstrapCi, brierScore, calibrate, collectPoints, GRADE_PROBABILITY, mulberry32, runCalibrationSuite, uncappedGrade, type CalibrationPoint } from "../../scripts/eval/calibration.ts";
import { runKillSuite } from "../../scripts/eval/deterministic.ts";
import { loadGoldenSet } from "../../scripts/eval/loader.ts";

const pt = (grade: CalibrationPoint["grade"], favourable: boolean, i = 0): CalibrationPoint => ({ caseId: `s-${i}`, grade, favourable });

describe("calibration math (synthetic)", () => {
  test("Brier score matches a hand computation", () => {
    // (0.8-1)^2 + (0.5-0)^2 + (0.2-0)^2 = 0.04 + 0.25 + 0.04 = 0.33 -> /3 = 0.11
    expect(brierScore([pt("green", true), pt("amber", false), pt("red", false)])).toBeCloseTo(0.11, 10);
    expect(brierScore([])).toBeNull();
  });

  test("a perfectly calibrated synthetic set has observed = predicted per bin", () => {
    const pts: CalibrationPoint[] = [];
    for (let i = 0; i < 10; i++) pts.push(pt("green", i < 8, i), pt("amber", i < 5, i), pt("red", i < 2, i));
    const r = calibrate(pts, 500);
    for (const row of r.reliability) expect(row.observed).toBeCloseTo(GRADE_PROBABILITY[row.grade], 10);
    // Brier of a calibrated forecast equals mean p(1-p): (0.16 + 0.25 + 0.16) / 3 = 0.19
    expect(r.brier).toBeCloseTo(0.19, 10);
    expect(r.greenOnUnfavourable).toBe(2);
  });

  test("bootstrap interval brackets the statistic, is deterministic, and degenerates at n = 1", () => {
    const pts = Array.from({ length: 20 }, (_, i) => pt("amber", i % 2 === 0, i));
    const rate = (s: CalibrationPoint[]) => s.filter((p) => p.favourable).length / s.length;
    const a = bootstrapCi(pts, rate, 1000);
    expect(a).toEqual(bootstrapCi(pts, rate, 1000));
    expect(a && a[0] < 0.5 && a[1] > 0.5).toBe(true);
    expect(bootstrapCi([pt("red", false)], rate, 100)).toEqual([0, 0]);
    expect(bootstrapCi([], rate)).toBeNull();
  });

  test("empty bins report n = 0 and no observed rate", () => {
    const r = calibrate([pt("red", false)], 100);
    expect(r.reliability.find((x) => x.grade === "green")).toEqual({ grade: "green", n: 0, predicted: 0.8, observed: null, ci: null });
  });

  test("mulberry32 is in [0,1)", () => {
    const r = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v >= 0 && v < 1).toBe(true);
    }
  });

  test("removing the cap lifts an Amber held only by data confidence to Green", () => {
    const dims = ["financial", "market", "regulatory_permit", "technical_execution", "risk"].map((d) => ({ dimension: d, grade: "green" as const, assessed: true }));
    const withDc = [...dims, { dimension: "data_confidence", grade: "amber" as const, assessed: true }];
    expect(uncappedGrade(withDc, false, "amber")).toBe("green");
    expect(uncappedGrade(withDc, true, "red")).toBe("red");
    expect(uncappedGrade([...dims.slice(1), { dimension: "financial", grade: "amber" as const, assessed: true }, { dimension: "data_confidence", grade: "amber" as const, assessed: true }], false, "amber")).toBe("amber");
    expect(uncappedGrade(dims, false, "amber")).toBe("amber");
  });
});

describe("calibration on the golden set", () => {
  const set = loadGoldenSet();

  test("only pilot 010 is outcome-calibratable from pre-decision inputs (reference track)", () => {
    const t = collectPoints(set);
    expect(t.reference).toEqual([{ caseId: "pilot-010", grade: "red", favourable: false }]);
    expect(t.engineCapped.length).toBe(t.engineUncapped.length);
  });

  test("suite reports metrics and the small-n statement", () => {
    const r = runCalibrationSuite(set);
    expect(r.metrics.n_reference).toBe(1);
    expect(r.metrics.brier_reference).toBeCloseTo(0.04, 10);
    expect(r.detail?.join("\n")).toContain("Insufficient for weight changes");
  });

  test("pilot-008 kill expectation is a known disagreement, not scored", () => {
    const k = runKillSuite(set);
    expect(k.cases.some((c) => c.caseId === "pilot-008")).toBe(false);
    expect(k.couldNotEvaluate.some((c) => c.caseId === "pilot-008" && c.reason.includes("docs/audits/2026-10-08-pilot-008"))).toBe(true);
  });
});
