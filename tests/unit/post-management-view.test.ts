// @version 1.0.0
// ADR-0161 Row 3: S12 post-management view helpers, PMI guard wiring and key-talent label fix.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GOAL_JUDGEMENT_LABEL, GREENFIELD_TRANSITION_HELP, KEY_TALENT_STATUS_LABEL, TRANSITION_DECISION_LABEL, VENTURE_CLASS_LABEL,
} from "../../app/web-next/lib/labels.ts";
import {
  applicableItems, bpToPercent, goalJudgementMeta, goalJudgementText, migrationFormState, migrationPreview, pmiErrorText, retentionText,
  validateMigrationNote, ventureClassText, type PostManagementApplicability,
} from "../../app/web-next/lib/post-management-view.ts";
import { STAGE_TAB_GROUPS, stageTabGroupsFor } from "../../app/web-next/lib/stage-tabs.ts";

const W = "./app/web-next";
const src = (p: string) => readFileSync(`${W}/${p}`, "utf8");
const app = (over: Partial<PostManagementApplicability> = {}): PostManagementApplicability => ({
  route: { track: "greenfield", sub_track: null, origin: null, case_type: "greenfield", basis: "case_type" },
  portfolio_venture_monitoring: true, integration_monitoring: false, partnership_monitoring: false, pmi_applies: false, blocking: false, ...over,
});

describe("S12 applicable items", () => {
  test("every applicable item is recommended, none blocking", () => {
    const items = applicableItems(app({ integration_monitoring: true, partnership_monitoring: true }));
    expect(items.filter((i) => i.applies).every((i) => i.chip.includes("권장") && i.chip.includes("차단하지 않음"))).toBe(true);
    expect(items.find((i) => i.key === "portfolio_venture_monitoring")?.applies).toBe(true);
  });
  test("non-applicable items say so in text", () => {
    expect(applicableItems(app()).find((i) => i.key === "integration_monitoring")?.chip).toContain("적용 대상 아님");
  });
});

describe("ramp-up reference evidence", () => {
  test("an unjudged goal reads 판정 안 됨 and is neutral", () => {
    expect(goalJudgementText("not_judged")).toBe("판정 안 됨");
    expect(goalJudgementText("whatever")).toBe("판정 안 됨");
    expect(goalJudgementMeta("not_judged").cls).toBe("status-not-started");
    expect(GOAL_JUDGEMENT_LABEL.on_target).toBe("목표 달성");
  });
  test("venture classes have Korean labels for the Q7 defaults", () => {
    for (const k of ["driving", "enabling", "emergent"]) expect(VENTURE_CLASS_LABEL[k]).toContain(k);
    expect(ventureClassText(null)).toBe("—");
  });
  test("greenfield help text exists for exactly the five unchanged transition terms", () => {
    expect(Object.keys(GREENFIELD_TRANSITION_HELP).sort()).toEqual(Object.keys(TRANSITION_DECISION_LABEL).sort());
  });
  test("number helpers", () => {
    expect(bpToPercent(1250)).toBe("12.5%");
    expect(retentionText(null)).toBe("—");
    expect(retentionText(87.5)).toBe("87.5%");
  });
});

describe("key-talent labels use the DB values", () => {
  test("labels cover exactly active | departed_regretted | departed_planned", () => {
    expect(Object.keys(KEY_TALENT_STATUS_LABEL).sort()).toEqual(["active", "departed_planned", "departed_regretted"]);
  });
  test("the PMI page no longer uses retained / exited", () => {
    const page = src("app/projects/[id]/pmi/page.tsx");
    expect(page).not.toContain("retained");
    expect(page).not.toContain("exited");
    expect(page).toContain("departed_regretted");
    expect(page).toContain("departed_planned");
  });
});

