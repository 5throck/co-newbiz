// U4 — design 2026-11-21-s67-completion-visibility § Defect Remediation: the decision-form
// inputs overflowed the 390px viewport by ~3px because the component-layer rules
// (.sizing-new-input / .sizing-new-input-sm) re-declared fixed min-width floors AFTER the
// base-layer containment (input,select,textarea { min-width: 0; max-width: 100% } — the
// OVERFLOW-390 rule), so the inputs lost the containment. The fix clamps the floors at the
// token layer: min(8rem, 100%) / min(5rem, 100%) + max-width: 100% — mirroring the
// .form-input / .invest-ctl precedents. No per-component (TSX) overrides.
// Static scan of styles.css + the consumers (pattern: table-sizing.test.ts). The ADR-0070
// 390px scrollWidth acceptance runs in the browser preview harness, not this unit harness.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync("./app/web-next/app/styles.css", "utf8");

/** Every rule block for a top-level selector, concatenated (e.g. .sizing-new-input also has a later touch-target block — later blocks must not reintroduce an unclamped floor). */
function blocksOf(selector: string): string {
  const starts = [...css.matchAll(new RegExp(`${selector}\\s*\\{`, "g"))].map((m) => m.index ?? 0);
  expect(starts.length).toBeGreaterThan(0);
  return starts
    .map((start) => {
      const open = css.indexOf("{", start);
      const close = css.indexOf("}", open);
      return css.slice(start, close + 1);
    })
    .join("\n");
}

describe("sizing-new-input containment at the token layer (U4)", () => {
  test(".sizing-new-input clamps its floor to the container and caps at 100%", () => {
    const b = blocksOf("\\.sizing-new-input");
    expect(b).toContain("min-width: min(8rem, 100%)");
    expect(b).toContain("max-width: 100%");
    // the unclamped floor is gone (the regression this fix removes)
    expect(b).not.toMatch(/min-width:\s*8rem\s*;/);
  });

  test(".sizing-new-input-sm clamps its floor to the container and caps at 100%", () => {
    const b = blocksOf("\\.sizing-new-input-sm");
    expect(b).toContain("min-width: min(5rem, 100%)");
    expect(b).toContain("max-width: 100%");
    expect(b).not.toMatch(/min-width:\s*5rem\s*;/);
  });

  test("the containment mirrors the .form-input / .invest-ctl precedents (same file, same rule family)", () => {
    expect(blocksOf("\\.form-input")).toContain("max-width: 100%");
    expect(blocksOf("\\.invest-ctl")).toContain("min-width: 0");
  });

  test("no per-component inline width overrides on the consumers (token-layer fix only)", () => {
    const panel = readFileSync("./app/web-next/components/GateDecisionPanel.tsx", "utf8");
    // the decision-form inputs still consume the token classes…
    expect(panel).toContain("sizing-new-input");
    // …and no TSX-side min-width hack accompanies them
    expect(panel).not.toMatch(/sizing-new-input[^"']*".*min-w-\[/);
    expect(panel).not.toContain("minWidth");
  });
});
