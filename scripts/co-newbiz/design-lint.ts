// @version 1.5.0
// design-lint (skills/design-lint) — mechanical enforcement of the Onyx 3.0
// design guide (docs/design-system/design-guide.md). Fails on:
//   1. hardcoded hex/rgba/hsl colors in components/app tsx (outside styles.css)
//   2. onInput= handlers (Korean IME composition breaks mid-typing)
//   3. a file declaring <main> more than once (AppShell provides the pane)
//   4. icon-only buttons (svg child, no text) without aria-label
//   5. row-action tables (.data-table + .sizing-actions-cell) without the
//      .list-table standard or with an unheaded actions column
//   6. font-size literals in styles.css or Tailwind text-[..rem] classes that
//      fall below the 14px floor (0.875rem at the 16px root), or inside the
//      body range (0.875–1rem) without being token-equal (0.875rem =
//      --fs-body) — a body-range literal passes at the 16px root yet computes
//      below 14px at the ≥1920px 15px root step (0.92rem → 13.8px). Only
//      var(--fs-caption) (13px) may sit below the floor, only for secondary
//      metadata, and only inside .caption-style selectors (Wave U-2);
//      em-relative literals are report-only (parent-relative, not mechanically
//      floor-checkable); html/body/:root root-sizing declarations are exempt.
//   7. class-less <button> (no className and no spread props) — every button
//      carries a design class (btn-primary / btn-ghost / btn-danger / control-chip / …)
//      so it is themed and meets the target size (R2-C)
// Usage: bun scripts/co-newbiz/design-lint.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB = join(import.meta.dirname, "..", "..", "app", "web-next");
const violations: string[] = [];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      yield* walk(p);
    } else if (name.endsWith(".tsx")) {
      yield p;
    }
  }
}

const FONT_FLOOR_PX = 14;
const REM_PX = 16;
// Wave U-2 type scale (styles.css): --fs-body 0.875rem (14px), --fs-caption 0.8125rem (13px).
const BODY_REM = 0.875;

