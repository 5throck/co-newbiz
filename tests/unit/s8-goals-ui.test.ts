// S8 business-goals UI (ADR-0159): pure view helpers + source-reading checks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GOALS_ACK_REQUIRED_CODE,
  STARTER_METRIC_KEYS,
  attainmentView,
  bannerText,
  goalsBannerState,
  primaryTabKeys,
  resolveS8Tab,
  shouldRedirectTargetsTab,
  summarizeAttainment,
} from "../../app/web-next/lib/business-goals-view.ts";
import { goalsAckErrorText, goalsLoadErrorText } from "../../app/web-next/lib/business-goals-view.ts";
import { releaseAction, trancheErrorText } from "../../app/web-next/lib/greenfield-structure-view.ts";
import { STAGE_TAB_GROUPS, groupForTrack, activeTabIndex } from "../../app/web-next/lib/stage-tabs.ts";
import { METRIC_PRESETS } from "../../app/web-next/lib/business-targets-format.ts";

const WEB = join(import.meta.dirname, "../../app/web-next");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");
// i18n (design 2026-10-23-i18n-ui-adoption): S8 stage copy resolves through the
// catalog — wording pins below assert the key call site in the component source
// and the ko master catalog value (the original Korean label).
const koCatalog = await import("../../app/web-next/locales/ko.json");
const koOf = (key: string): string =>
  key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog) as string;

describe("S8 tab order and greenfield redirect", () => {
  test("stage tab row: goals, technical, financial, targets, decision; financial sub-tab row (ADR-0169)", () => {
    const s8 = STAGE_TAB_GROUPS.find((g) => g.stage === "S8")!;
    expect(s8.tabs.map((t) => t.query ?? t.seg)).toEqual(["goals", "technical", "financial", "targets", "decision"]);
    expect(s8.subtabs!.map((t) => t.query ?? t.seg)).toEqual(["overview", "scenarios", "/wacc", "/financial-analysis", "bep", "params", "target-costing"]);
    expect(primaryTabKeys(false)).toEqual(["goals", "technical", "financial", "targets", "decision"]);
    expect(primaryTabKeys(true)).toEqual(["goals", "technical", "financial", "decision"]);
  });
  test("greenfield hides the targets tab in both tab models", () => {
    const s8 = STAGE_TAB_GROUPS.find((g) => g.stage === "S8")!;
    const gf = groupForTrack(s8, "greenfield");
    expect([...gf.tabs, ...gf.more].some((t) => t.query === "targets")).toBe(false);
    expect([...groupForTrack(s8, "brownfield").tabs].some((t) => t.query === "targets")).toBe(true);
    expect([...groupForTrack(s8, null).tabs].some((t) => t.query === "targets")).toBe(true);
    expect(primaryTabKeys(true)).not.toContain("targets");
    // ?tab=targets on greenfield falls back to the financial lens (default tab)
    const all = [...gf.tabs, ...gf.more];
    expect(all[activeTabIndex(gf, "/business-case", "targets")].label).toBe("재무적 타당성");
  });
  test("redirect rule", () => {
    expect(shouldRedirectTargetsTab("targets", true)).toBe(true);
    expect(shouldRedirectTargetsTab("targets", false)).toBe(false);
    expect(shouldRedirectTargetsTab("goals", true)).toBe(false);
    expect(resolveS8Tab("targets", { greenfield: true })).toBe("overview");
    expect(resolveS8Tab("targets", { greenfield: false })).toBe("targets");
    expect(resolveS8Tab("goals", { greenfield: true })).toBe("goals");
    expect(resolveS8Tab(null, { greenfield: false })).toBe("overview");
    expect(resolveS8Tab(undefined, { greenfield: true })).toBe("overview");
    expect(resolveS8Tab("bogus", { greenfield: false })).toBe("overview");
  });
});

