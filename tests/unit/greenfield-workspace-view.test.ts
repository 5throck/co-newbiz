// @version 1.0.0
// Row 3 (design 2026-10-12 sections 6A / 6B UI): pure view helpers for the greenfield S9 tabs, the
// scope summary panel and the plan-readiness tab, plus source-reading checks of the components.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canOfferWorkspaceOptIn, codeMeta, peoplePlanView, countAnnouncement, countLocation, judgedLine, notCountedNotice, optInPreviewLines, outOfScopeSteps, planArtefactHref,
  planReadinessLabel, pointerText, splitItems, tabCounts, tabKeyOf, tabLabel, tabStepTags, validateMigrationNote, workspaceView,
  type GfScope, type WsDomainLike, type WsItemScope, type WsView,
} from "../../app/web-next/lib/greenfield-dd-view.ts";

const sc = (over: Partial<WsItemScope> = {}): WsItemScope => ({
  checklist_id: "chk-technical-dd-checklist", item_id: "tdd-03", overlay_code: "A", code: "A", judgeable: true, reading: null, reason: null, note: null,
  replaced_by: [], fallback: null, rule: "overlay", steps: [], ...over,
});

const ws = (over: Partial<WsView> = {}): WsView => ({
  active: true, overlay_version: "1.0.0", scope_key: "existing_business_rbd",
  tab_labels: { technical: { en: "Technical plan", ko: "기술 계획" }, hr: { en: "People plan", ko: "인력/조직 계획" }, plan_readiness: { en: "Plan readiness", ko: "계획 준비 상태" } },
  step_tabs: {
    technical: [{ step: 1, purpose: "Site visit", in_scope: false, reason: "site not required", pointers: [] }],
    hr: [{ step: 6, purpose: "Core-team readiness", in_scope: true, reason: null, pointers: [] }],
  },
  plan_readiness: [
    { step: 4, purpose: "DD-to-valuation bridge", in_scope: true, reason: null, artefact: "dd_finding.value_impact", status: "recorded", detail: "2 finding(s)" },
    { step: 6, purpose: "Core-team readiness", in_scope: true, reason: null, artefact: "org-readiness-assessment", status: "not_tracked", detail: null },
  ],
  previous_scope: [],
  counts: { judged: 5, judgeable: 12, workspace_judgeable: 10, excluded: 4, mandatory_unmet: 1 },
  ...over,
});

const scope = (over: Partial<GfScope> = {}): GfScope => ({
  sub_track: "existing_business_rbd", sub_track_class: "existing_business_rbd", selection_active: true, opted_in: true,
  extra_checklists: ["chk-rbd-technology-checklist"],
  site: { site_required: false, basis: "confirmed", site_steps_apply: false },
  na_reason_checklists: [], excluded_steps: [1, 2, 3, 8], warnings: [], workspace_scope: ws(), ...over,
});

const dom = (domain: string, checklistId: string, items: WsDomainLike["items"], extra: Partial<WsDomainLike> = {}): WsDomainLike => ({ domain, checklistId, title: domain, items, ...extra });
const judgedState = { status: "pass" };

describe("tab labels", () => {
  test("greenfield workspace scope uses the overlay's Korean interim label; otherwise the shared Korean label", () => {
    const d = { domain: "technical", checklistId: "chk-technical-dd-checklist", title: "Technical DD" };
    expect(tabLabel(scope(), d)).toBe("기술 계획");
    expect(tabLabel(undefined, d)).toBe("기술 실사"); // brownfield: unchanged
    expect(tabLabel(scope({ workspace_scope: undefined }), d)).toBe("기술 실사"); // grandfathered: unchanged
    expect(tabLabel(undefined, { domain: "financing", checklistId: "x", title: "Financing" })).toBe("자금조달 계획");
  });
  test("extra tabs map to the overlay key by checklist id", () => {
    expect(tabKeyOf({ domain: "chk-rbd-technology-checklist", checklistId: "chk-rbd-technology-checklist" })).toBe("rbd_technology");
    expect(tabKeyOf({ domain: "hr", checklistId: "chk-hr-dd-checklist" })).toBe("hr");
  });
  test("plan readiness label falls back to a Korean default", () => {
    expect(planReadinessLabel(scope())).toBe("계획 준비 상태");
    expect(planReadinessLabel(undefined)).toBe("계획 준비 상태");
  });
});

