// @version 1.0.0
/**
 * Admin glossary registration helpers (app/web-next/lib/glossary-form.ts):
 * key suggestion, alias chips, live duplicate check, production write block,
 * plus the 인도 (Delivery) disambiguation and the shared generator output.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addAliases,
  findGlossaryDuplicates,
  GLOSSARY_OWNER_KEYS,
  isGlossaryWriteBlocked,
  suggestKey,
} from "../../app/web-next/lib/glossary-form.ts";
import { renderGlossaryDataModule } from "../../app/web-next/lib/glossary-generate.ts";
import { GLOSSARY_TERMS } from "../../app/web-next/lib/glossary-data.generated.ts";
import ko from "../../app/web-next/locales/ko.json";

describe("suggestKey", () => {
  test("title-cases words and keeps acronyms and hyphens like existing keys", () => {
    expect(suggestKey("stage gate")).toBe("Stage Gate");
    expect(suggestKey("  Pre-FS  ")).toBe("Pre-FS");
    expect(suggestKey("WACC")).toBe("WACC");
    expect(suggestKey("Kill  Criteria (v2)!")).toBe("Kill Criteria v2");
  });
  test("empty or symbol-only input gives an empty key", () => {
    expect(suggestKey("")).toBe("");
    expect(suggestKey("???")).toBe("");
  });
});

describe("addAliases", () => {
  test("splits on commas/newlines, trims, de-duplicates case-insensitively", () => {
    expect(addAliases(["게이트"], "스테이지 게이트, 게이트 ,\n  Stage gate, stage GATE")).toEqual(["게이트", "스테이지 게이트", "Stage gate"]);
  });
  test("blank input changes nothing", () => {
    expect(addAliases(["a"], " , ")).toEqual(["a"]);
  });
});

describe("findGlossaryDuplicates", () => {
  const existing = [
    { key: "Stage Gate", ko: "단계별 심사 체계(스테이지 게이트)", en: "Stage Gate", aliases: ["게이트"] },
    { key: "CGT", ko: "표준화물선환산톤수", en: "Compensated Gross Tonnage" },
  ];
  test("no clash for a new term", () => {
    expect(findGlossaryDuplicates({ key: "Hysteresis", ko: "이력 현상", en: "Hysteresis", aliases: [] }, existing)).toEqual([]);
  });
  test("reports which entry and field clash, case- and space-insensitively", () => {
    const hits = findGlossaryDuplicates({ key: "stage  gate", ko: "새 용어", en: "Other", aliases: [] }, existing);
    expect(hits).toEqual([{ field: "key", value: "stage  gate", entryKey: "Stage Gate", entryField: "key" }]);
  });
  test("an alias clashing with another entry's ko/alias is reported", () => {
    const hits = findGlossaryDuplicates({ key: "X", ko: "엑스", en: "X", aliases: ["게이트", "표준화물선환산톤수"] }, existing);
    expect(hits.map((h) => `${h.field}:${h.entryKey}.${h.entryField}`)).toEqual(["alias:Stage Gate.alias", "alias:CGT.ko"]);
  });
  test("empty candidate fields never match", () => {
    expect(findGlossaryDuplicates({ key: "", ko: "", en: "", aliases: [""] }, existing)).toEqual([]);
  });
});

describe("isGlossaryWriteBlocked", () => {
  test("blocked in production, in a container, or when forced read-only", () => {
    expect(isGlossaryWriteBlocked({ NODE_ENV: "production" })).toBe(true);
    expect(isGlossaryWriteBlocked({ NODE_ENV: "development", DOCKER_CONTAINER: "1" })).toBe(true);
    expect(isGlossaryWriteBlocked({ GLOSSARY_READ_ONLY: "1" })).toBe(true);
  });
  test("open in development and test", () => {
    expect(isGlossaryWriteBlocked({ NODE_ENV: "development" })).toBe(false);
    expect(isGlossaryWriteBlocked({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("registration surface", () => {
  test("owner options are roster agent keys, each with a ko label", () => {
    const labels = (ko.admin.labels.govOwner ?? {}) as Record<string, string>;
    for (const key of GLOSSARY_OWNER_KEYS) expect(labels[key.replace(/-/g, "_")], key).toBeTruthy();
  });
  test("generator output is the exact projection committed to the repo", () => {
    const committed = readFileSync(join(import.meta.dirname, "../../app/web-next/lib/glossary-data.generated.ts"), "utf8");
    expect(renderGlossaryDataModule(GLOSSARY_TERMS as unknown as Array<Record<string, unknown>>)).toBe(committed);
  });
  test("인도 (Delivery) carries a disambiguation and the country/currency names are restored", () => {
    const delivery = GLOSSARY_TERMS.find((t) => t.key === "인도");
    expect(delivery?.exclude_phrases).toContain("인도 루피");
    expect(delivery?.exclude_paths).toContain("admin.masterData.countryNames.");
    expect(ko.admin.masterData.countryNames.IN).toBe("인도");
    expect(ko.admin.masterData.currencyNames.INR).toBe("인도 루피");
  });
});
