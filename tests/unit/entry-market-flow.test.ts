// @version 1.2.0
/**
 * ADR-0179 presentational consolidation - the pure gating/status derivation
 * for the consolidated EntryMarketFlow card on the S2 opportunity page.
 * Covers the decider gating rules:
 *   1. no S1 link -> steps 2-3 disabled with a reason and the path forward
 *   2. link but no scope -> step 3 warns the scope verdict cannot be graded
 *   3. rail chips (auto/manual/none, scope set/unset, derivation set/unset,
 *      newer-version hint)
 *   4. TAB MODEL REMOVED (2026-10-17 decider decision, reverting PR #615):
 *      the three steps render STACKED and always visible in one flow; the
 *      step labels survive as SECTION headers with their status chips. The
 *      tab control (deriveEntryTabs / EntryTab / EntryTabKey, TabNav,
 *      role=tabpanel) is gone from lib and component.
 * NO API/behavior change - presentational step/rail logic only.
 * ASCII-only source (Korean via \u escapes).
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import {
  deriveEntryFlowStatus,
  STEP1_LINK_AUTO,
  STEP1_LINK_MANUAL,
  STEP1_LINK_NONE,
  STEP2_SET,
  STEP2_UNSET,
  STEP3_SET,
  STEP3_UNSET,
  DISABLE_REASON,
  SCOPE_WARNING,
  TAB1_LABEL,
  TAB2_LABEL,
  TAB3_LABEL,
} from "../../app/web-next/lib/entry-market-flow.ts";

const COMPONENT_SOURCE = readFileSync(
  new URL("../../app/web-next/components/EntryMarketFlow.tsx", import.meta.url),
  "utf8",
);
const LIB_SOURCE = readFileSync(
  new URL("../../app/web-next/lib/entry-market-flow-state.ts", import.meta.url),
  "utf8",
);
const PAGE_SOURCE = readFileSync(
  new URL("../../app/web-next/app/opportunities/[id]/page.tsx", import.meta.url),
  "utf8",
);
// the placement predecessor section labels (Korean via \u escapes above;
// predecessors) and the card, as ASCII-only \u escapes.
const SKETCH_SECTION = `aria-label="\uBE44\uC988\uB2C8\uC2A4\u0020\uBAA8\uB378\u0020\uAC80\uD1A0"`;
const FACTORS_SECTION = `aria-label="\uAE30\uD68C\u00B7\uC704\uD5D8\u0020\uC694\uC778"`;
const CARD_RENDER = "EntryMarketFlow opportunityId";

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

  test("manual link chip and step-3 scope warning independent of derivation", () => {
    const s = deriveEntryFlowStatus({ ...base(), linkProvenance: "manual", newerVersionAvailable: true });
    expect(s.step1.label).toBe(STEP1_LINK_MANUAL);
    expect(s.newerHint).not.toBeNull();
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

describe("tab control removed - steps render stacked (PR #615 revert)", () => {
  test("the lib tab model is gone (deriveEntryTabs / EntryTab / EntryTabKey)", () => {
    expect(LIB_SOURCE.includes("deriveEntryTabs")).toBe(false);
    expect(LIB_SOURCE.includes("EntryTabKey")).toBe(false);
    expect(LIB_SOURCE.includes("interface EntryTab ")).toBe(false);
  });

  test("the component has no tab control and renders three always-visible sections", () => {
    // no tab machinery of any kind on the card
    expect(COMPONENT_SOURCE.includes("TabNav")).toBe(false);
    expect(COMPONENT_SOURCE.includes("activeTab")).toBe(false);
    expect(COMPONENT_SOURCE.includes("role=\"tabpanel\"")).toBe(false);
    expect(COMPONENT_SOURCE.includes("deriveEntryTabs")).toBe(false);
    // the three stacked step sections, always rendered (no conditional wrapper)
    expect(COMPONENT_SOURCE.includes('data-testid="entry-flow-steps"')).toBe(true);
    expect(COMPONENT_SOURCE.includes('data-testid="entry-flow-step-section-link"')).toBe(true);
    expect(COMPONENT_SOURCE.includes('data-testid="entry-flow-step-section-scope"')).toBe(true);
    expect(COMPONENT_SOURCE.includes('data-testid="entry-flow-step-section-derivation"')).toBe(true);
    // per-step status chips survive on the section headers
    expect(COMPONENT_SOURCE.includes('data-testid="entry-flow-step-link"')).toBe(true);
    expect(COMPONENT_SOURCE.includes('data-testid="entry-flow-step-scope"')).toBe(true);
    expect(COMPONENT_SOURCE.includes('data-testid="entry-flow-step-derivation"')).toBe(true);
    // the newer-version hint stays on step 1's header
    expect(COMPONENT_SOURCE.includes("data-testid=\"entry-flow-newer-hint\"")).toBe(true);
  });

  test("step labels survive as section headers", () => {
    expect(COMPONENT_SOURCE.includes("{TAB1_LABEL}")).toBe(true);
    expect(COMPONENT_SOURCE.includes("{TAB2_LABEL}")).toBe(true);
    expect(COMPONENT_SOURCE.includes("{TAB3_LABEL}")).toBe(true);
    expect(TAB1_LABEL.length).toBeGreaterThan(0);
    expect(TAB2_LABEL.length).toBeGreaterThan(0);
    expect(TAB3_LABEL.length).toBeGreaterThan(0);
  });

  test("card renders AFTER the factors and business-model sections (placement)", () => {
    const cardAt = PAGE_SOURCE.indexOf(CARD_RENDER);
    expect(cardAt).toBeGreaterThan(-1);
    const factorsAt = PAGE_SOURCE.indexOf(FACTORS_SECTION);
    const sketchAt = PAGE_SOURCE.indexOf(SKETCH_SECTION);
    expect(factorsAt).toBeGreaterThan(-1);
    expect(sketchAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(factorsAt);
    expect(cardAt).toBeGreaterThan(sketchAt);
    // exactly one card render on the page
    expect(PAGE_SOURCE.split(CARD_RENDER).length - 1).toBe(1);
  });

  test("disable reason stays available for the gated bodies (they still explain)", () => {
    const s = deriveEntryFlowStatus({ linkProvenance: "none", newerVersionAvailable: false, scopeSet: false, derivationSet: false });
    expect(s.disableReason).toBe(DISABLE_REASON);
  });
});
