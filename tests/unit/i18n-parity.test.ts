// i18n catalog parity (design 2026-10-23-i18n-ui-adoption §5.1) — the
// project-runnable form of the workspace i18n-audit skill's parity
// methodology: en's key tree must be a strict mirror of ko's (missing and
// extra keys both fail) and every ko value must be non-empty.
import { describe, expect, test } from "bun:test";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";

type Catalog = Record<string, unknown>;

function keyTree(obj: Catalog, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v !== null && typeof v === "object" ? keyTree(v as Catalog, path) : [path];
  });
}

describe("i18n catalog parity", () => {
  test("en key tree exactly mirrors ko", () => {
    const koKeys = keyTree(ko).sort();
    const enKeys = keyTree(en).sort();
    expect(enKeys).toEqual(koKeys);
  });

  test("every ko value is a non-empty string", () => {
    for (const key of keyTree(ko)) {
      const v = key.split(".").reduce<unknown>((acc, k) => (acc as Catalog)[k], ko);
      expect(typeof v).toBe("string");
      expect(v as string).not.toBe("");
    }
  });

  test("every en value is a non-empty string", () => {
    for (const key of keyTree(en)) {
      const v = key.split(".").reduce<unknown>((acc, k) => (acc as Catalog)[k], en);
      expect(typeof v).toBe("string");
      expect(v as string).not.toBe("");
    }
  });
});