describe("step tags per tab", () => {
  test("shows the steps a tab serves with an in/out-of-scope text label", () => {
    const tags = tabStepTags(scope(), { domain: "technical", checklistId: "chk-technical-dd-checklist" });
    expect(tags).toHaveLength(1);
    expect(tags[0]!.stateText).toBe("범위 밖");
    expect(tags[0]!.reason).toBe("site not required");
    expect(tags[0]!.icon).toBe("—");
    const hr = tabStepTags(scope(), { domain: "hr", checklistId: "chk-hr-dd-checklist" });
    expect(hr[0]!.stateText).toBe("범위 안");
  });
  test("a tab serving no step, and non-workspace payloads, show no tags", () => {
    expect(tabStepTags(scope(), { domain: "financial", checklistId: "chk-financial-dd-checklist" })).toEqual([]);
    expect(tabStepTags(undefined, { domain: "technical", checklistId: "chk-technical-dd-checklist" })).toEqual([]);
  });
});

describe("item codes", () => {
  test("every code has an icon and a text label (never colour only)", () => {
    for (const code of ["A", "R", "X", "N"] as const) {
      const m = codeMeta(sc({ code }));
      expect(m.icon.length).toBeGreaterThan(0);
      expect(m.label.startsWith(code)).toBe(true);
    }
  });
  test("a C cell resolved through the site rule names the rule; fail-closed rows say so", () => {
    expect(codeMeta(sc({ rule: "site_rule" })).ruleText).toContain("C");
    expect(codeMeta(sc({ rule: "fail_closed", fallback: "missing_from_overlay" })).ruleText).not.toBeNull();
    expect(codeMeta(sc()).ruleText).toBeNull();
  });
  test("N and X items that are not judgeable leave the judgement table; fallback X stays judgeable", () => {
    const items = [
      { id: "a", state: null, scope: sc() },
      { id: "n", state: null, scope: sc({ code: "N", judgeable: false, reason: "r" }) },
      { id: "x", state: null, scope: sc({ code: "X", judgeable: false }) },
      { id: "xf", state: null, scope: sc({ code: "A", judgeable: true, fallback: "replacement_not_judged" }) },
      { id: "plain", state: null },
    ];
    const s = splitItems(items);
    expect(s.judgeable.map((i) => i.id)).toEqual(["a", "xf", "plain"]);
    expect(s.excluded.map((i) => i.id)).toEqual(["n", "x"]);
  });
  test("pointer text shows where the replacement is judged and its read-only status", () => {
    const base = { checklist_id: "chk-greenfield-feasibility-checklist", item_id: "gf-04", stage: "Screening/Pre-FS", in_s9: false, assessed_by: null, assessed_at: null };
    expect(pointerText({ ...base, status: null, judged: false })).toContain("아직 판정되지 않음");
    expect(pointerText({ ...base, status: "pass", judged: true, assessed_by: "u1", assessed_at: "2026-10-01T00:00:00Z" })).toContain("충족");
    expect(pointerText({ ...base, status: "pass", judged: true, assessed_by: "u1", assessed_at: "2026-10-01T00:00:00Z" })).toContain("2026-10-01");
  });
});

describe("per-tab count and the not-counted notice (all seven tabs stay judgeable)", () => {
  test("x of y counts only judgeable rows of the tab", () => {
    const d = dom("technical", "chk-technical-dd-checklist", [
      { id: "1", state: judgedState, scope: sc() }, { id: "2", state: null, scope: sc() },
      { id: "3", state: judgedState, scope: sc({ code: "N", judgeable: false }) },
    ]);
    expect(tabCounts(d)).toEqual({ judged: 1, judgeable: 2, excluded: 1 });
  });
  test("a pre-2026-10-01 new-domain tab keeps its rows judgeable and only adds a non-blocking notice with the server reason", () => {
    const d = dom("market", "chk-market-dd-checklist", [{ id: "mdd-01", state: null }], { counted: false, counted_reason: "Recorded for reference" });
    const n = notCountedNotice(d);
    expect(n).not.toBeNull();
    expect(JSON.stringify(n)).not.toContain("Recorded for reference"); // no English counted_reason leaks
    expect(/[가-힣]/.test(n!.text)).toBe(true);
    expect(splitItems(d.items).judgeable).toHaveLength(1); // still judgeable
    expect(notCountedNotice(dom("market", "x", [], { counted: true }))).toBeNull();
    expect(notCountedNotice(dom("extra", "x", []))).toBeNull(); // extras carry no flag
  });
});

