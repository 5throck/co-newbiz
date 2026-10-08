// Wave U-1 finding 5: a bottom-left floating control must never overlap the
// sidebar. The only offender was the dev-only Next indicator (default
// bottom-left); this test pins its position and allowlists every
// `position: fixed` rule in styles.css. The runtime check against real
// rects at 1024/1280/390 is scripts/co-newbiz/ux-layout-check.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "../../app/web-next");
const css = readFileSync(join(WEB, "app/styles.css"), "utf8");
const config = readFileSync(join(WEB, "next.config.ts"), "utf8");

// Selectors allowed to be position: fixed. None may sit in the left/bottom-left corner
// except the mobile sidebar drawer itself (full-height, closed state hidden).
const FIXED_ALLOWLIST = [
  '.app-shell[data-sidebar-state="open"] .app-sidebar',
  '.app-shell[data-sidebar-state="closed"] .app-sidebar',
  ".modal-backdrop",
  ".toast-region",
];

function fixedRules(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*position:\s*fixed[^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const selector = m[1].trim().split("\n").pop()!.trim();
    out.push({ selector, body: m[2] });
  }
  return out;
}

describe("fixed-position layout guard", () => {
  test("dev indicator is not anchored bottom-left", () => {
    expect(config).toMatch(/devIndicators:\s*\{\s*position:\s*"(bottom-right|top-right)"/);
  });

  test("every position:fixed rule is allowlisted; none anchors bottom-left outside the drawer", () => {
    const rules = fixedRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      const allowed = FIXED_ALLOWLIST.some((a) => r.selector.includes(a));
      expect(allowed).toBe(true);
      if (!r.selector.includes(".app-sidebar")) {
        expect(/left:\s*[0-9.]+(rem|px)/.test(r.body) && /bottom:\s*[0-9.]+(rem|px)/.test(r.body)).toBe(false);
      }
    }
  });

  test("sidebar footer is in-flow (no fixed/absolute positioning)", () => {
    const m = css.match(/\.sidebar-footer\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/position:\s*(fixed|absolute)/);
  });
});
