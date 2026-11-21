// ADR-0205 / design 2026-11-21-s67-completion-visibility Amendment 2 — stage-scoped S6/S7 bodies.
// S6: Universe → Long List (criteria strip + table) → the Pre-FS GateDecisionPanel LAST; no pre-check
// checklist, no committee, no promotion. S7: checklist + committee + decision tabs + promotion, and NO
// Pre-FS panel in the DOM (the criteria strip's 4th row is a criterion row, not a panel).
// Render pins use renderToStaticMarkup under NextIntlClientProvider (pattern: s67-criteria-panel.test.ts);
// BrownfieldStage's data hooks need a live API, so the composition order is pinned on its source.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const WEB = "../../app/web-next";
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as {
  renderToStaticMarkup: (el: unknown) => string;
};
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as {
  createElement: (type: unknown, props: unknown, ...c: unknown[]) => unknown;
};
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as {
  NextIntlClientProvider: unknown;
};
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, unknown>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, unknown>;
const { AppRouterContext } = (await import(
  `${WEB}/node_modules/next/dist/shared/lib/app-router-context.shared-runtime.js`
)) as { AppRouterContext: { Provider: unknown } };
const { AuthProvider } = (await import(`${WEB}/lib/auth-client.tsx`)) as { AuthProvider: unknown };
const { ShortlistSection } = (await import(`${WEB}/components/stages/brownfield/ShortlistSection.tsx`)) as {
  ShortlistSection: unknown;
};
const { GateDecisionPanel } = (await import(`${WEB}/components/GateDecisionPanel.tsx`)) as {
  GateDecisionPanel: unknown;
};
const { S6CriteriaPanel } = (await import(`${WEB}/components/stages/brownfield/S6CriteriaPanel.tsx`)) as {
  S6CriteriaPanel: unknown;
};

const noop = () => {};
const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: locale === "ko" ? ko : en, now: new Date(), timeZone: "Asia/Seoul" },
      // PromotionPanel reads next/navigation's useRouter — mount a stub app router for SSR.
      createElement(
        AppRouterContext.Provider,
        { value: { push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop } },
        createElement(AuthProvider, null, el),
      ),
    ),
  );

const shortlisted = {
  id: "t1",
  company_name: "태웅",
  rank: 1,
  status: "shortlisted",
  screening_json: null,
  screening_summary: { total: 9, assessed: 0, mandatoryOpen: [], anyKnockOutFail: false },
  eval_summary: { complete: true },
};
const ctxStub = (over: Record<string, unknown> = {}) => ({
  selected: {
    opportunity: { id: "opp-1", name: "신규 사업" },
    targets: [shortlisted],
    checklist: [],
    universe: null,
  },
  precheckOpen: true,
  setPrecheckOpen: noop,
  recoBusy: false,
  recoProgress: null,
  precheckDraft: {},
  precheckDraftNote: {},
  canAct: true,
  setPrecheckDraft: noop,
  precheckBusy: null,
  shortlistedTargets: [shortlisted],
  precheckIncomplete: 1,
  checklistItems: [{ id: "t-01", text: "항목 1", mandatory: true, part: 1 }],
  part1Count: 1,
  part2Count: 0,
  savePrecheck: noop,
  runCommitteePrecheck: noop,
  s6Gate: {
    ready: true,
    terminated: false,
    s6Status: "current",
    s6Missing: [],
    s6Blockers: [],
    s6Exempt: false,
    s7Blocked: false,
  },
  ...over,
});

describe("ShortlistSection stage scoping (checklist · committee · decision tabs · promotion are S7-only)", () => {
  test("S6 renders nothing — no checklist section, no promotion, no decision tabs, no shortlist anchor", () => {
    const html = render(createElement(ShortlistSection, { ctx: ctxStub({ stage: "S6" }), stage: "S6" }));
    expect(html).toBe("");
  });

  test("S7 renders the checklist section, the decision tabs and the promotion block", () => {
    const html = render(createElement(ShortlistSection, { ctx: ctxStub({ stage: "S7" }), stage: "S7" }));
    expect(html).toContain('id="s6s7-shortlist"');
    expect(html).toContain("사전 검토 · 위원회 추천");
    expect(html).toContain('role="tablist"'); // S7DecisionTabs
    expect(html).toContain("프로젝트로 추진"); // PromotionPanel heading
    // the Pre-FS panel never mounts on S7
    expect(html).not.toContain("gate-decision-pre_fs");
    expect(html).not.toContain('data-gate-form="pre_fs"');
  });
});

describe("Pre-FS GateDecisionPanel anchor", () => {
  test("the single-gate pre_fs panel emits the #gate-decision-pre_fs anchor the criteria row targets", () => {
    const html = render(createElement(GateDecisionPanel, { opportunityId: "opp-1", gates: ["pre_fs"] }));
    expect(html).toContain('id="gate-decision-pre_fs"');
    expect(html).toContain("market-section");
    expect(html).toContain('tabindex="-1"'); // focusable anchor target
  });
});

describe("criteria row 4 link target by stage", () => {
  const gate = {
    ready: true,
    terminated: false,
    s6Status: "current",
    s6Missing: ["s6.pre_fs_go"],
    s6Blockers: ["Pre-FS 게이트 GO 결정이 필요합니다 (사람이 기록)"],
    s6Exempt: false,
    s7Blocked: true,
  };
  const props = { gate, targets: [{ id: "a", gaps: [] }], minLongList: 1 };

  test("S6 links to the in-page Pre-FS panel; S7 links across routes to the S6 panel", () => {
    const s6 = render(createElement(S6CriteriaPanel, { ...props, stage: "S6" }));
    expect(s6).toContain('href="#gate-decision-pre_fs"');
    const s7 = render(createElement(S6CriteriaPanel, { ...props, stage: "S7" }));
    expect(s7).toContain('href="s6#gate-decision-pre_fs"');
    expect(s7).not.toContain('href="#gate-decision-pre_fs"');
    // the S7 strip is a criterion row, never a Pre-FS panel
    expect(s7).not.toContain('id="gate-decision-pre_fs"');
  });
});

