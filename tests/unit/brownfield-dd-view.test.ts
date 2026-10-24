// @version 1.0.0
// ADR-0162 UI row (design 2026-10-12-brownfield-dd-workspace-scope-by-subtrack, task row 4): pure view helpers
// for the brownfield S9 scope summary and tabs, plus source-reading checks of the components.
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import {
  bfCanOfferOptIn, bfCodeMeta, bfCountAnnouncement, bfExcludedGroups, bfJudgedLine, bfNeedsNaReason, bfPreviousForTab, bfPreviousLine, bfScopeBlock,
  bfScopeErrorText, bfSubTrackName, bfOptInExtrasLines, bfExtraChecklistLabel, isBfExtraTab, type BfScopeBlock,
} from "../../app/web-next/lib/brownfield-dd-view.ts";
import type { WsDomainLike, WsItemScope } from "../../app/web-next/lib/greenfield-dd-view.ts";

const sc = (over: Partial<WsItemScope> = {}): WsItemScope => ({
  checklist_id: "chk-legal-dd-checklist", item_id: "ldd-01", overlay_code: "A", code: "A", judgeable: true, reading: null, reason: null, note: null,
  replaced_by: [], fallback: null, rule: "overlay", steps: [], ...over,
});

const block = (over: Partial<BfScopeBlock> = {}, ws: Partial<BfScopeBlock["workspace_scope"]> = {}): BfScopeBlock => ({
  sub_track: "partnership",
  workspace_scope: {
    active: true, overlay_version: "1.0.0", scope_key: "partnership", opted_in: true,
    extra_checklists: ["chk-deal-shape-presigning-checklist"],
    items: {
      "chk-legal-dd-checklist:ldd-01": sc(),
      "chk-legal-dd-checklist:ldd-02": sc({ item_id: "ldd-02", code: "N", overlay_code: "N", judgeable: false, reason: "지분을 인수하지 않습니다" }),
      "chk-deal-shape-presigning-checklist:jvd-01": sc({ checklist_id: "chk-deal-shape-presigning-checklist", item_id: "jvd-01", code: "N", judgeable: false }),
    },
    previous_scope: [
      { checklist_id: "chk-legal-dd-checklist", item_id: "ldd-02", code: "N", status: "fail", assessed_by: "kim", assessed_at: "2026-10-01T09:00:00Z", stays_unmet: true },
      { checklist_id: "chk-technical-dd-checklist", item_id: "tdd-01", code: "X", status: "pass", assessed_by: null, assessed_at: null, stays_unmet: false },
    ],
    counts: { judged: 6, judgeable: 12, workspace_judgeable: 10, excluded: 3, extras_excluded: 4, mandatory_unmet: 1 },
    ...ws,
  },
  ...over,
});

const dom = (checklistId: string, items: WsDomainLike["items"], extra: Partial<WsDomainLike> = {}): WsDomainLike => ({ domain: checklistId, checklistId, title: checklistId, items, ...extra });
const done = { status: "pass" };

describe("bfScopeBlock — which projects get the scoped view", () => {
  test("a scoped sub-track with an active view is returned", () => {
    for (const st of ["jv", "strategic_investment", "minority_investment", "partnership", "rbd", "corporate_venture"]) {
      expect(bfScopeBlock(block({ sub_track: st }))).not.toBeNull();
    }
  });
  test("m_and_a, null sub-track, missing keys and grandfathered payloads produce nothing", () => {
    expect(bfScopeBlock(block({ sub_track: "m_and_a" }))).toBeNull();
    expect(bfScopeBlock(block({ sub_track: "" }))).toBeNull();
    expect(bfScopeBlock(undefined)).toBeNull();
    expect(bfScopeBlock(null)).toBeNull();
    expect(bfJudgedLine(block({ sub_track: "m_and_a" }), [])).toBeNull();
    expect(bfNeedsNaReason(undefined, "chk-legal-dd-checklist")).toBe(false);
    expect(bfPreviousForTab(undefined, "chk-legal-dd-checklist")).toEqual([]);
    expect(isBfExtraTab(undefined, "chk-deal-shape-presigning-checklist")).toBe(false);
  });
  test("sub-track names are the shared Korean labels (i18n re-pin T3-6: common.subTrack.* keys)", () => {
    const ko = JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8")) as Record<string, any>;
    const tr = (key: string): string => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, any>)[k], ko) as string;
    expect(tr(bfSubTrackName("partnership"))).toBe("전략 제휴");
    expect(tr(bfSubTrackName("minority_investment"))).toBe("소수지분 투자");
    expect(bfSubTrackName("zzz")).toBe("zzz");
  });
});

