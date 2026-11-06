// PR3 (design 2026-11-06, Fix 3) — UI-side catalog contract for keyed review
// items. ReviewBuckets renders keyed items via next-intl
// (resolveKeyedItem → tr(messageId[, …Reason])) and falls back to
// localizeItem when a key is absent from the catalog. This test pins which
// keys the catalog must carry and that claim/reason messages keep equal ICU
// parameter sets across ko/en, so a catalog edit cannot silently break the
// keyed rendering path.
import { describe, expect, test } from "bun:test";
import { REVIEW_ITEM_KEY_LIST } from "../../app/web-next/lib/review/review-item-keys.ts";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

type Catalog = Record<string, unknown>;

function dotValue(obj: Catalog, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, k) => (acc as Catalog | undefined)?.[k], obj);
}

function icuParams(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!).sort();
}

/** Keys the UI deliberately leaves on the localizeItem fallback: free LLM
 *  text (the stored text IS the message) and the AI-2nd reviewer-selection
 *  annotations, whose regex translations live in review-display.ts. */
const FALLBACK_KEYS = new Set([
  "review.ai2.freeText",
  "review.ai2.fallbackReviewer",
  "review.ai2.exemptAgents",
  "review.ai2.unresolvedAgents",
]);

describe("review item catalog contract (PR3)", () => {
  test("every cataloged item key has claim + Reason messages in ko and en", () => {
    const cataloged = REVIEW_ITEM_KEY_LIST.filter((k) => !FALLBACK_KEYS.has(k));
    expect(cataloged.length).toBeGreaterThan(0);
    for (const key of cataloged) {
      for (const [locale, cat] of [
        ["ko", ko],
        ["en", en],
      ] as const) {
        expect(typeof dotValue(cat, key)).toBe("string");
        expect(typeof dotValue(cat, `${key}Reason`)).toBe("string");
      }
    }
  });

  test("claim messages keep equal ICU param sets across ko/en", () => {
    for (const key of REVIEW_ITEM_KEY_LIST.filter((k) => !FALLBACK_KEYS.has(k))) {
      const koV = dotValue(ko, key) as string;
      const enV = dotValue(en, key) as string;
      expect(icuParams(koV)).toEqual(icuParams(enV));
      const koR = dotValue(ko, `${key}Reason`) as string;
      const enR = dotValue(en, `${key}Reason`) as string;
      expect(icuParams(koR)).toEqual(icuParams(enR));
    }
  });

  test("fallback keys stay off the catalog (missing-key → localizeItem path)", () => {
    for (const key of [...FALLBACK_KEYS]) {
      expect(dotValue(ko, key)).toBeUndefined();
      expect(dotValue(en, key)).toBeUndefined();
    }
  });
});
