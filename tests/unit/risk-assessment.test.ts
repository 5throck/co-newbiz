// 리스크 히트맵 사람 판정 오버라이드 (2026-10-19) — 사이드카 파싱·검증·병합.
// likelihood 하드코딩 2를 사람 판정으로 대체하는 슬라이스의 규칙 고정.
import { test, expect, describe } from "bun:test";
import {
  mergeRiskAssessment,
  parseRiskAssessment,
  serializeRiskAssessment,
  validateRiskAssessmentInput,
  RiskAssessmentValidationError,
} from "../../app/web-next/lib/risk-assessment.ts";

describe("risk-assessment overrides", () => {
  test("validate: dd/coc/inc keys and 1..3 levels pass; bad keys/levels are rejected", () => {
    expect(validateRiskAssessmentInput({ key: "dd:01ABC", likelihood: 2, impact: 3 })).toMatchObject({ key: "dd:01ABC", likelihood: 2, impact: 3 });
    expect(validateRiskAssessmentInput({ key: "coc:01X", likelihood: 1, impact: 1 })).toMatchObject({ key: "coc:01X", likelihood: 1, impact: 1 });
    expect(() => validateRiskAssessmentInput({ key: "zzz:01X", likelihood: 2, impact: 2 })).toThrow(RiskAssessmentValidationError);
    expect(() => validateRiskAssessmentInput({ key: "dd:01ABC", likelihood: 0, impact: 2 })).toThrow(RiskAssessmentValidationError);
    expect(() => validateRiskAssessmentInput({ key: "dd:01ABC", likelihood: 4, impact: 2 })).toThrow(RiskAssessmentValidationError);
    expect(() => validateRiskAssessmentInput({ key: "dd:01ABC", likelihood: 2, impact: 5 })).toThrow(RiskAssessmentValidationError);
  });

  test("parse: tolerates malformed JSON and non-1..3 levels (skips, never throws)", () => {
    expect(parseRiskAssessment(null)).toEqual({});
    expect(parseRiskAssessment("not json")).toEqual({});
    const raw = serializeRiskAssessment({ "dd:01A": { likelihood: 3, impact: 1, by: "u", at: "t" } });
    expect(parseRiskAssessment(raw)).toMatchObject({ "dd:01A": { likelihood: 3, impact: 1 } });
  });

  test("merge: latest wins per key without disturbing others", () => {
    const base = mergeRiskAssessment({}, "dd:01A", 2, 3, "u", "t0");
    const merged = mergeRiskAssessment(base, "coc:01B", 1, 1, "u", "t1");
    expect(Object.keys(merged).sort()).toEqual(["coc:01B", "dd:01A"]);
    const again = mergeRiskAssessment(merged, "dd:01A", 1, 1, "u", "t2");
    expect(again["dd:01A"]).toMatchObject({ likelihood: 1, impact: 1 });
    expect(again["coc:01B"]).toMatchObject({ likelihood: 1, impact: 1 });
  });
});
