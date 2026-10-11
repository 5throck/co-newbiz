import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../app/web-next/${p}`, import.meta.url), "utf8");

describe("note value reads go through noteNumber (no NaN)", () => {
  const src = read("components/business-case/ValuationMethodology.tsx");
  test("no raw Number(n.*) / Number(hn.*) reads or local parseNote", () => {
    expect(src).not.toMatch(/\bNumber\((n|hn)\./);
    expect(src).not.toContain("function parseNote");
    expect(src).toContain("parseSimNote");
    expect(src).toContain("noteNumber");
  });
});

describe("ReviewBuckets origin / not-performed line", () => {
  const src = read("components/ReviewBuckets.tsx");
  test("uses shared helpers, no local originOf or localizeMessage", () => {
    expect(src).toContain("reviewOriginText");
    expect(src).toContain("localizeNotPerformedReason");
    expect(src).not.toContain("function originOf");
    expect(src).not.toContain("localizeMessage");
    expect(src).not.toContain("수행되지 않음:");
  });
});

describe("targets table chips do not wrap", () => {
  const src = read("components/stages/BusinessCaseStage.tsx");
  test("band chip and row action are no-wrap; table sized to content", () => {
    expect(src).toMatch(/status-not-started block mt-1 whitespace-nowrap/);
    expect(src).toContain("btn-ghost btn-sm whitespace-nowrap");
    expect(src).toContain("data-table targets-table");
  });
});
