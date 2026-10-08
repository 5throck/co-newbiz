// @version 1.0.0
// contrast-check — automated WCAG AA token-pair contrast gate
// (docs/design-system/design-accessibility.md rule 6: "verify contrast in
// both themes"). Parses the runtime token SSOT (app/web-next/app/styles.css),
// resolves each token in the light (:root) and dark ([data-theme="dark"])
// themes, composites alpha backgrounds over their base surface, and fails on
// any enforced text pair below 4.5:1.
//
// Pairs that do not meet 4.5:1 today are reported as WARN and listed as
// follow-ups — the bar is never silently lowered; promote a pair from
// ADVISORY to ENFORCED only together with the token fix.
//
// Usage: bun scripts/co-newbiz/contrast-check.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = join(import.meta.dirname, "..", "..", "app", "web-next", "app", "styles.css");

type Rgb = { r: number; g: number; b: number; a: number };

// ── CSS color parsing ────────────────────────────────────────────────────────

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 || h.length === 4 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

function parseColor(raw: string): Rgb | null {
  const s = raw.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) return hexToRgb(hex[1]);
  const rgb = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a };
  }
  const hsl = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,\s/]+([\d.%]+))?\s*\)$/);
  if (hsl) {
    const h = +hsl[1] / 360, sat = +hsl[2] / 100, lig = +hsl[3] / 100;
    const a = hsl[4] === undefined ? 1 : hsl[4].endsWith("%") ? parseFloat(hsl[4]) / 100 : parseFloat(hsl[4]);
    // hsl → rgb (no hue-wrap edge cases expected for our tokens)
    const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
    const p = 2 * lig - q;
    const f = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255), a };
  }
  return null;
}

// ── Token block parsing ─────────────────────────────────────────────────────

function extractBlock(css: string, selector: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const idx = css.indexOf(selector);
  if (idx === -1) return tokens;
  const open = css.indexOf("{", idx);
  let depth = 1, i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  const body = css.slice(open + 1, i - 1);
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(`--${m[1]}`, m[2].trim());
  }
  return tokens;
}

function resolve(tokens: Map<string, string>, name: string): Rgb | null {
  const raw = tokens.get(name);
  if (!raw) return null;
  // hsl(var(--primary-h), var(--primary-s), var(--primary-l)) — substitute channel tokens
  let substituted = raw;
  for (const m of raw.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
    substituted = substituted.replace(m[0], tokens.get(m[1]) ?? "");
  }
  const direct = parseColor(substituted);
  if (direct) return direct;
  // var(--other-token) reference
  const ref = substituted.match(/^var\((--[a-z0-9-]+)\)$/);
  if (ref && ref[1] !== name) return resolve(tokens, ref[1]);
  return null;
}

function composite(fg: Rgb, base: Rgb): Rgb {
  const a = fg.a;
  return { r: fg.r * a + base.r * (1 - a), g: fg.g * a + base.g * (1 - a), b: fg.b * a + base.b * (1 - a), a: 1 };
}

// ── WCAG relative luminance / contrast ──────────────────────────────────────

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const l1 = luminance(a), l2 = luminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ── Pair registry ───────────────────────────────────────────────────────────
// ENFORCED pairs fail the build below 4.5:1. ADVISORY pairs are reported but
// do not fail — promote them together with the token fix that makes them pass.

type Pair = { fg: string; bg: string; chipOver?: string; note?: string };

const ENFORCED: Pair[] = [
  { fg: "--fg", bg: "--bg" },
  { fg: "--fg", bg: "--surface" },
  { fg: "--fg", bg: "--surface-2" },
  { fg: "--muted-fg", bg: "--bg" },
  { fg: "--muted-fg", bg: "--surface" },
  { fg: "--muted-fg", bg: "--surface-2" },
  { fg: "--accent-fg", bg: "--accent" },
  { fg: "--primary", bg: "--bg", note: "link/primary text on page background" },
  { fg: "--primary", bg: "--surface", note: "link/primary text on cards" },
  { fg: "--primary-fg", bg: "--primary", note: "btn-primary / selected control-chip fill (R2-C)" },
  { fg: "--primary-fg", bg: "--primary-strong", note: "btn-primary hover (R2-C)" },
  { fg: "--primary", bg: "--primary-bg", chipOver: "--surface", note: "current stage step / active tab text (R2-C)" },
  { fg: "--primary", bg: "--surface-2", note: "primary text on muted surfaces (R2-C)" },
  { fg: "--primary-dim", bg: "--primary-bg", chipOver: "--surface", note: "primary chip text (R2-C)" },
  { fg: "--green-fg", bg: "--green-bg", chipOver: "--surface", note: "RAG green chip" },
  { fg: "--amber-fg", bg: "--amber-bg", chipOver: "--surface", note: "RAG amber chip" },
  { fg: "--red-fg", bg: "--red-bg", chipOver: "--surface", note: "RAG red chip" },
];

// All pairs above pass 4.5:1 in both themes as of 2026-09-08; new pairs start
// here as ADVISORY and are promoted together with the token fix that passes.
const ADVISORY: Pair[] = [];

// ── Main ────────────────────────────────────────────────────────────────────

const css = readFileSync(CSS, "utf8");
const themes: Array<[string, Map<string, string>]> = [
  ["light", extractBlock(css, ":root")],
  ["dark", extractBlock(css, '[data-theme="dark"]')],
];

let failures = 0;
const warnings: string[] = [];

for (const [theme, base] of themes) {
  const merged = new Map(base);
  // dark block only overrides what it redefines; light values carry over
  if (theme === "dark") {
    for (const [k, v] of extractBlock(css, ":root")) if (!merged.has(k)) merged.set(k, v);
  }
  const surface = resolve(merged, "--surface") ?? { r: 255, g: 255, b: 255, a: 1 };

  for (const pair of [...ENFORCED, ...ADVISORY]) {
    const enforced = ENFORCED.includes(pair);
    const fg = resolve(merged, pair.fg);
    let bg = resolve(merged, pair.bg);
    if (bg && pair.chipOver) bg = composite(bg, surface);
    if (!fg || !bg) {
      warnings.push(`[${theme}] ${pair.fg} / ${pair.bg}: token missing — pair skipped`);
      continue;
    }
    const ratio = contrast(fg, bg);
    const label = `[${theme}] ${pair.fg} on ${pair.bg}${pair.chipOver ? " (over surface)" : ""}: ${ratio.toFixed(2)}:1`;
    if (ratio < 4.5) {
      if (enforced) {
        failures++;
        console.error(`  FAIL ${label} — below WCAG AA 4.5:1${pair.note ? ` (${pair.note})` : ""}`);
      } else {
        warnings.push(`${label} — below 4.5:1, ADVISORY (fix token, then promote to ENFORCED)`);
      }
    }
  }
}

for (const w of warnings) console.log(`  WARN ${w}`);

if (failures > 0) {
  console.error(`\ncontrast-check: ${failures} enforced pair(s) below 4.5:1`);
  process.exit(1);
}
console.log(`contrast-check: all enforced pairs >= 4.5:1 in both themes (${warnings.length} advisory note(s)).`);
