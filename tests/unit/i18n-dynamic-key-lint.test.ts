// Dynamic-key catalog coverage (validator hardening D8, design
// 2026-11-04-i18n-dynamic-key-lint) — the 2026-11-04 live bug: RetentionHandling
// gained "delete_only" but the locale catalogs lacked
// admin.ops.handling_delete_only, and the UI rendered MISSING_MESSAGE through
// t(`handling_${e.handling}`). Template-literal keys are invisible to the
// baseline and dotted-key checks; this suite pins the third check that
// cross-checks every enum union member against the catalogs.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LOCALES,
  parseUnionTypeValues,
  scanDynamicKeyCoverage,
  type DynamicKeyFamily,
} from "../../scripts/co-newbiz/i18n-lint.ts";

const PROJECT_ROOT = join(import.meta.dirname, "../..");

const FAMILY: DynamicKeyFamily = {
  prefix: "handling_",
  namespace: "admin.ops",
  valuesSource: "db/lib/retention-registry.ts",
  typeName: "RetentionHandling",
};

const FAMILIES: readonly DynamicKeyFamily[] = [
  FAMILY,
  { ...FAMILY, prefix: "handlingHint_" },
];

const realCatalogs = (): Record<string, unknown> =>
  Object.fromEntries(
    LOCALES.map((locale) => [locale, JSON.parse(readFileSync(join(PROJECT_ROOT, "app/web-next/locales", `${locale}.json`), "utf8"))]),
  );

describe("dynamic-key union parser", () => {
  test("extracts the quoted literals of the RetentionHandling declaration", () => {
    const src = readFileSync(join(PROJECT_ROOT, "db/lib/retention-registry.ts"), "utf8");
    expect(parseUnionTypeValues(src, "RetentionHandling")).toEqual([
      "archive_then_delete",
      "archive_only",
      "delete_only",
    ]);
  });

  test("parses a multi-line union and ignores comments and other declarations", () => {
    const src = [
      "// example in a comment: \"not_a_value\" | \"also_not\"",
      "export type NotTheOne = \"decoy\";",
      "export type Handling =",
      "  \"archive_then_delete\" | // trailing comment \"nope\"",
      "  \"archive_only\" |",
      "  \"delete_only\";",
      "const x = \"unrelated\";",
    ].join("\n");
    expect(parseUnionTypeValues(src, "Handling")).toEqual([
      "archive_then_delete",
      "archive_only",
      "delete_only",
    ]);
    expect(parseUnionTypeValues(src, "Missing")).toEqual([]);
  });

  test("an unparseable values source is itself a violation, not a silent pass", () => {
    const violations = scanDynamicKeyCoverage(
      [{ ...FAMILY, typeName: "NoSuchType" }],
      PROJECT_ROOT,
      realCatalogs(),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.key).toContain("unparseable");
  });
});

describe("dynamic-key catalog coverage — real tree", () => {
  test("every RetentionHandling value has label and hint keys in ko and en", () => {
    expect(scanDynamicKeyCoverage(FAMILIES, PROJECT_ROOT)).toEqual([]);
  });

  test("the value domain is exactly the three registry handlings (no silent narrowing)", () => {
    const src = readFileSync(join(PROJECT_ROOT, "db/lib/retention-registry.ts"), "utf8");
    const values = parseUnionTypeValues(src, "RetentionHandling");
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values).toContain("delete_only");
  });
});

describe("dynamic-key catalog coverage — missing-key scenario (in-memory)", () => {
  test("deleting admin.ops.handling_delete_only from a ko deep copy reports exactly that key", () => {
    const catalogs = realCatalogs() as Record<string, Record<string, unknown>>;
    // Simulate the 2026-11-04 bug: the key never made it into the ko catalog.
    const ko = structuredClone(catalogs.ko) as Record<string, Record<string, Record<string, unknown>>>;
    expect(typeof ko.admin?.ops?.handling_delete_only).toBe("string");
    delete ko.admin.ops.handling_delete_only;
    const patched = { ...catalogs, ko };

    const violations = scanDynamicKeyCoverage(FAMILIES, PROJECT_ROOT, patched);
    expect(violations).toEqual([
      {
        locale: "ko",
        key: "admin.ops.handling_delete_only",
        valuesSource: "db/lib/retention-registry.ts",
        typeName: "RetentionHandling",
      },
    ]);
    // en is unaffected by the ko-only deletion.
    expect(violations.every((v) => v.locale !== "en")).toBe(true);
  });

  test("every family value is checked, not just the first", () => {
    const catalogs = realCatalogs() as Record<string, Record<string, unknown>>;
    const en = structuredClone(catalogs.en) as Record<string, Record<string, Record<string, unknown>>>;
    delete en.admin.ops.handlingHint_delete_only;
    delete en.admin.ops.handling_archive_only;

    const violations = scanDynamicKeyCoverage(FAMILIES, PROJECT_ROOT, { ...catalogs, en });
    expect(violations.map((v) => `${v.locale} ${v.key}`).sort()).toEqual([
      "en admin.ops.handlingHint_delete_only",
      "en admin.ops.handling_archive_only",
    ]);
  });

  test("empty-string catalog entries count as missing", () => {
    const catalogs = realCatalogs() as Record<string, Record<string, unknown>>;
    const en = structuredClone(catalogs.en) as Record<string, Record<string, Record<string, string>>>;
    en.admin.ops.handling_delete_only = "";
    expect(scanDynamicKeyCoverage(FAMILIES, PROJECT_ROOT, { ...catalogs, en })).toEqual([
      {
        locale: "en",
        key: "admin.ops.handling_delete_only",
        valuesSource: "db/lib/retention-registry.ts",
        typeName: "RetentionHandling",
      },
    ]);
  });
});
