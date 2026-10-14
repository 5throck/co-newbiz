import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildModeBody, MODE_LABEL, MODE_NOT_CHOSEN_NOTICE, modeBadgeText, modeErrorText, modeEventSummary, modeOptions, s11Title,
  stripBusinessUnitForm, suggestionText, titleFor, validateModeChange, visibleHistorySteps, withBusinessUnitForm,
} from "../../app/web-next/lib/establishment-mode-view.ts";
import { localizeRequirement } from "../../app/web-next/lib/labels.ts";

describe("establishment-mode-view (ADR-0167)", () => {
  test("labels and S11 titles", () => {
    expect(MODE_LABEL).toEqual({ new_entity: "신규 법인 설립", business_unit: "신규 사업부 추진" });
    expect(s11Title("new_entity")).toBe("설립 실행 — 5단계 (신규 법인 설립)");
    expect(s11Title("business_unit")).toBe("사업부 신설 실행 — 5단계 (신규 사업부 추진)");
    expect(s11Title(null)).toBe("설립 실행 — 5단계");
    expect(modeBadgeText("business_unit")).toBe("설립 방식: 신규 사업부 추진");
    expect(modeBadgeText(null)).toBe("설립 방식 미정");
  });

  test("business_unit is disabled with a reason unless the server allows it", () => {
    const joint = modeOptions({ allowed_modes: ["new_entity"] }, "joint");
    expect(joint.find((o) => o.value === "new_entity")!.disabled).toBe(false);
    const bu = joint.find((o) => o.value === "business_unit")!;
    expect(bu.disabled).toBe(true);
    expect(bu.disabledReason).toContain("내부 추진");
    const internal = modeOptions({ allowed_modes: ["new_entity", "business_unit"] }, "internal");
    expect(internal.every((o) => !o.disabled && o.disabledReason === null)).toBe(true);
  });

  test("first choice needs no reason, a change needs 10+ chars, same value is refused", () => {
    expect(validateModeChange(null, null, "")).toContain("선택");
    expect(validateModeChange(null, "new_entity", "")).toBeNull();
    expect(validateModeChange("new_entity", "new_entity", "충분히 긴 사유입니다 열자")).toContain("같습니다");
    expect(validateModeChange("new_entity", "business_unit", "짧음")).toContain("10자");
    expect(validateModeChange("new_entity", "business_unit", " 가".repeat(2001))).toContain("2000자");
    expect(validateModeChange("new_entity", "business_unit", "사업부로 추진하기로 결정함")).toBeNull();
  });

  test("PUT body carries a reason only when changing", () => {
    expect(buildModeBody(null, "new_entity", "무시됨")).toEqual({ mode: "new_entity" });
    expect(buildModeBody("new_entity", "business_unit", "  사유 사유 사유 사유  ")).toEqual({ mode: "business_unit", reason: "사유 사유 사유 사유" });
  });

  test("API error codes map to plain Korean; unknown codes keep the server message", () => {
    for (const c of ["not_applicable", "mode_not_allowed", "reason_required", "human_only", "role_required", "invalid_request", "mode_not_chosen", "mode_mismatch"]) {
      const t = modeErrorText(c, "fallback");
      expect(t).not.toBe("fallback");
      expect(/[가-힣]/.test(t)).toBe(true);
      expect(t).not.toMatch(/establishment mode|ADR-/i);
    }
    expect(modeErrorText("zzz", "서버 문구")).toBe("서버 문구");
    expect(modeErrorText(undefined, "서버 문구")).toBe("서버 문구");
  });

  test("history summary and suggestion text", () => {
    expect(modeEventSummary({ kind: "set", from_mode: null, to_mode: "new_entity" })).toBe("설립 방식 확정 → 신규 법인 설립");
    expect(modeEventSummary({ kind: "change", from_mode: "new_entity", to_mode: "business_unit" })).toBe("설립 방식 변경 신규 법인 설립 → 신규 사업부 추진");
    expect(suggestionText(null)).toBeNull();
    expect(suggestionText("business_unit")).toContain("확정된 값이 아닙니다");
  });

  test("business-unit form is a reversible prefix on the generic note", () => {
    expect(withBusinessUnitForm("", "cic")).toBe("사업부 신설 형태: 사내 독립 기업(CIC)");
    expect(withBusinessUnitForm("연 매출 기준", "independent_unit")).toBe("사업부 신설 형태: 독립 사업부 / 연 매출 기준");
    expect(withBusinessUnitForm("연 매출 기준", "")).toBe("연 매출 기준");
    expect(stripBusinessUnitForm(withBusinessUnitForm("메모", "cic"))).toBe("메모");
    expect(withBusinessUnitForm(withBusinessUnitForm("메모", "cic"), "team_in_unit")).toBe("사업부 신설 형태: 기존 사업부 내 팀 / 메모");
  });

  test("previous-mode history hides pending rows and titles come from the API payload", () => {
    const rows = [
      { mode: "new_entity", step_no: 2, status: "done" }, { mode: "new_entity", step_no: 1, status: "done" }, { mode: "new_entity", step_no: 3, status: "pending" },
    ];
    expect(visibleHistorySteps(rows).map((r) => r.step_no)).toEqual([1, 2]);
    expect(visibleHistorySteps(null)).toEqual([]);
    expect(titleFor({ new_entity: { "1": "설립준비" } }, "new_entity", 1)).toBe("설립준비");
    expect(titleFor(undefined, "new_entity", 4)).toBe("4단계");
  });

  test("no English 'establishment mode not chosen' reaches users", () => {
    expect(MODE_NOT_CHOSEN_NOTICE).toBe("설립 방식이 아직 정해지지 않았습니다 — S10에서 설립 방식을 확정해야 설립 실행 단계를 기록할 수 있습니다");
    const blocker = "설립 방식 미선택 (establishment mode not chosen) — S10에서 사람이 신규 법인 설립 또는 신규 사업부 추진을 선택해야 합니다";
    expect(localizeRequirement(blocker)).not.toMatch(/establishment mode/i);
    expect(localizeRequirement(blocker)).toContain("설립 방식 미선택");
    expect(localizeRequirement("설립 방식이 아직 정해지지 않았습니다. S10에서 설립 방식을 확정해야 합니다.")).toContain("정해지지 않았습니다");
    expect(localizeRequirement("설립 방식 (establishment mode not chosen, ADR-0167)")).not.toMatch(/establishment/i);
    for (const f of [
      "app/web-next/lib/establishment-mode-view.ts",
      "app/web-next/components/stages/EstablishmentModePanel.tsx",
      "app/web-next/components/stages/EstablishmentPanel.tsx",
    ]) expect(readFileSync(f, "utf8")).not.toMatch(/establishment mode not chosen/i);
  });

  test("S11 panel renders titles from the API and no longer from a constant table", () => {
    const src = readFileSync("app/web-next/components/stages/EstablishmentPanel.tsx", "utf8");
    expect(src).toContain("est?.step_titles");
    expect(src).not.toContain("{STEP_TITLES[n]}");
    expect(src).toContain("MODE_NOT_CHOSEN_NOTICE");
    expect(src).toContain("deal-structure");
  });
});
