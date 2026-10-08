// Wave C-1: product gaps the E2E scenarios found, pinned so they cannot regress
// without the Playwright run. (The browser-level proof is tests/scenarios/*.)
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "../../app/web-next");
const read = (rel: string): string => readFileSync(join(WEB, rel), "utf8");

describe("UI sends what the decision routes require (ADR-0151 / ADR-0152)", () => {
  test("GateDecisionPanel collects and sends learning_capture for KILL", () => {
    const src = read("components/GateDecisionPanel.tsx");
    expect(src).toContain("learning_capture: form.decision === \"kill\"");
    expect(src).toContain("killNeedsLearning");
  });

  test("PortfolioStage collects the dedicated record column of every non-kill transition", () => {
    const src = read("components/stages/PortfolioStage.tsx");
    for (const key of ["tranche_condition", "core_handoff", "divest_plan"]) expect(src).toContain(key);
    for (const decision of ["next_tranche_released", "held_evidence_incomplete", "graduate_to_core", "reduce_or_divest"]) {
      expect(src).toMatch(new RegExp(`${decision}: \\{ key:`));
    }
  });
});

describe("accessibility defaults pinned by the axe gate", () => {
  test("root layout declares a document title", () => {
    expect(read("app/layout.tsx")).toMatch(/export const metadata[\s\S]*title/);
  });

  test("the stage tablist contains tabs only (the More menu button is its sibling)", () => {
    const src = read("components/StageTabs.tsx");
    expect(src).toContain('className="stage-tabs-list" role="tablist"');
    expect(src).not.toMatch(/role="tablist"[^>]*ref=\{listRef\}/);
  });

  test("the E2E build writes to its own dist dir via CO_NEWBIZ_DIST_DIR", () => {
    expect(read("next.config.ts")).toContain("CO_NEWBIZ_DIST_DIR");
  });
});
