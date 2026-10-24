// T-20261022-048 — 품평회 2026-10-22 2라운드 잔여 9건 수선 계약 테스트.
// 패턴: our-company-ui-refinement.test.ts (순수 헬퍼 단언 + 소스 계약 스캔).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { filterTargetsByStatus, TARGET_STATUS_FILTERS, type TargetStatusFilter } from "../../app/web-next/components/stages/brownfield/longlist-filter.ts";

const brownfieldDir = "./app/web-next/components/stages/brownfield/";
const longlist = readFileSync(`${brownfieldDir}LonglistSection.tsx`, "utf8");
const stageFrame = readFileSync("./app/web-next/components/StageFrame.tsx", "utf8");
const onboarding = readFileSync("./app/web-next/app/onboarding/page.tsx", "utf8");
const css = readFileSync("./app/web-next/app/styles.css", "utf8");
const ko = JSON.parse(readFileSync("./app/web-next/locales/ko.json", "utf8"));
const en = JSON.parse(readFileSync("./app/web-next/locales/en.json", "utf8"));

const row = (id: string, status: "pending" | "shortlisted" | "excluded") => ({ id, status });

describe("longlist status filter helper (잔여 #1)", () => {
  test("filter vocabulary covers every target status plus all", () => {
    expect([...TARGET_STATUS_FILTERS]).toEqual(["all", "pending", "shortlisted", "excluded"]);
  });
  test("all keeps source order untouched", () => {
    const targets = [row("a", "shortlisted"), row("b", "pending"), row("c", "excluded")];
    expect(filterTargetsByStatus(targets as never[], "all" satisfies TargetStatusFilter)).toBe(targets);
  });
  test("a status keeps only its rows", () => {
    const targets = [row("a", "shortlisted"), row("b", "pending"), row("c", "pending")];
    expect(filterTargetsByStatus(targets as never[], "pending").map((t) => t.id)).toEqual(["b", "c"]);
    expect(filterTargetsByStatus(targets as never[], "excluded")).toEqual([]);
  });
});

describe("longlist review-fix contracts (잔여 #1·#2)", () => {
  test("a status filter select renders above the table, wired to the helper", () => {
    expect(longlist).toContain('id="longlist-status-filter"');
    expect(longlist).toContain("filterTargetsByStatus");
    expect(longlist).toContain("visibleTargets.map");
    // the empty state must not render the table (guard against both branches at once)
    expect(longlist).toContain("visibleTargets.length === 0");
  });
  test("the reset control clears the filter and only renders while a filter is active", () => {
    expect(longlist).toContain('t("resetFilter")');
    expect(longlist).toMatch(/\{statusFilter !== "all" && \(\s*<button type="button" className="btn-ghost btn-sm" onClick=\{\(\) => setStatusFilter\("all"\)\}/);
  });
  test("resetFilter catalog key exists in ko and en", () => {
    expect(ko.stages.s67.longlistSection.resetFilter).toBe("필터 초기화");
    expect(en.stages.s67.longlistSection.resetFilter).toBe("Reset filter");
  });
  test("exclusion reason full text is reachable without hover (button + aria-expanded, not title-only)", () => {
    expect(longlist).toContain('className="cell-reason-toggle"');
    expect(longlist).toContain("aria-expanded=");
    // the old hover-only truncation span is gone
    expect(longlist).not.toContain('max-w-[18rem] truncate');
    expect(css).toMatch(/\.cell-reason-toggle\[aria-expanded="true"\],\s*\n\.cell-reason-toggle:focus-visible \{[^}]*white-space: normal/s);
  });
});

describe("stage frame review-fix contracts (잔여 #3·#6)", () => {
  test("blocked stages carry a focus-revealed reason bubble and are tab-reachable", () => {
    expect(stageFrame).toContain('className="stage-step-reason"');
    expect(stageFrame).toMatch(/<span key=\{s\.id\} title=\{title\} aria-disabled="true" tabIndex=\{0\}/);
    expect(css).toMatch(/\.stage-step-skipped:focus .stage-step-reason,\s*\n\.stage-step-skipped:focus-within .stage-step-reason \{ display: block; \}/);
  });
  test("the handoff strip opens by default (opt-out reading)", () => {
    expect(stageFrame).toMatch(/<details className="handoff-panel" open>/);
  });
});

describe("onboarding start-here cue (잔여 #7)", () => {
  test("step 1 gets the primary 여기서 시작 CTA, later steps stay ghost", () => {
    expect(onboarding).toContain('s.n === 1 ? "btn-primary btn-sm" : "btn-ghost btn-sm"');
    expect(onboarding).toContain('s.n === 1 ? t("startHere") : t("go")');
    expect(ko.pages.onboarding.startHere).toBe("여기서 시작");
    expect(en.pages.onboarding.startHere).toBe("Start here");
  });
});

describe("token reconcile contracts (잔여 #4·#5·#8)", () => {
  test("--lh-body meets the design-guide floor (>= 1.55)", () => {
    expect(css).toMatch(/--lh-body: 1\.55;/);
  });
  test("radius-lg and radius-xl are distinct tokens on a monotonic scale", () => {
    const lg = Number(css.match(/--radius-lg: ([\d.]+)rem;/)?.[1]);
    const xl = Number(css.match(/--radius-xl: ([\d.]+)rem;/)?.[1]);
    expect(lg).not.toBeNaN();
    expect(xl).not.toBeNaN();
    expect(lg).toBeLessThan(xl);
  });
  test("style rules use --fs tokens, never literal sizes below the 14px floor", () => {
    expect(css).toMatch(/\.longlist-status-filter \{[^}]*font-size: var\(--fs-caption\)/s);
    expect(css).toMatch(/\.stage-step-reason \{[^}]*font-size: var\(--fs-caption\)/s);
  });
});

describe("group card name full text (잔여 #9)", () => {
  test("ellipsis name keeps the hover title and reveals full text on keyboard focus", () => {
    const groups = readFileSync("./app/web-next/components/stages/our-company/GroupPanels.tsx", "utf8");
    expect(groups).toContain('className="group-card-name" title={g.name}');
    expect(css).toMatch(/\.group-card:focus .group-card-name,\s*\n\.group-card:focus-visible .group-card-name \{ white-space: normal;/);
  });
});
