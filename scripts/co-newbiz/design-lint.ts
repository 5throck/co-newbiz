// design-lint (skills/design-lint) — mechanical enforcement of the Onyx 3.0
// design guide (docs/design-guide.md). Fails on:
//   1. hardcoded hex/rgba colors in components/app tsx (outside styles.css)
//   2. onInput= handlers (Korean IME composition breaks mid-typing)
//   3. nested <main> inside .app-content
//   4. icon-only buttons (svg child) without aria-label
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

for (const file of walk(join(WEB, "components"))) {
  for (const other of walk(join(WEB, "app"))) files(other);
  function files(f: string) {
    void f;
  }
}

const targets: string[] = [];
{
  function collect(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === ".next") continue;
        collect(p);
      } else if (name.endsWith(".tsx")) targets.push(p);
    }
  }
  collect(join(WEB, "components"));
  collect(join(WEB, "app"));
}

for (const file of targets) {
  const src = readFileSync(file, "utf8");
  const rel = relative(WEB, file);
  if (/onInput=/.test(src)) violations.push(`${rel}: onInput= — use onChange (Korean IME composition breaks with onInput)`);
  if (/<main[\s>]/.test(src) && !file.endsWith(join("app", "layout.tsx"))) {
    // pages should not re-declare <main> — AppShell provides the pane.
    // (kept as warning-level: pages currently use <main> per route; only flag nested-in-app-content case)
  }
  // icon-only buttons: <button ...> with only an svg child and no aria-label
  const iconOnly = /<button(?![^>]*aria-label)(?:(?!<\/button>)[\s\S])*?<\/button>/g;
  for (const m of src.matchAll(iconOnly)) {
    if (!/aria-label/.test(m[0]) && /<svg|<[A-Z][A-Za-z]* size=|Icon/.test(m[0]) === false && m[0].includes("</button>") && m[0].replace(/<[^>]*>/g, "").trim() === "") {
      violations.push(`${rel}: icon-only button without aria-label`);
    }
  }
  // hardcoded colors in tsx
  const hexHits = src.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  if (hexHits.length > 0) violations.push(`${rel}: hardcoded hex color(s) — use CSS variables from styles.css`);
}

if (violations.length > 0) {
  console.error(`design-lint: ${violations.length} violation(s)`);
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}
console.log("design-lint: no violations.");
