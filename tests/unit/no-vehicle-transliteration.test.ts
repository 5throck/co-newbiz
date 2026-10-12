import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../app/web-next");

describe("S10 terminology: no transliterated 'vehicle' term in UI strings", () => {
  for (const f of ["components/stages/DealStructureStage.tsx", "lib/labels.ts", "lib/dd-checklist-ko.ts"]) {
    test(`${f} contains no 비히클`, () => {
      expect(readFileSync(join(root, f), "utf8")).not.toContain("비히클");
    });
  }
  test("DealStructureStage uses the replacement wording", () => {
    const s = readFileSync(join(root, "components/stages/DealStructureStage.tsx"), "utf8");
    expect(s).toContain("투자 주체");
    expect(s).toContain("설립 법인 형태");
  });
});
