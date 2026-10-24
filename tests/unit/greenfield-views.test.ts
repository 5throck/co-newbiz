// @version 1.0.0
// Pure view helpers for the greenfield S9 sub-track panel and S10 establishment structure (ADR-0160).
import { test, expect, describe } from "bun:test";
import {
  needsNaReason, s9Heading, scopeErrorText, siteFormMissing, showStepList, showSubTrackPanel, siteControlState, siteDisclosureLabel, splitScopeWarnings, validateNaReason, validateOptIn, validateSiteForm,
  type GfScope,
} from "../../app/web-next/lib/greenfield-dd-view.ts";
import {
  allowedTrancheTransitions, balanceView, buildHypothesisPayload, hypothesisFieldVisibility, nextTrancheNo, trancheEditable, trancheSummary, validateTrancheForm,
  type HypothesisForm, type TrancheView,
} from "../../app/web-next/lib/greenfield-structure-view.ts";




// i18n re-pin (T3-6): s9Heading now emits common.gf.* catalog keys — resolve through a ko stub translator.
import { readFileSync } from "node:fs";
const koCatalog = JSON.parse(readFileSync("app/web-next/locales/ko.json", "utf8")) as Record<string, any>;
const trKo = (key: string): string => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, any>)[k], koCatalog) as string;

const scope = (over: Partial<GfScope> = {}): GfScope => ({
  sub_track: "existing_business_rbd", sub_track_class: "existing_business_rbd", selection_active: true, opted_in: false,
  extra_checklists: ["chk-rbd-technology-checklist"],
  site: { site_required: null, basis: "unconfirmed", site_steps_apply: true },
  na_reason_checklists: ["chk-rbd-technology-checklist"], excluded_steps: [2, 8], warnings: [], ...over,
});

describe("S9 sub-track view", () => {
  test("null sub-track shows no new panel and keeps the legacy heading", () => {
    const none = scope({ sub_track: null, sub_track_class: "none", extra_checklists: [], na_reason_checklists: [], excluded_steps: [6, 7, 8] });
    expect(showSubTrackPanel(none)).toBe(false);
    expect(showStepList(none)).toBe(false);
    expect(trKo(s9Heading(none))).toBe("S9 실사·검증 — DD 체크리스트 판정");
    expect(trKo(s9Heading(undefined))).toBe("S9 실사·검증 — DD 체크리스트 판정"); // brownfield: no scope at all
    expect(showSubTrackPanel(null)).toBe(false);
  });
  test("unknown sub-track shows a warning panel but no step list and the legacy heading", () => {
    const unk = scope({ sub_track: "partnership", sub_track_class: "unknown", extra_checklists: [], excluded_steps: [6, 7, 8], warnings: ["w"] });
    expect(showSubTrackPanel(unk)).toBe(true);
    expect(showStepList(unk)).toBe(false);
    expect(trKo(s9Heading(unk))).toBe("S9 실사·검증 — DD 체크리스트 판정");
  });
  test("named sub-track uses the plan-verification heading only when the selection is active", () => {
    expect(trKo(s9Heading(scope()))).toContain("계획 검증");
    expect(trKo(s9Heading(scope({ selection_active: false })))).toBe("S9 실사·검증 — DD 체크리스트 판정");
  });
});

