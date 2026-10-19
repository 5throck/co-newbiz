// @version 1.0.0
/**
 * 2026-10-17 entry-market flow redesign slices 1+2 - the pure FlowState
 * machine, header-strip derivation and the derivation-step form mappers
 * (lib/entry-market-flow-state.ts). ASCII-only source (Korean via \u).
 */
import { test, expect, describe } from "bun:test";
import {
  deriveFlowState,
  anchorLegacyLine,
  derivedValueLine,
  s1Line,
  STATE_CHIP_DERIVED,
  STATE_CHIP_LEGACY_ANCHOR,
  STATE_CHIP_UNLINKED,
  ANCHOR_DEFAULT_LINE,
  STALE_LINE,
  REPIN_WARNING,
  UNLINK_CHAIN_WARNING,
  DERIVATION_BASE_STEP_COUNT,
  BASE_STEP_LABELS,
  EXTRA_STEP_LABEL,
  EMPTY_DERIVATION_STEP,
  emptyDerivationSteps,
  derivationStepToForm,
  derivationStepFromForm,
  buildDerivationSavePayload,
  derivationFormError,
  marketBriefExample,
} from "../../app/web-next/lib/entry-market-flow-state.ts";
import * as shim from "../../app/web-next/lib/entry-market-flow.ts";

type FlowInput = Parameters<typeof deriveFlowState>[0];

function base(): FlowInput {
  return {
    linkProvenance: "none",
    newerVersionAvailable: false,
    scopeSet: false,
    derivationSet: false,
    computed: null,
    legacyAnchor: null,
    s1: null,
  };
}

describe("flow state machine", () => {
  test("UNLINKED: muted chip, default anchor line, no S1 line", () => {
    const fs = deriveFlowState(base());
    expect(fs.state).toBe("UNLINKED");
    expect(fs.stale).toBe(false);
    expect(fs.anchorInForce).toBe("legacy_default");
    expect(fs.header.stateChipLabel).toBe(STATE_CHIP_UNLINKED);
    expect(fs.header.stateChipTone).toBe("muted");
    expect(fs.header.s1Line).toBeNull();
    expect(fs.header.anchorLine).toBe(ANCHOR_DEFAULT_LINE);
  });

  test("LINKED_UNSCOPED: legacy-opportunity anchor in force, legacy line", () => {
    const fs = deriveFlowState({ ...base(), linkProvenance: "manual", legacyAnchor: { market_size_krw_m: 80000, growth_rate: 0.03 } });
    expect(fs.state).toBe("LINKED_UNSCOPED");
    expect(fs.anchorInForce).toBe("legacy_opportunity");
    expect(fs.header.stateChipLabel).toBe(STATE_CHIP_LEGACY_ANCHOR);
    expect(fs.header.anchorLine).toBe(anchorLegacyLine({ market_size_krw_m: 80000, growth_rate: 0.03 }));
    expect(fs.header.anchorLine.startsWith("80,000")).toBe(false);
    expect(fs.header.anchorLine).toContain("80,000");
    expect(fs.warnings.disableReason).toBeNull();
  });

  test("LINKED_SCOPED: same anchor order, no scope warning on the chip line", () => {
    const fs = deriveFlowState({ ...base(), linkProvenance: "manual", scopeSet: true });
    expect(fs.state).toBe("LINKED_SCOPED");
    expect(fs.anchorInForce).toBe("legacy_default");
    // Scope is SET in this state, so the step-3 warning is gone.
    expect(fs.warnings.scopeWarning).toBeNull();
    // The warning belongs to LINKED_UNSCOPED instead.
    const unscoped = deriveFlowState({ ...base(), linkProvenance: "manual" });
    expect(unscoped.warnings.scopeWarning).not.toBeNull();
  });

  test("DERIVED: derived anchor in force with the factor-product line", () => {
    const fs = deriveFlowState({
      ...base(),
      linkProvenance: "manual",
      scopeSet: true,
      derivationSet: true,
      computed: { entry_market_krw_m: 20000, factor_product: 0.25 },
      s1: { version_no: 3, confidence_grade: "B" },
    });
    expect(fs.state).toBe("DERIVED");
    expect(fs.anchorInForce).toBe("derived");
    expect(fs.header.stateChipLabel).toBe(STATE_CHIP_DERIVED);
    expect(fs.header.anchorLine).toBe(derivedValueLine(20000, 0.25));
    expect(fs.header.s1Line).toBe(s1Line(3, "B"));
  });

  test("DERIVED without a computable anchor keeps the fallback anchor order", () => {
    const fs = deriveFlowState({
      ...base(),
      linkProvenance: "auto",
      derivationSet: true,
      legacyAnchor: { market_size_krw_m: 65000, growth_rate: null },
    });
    expect(fs.state).toBe("DERIVED");
    expect(fs.anchorInForce).toBe("legacy_opportunity");
  });

  test("DERIVED with no legacy fields falls back to the 50,000 default", () => {
    const fs = deriveFlowState({ ...base(), linkProvenance: "auto", derivationSet: true });
    expect(fs.anchorInForce).toBe("legacy_default");
    expect(fs.header.anchorLine).toBe(ANCHOR_DEFAULT_LINE);
  });

  test("stale is advisory-only (manual + newer version), never blocks", () => {
    const fs = deriveFlowState({ ...base(), linkProvenance: "manual", newerVersionAvailable: true, scopeSet: true, derivationSet: true, computed: { entry_market_krw_m: 1, factor_product: 0.5 } });
    expect(fs.stale).toBe(true);
    expect(fs.warnings.staleLine).toBe(STALE_LINE);
    // Auto links never go stale.
    const auto = deriveFlowState({ ...base(), linkProvenance: "auto", newerVersionAvailable: true });
    expect(auto.stale).toBe(false);
    expect(auto.warnings.staleLine).toBeNull();
  });

  test("UNLINKED suppresses the newer-version hint entirely", () => {
    const fs = deriveFlowState({ ...base(), newerVersionAvailable: true });
    expect(fs.stale).toBe(false);
    expect(fs.warnings.staleLine).toBeNull();
  });

  test("warning constants exist for the confirm-styled inline blocks", () => {
    expect(REPIN_WARNING.length).toBeGreaterThan(10);
    expect(UNLINK_CHAIN_WARNING.length).toBeGreaterThan(10);
  });
});