describe("single judged X / Y line", () => {
  const domains = [
    dom("commercial", "chk-commercial-dd-checklist", [{ id: "c1", state: judgedState, scope: sc() }, { id: "c2", state: judgedState, scope: sc({ code: "N", judgeable: false }) }]),
    dom("market", "chk-market-dd-checklist", [{ id: "m1", state: judgedState, scope: sc() }], { counted: false }),
    dom("chk-rbd-technology-checklist", "chk-rbd-technology-checklist", [{ id: "r1", state: judgedState }]),
  ];
  test("RBD / IV with an active scope keep the count only in the panel; null keeps it in the header", () => {
    expect(countLocation(scope())).toBe("panel");
    expect(countLocation(scope({ sub_track_class: "intra_venture" }))).toBe("panel");
    expect(countLocation(scope({ sub_track_class: "none", sub_track: null }))).toBe("header");
    expect(countLocation(undefined)).toBe("header"); // brownfield
    expect(countLocation(scope({ workspace_scope: undefined }))).toBe("header"); // grandfathered keeps the legacy header
  });
  test("Y is workspace_judgeable, X counts the same items, extras are reported beside it", () => {
    const l = judgedLine(scope(), domains)!;
    expect(l.judgeable).toBe(10);
    expect(l.judged).toBe(1); // c1 only: N row, uncounted tab and extra tab excluded
    expect(l.excluded).toBe(4);
    expect(l.mandatoryUnmet).toBe(1);
    expect(l.extra).toEqual({ judged: 4, judgeable: 2 });
    expect(l.text).toBe("판정 1 / 10");
  });
  test("no line without a workspace scope; announcement carries unmet and excluded counts", () => {
    expect(judgedLine(undefined, domains)).toBeNull();
    expect(judgedLine(scope({ workspace_scope: undefined }), domains)).toBeNull();
    expect(countAnnouncement(judgedLine(scope(), domains))).toContain("필수 미충족 1건");
    expect(countAnnouncement(null)).toBe("");
  });
});

describe("plan readiness and out-of-scope steps", () => {
  test("artefact links exist for steps 4 and 5 only; step 6 is not tracked", () => {
    expect(planArtefactHref(4)).toBe("#dd-findings");
    expect(planArtefactHref(5)).toBe("#gate-decision-dd");
    expect(planArtefactHref(6)).toBeNull();
  });
  test("out-of-scope steps carry the overlay reason when known", () => {
    const o = outOfScopeSteps(scope());
    expect(o.map((x) => x.step)).toEqual([1, 2, 3, 8]);
    expect(o.find((x) => x.step === 1)!.reason).toBe("site not required");
    expect(o.find((x) => x.step === 2)!.reason).toBeNull();
  });
  test("workspaceView is null for brownfield and grandfathered payloads", () => {
    expect(workspaceView(undefined)).toBeNull();
    expect(workspaceView(scope({ workspace_scope: undefined }))).toBeNull();
    expect(workspaceView(scope())).not.toBeNull();
  });
});

describe("opt-in preview", () => {
  const prev = (over = {}) => ({
    eligible: true, reason: null, before: { judged: 37, judgeable: 60 },
    after: { judged: 30, judgeable: 59, workspace_judgeable: 59, excluded: 21 },
    moves_to_previous_scope: [{ checklist_id: "c", item_id: "i", code: "N" as const, status: "pass", assessed_by: "u", assessed_at: null, stays_unmet: false }],
    fails_stay_unmet: [{ checklist_id: "c", item_id: "j", code: "N" as const, status: "fail", assessed_by: "u", assessed_at: null, stays_unmet: true }],
    ...over,
  });
  test("lines show before, after, moved judgements and fails that stay unmet", () => {
    const l = optInPreviewLines(prev());
    expect(l[0]).toContain("37 / 60");
    expect(l[1]).toContain("30 / 59");
    expect(l[1]).toContain("21");
    expect(l[2]).toContain("1건");
    expect(l[3]).toContain("1건");
  });
  test("offered only when eligible; migration_note is required", () => {
    expect(canOfferWorkspaceOptIn(prev())).toBe(true);
    expect(canOfferWorkspaceOptIn(prev({ eligible: false }))).toBe(false);
    expect(canOfferWorkspaceOptIn(null)).toBe(false);
    expect(validateMigrationNote("  ")).not.toBeNull();
    expect(validateMigrationNote("사유")).toBeNull();
  });
});