describe("code badges", () => {
  test("every code has an icon and a text label (never colour only), and R reads brownfield-neutral", () => {
    for (const code of ["A", "R", "X", "N"] as const) {
      const m = bfCodeMeta(sc({ code }));
      expect(m.icon.length).toBeGreaterThan(0);
      expect(m.label.startsWith(code)).toBe(true);
      expect(m.label).not.toContain("그린필드");
      expect(m.hint).not.toContain("그린필드");
    }
  });
  test("a fail-closed row says why it is judged as written", () => {
    expect(bfCodeMeta(sc({ rule: "fail_closed" })).ruleText).toContain("승인된 범위 행이 없어");
    expect(bfCodeMeta(sc()).ruleText).toBeNull();
  });
});

describe("single judged line", () => {
  const domains = [
    dom("chk-legal-dd-checklist", [{ id: "ldd-01", state: done, scope: sc() }, { id: "ldd-03", state: null, scope: sc({ item_id: "ldd-03" }) }, { id: "ldd-02", state: done, scope: sc({ code: "N", judgeable: false }) }]),
    dom("chk-hr-dd-checklist", [{ id: "hdd-01", state: done, scope: sc() }]),
    dom("chk-financial-dd-checklist", [{ id: "fdd-01", state: done }], { counted: false }),
    dom("chk-deal-shape-presigning-checklist", [{ id: "jvd-02", state: done, scope: sc() }]),
  ];
  test("X counts judgeable judged workspace items of counted tabs; Y is workspace_judgeable; excluded and extras are separate", () => {
    const line = bfJudgedLine(block(), domains)!;
    expect(line.text).toBe("판정 2 / 10");
    expect(line.excluded).toBe(3);
    expect(line.extrasExcluded).toBe(4);
    expect(line.mandatoryUnmet).toBe(1);
    expect(line.extra).toEqual({ judged: 4, judgeable: 2 }); // counts.judged 6 - 2 workspace; judgeable 12 - 10
  });
  test("replacedCount counts X rows of counted tabs only (helper sentence shows only when > 0)", () => {
    expect(bfJudgedLine(block(), domains)!.replacedCount).toBe(0);
    const withX = [dom("chk-legal-dd-checklist", [{ id: "ldd-09", state: null, scope: sc({ code: "X", replaced_by: [] }) }])];
    expect(bfJudgedLine(block(), withX)!.replacedCount).toBe(1);
  });
  test("no extra line without extra judgeable items; announcement carries the numbers", () => {
    const b = block({}, { counts: { judged: 2, judgeable: 10, workspace_judgeable: 10, excluded: 3, extras_excluded: 0, mandatory_unmet: 0 } });
    const line = bfJudgedLine(b, domains)!;
    expect(line.extra).toBeNull();
    expect(bfCountAnnouncement(line)).toContain("판정 2 / 10");
    expect(bfCountAnnouncement(line)).toContain("트랙 규칙 제외 3건");
    expect(bfCountAnnouncement(null)).toBe("");
  });
});

describe("excluded lists and previous scope", () => {
  test("workspace tabs form one unlabeled group; extra tabs group by section prefix", () => {
    expect(bfExcludedGroups([], false)).toEqual([]);
    const g = bfExcludedGroups([{ id: "ldd-02" }, { id: "ldd-07" }], false);
    expect(g).toHaveLength(1);
    expect(g[0]!.label).toBeNull();
    const ex = bfExcludedGroups([{ id: "lic-01" }, { id: "lic-02" }, { id: "cdv-01" }], true);
    expect(ex.map((x) => x.key)).toEqual(["lic", "cdv"]);
    expect(ex[0]!.label).toContain("2건");
  });
  test("previous scope is filtered per checklist and keeps the unmet flag; line shows code, status and author", () => {
    const prev = bfPreviousForTab(block(), "chk-legal-dd-checklist");
    expect(prev).toHaveLength(1);
    expect(prev[0]!.stays_unmet).toBe(true);
    expect(bfPreviousLine(prev[0]!)).toContain("N 해당 없음");
    expect(bfPreviousLine(prev[0]!)).toContain("미충족");
    expect(bfPreviousLine(prev[0]!)).toContain("kim · 2026-10-01");
  });
});

