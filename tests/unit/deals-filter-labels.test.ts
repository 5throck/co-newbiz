// Every /deals FILTERS chip label is resolved through t(key): a literal such as "HOLD" is not a catalog key and logged
// MISSING_MESSAGE in the browser. The labels must be dotted keys that exist in both locales.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dirname, "..", "..", "app", "web-next");
const src = readFileSync(join(WEB, "app", "deals", "page.tsx"), "utf8");
const block = src.match(/const FILTERS[^=]*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? "";
const labels = [...block.matchAll(/\[\s*"[a-z]+"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => m[1]);

function resolve(cat: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Record<string, unknown>)[k] : undefined), cat);
}

describe("deals board filter chips", () => {
  test("FILTERS is parsed and every label is a catalog key present in ko and en", () => {
    expect(labels.length).toBeGreaterThanOrEqual(5);
    for (const locale of ["ko", "en"]) {
      const cat = JSON.parse(readFileSync(join(WEB, "locales", `${locale}.json`), "utf8"));
      for (const key of labels) {
        expect(key.includes("."), `${key} is not a dotted catalog key`).toBe(true);
        expect(typeof resolve(cat, key), `${locale}:${key}`).toBe("string");
      }
    }
  });
});