describe("banner state", () => {
  test("none vs applied with source counts and standards note", () => {
    const none = goalsBannerState({ project: 0, affiliate: 0, group: 0 }, false);
    expect(none.kind).toBe("none");
    expect(bannerText(none).actionLabel).toBe("목표 설정");
    expect(bannerText(none).standardsNote).toContain("없습니다");
    const applied = goalsBannerState({ project: 2, affiliate: 0, group: 1 }, true);
    expect(applied.kind).toBe("applied");
    const t = bannerText(applied);
    expect(t.message).toContain("3건");
    expect(t.message).toContain("프로젝트 목표 2건");
    expect(t.message).toContain("그룹 목표 1건");
    expect(t.message).not.toContain("계열사");
    expect(t.actionLabel).toBe("목표 검토");
    expect(t.standardsNote).toContain("적용됩니다");
    expect(goalsBannerState(null, true).kind).toBe("none");
  });
});

describe("attainment mapping", () => {
  test("every status has icon + text; not set is distinct", () => {
    for (const s of ["met", "missed", "indeterminate", "manual", null] as const) {
      const v = attainmentView(s);
      expect(v.icon.length).toBeGreaterThan(0);
      expect(v.label.length).toBeGreaterThan(0);
    }
    const labels = new Set((["met", "missed", "indeterminate", "manual", null] as const).map((s) => attainmentView(s).label));
    expect(labels.size).toBe(5);
  });
  test("summary counts", () => {
    const e = (status: "met" | "missed" | "indeterminate" | "manual") => ({ metric_key: "npv", label: "x", direction: "gte" as const, target_value: 1, unit: "krw_m" as const, source: "project" as const, status, actual: null, actual_basis: "" });
    expect(summarizeAttainment([e("met"), e("met"), e("missed"), e("manual")])).toEqual({ met: 2, missed: 1, indeterminate: 0, manual: 1 });
    expect(summarizeAttainment(undefined)).toEqual({ met: 0, missed: 0, indeterminate: 0, manual: 0 });
  });
  test("starter chips are existing presets only", () => {
    const keys = METRIC_PRESETS.map((p) => p.key);
    for (const k of STARTER_METRIC_KEYS) expect(keys).toContain(k);
  });
});

describe("source-reading checks", () => {
  test("BusinessCaseStage wires goals tab, attainment, ack dialog", () => {
    const src = read("components/stages/BusinessCaseStage.tsx");
    expect(src).toContain('tab === "goals" && <GoalsPanel');
    // IA 2026-10-14: goal setting/status lives only in the goals tab -- no banner on any other tab.
    expect(src).not.toContain("<GoalsBanner");
    expect(src).not.toContain("S8GoalsBannerLoader");
    expect(read("components/business-case/GoalsPanel.tsx")).not.toContain("export function GoalsBanner");
    expect(read("app/projects/[id]/wacc/page.tsx")).not.toContain("GoalsBanner");
    expect(read("app/projects/[id]/financial-analysis/page.tsx")).not.toContain("GoalsBanner");
    expect(src).toContain("<GoalAttainmentTable");
    // W1-19/W2-07: NoGoalsCallout is no longer rendered here — GoalsBanner already shows the 목표 미설정 state once.
    expect(src).not.toContain("<NoGoalsCallout");
    expect(src).toContain(GOALS_ACK_REQUIRED_CODE);
    expect(src).toContain("goals_ack");
    expect(src).toContain("shouldRedirectTargetsTab");
  });
  test("TargetCheckPanel renders source badge, shadowed note, rationale, set_by", () => {
    const src = read("components/TargetCheckPanel.tsx");
    for (const needle of ["SOURCE_VIEW", "shadowed_note", "e.rationale", "e.set_by"]) expect(src).toContain(needle);
  });
  test("new UI strings are marked INTERIM-WORDING and use no raw colours", () => {
    for (const f of ["components/business-case/GoalsPanel.tsx", "components/business-case/GoalAttainment.tsx", "lib/business-goals-view.ts"]) {
      const src = read(f);
      expect(src).toContain("INTERIM-WORDING");
      expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
    }
  });
  test("retire and acknowledgement dialogs gate the confirm button with a stated reason", () => {
    const src = read("components/business-case/GoalsPanel.tsx");
    expect(src).toContain("disabled={!!blockedReason}");
    expect(src).toContain('role="alertdialog"');
  });
});