describe("BrownfieldStage composition (source-pinned)", () => {
  const read = (p: string) =>
    readFileSync(new URL(`${WEB}/components/stages/brownfield/${p}`, import.meta.url), "utf-8");
  const stageSrc = read("BrownfieldStage.tsx");

  test('`stage: "S6" | "S7"` is required and replaces dealShapePanel', () => {
    expect(stageSrc).toContain('stage: "S6" | "S7"');
    expect(stageSrc).not.toContain("dealShapePanel");
    expect(read("ShortlistSection.tsx")).not.toContain("dealShapePanel");
    const page = readFileSync(new URL(`${WEB}/app/deals/[id]/[stage]/page.tsx`, import.meta.url), "utf-8");
    expect(page).toContain("<BrownfieldStage opportunityId={opportunityId} stage={stageId} />");
  });

  test("S6 body order: Universe → Long List → (S7 shortlist block) → Pre-FS panel LAST, S6-only", () => {
    const iUni = stageSrc.indexOf("<UniverseSection");
    const iLong = stageSrc.indexOf("<LonglistSection");
    const iShort = stageSrc.indexOf("<ShortlistSection");
    const iPre = stageSrc.indexOf("<GateDecisionPanel");
    expect([iUni, iLong, iShort, iPre].every((i) => i >= 0)).toBe(true);
    expect(iUni).toBeLessThan(iLong);
    expect(iLong).toBeLessThan(iShort);
    expect(iShort).toBeLessThan(iPre);
    expect(stageSrc.match(/<GateDecisionPanel/g)?.length).toBe(1);
    expect(stageSrc).toContain('gates={["pre_fs"]}');
    // gated on S6 only — absent from the S7 tree
    expect(stageSrc.slice(stageSrc.lastIndexOf("{", iPre) - 80, iPre)).toContain('stage === "S6"');
    // nothing after the Pre-FS panel in the returned fragment
    const tail = stageSrc.slice(iPre);
    expect(tail).not.toContain("<Section");
  });

  test("the S6 authoring block (Universe + discovery card, web discovery, edit modal) is S6-only; Long List stays on both", () => {
    const iUni = stageSrc.indexOf("<UniverseSection");
    const iWeb = stageSrc.indexOf("<WebDiscoveryPanel");
    const iEdit = stageSrc.indexOf("<UniverseEditModal");
    const iLong = stageSrc.indexOf("<LonglistSection");
    expect([iUni, iWeb, iEdit].every((i) => i >= 0)).toBe(true);
    // one S6 guard encloses all three, and the guard closes before the Long List
    const guard = stageSrc.lastIndexOf('stage === "S6" && (', iUni);
    expect(guard).toBeGreaterThan(stageSrc.indexOf("return ("));
    expect(guard).toBeLessThan(iUni);
    expect(iEdit).toBeLessThan(iLong);
    const guarded = stageSrc.slice(guard, iLong);
    expect(guarded).toContain("<UniverseSection");
    expect(guarded).toContain("<WebDiscoveryPanel");
    expect(guarded).toContain("<UniverseEditModal");
    // Long List, criteria strip host and shortlist block are NOT inside the S6 guard
    expect(stageSrc.slice(iLong)).not.toContain("<UniverseSection");
    expect(stageSrc.match(/<LonglistSection/g)?.length).toBe(1);
    expect(stageSrc.slice(stageSrc.lastIndexOf("{", iLong) - 80, iLong)).not.toContain('stage === "S6"');
    // hooks keep running on both stages (min_long_list / long list read the universe state)
    expect(stageSrc.indexOf("useBrownfieldUniverse(")).toBeLessThan(stageSrc.indexOf("return ("));
    expect(read("LonglistSection.tsx")).toContain("selected.universe?.min_long_list");
  });

  test("the discovery/registration card lives in UniverseSection, so S7 omits it with the Universe card", () => {
    const uni = read("UniverseSection.tsx");
    expect(uni).toContain("candidateDiscoveryFillingTheFull");
    expect(read("LonglistSection.tsx")).not.toContain("candidateDiscovery");
  });

  test("ReviewBuckets shows only the current stage's artifact tabs (S6 screen → S6, S7 screen → S7)", async () => {
    expect(stageSrc).toContain("artifacts={stageArtifactTabs(stage)}");
    expect(stageSrc).not.toContain('stageArtifactTabs("S6", "S7")');
    const { stageArtifactTabs } = (await import(`${WEB}/lib/review/stage-artifact-labels.ts`)) as {
      stageArtifactTabs: (...s: string[]) => { key: string; stageId: string }[];
    };
    expect(stageArtifactTabs("S6").map((t) => t.key)).toEqual(["stage:S6:1", "stage:S6:2"]);
    expect(stageArtifactTabs("S7").map((t) => t.key)).toEqual(["stage:S7:1", "stage:S7:2", "stage:S7:3", "stage:S7:4"]);
  });

  test("the Pre-FS panel no longer mounts inside LonglistSection or the S7 decision tabs", () => {
    expect(read("LonglistSection.tsx")).not.toContain("GateDecisionPanel");
    expect(read("S7DecisionTabs.tsx")).not.toContain('"pre_fs"]');
  });
});