describe("header strip formatting helpers", () => {
  test("anchorLegacyLine formats the legacy-opportunity value", () => {
    expect(anchorLegacyLine({ market_size_krw_m: 80000, growth_rate: 0.03 })).toContain("80,000");
    expect(anchorLegacyLine(null)).toContain("-");
  });

  test("derivedValueLine carries the value and the 4-decimal factor product", () => {
    expect(derivedValueLine(20000, 0.25)).toContain("20,000");
    expect(derivedValueLine(20000, 0.25)).toContain("0.2500");
  });

  test("s1Line renders version + grade with a dash for a missing grade", () => {
    expect(s1Line(3, "B")).toContain("v3");
    expect(s1Line(3, null)).toContain("-");
  });
});

describe("fixed 2-step form mappers", () => {
  test("empty state is exactly two named base cards", () => {
    const s = emptyDerivationSteps();
    expect(s.length).toBe(DERIVATION_BASE_STEP_COUNT);
    expect(s[0]).toEqual(EMPTY_DERIVATION_STEP);
    expect(s[1]).toEqual(EMPTY_DERIVATION_STEP);
    expect(BASE_STEP_LABELS.length).toBe(DERIVATION_BASE_STEP_COUNT);
  });

  test("derivationStepToForm tolerates malformed rows and preserves the AI origin", () => {
    const f = derivationStepToForm({ factor: 0.6, source: "est", as_of: "2026-01", note: "n", region_tags: ["kr"], segment_tags: ["s1"], origin: "ai_suggested" });
    expect(f.factor).toBe("0.6");
    expect(f.region_tags).toBe("kr");
    expect(f.origin).toBe("ai_suggested");
    const bad = derivationStepToForm({ factor: "0.6", region_tags: 42 });
    expect(bad.factor).toBe("");
    expect(bad.region_tags).toBe("");
    expect(bad.origin).toBeNull();
  });

  test("draft with more than 2 steps maps all rows (extras stay removable in UI)", () => {
    const draft = [
      { factor: 0.5, source: "a", as_of: "2026", origin: "ai_suggested" },
      { factor: 0.4, source: "b", as_of: "2026" },
      { factor: 0.1, source: "c", as_of: "2026", origin: "ai_suggested" },
    ];
    const forms = draft.map(derivationStepToForm);
    expect(forms.length).toBe(3);
    expect(forms.every((f) => typeof f.factor === "string")).toBe(true);
    expect(derivationFormError(forms)).toBeNull();
  });

  test("legacy stored >2-step chain round-trips through the form", () => {
    const stored = [
      { base: "s1_anchor", factor: 0.5, source: "a", as_of: "2026-01", note: "keep" },
      { base: "step:0", factor: 0.4, source: "b", as_of: "2026-01" },
      { base: "step:1", factor: 0.2, source: "c", as_of: "2026-01" },
    ];
    const forms = stored.map(derivationStepToForm);
    expect(forms.length).toBe(3);
    expect(forms[0].note).toBe("keep");
    const back = buildDerivationSavePayload(forms);
    expect(back[0].base).toBe("s1_anchor");
    expect(back[1].base).toBe("step:0");
    expect(back[2].base).toBe("step:1");
    expect(back.map((x) => x.factor)).toEqual([0.5, 0.4, 0.2]);
  });

  test("save payload is byte-identical to the previous inline builder (fixture)", () => {
    const forms = [
      { factor: "0.5", source: " stat", as_of: " 2026 ", note: "  n  ", region_tags: " kr , we ", segment_tags: "", origin: null },
      { factor: "0.4", source: "b", as_of: "2026", note: "", region_tags: "", segment_tags: "s1", origin: "ai_suggested" as const },
    ];
    const payload = buildDerivationSavePayload(forms);
    const expected = [
      { base: "s1_anchor", factor: 0.5, source: "stat", as_of: "2026", note: "n", region_tags: ["kr", "we"] },
      { base: "step:0", factor: 0.4, source: "b", as_of: "2026", segment_tags: ["s1"], origin: "ai_suggested" },
    ];
    expect(payload).toEqual(expected);
    expect(JSON.stringify(payload)).toBe(JSON.stringify(expected));
  });

  test("pre-check messages for bad factor / missing source / missing as_of", () => {
    const good = { factor: "0.5", source: "a", as_of: "2026", note: "", region_tags: "", segment_tags: "", origin: null };
    expect(derivationFormError([])).toContain("1");
    const noFactor = derivationFormError([{ ...good, factor: "1.5" }]);
    expect(noFactor).toContain("factor");
    const noSource = derivationFormError([{ ...good, source: "  " }]);
    expect(noSource).toContain("source");
    const noAsOf = derivationFormError([{ ...good, as_of: "" }]);
    expect(noAsOf).toContain("as_of");
    expect(derivationFormError([good])).toBeNull();
  });
});

describe("one-release re-export shim (OD-4)", () => {
  test("old import path re-exports the folded module's API", () => {
    expect((shim as { deriveFlowState?: unknown }).deriveFlowState).toBe(deriveFlowState);
    expect((shim as { buildDerivationSavePayload?: unknown }).buildDerivationSavePayload).toBe(deriveFlowState ? buildDerivationSavePayload : null);
  });
});

describe("marketBriefExample (진입 시장 정보 placeholder)", () => {
  test("composes the example from the LINKED S1 industry and the matrix scope", () => {
    expect(marketBriefExample({ industryName: "산업용 로봇", regionLabels: ["유럽"], segmentLabels: ["자동화"] }))
      .toBe("예: 유럽 자동화 — 산업용 로봇 수요 중심");
    expect(marketBriefExample({ industryName: "산업용 로봇", regionLabels: [], segmentLabels: [] }))
      .toBe("예: 산업용 로봇 — 진입 대상 수요 중심");
  });
  test("degrades to a domain-neutral prompt instead of another industry's example", () => {
    const neutral = marketBriefExample({ industryName: null });
    expect(neutral).toContain("진입할 지역");
    expect(neutral).not.toContain("Stage V");
    expect(neutral).not.toContain("유압 브레이커");
  });
});