describe("site_required control state", () => {
  test("unconfirmed existing_business_rbd: site steps apply", () => {
    const s = siteControlState(scope(), "u1");
    expect(s.kind).toBe("unconfirmed");
    expect(s.siteStepsApply).toBe(true);
    expect(s.text).toBe("부지: 아직 확인하지 않았습니다 — 확인 전에는 부지 관련 단계(1, 3)가 포함됩니다");
    expect(s.icon).toBe("ⓘ"); // neutral info, not the red cross
    expect(s.text).not.toContain("미확인");
  });
  test("disclosure label and the no-default warning becoming an info note", () => {
    expect(siteDisclosureLabel("unconfirmed")).toBe("부지 필요 여부 정하기");
    expect(siteDisclosureLabel("confirmed")).toBe("다시 확인하기");
    const split = splitScopeWarnings(["기존사업 R&BD·사내벤처 세부 트랙은 부지 필요 여부의 기본값이 없습니다 — x.", "알 수 없는 값입니다"]);
    expect(split.notes).toHaveLength(1);
    expect(split.warnings).toEqual(["알 수 없는 값입니다"]);
  });
  test("a legacy pending assertion is ignored: unconfirmed stays unconfirmed, confirmed shows who/when", () => {
    const pending = { id: "a1", value: false, asserted_by: "u1", rationale: "r" };
    const sc = scope({ site: { site_required: null, basis: "unconfirmed", site_steps_apply: true, pending_assertion: pending } });
    const st = siteControlState(sc, "u1");
    expect(st.kind).toBe("unconfirmed");
    expect(st.siteStepsApply).toBe(true);
    const done = siteControlState(scope({ site: { site_required: false, basis: "confirmed", site_steps_apply: false, confirmed_by: "u1", confirmed_at: "2026-10-12" } }), "u1");
    expect(done.kind).toBe("confirmed");
    expect(done.text).toContain("u1");
    expect(done.text).not.toContain("검토");
  });
  test("confirmed and default states", () => {
    expect(siteControlState(scope({ site: { site_required: false, basis: "confirmed", site_steps_apply: false } }), "u").kind).toBe("confirmed");
    const d = siteControlState(scope({ sub_track_class: "intra_venture", site: { site_required: null, basis: "unconfirmed", site_steps_apply: true } }), "u");
    // intra_venture has no site_required default (like existing_business_rbd): site steps apply until a person confirms.
    expect(d.kind).toBe("unconfirmed");
    expect(d.siteStepsApply).toBe(true);
    const dflt = siteControlState(scope({ site: { site_required: false, basis: "default", site_steps_apply: false } }), "u");
    expect(dflt.kind).toBe("default");
    expect(dflt.siteStepsApply).toBe(false);
  });
  test("form validation", () => {
    expect(validateSiteForm({ value: null, rationale: "a" })).toContain("선택");
    expect(validateSiteForm({ value: true, rationale: " " })).toContain("근거");
    expect(validateSiteForm({ value: false, rationale: "a" })).toBeNull();
    expect(validateOptIn(" ")).not.toBeNull();
    expect(validateOptIn("n")).toBeNull();
  });
});

describe("na reason item-level", () => {
  const site = scope({ extra_checklists: [], na_reason_checklists: ["chk-technical-dd-checklist"] });
  test("technical DD needs a reason only on tdd-01 and tdd-02", () => {
    expect(needsNaReason(site, "chk-technical-dd-checklist", "tdd-01")).toBe(true);
    expect(needsNaReason(site, "chk-technical-dd-checklist", "tdd-02")).toBe(true);
    expect(needsNaReason(site, "chk-technical-dd-checklist", "tdd-03")).toBe(false);
    expect(needsNaReason(site, "chk-legal-dd-checklist", "ldd-01")).toBe(false);
  });
  test("sub-track extra checklists keep whole-checklist scope", () => {
    expect(needsNaReason(scope(), "chk-rbd-technology-checklist", "any-item")).toBe(true);
  });
});

describe("na reason", () => {
  test("only sub-track-ruled checklists need a reason; brownfield (no scope) never", () => {
    expect(needsNaReason(scope(), "chk-rbd-technology-checklist")).toBe(true);
    expect(needsNaReason(scope(), "chk-legal-dd-checklist")).toBe(false);
    expect(needsNaReason(undefined, "chk-rbd-technology-checklist")).toBe(false);
    expect(validateNaReason("  ")).not.toBeNull();
    expect(validateNaReason("해당 없음 사유")).toBeNull();
  });
});

const form = (over: Partial<HypothesisForm> = {}): HypothesisForm => ({
  vehicle: "spc", asset_or_stock: "asset", stake_type: "majority", instrument_mix: "primary",
  tax_structure_note: "", liability_isolation_note: "", financing_leverage_note: "", exit_structure_note: "", rationale: "r", ...over,
});

describe("S10 hypothesis fields", () => {
  test("brownfield: all fields visible and payload keeps them (previous shape)", () => {
    expect(hypothesisFieldVisibility(false, "")).toEqual({ assetOrStock: true, stakeType: true, instrumentMix: true });
    const p = buildHypothesisPayload(false, form());
    expect(p).toMatchObject({ action: "hypothesize", vehicle: "spc", asset_or_stock: "asset", stake_type: "majority", instrument_mix: "primary" });
    expect(buildHypothesisPayload(false, form({ vehicle: "", asset_or_stock: "", stake_type: "", instrument_mix: "" }))).toMatchObject({ vehicle: null, asset_or_stock: null, stake_type: null, instrument_mix: null });
  });
  test("greenfield: M&A-only fields hidden; stake only for a JV vehicle", () => {
    expect(hypothesisFieldVisibility(true, "spc")).toEqual({ assetOrStock: false, stakeType: false, instrumentMix: false });
    expect(hypothesisFieldVisibility(true, "jv").stakeType).toBe(true);
    const p = buildHypothesisPayload(true, form());
    expect(p).toMatchObject({ asset_or_stock: null, stake_type: null, instrument_mix: null, vehicle: "spc" });
    expect(buildHypothesisPayload(true, form({ vehicle: "jv" }))).toMatchObject({ stake_type: "majority", asset_or_stock: null, instrument_mix: null });
  });
});

