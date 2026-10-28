// @version 1.0.0
/**
 * @co-newbiz/core-scoring package tests — pure functions only, plus
 * property-style cases for the data-confidence cap (boundary #4):
 *   - a recorded grade never exceeds the data-confidence ceiling;
 *   - an incomplete assessment is never graded (overall null) unless a
 *     Red / Kill Criteria signal forces Red.
 * Cases are generated from a seeded PRNG and exhaustive enumeration, so the
 * suite is deterministic.
 */
import { describe, expect, test } from "bun:test";
import {
  applyConfidenceCeiling,
  applyProxyChain,
  computeOverall,
  confidenceCeilingOf,
  convertBetweenUnits,
  evaluateRag,
  gradeChain,
  gradeDataConfidence,
  gradeFromHops,
  KILL_ACTIONS,
  parsePredicate,
  evaluatePredicate,
  RAG_DIMENSIONS,
  RAG_GRADE_ORDER,
  type ConfidenceGrade,
  type RagDimension,
  type RagEvaluationInput,
  type RagGrade,
  type StageGate,
  validateRegistryEntry,
  buildLookup,
  worseGrade,
} from "../src/index.ts";

const GRADES: RagGrade[] = ["green", "amber", "red"];
const CHAIN: Array<"A" | "B" | "C"> = ["A", "B", "C"];
const GATES: StageGate[] = ["screening", "pre_fs", "fs", "dd", "entity_ic", "group_ic"];