describe("ack note, migration_pending and two-person release", () => {
  test("goals ack requires a note and surfaces goals_ack_note_required", () => {
    const stage = read("components/stages/BusinessCaseStage.tsx");
    expect(stage).toMatch(/textLabel=\{t\("adoptionReason"\)\}\s+textRequired\n/);
    expect(koOf("stages.s8.stage.adoptionReason")).toBe("채택 사유");
    expect(stage).toContain("goalsAckErrorText");
    expect(stage).not.toContain("...(note ? { note } : {})");
    expect(goalsAckErrorText({ code: "goals_ack_note_required" })).toMatch(/사유/);
    expect(goalsAckErrorText({ code: "other" })).toBeNull();
  });
  test("migration_pending renders the restart instruction", () => {
    expect(goalsLoadErrorText({ code: "migration_pending", message: "x" }, "f")).toBe("서버를 재시작해 마이그레이션을 적용해야 합니다.");
    expect(goalsLoadErrorText(new Error("boom"), "f")).toBe("boom");
    expect(goalsLoadErrorText("x", "f")).toBe("f");
    for (const f of ["components/business-case/GoalsPanel.tsx", "components/stages/BusinessCaseStage.tsx", "components/TargetCheckPanel.tsx"]) expect(read(f)).toContain("goalsLoadErrorText");
  });
  test("release action hides approve for requester and creator", () => {
    const base = { created_by: "c" };
    expect(releaseAction({ ...base, pending_release: null }, "c").kind).toBe("request");
    const pending = { requested_by: "r", requested_at: "t" };
    expect(releaseAction({ ...base, pending_release: pending }, "r")).toMatchObject({ allowed: false, kind: "awaiting_other" });
    expect(releaseAction({ ...base, pending_release: pending }, "c")).toMatchObject({ allowed: false, kind: "creator_blocked" });
    expect(releaseAction({ ...base, pending_release: pending }, "x")).toMatchObject({ allowed: true, kind: "approve", label: "집행 승인" });
    expect(trancheErrorText("second_person_required", "f")).toMatch(/다른 사람/);
    expect(read("components/stages/CapexTrancheTable.tsx")).toContain('aria-live="polite"');
  });
});

