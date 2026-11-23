// @version 1.0.0
/**
 * api-spec.md method-set drift gate (review F-26 residual, 2026-11-23 batch).
 *
 * tests/unit/openapi.test.ts pins docs/architecture/openapi.yaml to the
 * Next.js route handlers in BOTH directions. This sibling test pins the
 * human-readable index — docs/architecture/api-spec.md — to openapi.yaml at
 * the METHOD level: for every path api-spec.md documents (its per-table
 * Endpoint | Method listings), the doc's method set must equal openapi.yaml's
 * declared method set for that path, in BOTH directions. A DELETE documented
 * in openapi but missing from the doc's listing (the F-26 defect class), or a
 * doc method that is not built, fails the suite.
 *
 * Parse contract (pragmatic, api-spec.md is a lang: ko markdown doc):
 * - Markdown tables with an `Endpoint` and a `Method` header column are read.
 * - The Endpoint cell may list several `/api/...` paths; the Method cell
 *   (slash-separated HTTP verbs) applies to each.
 * - Rows are skipped when they declare no method listing or no as-built
 *   surface: Method cell `-` (catalog/annotation rows), an `Implementation`
 *   column cell containing forward-design without as-built, or `removed`.
 * - Mixed rows ("GET as-built …; POST forward-design") contribute only the
 *   as-built methods.
 * - Annotation rows whose Endpoint cell carries an inline verb marker
 *   ("`/api/...` (GET)") are skipped — their verb scopes the annotation, not
 *   the path's method set.
 * - Path params: doc `:id` form normalizes to openapi `{id}` form.
 *
 * Path-set gate (2026-11-23 as-built purge follow-up): every path this parser
 * sees (i.e. every as-built claim — forward-design-only, removed and
 * annotation rows are skipped upstream) must exist in openapi.yaml. A doc-only
 * path (documented as-built, no handler surface) fails with a purge-or-align
 * message; the doc-only class that motivated this gate (engine-1 runs rows,
 * governance reads, watch/report rows — routes that predate the Next.js
 * handler cutover) was purged from api-spec.md on 2026-11-23. The REVERSE
 * direction is deliberately NOT checked: api-spec.md is a human-readable
 * index (~112 of 380+ paths), not an exhaustive catalog, so openapi paths
 * without a doc row are the expected steady state.
 */

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const HTTP_VERBS = new Set(METHODS.map((m) => m.toUpperCase()));

function normalizeDocPath(raw: string): string {
  return raw.replace(/:([A-Za-z0-9_-]+)/g, "{$1}");
}

/** Parse api-spec.md's per-path method listings (see header for the rules). */
export function parseApiSpecMethods(content: string): Map<string, Set<string>> {
  const lines = content.split("\n");
  const map = new Map<string, Set<string>>();
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("|")) {
      i++;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && lines[i].startsWith("|")) {
      block.push(lines[i]);
      i++;
    }
    if (block.length < 3) continue; // header + separator only
    const header = block[0].split("|").map((c) => c.trim().toLowerCase().replace(/`/g, ""));
    const epIdx = header.indexOf("endpoint");
    const methIdx = header.indexOf("method");
    if (epIdx === -1 || methIdx === -1) continue;
    const implIdx = header.findIndex((h) => h.startsWith("implement"));
    for (const line of block.slice(2)) {
      const cells = line.split("|").map((c) => c.trim());
      const epCell = cells[epIdx] ?? "";
      const impl = implIdx !== -1 ? (cells[implIdx] ?? "").toLowerCase() : "";
      // forward-design-only or removed rows declare no as-built surface
      if (impl.includes("removed")) continue;
      if (impl.includes("forward-design") && !impl.includes("as-built")) continue;
      const methCell = cells[methIdx] ?? "";
      // catalog/annotation rows without a method listing
      if (!HTTP_VERBS.has(methCell.split("/")[0]?.trim().toUpperCase() ?? "")) continue;
      // annotation rows scope their verb inline in the endpoint cell
      if (/\((GET|POST|PUT|PATCH|DELETE)\)/i.test(epCell)) continue;

      let methods: string[];
      if (impl.includes("forward-design") && impl.includes("as-built")) {
        methods = [];
        for (const seg of impl.split(";")) {
          if (!seg.includes("as-built")) continue;
          for (const m of seg.matchAll(/\b(get|post|put|patch|delete)\b/gi)) {
            methods.push(m[1].toUpperCase());
          }
        }
      } else {
        methods = methCell
          .split("/")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => HTTP_VERBS.has(s));
      }
      const paths = [...epCell.matchAll(/\/api\/[A-Za-z0-9_\-/:.{}[\]]+/g)].map((m) =>
        normalizeDocPath(m[0].replace(/[.,;)]+$/, "")),
      );
      for (const p of paths) {
        let set = map.get(p);
        if (!set) {
          set = new Set<string>();
          map.set(p, set);
        }
        for (const m of methods) set.add(m);
      }
    }
  }
  return map;
}

const spec = yaml.load(readFileSync(join(PROJECT_ROOT, "docs/architecture/openapi.yaml"), "utf8")) as {
  paths?: Record<string, Record<string, unknown>>;
};

function specMethodsFor(path: string): Set<string> {
  const out = new Set<string>();
  const item = spec.paths?.[path];
  if (!item) return out;
  for (const m of METHODS) if (item[m]) out.add(m.toUpperCase());
  return out;
}

const docMap = parseApiSpecMethods(readFileSync(join(PROJECT_ROOT, "docs/architecture/api-spec.md"), "utf8"));

describe("docs/architecture/api-spec.md method-set drift gate (F-26 residual)", () => {
  test("the doc parser still sees a sane catalog (non-vacuous)", () => {
    expect(docMap.size).toBeGreaterThanOrEqual(100);
  });

  test("every as-built doc path exists in openapi.yaml (no doc-only paths — the 2026-11-23 purge class)", () => {
    const failures: string[] = [];
    for (const path of docMap.keys()) {
      if (!spec.paths?.[path])
        failures.push(
          `${path}: documented as-built but absent from openapi.yaml (no handler surface) — purge the row or align it to the built path`,
        );
    }
    expect(failures).toEqual([]);
  });

  test("doc method sets equal openapi.yaml for every documented path (no doc-only methods)", () => {
    const failures: string[] = [];
    for (const [path, docMethods] of docMap) {
      const specMethods = specMethodsFor(path);
      if (specMethods.size === 0) continue; // path absent from openapi — out of scope here (see header)
      const docOnly = [...docMethods].filter((m) => !specMethods.has(m));
      if (docOnly.length)
        failures.push(`${path}: doc-only methods [${docOnly.join(",")}] (openapi has [${[...specMethods].join(",")}])`);
    }
    expect(failures).toEqual([]);
  });

  test("openapi method sets equal the doc for every documented path (no undocumented methods — the F-26 class)", () => {
    const failures: string[] = [];
    for (const [path, docMethods] of docMap) {
      const specMethods = specMethodsFor(path);
      if (specMethods.size === 0) continue;
      const specOnly = [...specMethods].filter((m) => !docMethods.has(m));
      if (specOnly.length)
        failures.push(
          `${path}: openapi-only methods [${specOnly.join(",")}] (doc lists [${[...docMethods].join(",")}])`,
        );
    }
    expect(failures).toEqual([]);
  });
});
