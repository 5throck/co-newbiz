// @version 1.1.0
/**
 * ADR-0179 presentational consolidation - the pure gating/status derivation
 * for the consolidated EntryMarketFlow card on the S2 opportunity page.
 * Covers the decider gating rules:
 *   1. no S1 link -> steps 2-3 disabled with a reason and the path forward
 *   2. link but no scope -> step 3 warns the scope verdict cannot be graded
 *   3. rail chips (auto/manual/none, scope set/unset, derivation set/unset,
 *      newer-version hint)
 *   4. tab model (2026-10-17 decider feedback): each tab keeps its own
 *      status chip; locked tabs 2-3 stay VISIBLE with their chips and their
 *      bodies render the disable reason; tab 1 carries the newer hint.
 * NO API/behavior change - presentational tab/rail logic only.
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, describe } from "bun:test";
import {
  deriveEntryFlowStatus,
  deriveEntryTabs,
  STEP1_LINK_AUTO,
  STEP1_LINK_MANUAL,
  STEP1_LINK_NONE,
  STEP2_SET,
  STEP2_UNSET,
  STEP3_SET,
  STEP3_UNSET,
  NEWER_HINT,
  DISABLE_REASON,
  SCOPE_WARNING,
  TAB1_LABEL,
  TAB2_LABEL,
  TAB3_LABEL,
} from "../../app/web-next/lib/entry-market-flow.ts";

type FlowInput = Parameters<typeof deriveEntryFlowStatus>[0];

function base(): FlowInput {
  return { linkProvenance: "none", newerVersionAvailable: false, scopeSet: false, derivationSet: false };
}

describe("entry market flow status rail", () => {
  test("no link disables steps 2-3 with reason and path forward", () => {
    const s = deriveEntryFlowStatus(base());
    expect(s.steps23Enabled).toBe(false);
    expect(s.disableReason).toBe(DISABLE_REASON);
  });

  test("no link: no step-3 scope warning while gating dominates", () => {
    const s = deriveEntryFlowStatus(base());
    expect(s.step3ScopeWarning).toBeNull();
  });

  test("link without scope warns on step 3 but keeps it enabled", () => {
    const s = deriveEntryFlowStatus({ ...base(), linkProvenance: "manual", scopeSet: false });
    expect(s.steps23Enabled).toBe(true);
    expect(s.disableReason).toBeNull();
    expect(s.step3ScopeWarning).toBe(SCOPE_WARNING);
  });

  test("link and scope enable everything with no warnings", () => {
    const s = deriveEntryFlowStatus({ ...base(), linkProvenance: "auto", scopeSet: true });
    expect(s.steps23Enabled).toBe(true);
    expect(s.disableReason).toBeNull();
    expect(s.step3ScopeWarning).toBeNull();
  });

  test("rail chips: auto link, scope set, derivation set", () => {
    const s = deriveEntryFlowStatus({ ...base(), linkProvenance: "auto", scopeSet: true, derivationSet: true });
    expect(s.step1.label).toBe(STEP1_LINK_AUTO);
    expect(s.step1.tone).toBe("info");
    expect(s.step2.label).toBe(STEP2_SET);
    expect(s.step2.tone).toBe("info");
    expect(s.step3.label).toBe(STEP3_SET);
    expect(s.step3.tone).toBe("info");
    expect(s.newerHint).toBeNull();
  });

  test("rail chips: none link, scope unset, derivation unset", () => {
    const s = deriveEntryFlowStatus(base());
    expect(s.step1.label).toBe(STEP1_LINK_NONE);
    expect(s.step1.tone).toBe("muted");
    expect(s.step2.label).toBe(STEP2_UNSET);
    expect(s.step2.tone).toBe("muted");
    expect(s.step3.label).toBe(STEP3_UNSET);
    expect(s.step3.tone).toBe("muted");
  });

  test("manual link chip and newer-version hint", () => {
    const s = deriveEntryFlowStatus({ ...base(), linkProvenance: "manual", newerVersionAvailable: true });
    expect(s.step1.label).toBe(STEP1_LINK_MANUAL);
    expect(s.newerHint).toBe(NEWER_HINT);
  });

  test("newer-version hint suppressed without a link", () => {
    const s = deriveEntryFlowStatus({ ...base(), newerVersionAvailable: true });
    expect(s.newerHint).toBeNull();
  });

  test("derivation set with scope unset still warns (step3 tone independent)", () => {
    const s = deriveEntryFlowStatus({ ...base(), linkProvenance: "manual", derivationSet: true });
    expect(s.step3.label).toBe(STEP3_SET);
    expect(s.step3ScopeWarning).toBe(SCOPE_WARNING);
  });
});

describe("entry market flow tab model", () => {
  test("three tabs with per-tab status chips; tab keys stable", () => {
    const s = deriveEntryFlowStatus({ linkProvenance: "auto", newerVersionAvailable: false, scopeSet: true, derivationSet: true });
    const tabs = deriveEntryTabs(s);
    expect(tabs.map((t) => t.key)).toEqual(["link", "scope", "derivation"]);
    expect(tabs[0].label).toBe(TAB1_LABEL);
    expect(tabs[1].label).toBe(TAB2_LABEL);
    expect(tabs[2].label).toBe(TAB3_LABEL);
    expect(tabs[0].chip.label).toBe(STEP1_LINK_AUTO);
    expect(tabs[1].chip.label).toBe(STEP2_SET);
    expect(tabs[2].chip.label).toBe(STEP3_SET);
  });

  test("locked tabs 2-3 stay visible with chips but are marked locked", () => {
    const tabs = deriveEntryTabs(deriveEntryFlowStatus({ linkProvenance: "none", newerVersionAvailable: false, scopeSet: false, derivationSet: false }));
    expect(tabs[0].locked).toBe(false);
    expect(tabs[1].locked).toBe(true);
    expect(tabs[2].locked).toBe(true);
    // Locked tabs still carry a chip — a person can SEE the state.
    expect(tabs[1].chip.label).toBe(STEP2_UNSET);
    expect(tabs[2].chip.label).toBe(STEP3_UNSET);
  });

  test("locked tabs unlock (and their bodies explain instead) once linked", () => {
    const tabs = deriveEntryTabs(deriveEntryFlowStatus({ linkProvenance: "manual", newerVersionAvailable: false, scopeSet: false, derivationSet: false }));
    expect(tabs[1].locked).toBe(false);
    expect(tabs[2].locked).toBe(false);
  });

  test("newer-version hint rides tab 1 only", () => {
    const s = deriveEntryFlowStatus({ linkProvenance: "manual", newerVersionAvailable: true, scopeSet: true, derivationSet: true });
    const tabs = deriveEntryTabs(s);
    expect(tabs[0].newerHint).toBe(NEWER_HINT);
    expect(tabs[1].newerHint).toBeNull();
    expect(tabs[2].newerHint).toBeNull();
  });

  test("disable reason stays available for the locked bodies (they still explain)", () => {
    const s = deriveEntryFlowStatus({ linkProvenance: "none", newerVersionAvailable: false, scopeSet: false, derivationSet: false });
    expect(s.disableReason).toBe(DISABLE_REASON);
  });
});
