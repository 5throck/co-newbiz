import { describe, expect, test } from "bun:test";
import { buildBreach, computeReadiness, familyStatus } from "../../app/web-next/lib/gate-integrity-readiness.ts";
import {
  FAMILY_ORDER, KPI_GROUPS, breachActions, isEmptyKpi, notReadyText, runbookHref, sortFamilies, type Kpi,
} from "../../app/web-next/lib/gate-integrity-kpis-view.ts";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

const kpi = (o: Partial<Kpi> & { id: string }): Kpi => ({ name: o.id, li: false, li_families: [], period: null, value: null, numerator: 0, denominator: 0, rate: null, breach: { breached: false, reasons: [], items: [] }, status: "ok", ...o });

describe("readiness verdict (14 clean days, >=10 decisions, zero would-blocks)", () => {
  test("ready only when all three hold in shadow", () => {
    expect(computeReadiness({ mode: "shadow", cleanDays: 14, decisions: 10, wouldBlocks14d: 0 })).toEqual({ state: "ready" });
  });
  test("each shortfall is a separate reason", () => {
    const v = computeReadiness({ mode: "shadow", cleanDays: 9, decisions: 3, wouldBlocks14d: 2 });
    expect(v).toEqual({ state: "not_yet", reasons: [{ code: "would_blocks_open", count: 2 }, { code: "clean_days_short", days: 9, need: 14 }, { code: "decisions_few", count: 3, need: 10 }] });
  });
  test("off is never ready; enforce is reported as enforcing", () => {
    const off = computeReadiness({ mode: "off", cleanDays: 90, decisions: 99, wouldBlocks14d: 0 });
    expect(off).toEqual({ state: "not_yet", reasons: [{ code: "mode_off" }] });
    expect(computeReadiness({ mode: "enforce", cleanDays: 0, decisions: 0, wouldBlocks14d: 5 })).toEqual({ state: "enforcing" });
  });
  test("the minimum-decision parameter is honoured", () => {
    expect(computeReadiness({ mode: "shadow", cleanDays: 20, decisions: 4, wouldBlocks14d: 0, minDecisions: 3 }).state).toBe("ready");
    expect(familyStatus("waiver", "shadow", { cleanDays: 20, decisions: 4, wouldBlocks14d: 0 }, 5).verdict.state).toBe("not_yet");
  });
});

describe("structured breach codes", () => {
  test("buildBreach keeps the English text and the code list parallel", () => {
    const b = buildBreach([["wacc_provisional", { count: 4 }, "4 project(s) at S8 or later with a provisional discount rate"]]);
    expect(b).toEqual({ breached: true, reasons: ["4 project(s) at S8 or later with a provisional discount rate"], items: [{ code: "wacc_provisional", params: { count: 4 } }] });
    expect(buildBreach([]).breached).toBe(false);
  });
  test("actions: structured findings get a fix link, ordered by priority; unknown ones link to the card", () => {
    const g7 = kpi({ id: "G7", breach: buildBreach([["countersign_pending_old", { count: 2 }, "x"], ["reviewer_holders_low", { role: "entity-ic-reviewer" }, "y"]]) });
    const g11 = kpi({ id: "G11", breach: buildBreach([["wacc_provisional", { count: 4 }, "z"]]) });
    const g2 = kpi({ id: "G2", breach: { breached: true, reasons: ["legacy text"] } });
    const acts = breachActions([g2, g7, g11]);
    expect(acts.map((a) => a.code)).toEqual(["reviewer_holders_low", "wacc_provisional", "countersign_pending_old", "unknown"]);
    expect(acts[0].href).toBe("/admin/users");
    expect(acts[1].href).toBe("/projects");
    expect(acts[3]).toMatchObject({ href: "#kpi-G2", fallback: "legacy text" });
  });
  test("pending / unavailable KPIs produce no actions", () => {
    expect(breachActions([kpi({ id: "G3", status: "migration_pending", breach: buildBreach([["would_block_events", { count: 1 }, "e"]]) })])).toEqual([]);
  });
});

describe("label mapping and layout", () => {
  const dig = (o: any, path: string) => path.split(".").reduce((a, k) => a?.[k], o);
  test("every family, breach code, group and not-ready reason has ko and en text", () => {
    const codes = ["go_share_high", "go_share_shift", "divergence_zero", "divergence_high", "divergence_reason_missing", "would_block_events", "rationale_rejections_high", "ack_reason_reused", "unassessed_high", "would_block_unexplained", "countersign_pending_old", "countersign_slow", "reviewer_holders_low", "conditions_old", "group_ic_conditions_open", "waivers_old", "na_unconfirmed_old", "wacc_provisional"];
    for (const loc of [ko, en] as any[]) {
      const g = loc.admin.gateIntegrity;
      for (const f of FAMILY_ORDER) { expect(g.family[f].name).toBeTruthy(); expect(g.family[f].desc).toBeTruthy(); }
      for (const c of codes) expect(g.actions.text[c]).toBeTruthy();
      for (const grp of KPI_GROUPS) expect(g.group[grp.id].title).toBeTruthy();
      for (const r of [{ code: "mode_off" }, { code: "would_blocks_open", count: 1 }, { code: "clean_days_short", days: 1, need: 14 }, { code: "decisions_few", count: 1, need: 10 }] as const) expect(dig(g, notReadyText(r).key)).toBeTruthy();
      expect(loc.admin.labels.kpiKey.target_screening).toBeTruthy();
    }
    expect(dig(ko, "admin.gateIntegrity.family.maker_checker.name")).toContain("기록자·확인자");
    expect(ko.admin.labels.kpiKey.target_screening).toBe("대상 심사");
  });
  test("groups cover G1-G12 exactly once", () => {
    expect(KPI_GROUPS.flatMap((g) => [...g.ids]).sort()).toEqual(["G1", "G10", "G11", "G12", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9"]);
  });
  test("empty detection: all-zero, unbreached KPIs are empty; G12 and breached ones never", () => {
    expect(isEmptyKpi(kpi({ id: "G8", value: { open: 0, older_than_30_days: 0, oldest_age_days: null } }))).toBe(true);
    expect(isEmptyKpi(kpi({ id: "G8", value: { open: 3 }, denominator: 3 }))).toBe(false);
    expect(isEmptyKpi(kpi({ id: "G12", value: { min_writes: 10 } }))).toBe(false);
    expect(isEmptyKpi(kpi({ id: "G9", value: { active: 0 }, breach: buildBreach([["waivers_old", { count: 1 }, "w"]]) }))).toBe(false);
    expect(isEmptyKpi(kpi({ id: "G9", status: "unavailable" }))).toBe(false);
  });
  test("families sort in the runbook's flip order; the runbook link follows the language", () => {
    const rows = ["maker_checker", "rationale", "wacc"].map((f) => familyStatus(f, "shadow", { cleanDays: 0, decisions: 0, wouldBlocks14d: 0 }));
    expect(sortFamilies(rows).map((r) => r.family)).toEqual(["rationale", "wacc", "maker_checker"]);
    expect(runbookHref("ko")).toContain("rb-gate-integrity-enforce-flip-ko");
    expect(runbookHref("en")).toBe("/library?doc=rb-gate-integrity-enforce-flip");
  });
});
