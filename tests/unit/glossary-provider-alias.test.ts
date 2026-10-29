import { describe, expect, test } from "bun:test";
import { buildIndex, segmentByGlossary } from "../../app/web-next/lib/glossary-provider.tsx";

const terms = [
  { key: "Financial Covenant", ko: "대출 약정 조건(커버넌트)", en: "Financial Covenant", category: "financial", aliases: ["재무약정", "FC"] },
  { key: "Green Field", ko: "그린필드", en: "Green Field", category: "business", aliases: ["GF"] },
];

describe("glossary alias auto-linking", () => {
  const index = buildIndex(terms);
  test("an old wording kept as alias gets the tooltip", () => {
    const seg = segmentByGlossary("재무약정 위반 시 상환", index);
    expect(seg.some((s) => typeof s !== "string" && s.term.key === "Financial Covenant")).toBe(true);
  });
  test("very short aliases are not indexed (no false positives)", () => {
    const seg = segmentByGlossary("GF and FC in a sentence", index);
    expect(seg.every((s) => typeof s === "string")).toBe(true);
  });
});
