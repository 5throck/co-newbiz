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

describe("S8 tab order and greenfield redirect", () => {
  test("stage tab row: goals, technical, financial, targets, decision; financial sub-tab row (ADR-0169)", () => {
    const s8 = STAGE_TAB_GROUPS.find((g) => g.stage === "S8")!;
    expect(s8.tabs.map((t) => t.query ?? t.seg)).toEqual(["goals", "technical", "financial", "targets", "decision"]);
    expect(s8.subtabs!.map((t) => t.query ?? t.seg)).toEqual(["scenarios", "/wacc", "/financial-analysis"]);
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
    expect(resolveS8Tab("targets", { greenfield: true })).toBe("scenarios");
    expect(resolveS8Tab("targets", { greenfield: false })).toBe("targets");
    expect(resolveS8Tab("goals", { greenfield: true })).toBe("goals");
    expect(resolveS8Tab(null, { greenfield: false })).toBe("scenarios");
    expect(resolveS8Tab(undefined, { greenfield: true })).toBe("scenarios");
    expect(resolveS8Tab("bogus", { greenfield: false })).toBe("scenarios");
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
  test("BusinessCaseStage wires goals tab, banner, attainment, ack dialog", () => {
    const src = read("components/stages/BusinessCaseStage.tsx");
    expect(src).toContain('tab === "goals" && <GoalsPanel');
    expect(src).toContain("<GoalsBanner");
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
    expect(stage).toMatch(/textLabel="채택 사유"\s+textRequired\n/);
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
    expect(src).toMatch(/key: "delete", label: "삭제", danger: true[^}]*onSelect: \(\) => remove\(c\)/);
    expect(src).toMatch(/key: "lines", label: "라인 편집"[^}]*startEdit\(c\)/);
    expect(src).toMatch(/aria-label=\{`\$\{rowCtx\} 채택`\}[^>]*onClick=\{\(\) => adopt\(/);
    expect(src).not.toMatch(/btn-danger btn-sm[^\n]*remove\(c\)/);
  });
  test("lines action is labelled 라인 편집 and scrolls/focuses the editor, naming the row", () => {
    expect(src).toContain('label: "라인 편집"');
    expect(src).not.toContain('label: "라인 보기"');
    expect(src).toMatch(/scrollIntoView\(\{ block: "start"/);
    expect(src).toContain("prefers-reduced-motion");
    expect(src).toContain("editorTextRef.current?.focus");
    expect(src).toContain("편집 대상:");
    expect(src).toContain("라인 편집기가 아래에 열렸습니다");
    expect(src).toContain('.row-menu-trigger`)?.focus()');
  });
});

describe("S8 median-gap hint (cross-check signal, not a bug)", () => {
  const src = readFileSync(join(import.meta.dir, "../../app/web-next/components/stages/BusinessCaseStage.tsx"), "utf8");
  test("large median gap shows growth-assumption explanation and links to the 설명 tab", () => {
    expect(src).toContain("P50_GAP_WARN_RATIO");
    expect(src).toContain('data-testid="p50-gap-hint"');
    expect(src).toContain("성장 가정 차이가 지배적");
    expect(src).toContain('onClick={() => setTab("overview")}');
  });
});