describe("people/organization plan readiness (panel lead)", () => {
  const hrDom = (items: WsDomainLike["items"], extra: Partial<WsDomainLike> = {}) => dom("hr", "chk-hr-dd-checklist", items, extra);
  test("shows hr tab judged x/y, the tab link target, and step 6 'not tracked in system'", () => {
    const v = peoplePlanView(scope(), [dom("technical", "t", []), hrDom([{ id: "a", state: judgedState }, { id: "b", state: { status: "pending" } }])])!;
    expect(v.heading).toContain("인력/조직");
    expect(v.tabIndex).toBe(1);
    expect(v.tabLabel).toBe("인력/조직 계획");
    expect([v.judged, v.judgeable, v.reference]).toEqual([1, 2, false]);
    const s6 = v.steps.find((x) => x.step === 6)!;
    expect(s6.text).toBe("시스템에서 추적하지 않음");
  });
  test("a tab outside the completion count still shows its x/y, flagged as reference", () => {
    const v = peoplePlanView(scope(), [hrDom([{ id: "a", state: judgedState }], { counted: false })])!;
    expect([v.judged, v.judgeable, v.reference]).toEqual([1, 1, true]);
  });
  test("step 2 out of scope shows the reason; without workspace scope only the tab counts are shown", () => {
    const w = ws({ step_tabs: { hr: [{ step: 2, purpose: "Talent pipeline", in_scope: false, reason: "n/a for track", pointers: [] }] } });
    const v = peoplePlanView(scope({ workspace_scope: w }), [hrDom([])])!;
    expect(v.steps.find((x) => x.step === 2)).toMatchObject({ text: "범위 밖", detail: "n/a for track" });
    const plain = peoplePlanView(scope({ workspace_scope: undefined }), [hrDom([])])!;
    expect(plain.steps).toEqual([]);
    expect(plain.tabLabel).toBe("인사 실사");
  });
  test("the null sub-track gets no people block", () => {
    expect(peoplePlanView(scope({ sub_track: null, sub_track_class: "none" }), [hrDom([])])).toBeNull();
  });
});

describe("components (source reading)", () => {
  const panel = readFileSync("app/web-next/components/stages/GreenfieldScopePanel.tsx", "utf8");
  const stage = readFileSync("app/web-next/components/stages/DdStage.tsx", "utf8");
  test("the panel no longer renders the step list", () => {
    expect(panel).not.toContain("stepRows");
    expect(panel).not.toContain("showStepList");
    expect(panel).not.toContain("적용 단계와 이유");
  });
  test("the panel offers the opt-in through the preview endpoint with a required migration_note", () => {
    expect(panel).toContain("workspace-opt-in");
    expect(panel).toContain("migration_note");
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain("btn-premium"); // the one primary action (site confirmation) and the dialog confirm
  });
  test("the stage never hides the judgement or record column on a tab", () => {
    expect(stage).not.toContain("read_only");
    expect(stage).not.toContain("notCounted.reason");
    expect(stage).toContain("const rowCanAct = canAct;");
    expect(stage).toContain('<th scope="col">판정</th>');
    expect(stage).toContain('<th scope="col">판정 기록</th>');
  });
  test("the stage renders the plan readiness tab, step tags, previous-scope and excluded disclosures", () => {
    for (const id of ["dd-plan-readiness", "dd-step-tags", "dd-previous-scope", "dd-excluded", "dd-not-counted", "dd-tab-count"]) expect(stage).toContain(id);
    expect(stage).toContain('id="dd-findings"');
  });
  test("the panel leads with the people plan link; the site question is a collapsed neutral secondary row", () => {
    expect(panel.indexOf("gf-people-plan")).toBeLessThan(panel.indexOf("gf-site-required"));
    expect(panel).toContain("gf-people-link");
    expect(panel).toContain("<details");
    expect(panel).toContain("status-info");
    expect(panel).not.toContain("status-red");
    expect(panel).toContain('aria-live="polite"');
    expect(stage).toContain("onSelectTab={setTab}");
  });
  test("new strings are marked interim and shared table sizing is used", () => {
    expect(stage).toContain("INTERIM-WORDING");
    expect(stage).toContain("<ColGroup widths={PLAN_COL_PCT} />");
    expect(panel).toContain("INTERIM-WORDING");
  });
});