describe("na reason and extra tabs", () => {
  test("na needs a reason on workspace checklists and attached extras of a scoped project only", () => {
    expect(bfNeedsNaReason(block(), "chk-legal-dd-checklist")).toBe(true);
    expect(bfNeedsNaReason(block(), "chk-deal-shape-presigning-checklist")).toBe(true);
    expect(bfNeedsNaReason(block(), "chk-unknown-checklist")).toBe(false);
    expect(isBfExtraTab(block(), "chk-deal-shape-presigning-checklist")).toBe(true);
    expect(isBfExtraTab(block(), "chk-legal-dd-checklist")).toBe(false);
  });
});

describe("opt-in", () => {
  test("offered only when the server preview says eligible and the scoped view is not already active", () => {
    expect(bfCanOfferOptIn(undefined, { eligible: true })).toBe(true);
    expect(bfCanOfferOptIn(undefined, { eligible: false })).toBe(false);
    expect(bfCanOfferOptIn(undefined, null)).toBe(false);
    expect(bfCanOfferOptIn(block(), { eligible: true })).toBe(false);
  });
  test("error codes of the route map to Korean text", () => {
    for (const code of ["human_only", "role_required", "not_brownfield", "no_scope_change", "already_opted_in", "overlay_unavailable"]) {
      expect(bfScopeErrorText(code, 409, "x")).not.toBe("x");
    }
    expect(bfScopeErrorText(undefined, 403, "")).toContain("권한");
  });
});