const tr = (over: Partial<TrancheView> = {}): TrancheView => ({ id: "t", tranche_no: 1, amount: 100, currency: "KRW", release_condition: "c", status: "planned", status_reason: null, source_stage: "S10", ...over });

describe("capex tranches", () => {
  test("form validation mirrors the server", () => {
    const ok = { trancheNo: "1", amount: "10", currency: "KRW", releaseCondition: "c" };
    expect(validateTrancheForm(ok)).toBeNull();
    expect(validateTrancheForm({ ...ok, trancheNo: "0" })).toContain("정수");
    expect(validateTrancheForm({ ...ok, trancheNo: "1.5" })).toContain("정수");
    expect(validateTrancheForm(ok, [1])).toContain("이미");
    expect(validateTrancheForm({ ...ok, amount: "" })).toContain("0보다");
    expect(validateTrancheForm({ ...ok, amount: "-3" })).toContain("0보다");
    expect(validateTrancheForm({ ...ok, currency: "krw" })).toContain("대문자");
    expect(validateTrancheForm({ ...ok, currency: "" })).toBeNull(); // server defaults to KRW
    expect(validateTrancheForm({ ...ok, releaseCondition: " " })).toContain("집행 조건");
  });
  test("transitions: released is terminal and immutable", () => {
    expect(allowedTrancheTransitions("planned")).toEqual(["released", "withheld"]);
    expect(allowedTrancheTransitions("withheld")).toEqual(["planned", "released"]);
    expect(allowedTrancheTransitions("released")).toEqual([]);
    expect(trancheEditable("released")).toBe(false);
    expect(trancheEditable("withheld")).toBe(true);
  });
  test("next number and per-currency summary never mix currencies", () => {
    expect(nextTrancheNo([])).toBe(1);
    expect(nextTrancheNo([{ tranche_no: 1 }, { tranche_no: 4 }])).toBe(5);
    const s = trancheSummary([tr({ amount: 100 }), tr({ id: "b", tranche_no: 2, amount: 50, status: "released" }), tr({ id: "c", tranche_no: 3, amount: 5, currency: "USD", status: "withheld" })]);
    expect(s).toEqual([
      { currency: "KRW", total: 150, planned: 100, released: 50, withheld: 0 },
      { currency: "USD", total: 5, planned: 0, released: 0, withheld: 5 },
    ]);
  });
});

describe("sources = uses", () => {
  test("states", () => {
    expect(balanceView(undefined)).toBeNull();
    expect(balanceView({ sources: 0, uses: 0, balanced: false })!.text).toContain("아직 없습니다");
    expect(balanceView({ sources: 10, uses: 10, balanced: true })).toMatchObject({ balanced: true, text: "조달 = 사용 — 균형" });
    expect(balanceView({ sources: 12, uses: 10, balanced: false })!.text).toContain("많습니다");
    expect(balanceView({ sources: 8, uses: 10, balanced: false })!.text).toContain("부족합니다");
  });
});

describe("site form guidance and scope errors", () => {
  test("lists what is missing, in field order", () => {
    expect(siteFormMissing({ value: null, rationale: "" })).toEqual(["부지 필요 여부 선택", "확인 근거"]);
    expect(siteFormMissing({ value: false, rationale: "r" })).toEqual([]);
  });
  test("every failure code maps to readable Korean", () => {
    for (const c of ["no_run", "human_only", "role_required", "not_greenfield", "already_opted_in", "not_found", "write_rejected", "invalid_request"]) {
      expect(scopeErrorText(c, 409, "m")).toMatch(/[가-힣]/);
    }
    expect(scopeErrorText("no_run", 409, "m")).toContain("run");
    expect(scopeErrorText(undefined, 403, "")).toMatch(/권한/);
  });
  test("confirmed text has no review wording", () => {
    expect(siteControlState(scope({ site: { site_required: true, basis: "confirmed", site_steps_apply: true } }), "u").text).not.toContain("검토");
  });
});
