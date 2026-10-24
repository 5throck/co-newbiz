// i18n catalog gap pins (2026-10-24 frontend fix) — the sibling audit found two
// catalog blocks missing from BOTH locales while their components shipped:
//   1. app/error.tsx used errors.unexpected.* (title/body/digest) — the block
//      never existed in either catalog, so every unhandled error rendered 3 raw
//      keys.
//   2. app/glossary/page.tsx used 15 pages.glossary.* keys — the extraction
//      during the locale restructure dropped the whole block.
// The glossary key list is extracted from the component source at test time, so
// removing a catalog key or adding a t() key without a catalog entry fails here.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

type Catalog = Record<string, unknown>;

function lookup(obj: Catalog, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Catalog)[k] : undefined), obj);
}

function expectNonEmpty(catalog: Catalog, locale: string, key: string): void {
  const v = lookup(catalog, key);
  expect([locale, key, typeof v]).toEqual([locale, key, "string"]);
  expect([locale, key, v as string]).not.toEqual([locale, key, ""]);
}

// ── pages.glossary — keys extracted from the component, not mirrored ──
const glossarySource = readFileSync(
  new URL("../../app/web-next/app/glossary/page.tsx", import.meta.url),
  "utf8",
);
// t("key") resolves against the pages.glossary namespace. tc("...") (common)
// cannot match: the pattern requires "(" immediately after the single-t call.
// Section headings are used twice (aria-label + h3) — dedupe before comparing.
const glossaryKeys = [
  ...new Set([...glossarySource.matchAll(/(?<![\w$.])t\("([^"]+)"/g)].map((m) => m[1]!)),
];

const GLOSSARY_COMPONENT_KEYS = [
  "heading",
  "searchAria",
  "phSearch",
  "empty",
  "totalCount",
  "detailAriaEmpty",
  "detailEmptyPrompt",
  "detailAria",
  "closeAria",
  "secDefinition",
  "secWhy",
  "secAliases",
  "secRelated",
  "secUsedIn",
  "secOwner",
];

describe("i18n catalog gaps — pages.glossary", () => {
  test("component uses exactly the 15 pinned keys (no drift in either direction)", () => {
    expect(glossaryKeys.sort()).toEqual([...GLOSSARY_COMPONENT_KEYS].sort());
  });

  test("every key exists as a non-empty string in ko and en", () => {
    for (const key of GLOSSARY_COMPONENT_KEYS) {
      expectNonEmpty(ko as Catalog, "ko", `pages.glossary.${key}`);
      expectNonEmpty(en as Catalog, "en", `pages.glossary.${key}`);
    }
  });

  test("interpolation placeholders survive in both catalogs", () => {
    expect(lookup(ko as Catalog, "pages.glossary.totalCount")).toContain("{count}");
    expect(lookup(en as Catalog, "pages.glossary.totalCount")).toContain("{count}");
    expect(lookup(ko as Catalog, "pages.glossary.detailAria")).toContain("{name}");
    expect(lookup(en as Catalog, "pages.glossary.detailAria")).toContain("{name}");
  });
});

describe("i18n catalog gaps — errors.unexpected", () => {
  test("title/body/digest exist non-empty in ko and en", () => {
    for (const key of ["title", "body", "digest"]) {
      expectNonEmpty(ko as Catalog, "ko", `errors.unexpected.${key}`);
      expectNonEmpty(en as Catalog, "en", `errors.unexpected.${key}`);
    }
  });

  test("digest keeps the {digest} interpolation the error boundary passes", () => {
    expect(lookup(ko as Catalog, "errors.unexpected.digest")).toContain("{digest}");
    expect(lookup(en as Catalog, "errors.unexpected.digest")).toContain("{digest}");
  });
});
