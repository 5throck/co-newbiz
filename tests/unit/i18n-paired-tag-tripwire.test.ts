/**
 * Paired-markup tripwire for the i18n catalogs (FORMATTING_ERROR class pin).
 *
 * next-intl parses catalog values as ICU messages: any paired tag
 * (`<strong>…</strong>`) or self-closing tag (`<br/>`) inside a catalog value
 * makes plain `t()` throw FORMATTING_ERROR — and i18n/request.ts swallows the
 * error silently (`onError() {}`), so the consuming surface (the SizingCharts
 * scenario-band tooltip, 2026-11-12) just degrades to nothing instead of
 * failing loudly. Emphasis therefore belongs in code at the call site;
 * `t.rich` has zero usages in this repo and must not be introduced as a
 * workaround. This suite pins the whole class: neither locale file may carry
 * markup anywhere, and the SizingCharts call site keeps composing its
 * `<strong>` wrapper in code.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

/** Any closing tag (`</strong>`, `</br>`, …) — the exact FORMATTING_ERROR trigger. */
const PAIRED_TAG = /<\/[a-zA-Z]/;
/** Self-closing tags (`<br/>`) trigger the same rich-text path (no children, plain t() cannot format). */
const SELF_CLOSING_TAG = /<[a-zA-Z][a-zA-Z0-9]*\s*\/>/;

function collectStrings(value: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof value === "string") {
    out.push({ path, value });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectStrings(v, path ? `${path}.${k}` : k, out);
  }
}

describe("i18n paired-tag tripwire (FORMATTING_ERROR class pin)", () => {
  for (const [locale, catalog] of [
    ["ko", ko],
    ["en", en],
  ] as const) {
    test(`${locale}.json carries no HTML markup in any catalog value`, () => {
      const strings: Array<{ path: string; value: string }> = [];
      collectStrings(catalog, "", strings);
      expect(strings.length).toBeGreaterThan(1000); // the sweep really covered the catalog
      const offenders = strings.filter((s) => PAIRED_TAG.test(s.value) || SELF_CLOSING_TAG.test(s.value));
      expect(offenders).toEqual([]);
    });
  }

  test("the SizingCharts override tooltip composes its emphasis in code, catalog stays plain text", () => {
    const source = readFileSync(
      new URL("../../app/web-next/components/stages/market/SizingCharts.tsx", import.meta.url),
      "utf8",
    );
    // the <strong> wrapper for the source-mismatch suffix lives at the call site …
    expect(source).toMatch(/p4: r\.isOverride \? `<br\/><strong>\$\{t\("sourceMismatchWide"\)\}<\/strong>` : ""/);
    // … and the line break the old catalog carried moved into the template too
    // (byte-identical rendered output, markup-free catalog).
    expect(source).toMatch(/p1: `\$\{r\.label\}<br\/>`/);
  });
});