describe("components (source reading)", () => {
  const panel = readFileSync("app/web-next/components/stages/BrownfieldScopePanel.tsx", "utf8");
  const stage = readFileSync("app/web-next/components/stages/DdStage.tsx", "utf8");
  test("the panel uses the brownfield opt-in route with a required migration_note and a preview GET", () => {
    expect(panel).toContain("/brownfield-scope/workspace-opt-in");
    expect(panel).toContain("api.get<");
    expect(panel).toContain("api.post(optBase, { migration_note");
    expect(panel).toContain("validateMigrationNote");
  });
  test("the panel renders nothing when the view is inactive and no opt-in is eligible", () => {
    expect(panel).toMatch(/if \(!active && !offer && !notice\) return null/);
  });
  test("the opt-in is a ghost/secondary action; the panel has no primary action outside the confirmation dialog", () => {
    const body = panel.slice(0, panel.indexOf("function BrownfieldOptInDialog"));
    expect(body).not.toContain("btn-premium");
    expect(body).toContain("btn-ghost");
  });
  test("the judged count is announced politely and shown once; no step-to-tab panel (design Q6)", () => {
    expect(panel).toContain('aria-live="polite"');
    expect(panel.match(/data-testid="bf-judged-line"/g)).toHaveLength(1);
    expect(panel).not.toContain("plan_readiness");
    expect(panel).not.toContain("step_tabs");
  });
  test("DdStage mounts the panel only on routes without a greenfield scope, and never while comparing", () => {
    expect(stage).toContain("data && !data.greenfield_scope");
    expect(stage).toContain("previewEnabled={!comparing}");
    expect(stage).toContain("brownfield_scope?: BfScopeBlock");
  });
  test("DdStage adds no brownfield element unless the payload carries the scope: the tab count and notes are gated on the block", () => {
    expect(stage).toContain("const bf = bfScopeBlock(data?.brownfield_scope)");
    expect(stage).toContain("{(ws || bf) && (");
    expect(stage).toContain("if (brownfield && sc.code === \"A\" && sc.rule !== \"fail_closed\") return null");
    expect(stage).toContain("bfNeedsNaReason(data?.brownfield_scope");
  });
  test("brownfield keeps the shared tab labels (HR stays 인사 실사); no greenfield tab-label override is applied to it", () => {
    expect(stage).toContain("tabLabel(data?.greenfield_scope, d)");
    expect(stage).not.toContain("tabLabel(data?.brownfield_scope");
  });
  test("brownfield wording avoids the greenfield-only terms", () => {
    const lib = readFileSync("app/web-next/lib/brownfield-dd-view.ts", "utf8");
    expect(lib).not.toContain("신규 사업");
    expect(lib).not.toContain("그린필드 해석");
    expect(lib).not.toContain("인력/조직 계획");
    expect(panel).not.toContain("신규 사업");
  });
  test("every new Korean string family carries an INTERIM-WORDING marker", () => {
    expect((panel.match(/INTERIM-WORDING/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  test("opt-in extras lines: labelled counts, tolerant of absent or empty field", () => {
    const base = { eligible: true, reason: null, before: { judged: 0, judgeable: 10 }, after: { judged: 0, judgeable: 20, workspace_judgeable: 10, excluded: 2 }, moves_to_previous_scope: [], fails_stay_unmet: [] };
    expect(bfOptInExtrasLines(base)).toEqual([]);
    expect(bfOptInExtrasLines({ ...base, extras_attached_by_opt_in: [] })).toEqual([]);
    const lines = bfOptInExtrasLines({ ...base, extras_attached_by_opt_in: [{ checklist_id: "chk-partnership-checklist", judgeable: 7, excluded: 1 }, { checklist_id: "chk-deal-shape-presigning-checklist", judgeable: 5, excluded: 3 }] });
    expect(lines[0]).toContain("전략 제휴 체크리스트(판정 대상 7건, 제외 1건)");
    expect(lines[0]).toContain("딜 형태 사전 점검(판정 대상 5건, 제외 3건)");
    expect(lines[1]).toContain("판정 X / Y");
    expect(bfExtraChecklistLabel("chk-x")).toBe("chk-x");
  });
});

describe("replaced-item wording and custom proposer (DdStage)", () => {
  const src = readFileSync(new URL("../../app/web-next/components/stages/DdStage.tsx", import.meta.url), "utf8");
  test("human proposals show 제안: user; never the unknown-agent text; self-approval hidden with hint", () => {
    // i18n: proposer wording moved to the catalog (stages.s9.stage.*) — pin the keys.
    expect(src).toContain('stages.s9.stage.noProposerRecord');
    expect(src).not.toContain("알 수 없는 에이전트");
    expect(src).toContain('stages.s9.stage.theProposerCannotApproveIt');
    expect(src).toContain("canAct && !c.is_proposer");
  });
  test("draft-AI chips are trimmed from checklist rows — the item id carries the full tooltip (2026-10-17 round 2)", () => {
    expect(src).toContain('reviewBadge(item).status === "draft-AI" ? t("reviewStatusP1", { p1: DRAFT_AI_MARKER }) : undefined');
    expect(src).toContain('reviewBadge(item).status !== "draft-AI" && <ReviewBadgeChip item={item} />');
    expect(src).toContain('import { DRAFT_AI_MARKER, reviewBadge, type ReviewStatus } from "../../lib/checklist-review-status.ts"');
  });
  test("X rows show pending note until a pointer is pass/fail", async () => {
    const v = await import("../../app/web-next/lib/greenfield-dd-view.ts");
    const ptr = (status: string | null) => ({ checklist_id: "c", item_id: "i", stage: "S9", in_s9: true, status, judged: status === "pass", assessed_by: null, assessed_at: null });
    expect(v.replacementUndecided(sc({ code: "X", replaced_by: [ptr("pending")] }))).toBe(true);
    expect(v.replacementUndecided(sc({ code: "X", replaced_by: [ptr("fail")] }))).toBe(false);
    expect(v.replacementUndecided(sc({ code: "A" }))).toBe(false);
    expect(v.REPLACED_JUDGED_HELP).toContain("그때까지는 이 숫자에 포함됩니다");
  });
});