// 6. styles.css font-size literals (Wave U-2, design 2026-10-08-wave-u-ux-overhaul §6
//    "design:lint gains a rule rejecting font-size below 0.875rem except .caption"):
//    (a) below the 14px floor at the 16px root is rejected;
//    (b) a body-range literal (0.875rem ≤ v < 1rem) that is not token-equal
//        (≠ 0.875rem = --fs-body) is rejected with a token-steer verdict — it
//        passes at the 16px root yet computes below 14px at the ≥1920px 15px
//        root step (0.88rem → 13.2px, 0.92rem → 13.8px), which is how three
//        breaches slipped past v1.4.0;
//    em-relative values scale with the parent and cannot be floor-checked
//    mechanically → report-only on stdout;
//    var(--fs-*) usages are the sanctioned path and are not matched.
//    Exempt: `.caption` selectors (design §6 "except .caption"), and
//    element-level root sizing (html/body/:root — that declaration IS the
//    responsive root font-size step, not text content).
{
  const cssPath = join(WEB, "app", "styles.css");
  const css = readFileSync(cssPath, "utf8");
  const emNotes: string[] = [];
  for (const m of css.matchAll(/(^|\n)([^{}\n]*)\{([^{}]*)\}/g)) {
    const selector = m[2].trim();
    if (selector.startsWith("/*") || selector.startsWith("@")) continue;
    if (/^(html|body|:root)\b[\w\s,:.#>*+~-]*$/.test(selector)) continue; // root sizing step
    const isCaption = /\.caption\b/.test(selector);
    for (const d of m[3].matchAll(/(?:^|[;\s])font-size:\s*(\d*\.?\d+)(rem|px|em)\b/g)) {
      const literal = `${d[1]}${d[2]}`;
      if (d[2] === "em") {
        emNotes.push(`app/styles.css: "${selector.slice(0, 60)}" font-size ${literal} is em-relative (scales with the parent) — fold to var(--fs-body)/var(--fs-caption) when possible`);
        continue;
      }
      const px = d[2] === "rem" ? Number(d[1]) * REM_PX : Number(d[1]);
      if (px < FONT_FLOOR_PX) {
        if (isCaption) continue; // design §6: .caption is the sanctioned sub-floor case
        violations.push(`app/styles.css: "${selector.slice(0, 60)}" font-size ${literal} is below the 14px floor — use var(--fs-body) or var(--fs-caption)`);
      } else if (d[2] === "rem" && Number(d[1]) > BODY_REM && Number(d[1]) < 1) {
        // band (b) is rem-only: px literals do not scale with the root, so the
        // 15px-root dip that motivates the band cannot occur for them.
        violations.push(`app/styles.css: "${selector.slice(0, 60)}" font-size ${literal} is a body-range non-token literal (below 14px at the 15px root step) — token-fold to var(--fs-body) or var(--fs-caption)`);
      }
    }
  }
  for (const n of emNotes) console.log(`design-lint (report-only): ${n}`);
}

const targets = [...walk(join(WEB, "components")), ...walk(join(WEB, "app"))];

for (const file of targets) {
  const src = readFileSync(file, "utf8");
  const rel = relative(WEB, file);
  if (/onInput=/.test(src)) violations.push(`${rel}: onInput= — use onChange (Korean IME composition breaks with onInput)`);

  // 3. nested <main> — a <main> opened while another is still open (textual
  //    depth scan; separate JSX branches that each render one <main> pass,
  //    true nesting fires). layout.tsx is the only multi-main exempt shell.
  let depth = 0;
  const tags = src.match(/<\/?main[\s>]/g) ?? [];
  for (const tag of tags) {
    if (tag.startsWith("</")) depth = Math.max(0, depth - 1);
    else {
      depth += 1;
      if (depth > 1 && !file.endsWith(join("app", "layout.tsx"))) {
        violations.push(`${rel}: nested <main> — AppShell owns the pane`);
        break;
      }
    }
  }

  // 4. icon-only buttons: a <button> whose children are only svg(s)/icon
  //    components (no visible text) must carry aria-label.
  const button = /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<\/button>/g;
  for (const m of src.matchAll(button)) {
    if (/aria-label/.test(m[0])) continue;
    const text = m[0].replace(/<[^>]*>/g, "").trim();
    const hasIcon = /<svg|Icon\b|size=\{/.test(m[0]);
    if (hasIcon && text === "") {
      violations.push(`${rel}: icon-only button without aria-label`);
    }
  }

  // 7. class-less <button>: scan each opening tag brace/quote-aware (arrow functions in
  //    attribute values contain ">" so a plain regex would cut the tag short).
  for (const open of src.matchAll(/<button(?=[\s>])/g)) {
    const lineStart = src.lastIndexOf("\n", open.index ?? 0) + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(src.slice(lineStart, open.index))) continue; // comment text, not JSX
    let i = (open.index ?? 0) + "<button".length;
    let braces = 0;
    let quote = "";
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === quote && src[i - 1] !== "\\") quote = "";
        continue;
      }
      if (braces === 0 && (c === '"' || c === "'")) quote = c;
      else if (c === "{") braces++;
      else if (c === "}") braces--;
      else if (c === ">" && braces === 0 && src[i - 1] !== "=") break;
    }
    const attrs = src.slice(open.index ?? 0, i);
    if (!/className\s*=/.test(attrs) && !/\{\s*\.\.\./.test(attrs)) {
      const line = src.slice(0, open.index ?? 0).split("\n").length;
      violations.push(`${rel}:${line}: <button> without a design class — add className (btn-primary / btn-ghost / btn-danger / control-chip / …)`);
    }
  }

  // 5. list-table standard (docs/design-system/design-components.md): a
  //    .data-table that renders per-row actions (.sizing-actions-cell) is a
  //    LIST table and must (a) opt into .list-table — fixed column layout +
  //    width cap so the label column cannot absorb all leftover width — and
  //    (b) head its actions column (작업). A headerless actions column drifts
  //    past the header row on wide screens (2026-09-14 S1/S2 user report).
  //    i18n (design 2026-10-23-i18n-ui-adoption): the header may be the literal
  //    작업 (unconverted pages) or the shared ("actions") catalog key, which
  //    resolves to 작업 in locales/ko.json — both keep the column headed.
  const tableRe = /<table\b[^>]*>[\s\S]*?<\/table>/g;
  for (const m of src.matchAll(tableRe)) {
    const t = m[0];
    if (!/data-table/.test(t) || !/sizing-actions-cell/.test(t)) continue;
    if (!/list-table/.test(t)) violations.push(`${rel}: row-action table without .list-table — apply the list-table standard (design-components.md)`);
    const head = t.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? "";
    if (!/작업/.test(head) && !/\(\s*["']actions["']\s*\)/.test(head)) violations.push(`${rel}: actions column without 작업 header — every list-table column must be headed`);
  }

  // 1. hardcoded colors in tsx — 3/4/6/8-digit hex, rgba(), hsl()
  const hexHits = src.match(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g) ?? [];
  if (hexHits.length > 0) violations.push(`${rel}: hardcoded hex color(s) (${hexHits.length}) — use CSS variables from styles.css`);
  if (/rgba?\(\s*\d/.test(src)) violations.push(`${rel}: hardcoded rgba() color — use CSS variables from styles.css`);
  if (/hsl\(\s*\d/.test(src)) violations.push(`${rel}: hardcoded hsl() color — use CSS variables from styles.css`);
  // 6. font-size floor — Tailwind arbitrary text-[<n>rem|px] below 0.875rem
  for (const m of src.matchAll(/text-\[(\d*\.?\d+)(rem|px)\]/g)) {
    const px = m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
    if (px < FONT_FLOOR_PX) violations.push(`${rel}: text-[${m[1]}${m[2]}] is below the 14px floor — use var(--fs-body), or var(--fs-caption) for captions`);
  }
  const semanticColorUtilities = src.match(/\b(?:bg|text|border)-(?:red|amber|yellow|orange|green|emerald|blue|sky|cyan|slate|gray|zinc|neutral|stone|purple|violet|pink|rose)-\d{2,3}(?:\/\d{1,3})?\b/g) ?? [];
  if (semanticColorUtilities.length > 0) {
    violations.push(`${rel}: Tailwind semantic color utility/ies (${[...new Set(semanticColorUtilities)].join(", ")}) — use CSS variables from styles.css`);
  }
}

if (violations.length > 0) {
  console.error(`design-lint: ${violations.length} violation(s)`);
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}
console.log("design-lint: no violations.");