describe("S8 scenario row actions (RowMenu)", () => {
  const src = readFileSync(join(import.meta.dir, "../../app/web-next/components/stages/BusinessCaseStage.tsx"), "utf8");
  test("keeps adopt as a visible button and moves lines/delete into RowMenu", () => {
    expect(src).toContain("<RowMenu");
    expect(src).toMatch(/key: "delete", label: tc\("delete"\), danger: true[^}]*onSelect: \(\) => remove\(c\)/);
    expect(koOf("common.delete")).toBe("삭제");
    // ADR-0178 (2026-10-16): the lines action is conditional — Green Field opens the
    // read-only view, Brown Field keeps the editor.
    expect(src).toMatch(/key: "lines", label: greenfield \? t\("viewLines"\) : t\("editLine"\)[^}]*startView\(c\) : startEdit\(c\)/);
    expect(koOf("stages.s8.stage.viewLines")).toBe("라인 보기");
    expect(koOf("stages.s8.stage.editLine")).toBe("라인 편집");
    expect(src).toMatch(/aria-label=\{t\("p1Adopt", \{ p1: rowCtx \}\)\}[^>]*onClick=\{\(\) => adopt\(/);
    expect(koOf("stages.s8.stage.p1Adopt")).toBe("{p1} 채택");
    expect(src).not.toMatch(/btn-danger btn-sm[^\n]*remove\(c\)/);
  });
  test("lines action is labelled per track and scrolls/focuses the editor, naming the row", () => {
    expect(src).toContain('label: greenfield ? t("viewLines") : t("editLine")');
    expect(src).toMatch(/scrollIntoView\(\{ block: "start"/);
    expect(src).toContain("prefers-reduced-motion");
    expect(src).toContain("editorTextRef.current?.focus");
    expect(src).toContain('t("editing2")');
    expect(koOf("stages.s8.stage.editing2")).toBe("편집 대상:");
    expect(src).toContain('t("theLineEditorIsOpen")');
    expect(koOf("stages.s8.stage.theLineEditorIsOpen")).toBe("라인 편집기가 아래에 열렸습니다 —");
    expect(src).toContain('.row-menu-trigger`)?.focus()');
  });
});

describe("S8 median-gap hint (cross-check signal, not a bug)", () => {
  const src = readFileSync(join(import.meta.dir, "../../app/web-next/components/stages/BusinessCaseStage.tsx"), "utf8");
  test("large median gap shows growth-assumption explanation and links to the 설명 tab", () => {
    expect(src).toContain("P50_GAP_WARN_RATIO");
    expect(src).toContain('data-testid="p50-gap-hint"');
    expect(src).toContain('t("theGrowthAssumptionDifferenceDominates")');
    expect(koOf("stages.s8.stage.theGrowthAssumptionDifferenceDominates")).toBe("성장 가정 차이가 지배적");
    expect(src).toContain('onClick={() => setTab("overview")}');
  });
});

describe("S8 IA cleanup (2026-10-14): one home per fact", () => {
  const src = readFileSync(join(import.meta.dir, "../../app/web-next/components/stages/BusinessCaseStage.tsx"), "utf8");
  test("attainment table renders once, in the goals tab (per-case columns kept)", () => {
    expect(src).toContain("attainmentCases");
    expect(src).toMatch(/tab === "goals" && \(\s*\n\s*<GoalAttainmentTable/);
    expect(src).not.toContain("tab === \"scenarios\" && <GoalAttainmentTable");
    expect(src).toContain('t("goalAttainmentJudgementIsIn")');
    expect(koOf("stages.s8.stage.goalAttainmentJudgementIsIn")).toBe("목표 달성 판정은 사업 목표 탭 →");
  });
  test("S8LensStrip renders only on the decision tab (one site, above TargetCheckPanel)", () => {
    expect(src.match(/<S8LensStrip/g)).toHaveLength(1);
    expect(src).toMatch(/tab === "decision" && \(\s*\n\s*<div className="mt-4">\s*\n\s*<S8LensStrip[^>]*\/>\s*\n\s*<TargetCheckPanel/);
    expect(read("components/StageTabs.tsx")).not.toContain("S8LensStrip");
  });
  test("goals tab layout: one primary add action, status line, sections, editor above the table", () => {
    const g = read("components/business-case/GoalsPanel.tsx");
    expect(g).toContain('t("addTarget")');
    expect(koOf("stages.s8.goalsPanel.addTarget")).toBe("+ 목표 추가");
    expect(g).toContain("goalsBannerState");
    expect(g).toContain('t("activeTargets")');
    expect(koOf("stages.s8.goalsPanel.activeTargets")).toBe("적용 중인 목표");
    expect(g).toContain('t("setAsTheProjectGoal")');
    expect(koOf("stages.s8.goalsPanel.setAsTheProjectGoal")).toBe("프로젝트 목표로 지정");
    expect(g).not.toContain("프로젝트 목표 설정");
    // chip row and editor render above the table; chips only in empty state or after pressing the add button
    expect(g.indexOf("<form ref={editorRef}")).toBeLessThan(g.indexOf('aria-label={t("activeBusinessGoals")}'));
    expect(g.indexOf('t("pickAStartingMetric")')).toBeLessThan(g.indexOf('aria-label={t("activeBusinessGoals")}'));
    expect(g).toContain("resolved.length === 0 && (");
    expect(g).not.toContain("picking");
    expect(g).toContain("scrollIntoView");
    const a = read("components/business-case/GoalAttainment.tsx");
    expect(a).toContain('tc("scenarioAttainment")');
    expect(koOf("common.scenarioAttainment")).toBe("시나리오별 달성 여부");
    expect(a).toContain("attainment-legend");
    expect(a).toContain('t("onceATargetIsAdded")');
    expect(koOf("stages.s8.goalAttainment.onceATargetIsAdded")).toBe("목표를 추가하면 시나리오별 달성 여부가 표시됩니다.");
  });
  test("add button opens the editor directly; select lists all presets, taken ones disabled; chips only when empty", () => {
    const g = read("components/business-case/GoalsPanel.tsx");
    expect(g).toContain("startCreate(firstFreePreset?.key ?? CUSTOM)");
    expect(g).toContain("disabled={takenKeys.has(p.key)}");
    expect(g).toContain('t("set")');
    expect(koOf("stages.s8.goalsPanel.set")).toBe(" (설정됨)");
    expect(g).toContain("presets.map((p) => <option");
    expect(g).toContain("canAct && data && !editor && resolved.length === 0 && (");
    expect(g).toContain('querySelector<HTMLElement>("select, input, textarea")?.focus()');
  });
  test("moved tabs sit in the financial sub-tab row, not the primary row", () => {
    expect(src).toMatch(/label=\{t\("financialFeasibility2"\)\}[\s\S]*?key: "target-costing"/);
    const primary = src.slice(src.indexOf('label={t("s8BusinessCaseScreen")}'), src.indexOf('label={t("financialFeasibility2")}'));
    for (const k of ["overview", "params", "target-costing"]) expect(primary).not.toContain(`key: "${k}"`);
  });
  test("TargetCheckPanel is decision-tab only, above GateDecisionPanel", () => {
    expect(src.match(/<TargetCheckPanel/g)).toHaveLength(1);
    expect(src).toMatch(/tab === "decision" && \(\s*\n\s*<div className="mt-4">\s*\n\s*<S8LensStrip[^>]*\/>\s*\n\s*<TargetCheckPanel/);
    expect(src).toMatch(/<TargetCheckPanel[^>]*\/>\s*\n\s*<AiJudgementSupport[\s\S]*?<GateDecisionPanel/);
  });
  test("single generate entry (overview), decision jump hidden on decision, no global recalc row", () => {
    expect(src).not.toContain("밸류에이션 재계산 (재생성)");
    expect(src).toContain('t("marketPastBasis3Scenarios")');
    expect(koOf("stages.s8.stage.marketPastBasis3Scenarios")).toBe("이중 관점 자동 생성 (시장 기반 + 과거 기반 × 3 시나리오)");
    expect(src).not.toContain("결정 기록은 위쪽");
    expect(src).toContain('t("recordTheDecisionInThe")');
    expect(koOf("stages.s8.stage.recordTheDecisionInThe")).toBe("결정 기록은 '결정' 탭에서 합니다.");
    expect(src).toMatch(/tab !== "decision" && <GateDecisionJump/);
    expect(src).not.toContain("s8-analysis-tabs-note");
  });
  test("capability content lives in the technical tab; scenarios keep only a pointer", () => {
    expect(src).not.toContain("<CapabilityAttainabilityPanel");
    expect(src).toContain('t("theCapabilityAttainabilityJudgement")');
    expect(koOf("stages.s8.stage.theCapabilityAttainabilityJudgement")).toBe("필요 역량 달성 가능성 판정은");
    expect(src).toMatch(/onClick=\{\(\) => setTab\("technical"\)\}>\{t\("technicalFeasibilityTab"\)\}<\/button>/);
    expect(koOf("stages.s8.stage.technicalFeasibilityTab")).toBe("기술적 타당성 탭 →");
  });
});

describe("S8 greenfield single-perspective wording", () => {
  const stage = read("components/stages/BusinessCaseStage.tsx");
  const method = read("components/business-case/ValuationMethodology.tsx");
  test("greenfield branches replace the dual-perspective wording", () => {
    expect(stage).toContain('t("s8BusinessCaseValuation")');
    expect(koOf("stages.s8.stage.s8BusinessCaseValuation")).toBe("시장 기반 밸류에이션");
    expect(stage).toContain('t("marketBasis3Scenarios")');
    expect(koOf("stages.s8.stage.marketBasis3Scenarios")).toBe("자동 생성 (시장 기반 × 3 시나리오)");
    expect(stage).toContain('t("whatTheEvaluationPerspectiveMeans")');
    expect(koOf("stages.s8.stage.whatTheEvaluationPerspectiveMeans")).toBe("평가 관점의 의미");
    expect(stage).toContain('t("comparisonAppliesOnlyToBrown")');
    expect(koOf("stages.s8.stage.comparisonAppliesOnlyToBrown")).toBe("과거 기반 비교는 대상 회사가 있는 Brown Field에만 적용됩니다.");
    expect(stage).toContain("{!hasHistorical && !greenfield && (");
    expect(stage).toContain("greenfield={greenfield}");
  });
  test("Brown Field keeps the dual-perspective wording", () => {
    expect(stage).toContain('t("s8BusinessCaseValuationComparison")');
    expect(koOf("stages.s8.stage.s8BusinessCaseValuationComparison")).toBe("이중 관점 밸류에이션 비교");
    expect(stage).toContain('t("marketPastBasis3Scenarios")');
    expect(stage).toContain('t("whatTheTwoPerspectivesMean")');
    expect(koOf("stages.s8.stage.whatTheTwoPerspectivesMean")).toBe("두 관점의 의미");
  });
  test("ValuationMethodology hides the two-perspective explanation for greenfield", () => {
    expect(method).toContain("greenfield?: boolean");
    expect(method).toContain("{!greenfield && marketCase && historicalCase");
  });
  test("report composer does not ask for DART sync when no target company is linked", () => {
    expect(read("lib/report-composer.ts")).toContain("시장 기반 단일 관점");
  });
});

describe("S8 decision tab: one AI judgement support section (ADR-0118)", () => {
  const stage = read("components/stages/BusinessCaseStage.tsx");
  const section = read("components/AiJudgementSupport.tsx");
  const panel = read("components/GateDecisionPanel.tsx");

  test("decision tab renders one AiJudgementSupport above GateDecisionPanel, which hides its own brief", () => {
    expect(stage.match(/<AiJudgementSupport/g)?.length).toBe(1);
    const dec = stage.slice(stage.indexOf('tab === "decision" && ('));
    expect(dec.indexOf("<AiJudgementSupport")).toBeLessThan(dec.indexOf("<GateDecisionPanel"));
    expect(dec).toContain("hideBrief");
    expect(dec).toContain("rationalePrefill");
  });
  test("section has two ordered blocks and a single generate button", () => {
    expect(section.indexOf('aria-label="채택할 케이스"')).toBeGreaterThan(0);
    expect(section.indexOf('aria-label="채택할 케이스"')).toBeLessThan(section.indexOf('aria-label="게이트 판단"'));
    expect(section.match(/AI 판단 지원 생성/g)?.length).toBe(1);
    expect(section.match(/<button/g)?.length).toBe(1);
    expect(section).toContain("adoption-recommendation");
    expect(section).toContain("/gate-brief");
  });
  test("overview keeps only a pointer; the old reco section is gone", () => {
    expect(stage).not.toContain("AI 추천 채택 권고\"");
    expect(stage).not.toContain("generateAdoptionReco");
    expect(stage).toContain('t("theAiAdoptionRecommendationIs")');
    expect(koOf("stages.s8.stage.theAiAdoptionRecommendationIs")).toBe("AI 채택 권고는 결정 탭의 AI 판단 지원에서 확인합니다.");
  });
  test("GateDecisionPanel still offers the standalone brief for other gates", () => {
    expect(panel).toContain('t("generateAiBrief")');
    expect(koOf("components.gateDecision.panel.generateAiBrief")).toBe("🤖 AI 브리프 생성");
    expect(panel).toContain("canRecord && !hideBrief");
    expect(panel).toContain("export function GateBriefBody");
  });
});
