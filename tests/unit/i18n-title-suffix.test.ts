// Tab-title suffix regression guard (2026-10-24 live regression): a locale
// restructure moved `titleSuffix` from `common` to `pages.titles`, but the
// root layout's generateMetadata kept the old flat path, so every browser
// tab rendered the raw fallback key `common.titleSuffix`. This test pins the
// contract between the consumer (app/web-next/app/layout.tsx, which scopes
// getTranslations("pages.titles") and calls t("titleSuffix")) and both
// catalogs: the key must exist at pages.titles.titleSuffix in ko AND en.
import { describe, expect, test } from "bun:test";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

type Catalog = Record<string, unknown>;

/** The namespace + key app/web-next/app/layout.tsx resolves for the tab-title suffix. */
const CONSUMER_NAMESPACE = "pages.titles";
const CONSUMER_KEY = "titleSuffix";
const CONSUMER_PATH = `${CONSUMER_NAMESPACE}.${CONSUMER_KEY}`;

function resolvePath(catalog: Catalog, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc !== null && typeof acc === "object") return (acc as Catalog)[k];
    return undefined;
  }, catalog);
}

describe("i18n title suffix (tab title contract)", () => {
  test.each([
    ["ko", ko],
    ["en", en],
  ])("%s catalog has titleSuffix at the path layout.tsx uses", (_locale, catalog) => {
    const v = resolvePath(catalog as Catalog, CONSUMER_PATH);
    expect(typeof v).toBe("string");
    expect(v as string).not.toBe("");
  });

  test("titleSuffix is not left behind under common (the regression mode)", () => {
    // If this fails, the key moved back to the flat `common` scope: update
    // generateMetadata in app/web-next/app/layout.tsx and this test together.
    expect(resolvePath(ko as Catalog, "common.titleSuffix")).toBeUndefined();
    expect(resolvePath(en as Catalog, "common.titleSuffix")).toBeUndefined();
  });
});
