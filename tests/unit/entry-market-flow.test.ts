// @version 1.0.0
/**
 * ADR-0179 presentational consolidation - the pure gating/status derivation
 * for the consolidated EntryMarketFlow card on the S2 opportunity page.
 * Covers the decider gating rules:
 *   1. no S1 link -> steps 2-3 disabled with a reason and the path forward
 *   2. link but no scope -> step 3 warns the scope verdict cannot be graded
 *   3. rail chips (auto/manual/none, scope set/unset, derivation set/unset,
 *      newer-version hint)
 * NO API/behavior change - presentational status-rail logic only.
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, describe } from "bun:test";
import {
  deriveEntryFlowStatus,
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
