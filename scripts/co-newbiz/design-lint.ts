// @version 1.4.0
// design-lint (skills/design-lint) — mechanical enforcement of the Onyx 3.0
// design guide (docs/design-system/design-guide.md). Fails on:
//   1. hardcoded hex/rgba/hsl colors in components/app tsx (outside styles.css)
//   2. onInput= handlers (Korean IME composition breaks mid-typing)
//   3. a file declaring <main> more than once (AppShell provides the pane)
//   4. icon-only buttons (svg child, no text) without aria-label
//   5. row-action tables (.data-table + .sizing-actions-cell) without the
//      .list-table standard or with an unheaded actions column
//   6. font-size below the 14px floor (0.875rem) in styles.css or Tailwind
//      text-[..rem] classes — only var(--fs-caption) (13px) is allowed for
//      secondary metadata, and only inside .caption-style selectors (Wave U-2)
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

// 6. styles.css: literal font-size below the floor is rejected; the token
//    declarations (--fs-*) and var() usages are the sanctioned path.
{
  const cssPath = join(WEB, "app", "styles.css");
  const css = readFileSync(cssPath, "utf8");
  for (const m of css.matchAll(/(^|\n)([^{}\n]*)\{([^{}]*)\}/g)) {
    const selector = m[2].trim();
    if (selector.startsWith("/*") || selector.startsWith("@")) continue;
    for (const d of m[3].matchAll(/(?:^|[;\s])font-size:\s*(\d*\.?\d+)(rem|px)/g)) {
      const px = d[2] === "rem" ? Number(d[1]) * 16 : Number(d[1]);
      if (px < FONT_FLOOR_PX && !/\.caption\b/.test(selector)) {
        violations.push(`app/styles.css: "${selector.slice(0, 60)}" font-size ${d[1]}${d[2]} is below the 14px floor — use var(--fs-body) or var(--fs-caption)`);
      }
    }
  }
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