/** mulberry32 — small deterministic PRNG for property-style generation. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T;
}
function maybe<T>(r: () => number, v: () => T): T | undefined {
  return r() < 0.75 ? v() : undefined;
}

function randomInput(r: () => number): RagEvaluationInput {
  return {
    stageGate: pick(r, GATES),
    chainGrade: maybe(r, () => pick(r, CHAIN)),
    stalenessViolated: r() < 0.1,
    financial: maybe(r, () => ({ irr: r() * 0.3, hurdle: 0.08 + r() * 0.05, dscrDownside: 0.8 + r() * 1.2 })),
    regulatory: maybe(r, () => ({ remedyType: pick(r, ["none", "behavioral", "structural", "prohibited"] as const) })),
    marketGrade: maybe(r, () => pick(r, GRADES)),
    technicalGrade: maybe(r, () => pick(r, GRADES)),
    riskGrade: maybe(r, () => pick(r, GRADES)),
    killCriteriaTriggered: r() < 0.05,
  };
}

describe("confidence cap — property-style", () => {
  test("applyConfidenceCeiling never exceeds the ceiling nor raises the grade (exhaustive)", () => {
    for (const g of GRADES) {
      for (const c of [...GRADES, null, undefined]) {
        const out = applyConfidenceCeiling(g, c);
        expect(RAG_GRADE_ORDER[out.grade]).toBeLessThanOrEqual(RAG_GRADE_ORDER[g]);
        if (c) expect(RAG_GRADE_ORDER[out.grade]).toBeLessThanOrEqual(RAG_GRADE_ORDER[c]);
        expect(out.capNote === "").toBe(out.grade === g);
      }
    }
  });

  test("computeOverall never exceeds the data_confidence dimension (exhaustive 3^6 x kill)", () => {
    const dims = RAG_DIMENSIONS;
    const total = GRADES.length ** dims.length;
    for (let i = 0; i < total; i++) {
      const rec = {} as Record<RagDimension, RagGrade>;
      let n = i;
      for (const d of dims) {
        rec[d] = GRADES[n % 3] as RagGrade;
        n = Math.floor(n / 3);
      }
      for (const kill of [false, true]) {
        const o = computeOverall(rec, kill);
        expect(RAG_GRADE_ORDER[o.grade]).toBeLessThanOrEqual(RAG_GRADE_ORDER[rec.data_confidence]);
        if (kill) expect(o.grade).toBe("red");
      }
    }
  });

  test("evaluateRag: graded overall <= ceiling; incomplete is never graded unless forced Red (2000 seeded cases)", () => {
    const r = prng(20261008);
    let incompleteSeen = 0;
    for (let i = 0; i < 2000; i++) {
      const ev = evaluateRag(randomInput(r));
      const ceiling = confidenceCeilingOf(ev);
      if (ev.overall && ceiling) {
        expect(RAG_GRADE_ORDER[ev.overall.grade]).toBeLessThanOrEqual(RAG_GRADE_ORDER[ceiling]);
        expect(RAG_GRADE_ORDER[applyConfidenceCeiling(ev.overall.grade, ceiling).grade]).toBeLessThanOrEqual(
          RAG_GRADE_ORDER[ceiling],
        );
      }
      if (!ev.complete) {
        incompleteSeen++;
        if (ev.overall !== null) expect(ev.overall.grade).toBe("red");
      }
    }
    expect(incompleteSeen).toBeGreaterThan(0);
  });

  test("an assessment missing any one input is never graded green/amber", () => {
    const full: RagEvaluationInput = {
      stageGate: "fs",
      chainGrade: "A",
      financial: { irr: 0.2, hurdle: 0.1, dscrDownside: 2 },
      regulatory: { remedyType: "none" },
      marketGrade: "green",
      technicalGrade: "green",
      riskGrade: "green",
    };
    expect(evaluateRag(full).overall?.grade).toBe("green");
    for (const k of ["chainGrade", "financial", "regulatory", "marketGrade", "technicalGrade", "riskGrade"] as const) {
      const partial = { ...full, [k]: undefined };
      const ev = evaluateRag(partial);
      expect(ev.complete).toBe(false);
      expect(ev.overall).toBeNull();
    }
  });

  test("gradeDataConfidence never beats its provenance cap (seeded)", () => {
    const r = prng(7);
    const order: Record<ConfidenceGrade, number> = { A: 3, B: 2, U: 1, C: 0 };
    for (let i = 0; i < 1000; i++) {
      const provenance = pick(r, ["frozen-research", "llm-estimate", null, undefined]);
      const synthesized = r() < 0.2;
      const stat = Math.floor(r() * 4);
      const minR2 = r() < 0.2 ? null : r();
      const out = gradeDataConfidence({ chainHops: stat + 1, statisticalHops: stat, minR2, provenance, synthesized });
      const cap: ConfidenceGrade = synthesized ? "C" : provenance === "frozen-research" ? "A" : "B";
      expect(order[out.grade]).toBeLessThanOrEqual(order[cap]);
      expect(out.grade).toBe(worseGrade(gradeFromHops(stat, minR2), cap));
    }
  });
});

describe("pure helpers", () => {
  test("gradeChain: statistical hop count drives the grade", () => {
    expect(gradeChain([{ hopType: "engineering", betaOrCoefficient: 2 }]).grade).toBe("A");
    expect(gradeChain([{ hopType: "statistical", r2: 0.7, betaOrCoefficient: 1.1 }]).grade).toBe("B");
  });

  test("unit conversion refuses cross-dimension and scales via SI", () => {
    const krw100m = { code: "krw_100m", dimension: "krw", siCoefficient: 1e8 };
    const krw1t = { code: "krw_1t", dimension: "krw", siCoefficient: 1e12 };
    expect(convertBetweenUnits(10000, krw100m, krw1t)).toBe(1);
    expect(() => convertBetweenUnits(1, krw100m, { code: "ton", dimension: "mass", siCoefficient: 1000 })).toThrow(/cross-dimension/);
  });

  test("applyProxyChain multiplies factors and scales the CI band", () => {
    const out = applyProxyChain(
      10,
      [
        { id: "h1", hopType: "engineering", beta: null, coefficient: 2 },
        { id: "h2", hopType: "statistical", beta: 1.5, coefficient: null },
      ],
      0.8,
      null,
    );
    expect(out).toEqual({ converted: 30, ciLow: 8, ciHigh: 10 });
    expect(() => applyProxyChain(1, [{ id: "bad", hopType: "statistical", beta: null, coefficient: 3 }], null, null)).toThrow(/no usable factor/);
  });

  test("kill-criteria registry validation and snapshot lookup", () => {
    expect(KILL_ACTIONS).toContain("halt");
    const base = { procedure: "p", criterion_id: "c", action: "halt", predicate: null, enabled: true, policy_id: "POL", thresholds_source: "src" };
    expect(() => validateRegistryEntry(base)).not.toThrow();
    expect(() => validateRegistryEntry({ ...base, action: "hault" })).toThrow(/actions vocabulary/);
    expect(() => validateRegistryEntry({ ...base, policy_id: null })).toThrow(/policy_id/);
    const lookup = buildLookup([
      { var_key: "x", value_num: 5, value_text: null, status: "present" },
      { var_key: "y", value_num: null, value_text: null, status: "low_confidence" },
    ]);
    expect(lookup("x")).toEqual({ status: "present", value: 5 });
    expect(lookup("y")).toEqual({ status: "missing" });
    expect(lookup("z")).toBeUndefined();
    expect(typeof evaluatePredicate).toBe("function");
    expect(typeof parsePredicate).toBe("function");
  });
});
