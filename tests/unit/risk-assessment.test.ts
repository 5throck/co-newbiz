// 리스크 히트맵 사람 판정 입력 검증 (2026-10-19 / 2026-10-21 원장 전환).
// 저장·최신값·이력은 risk_assessment_ledger를 쓰는 s9-depth-routes.test.ts가 고정한다.
import { test, expect, describe } from "bun:test";
import { validateRiskAssessmentInput, RiskAssessmentValidationError, MITIGATION_MAX_LENGTH } from "../../app/web-next/lib/risk-assessment.ts";

describe("risk-assessment input validation", () => {
  test("validate: dd/coc/inc/cov keys and 1..3 levels pass; bad keys/levels are rejected", () => {
    expect(validateRiskAssessmentInput({ key: "dd:01ABC", likelihood: 2, impact: 3 })).toMatchObject({ key: "dd:01ABC", likelihood: 2, impact: 3, mitigation: null });
    expect(validateRiskAssessmentInput({ key: "coc:01X", likelihood: 1, impact: 1 })).toMatchObject({ key: "coc:01X", likelihood: 1, impact: 1 });
    expect(validateRiskAssessmentInput({ key: "cov:dscr", likelihood: 3, impact: 2 })).toMatchObject({ key: "cov:dscr" });
    expect(() => validateRiskAssessmentInput({ key: "zzz:01X", likelihood: 2, impact: 2 })).toThrow(RiskAssessmentValidationError);
    expect(() => validateRiskAssessmentInput({ key: "dd:01ABC", likelihood: 0, impact: 2 })).toThrow(RiskAssessmentValidationError);
    expect(() => validateRiskAssessmentInput({ key: "dd:01ABC", likelihood: 4, impact: 2 })).toThrow(RiskAssessmentValidationError);
    expect(() => validateRiskAssessmentInput({ key: "dd:01ABC", likelihood: 2, impact: 5 })).toThrow(RiskAssessmentValidationError);
  });

  test("mitigation: trimmed, empty → null, over the limit rejected, non-string rejected", () => {
    expect(validateRiskAssessmentInput({ key: "dd:1", likelihood: 1, impact: 1, mitigation: "  보증보험  " }).mitigation).toBe("보증보험");
    expect(validateRiskAssessmentInput({ key: "dd:1", likelihood: 1, impact: 1, mitigation: "   " }).mitigation).toBeNull();
    expect(() => validateRiskAssessmentInput({ key: "dd:1", likelihood: 1, impact: 1, mitigation: "x".repeat(MITIGATION_MAX_LENGTH + 1) })).toThrow(RiskAssessmentValidationError);
    expect(() => validateRiskAssessmentInput({ key: "dd:1", likelihood: 1, impact: 1, mitigation: 42 })).toThrow(RiskAssessmentValidationError);
  });
});