describe("PMI guard in the UI", () => {
  test("403 not_applicable_track maps to a Korean explanation", () => {
    expect(pmiErrorText("not_applicable_track", "x", "저장 실패")).toContain("PMI는 인수합병");
    expect(pmiErrorText("other", "서버 메시지", "저장 실패")).toBe("서버 메시지");
    expect(pmiErrorText(undefined, undefined, "저장 실패")).toBe("저장 실패");
  });
  test("PMI page hides write controls and shows the note when PMI does not apply", () => {
    const page = src("app/projects/[id]/pmi/page.tsx");
    expect(page).toContain("pmiApplies !== false");
    expect(page).toContain("pmi-not-applicable");
  });
  test("StageTabs wires stageTabGroupsFor({pmiApplies}) and fetches applicability for S12", () => {
    const tabs = src("components/StageTabs.tsx");
    expect(tabs).toContain("stageTabGroupsFor({ pmiApplies: false })");
    expect(tabs).toContain("/post-management");
    expect(tabs).toContain('baseGroup?.stage === "S12"');
  });
  test("tab map: PMI is removed when it does not apply and untouched when it does", () => {
    const hidden = stageTabGroupsFor({ pmiApplies: false });
    expect(hidden.flatMap((g) => [...g.tabs, ...g.more]).some((t) => t.seg === "/pmi")).toBe(false);
    expect(stageTabGroupsFor({ pmiApplies: true })).toBe(STAGE_TAB_GROUPS);
  });
  test("the S12 page and panels never link to the PMI page", () => {
    for (const f of ["components/stages/PortfolioStage.tsx", "components/stages/PostManagementPanel.tsx", "components/stages/PolicyMigrationPanel.tsx"]) {
      expect(src(f)).not.toMatch(/\/pmi["`?]/);
    }
  });
});

describe("policy migration panel", () => {
  const applies = { track: "greenfield", sub_track: null, greenfield_execution_baseline: "applies" as const, portfolio_venture_monitoring: true, integration_monitoring: false, partnership_monitoring: false, pmi_tab: false };
  test("preview says recommended for a completed S11 and blocking-before-confirmation otherwise", () => {
    expect(migrationPreview(applies, ["S11"])[0].text).toContain("권장");
    expect(migrationPreview(applies, [])[0].text).toContain("차단");
    expect(migrationPreview(applies, [])[4].text).toContain("삭제되지 않음");
  });
  test("note is required and limited", () => {
    expect(validateMigrationNote("  ")).toContain("입력");
    expect(validateMigrationNote("가".repeat(2001))).toContain("2000");
    expect(validateMigrationNote("메모")).toBeNull();
  });
  test("only leads see the form, once", () => {
    expect(migrationFormState(false, null)).toBe("hidden");
    expect(migrationFormState(true, null)).toBe("form");
    expect(migrationFormState(true, { actor: "u", at: "2026-10-12", completed_stages: [], migration_note: "n" })).toBe("recorded");
  });
  test("the panel is a secondary (ghost) action, sits in S12 and posts migration_note", () => {
    const panel = src("components/stages/PolicyMigrationPanel.tsx");
    expect(panel).not.toContain("btn-primary");
    expect(panel).toContain("migration_note");
    expect(src("components/stages/PortfolioStage.tsx")).toContain("<PolicyMigrationPanel");
  });
});

// ── S12 greenfield scorecard cycle form ──
import {
  buildScorecardPayload, CUSTOM_GOAL_OPTION, effectiveClassText, emptyMeasureDraft, isVentureOverride, scorecardErrorText,
  type ScorecardFormState,
} from "../../app/web-next/lib/post-management-view.ts";

const okRow = (over = {}) => ({ ...emptyMeasureDraft("a"), measure_key: "revenue_vs_case", value: "10", target_value: "12", status: "deviation", evidence_ref: "doc:abc", ...over });
const form = (over: Partial<ScorecardFormState> = {}): ScorecardFormState => ({ review_cycle: "2026-Q4", venture_class: "driving", note: "", measures: [okRow()], ...over });

describe("scorecard form payload", () => {
  test("valid default-class form builds a payload", () => {
    const r = buildScorecardPayload(form(), "driving");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.measures[0]).toMatchObject({ measure_key: "revenue_vs_case", value: 10, target_value: 12 });
  });
  test("override needs a note", () => {
    expect(isVentureOverride("enabling", "driving")).toBe(true);
    const r = buildScorecardPayload(form({ venture_class: "enabling" }), "driving");
    expect(r.ok).toBe(false);
    expect(buildScorecardPayload(form({ venture_class: "enabling", note: "역량 지원 중심" }), "driving").ok).toBe(true);
  });
  test("bad cycle, null values with non-insufficient status, bad evidence, duplicates", () => {
    expect(buildScorecardPayload(form({ review_cycle: "2026Q4" }), "driving").ok).toBe(false);
    expect(buildScorecardPayload(form({ measures: [okRow({ value: "" })] }), "driving").ok).toBe(false);
    expect(buildScorecardPayload(form({ measures: [okRow({ value: "", target_value: "", status: "insufficient_evidence" })] }), "driving").ok).toBe(true);
    expect(buildScorecardPayload(form({ measures: [okRow({ evidence_ref: "http://x" })] }), "driving").ok).toBe(false);
    expect(buildScorecardPayload(form({ measures: [okRow(), okRow({ uid: "b" })] }), "driving").ok).toBe(false);
  });
  test("custom goal key is validated", () => {
    expect(buildScorecardPayload(form({ measures: [okRow({ measure_key: CUSTOM_GOAL_OPTION, custom_goal: "Bad Key" })] }), "driving").ok).toBe(false);
    const r = buildScorecardPayload(form({ measures: [okRow({ measure_key: CUSTOM_GOAL_OPTION, custom_goal: "ebitda_margin" })] }), "driving");
    expect(r.ok && r.payload.measures[0].measure_key).toBe("goal:ebitda_margin");
  });
});

describe("scorecard errors and effective class text", () => {
  test("run_required explains the new-run rule", () => {
    expect(scorecardErrorText("run_required", 409, "x")).toContain("새 분석 실행이 필요합니다");
  });
  test("every documented API error code has Korean text", () => {
    for (const c of ["invalid_request", "human_only", "role_required", "insider_required", "not_applicable_track", "needs_classification", "cycle_exists", "run_required"]) {
      expect(scorecardErrorText(c, 400, undefined).length).toBeGreaterThan(5);
    }
    expect(scorecardErrorText(undefined, 404, undefined)).toContain("찾을 수 없");
  });
  test("overridden class shows who, when, note", () => {
    const t = effectiveClassText({ default: "driving", effective: "enabling", overridden: true, override: { review_cycle: "2026-Q4", before: "driving", after: "enabling", note: "사유A", by: "u1", at: "2026-10-12T01:00:00Z" } }, "driving");
    expect(t).toContain("변경됨");
    expect(t).toContain("u1");
    expect(t).toContain("2026-10-12");
    expect(t).toContain("사유A");
    expect(effectiveClassText(undefined, "driving")).toContain("기본값");
  });
});
