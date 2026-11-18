// @version 1.0.0
import { describe, expect, test } from "bun:test";
import { buildPlan, charLength, edgeWhitespace, MAX_UNIT_CHARS, segmentDocument, splitOversized } from "../lib/segment";
import { FILLER_ORIGINAL } from "./fixtures/korean";

const FENCE = "```";
const DOC = [
  "---",
  "title: 샘플",
  "---",
  "# 제목",
  "",
  "첫 번째 본문 문단이다. 이 문장은 한글로 쓰였다.",
  "",
  `${FENCE}ts`,
  "const x = 1;",
  FENCE,
  "",
  "| 항목 | 값 |",
  "|---|---|",
  "| a | b |",
  "",
  "> 인용문은 그대로 남아야 한다.",
  "",
  "<!-- 주석 블록 -->",
  "",
  "- [ ] 확인할 항목",
  "- [x] 끝난 항목",
  "",
  "This paragraph is plain English and long enough to matter here.",
  "",
  "마지막 본문 문단이다.",
  "",
].join("\n");

describe("segmentDocument", () => {
  const blocks = segmentDocument(DOC);

  test("is lossless", () => {
    expect(blocks.map((b) => b.text).join("")).toBe(DOC);
  });

  test("protected blocks come back byte-identical", () => {
    const prot = (reason: string) =>
      blocks.filter((b) => b.type === "protected" && b.reason === reason).map((b) => b.text);
    expect(prot("frontmatter")).toEqual(["---\ntitle: 샘플\n---\n"]);
    expect(prot("fenced-code")).toEqual([`${FENCE}ts\nconst x = 1;\n${FENCE}\n`]);
    expect(prot("table")).toEqual(["| 항목 | 값 |\n|---|---|\n| a | b |\n"]);
    expect(prot("blockquote")).toEqual(["> 인용문은 그대로 남아야 한다.\n"]);
    expect(prot("html-comment")).toEqual(["<!-- 주석 블록 -->\n"]);
    expect(prot("checklist")).toEqual(["- [ ] 확인할 항목\n- [x] 끝난 항목\n"]);
  });

  test("non-Hangul prose passes through verbatim", () => {
    const eng = blocks.find((b) => b.type === "protected" && b.reason === "not-hangul-dominant");
    expect(eng?.text.startsWith("This paragraph is plain English")).toBe(true);
  });

  test("Hangul prose paragraphs and the heading stay polishable", () => {
    const prose = blocks.filter((b) => b.type === "prose").map((b) => b.text.trim());
    expect(prose).toContain("첫 번째 본문 문단이다. 이 문장은 한글로 쓰였다.");
    expect(prose).toContain("마지막 본문 문단이다.");
  });

  test("a section under a marked heading is protected", () => {
    const doc = "# 용어\n\n정의 문단은 용어집 정의다.\n\n# 본문\n\n일반 본문 문단이다.\n";
    const b = segmentDocument(doc, { protectedHeadings: ["용어"] });
    expect(b.some((x) => x.type === "protected" && x.reason === "marked-section" && x.text.includes("정의 문단"))).toBe(
      true,
    );
    expect(b.some((x) => x.type === "prose" && x.text.includes("일반 본문"))).toBe(true);
  });

  test("CRLF documents round-trip", () => {
    const doc = "본문 문단이다.\r\n\r\n| a | b |\r\n|---|---|\r\n\r\n둘째 문단이다.\r\n";
    expect(
      segmentDocument(doc)
        .map((b) => b.text)
        .join(""),
    ).toBe(doc);
  });
});

describe("buildPlan (unit packing)", () => {
  const rep = (n: number) => Array(n).fill(FILLER_ORIGINAL.join(" ")).join(" ");
  const para = (n: number) => rep(n) + "\n\n";

  test("units never exceed 5,000 characters and concatenate back exactly", () => {
    const doc = para(10) + para(10) + para(10) + para(10);
    const plan = buildPlan(segmentDocument(doc));
    const units = plan.filter((p) => p.type === "unit");
    expect(units.length).toBeGreaterThan(1);
    for (const u of units) expect(charLength(u.text)).toBeLessThanOrEqual(MAX_UNIT_CHARS);
    expect(plan.map((p) => p.text).join("")).toBe(doc);
  });

  test("cuts only on paragraph boundaries", () => {
    const doc = para(10) + para(10) + para(10);
    const units = buildPlan(segmentDocument(doc)).filter((p) => p.type === "unit");
    for (const u of units) expect(u.text.endsWith("\n\n")).toBe(true);
  });

  test("never crosses a protected block", () => {
    const doc = "첫 문단이다.\n\n| a | b |\n|---|---|\n\n둘째 문단이다.\n";
    const plan = buildPlan(segmentDocument(doc));
    const kinds = plan.map((p) => p.type).filter((t, i, a) => t !== a[i - 1]);
    expect(kinds).toEqual(["unit", "protected", "unit"]);
    for (const p of plan) if (p.type === "unit") expect(p.text.includes("|")).toBe(false);
  });

  test("offsets index the source", () => {
    const doc = para(3) + "| a | b |\n\n" + para(3);
    for (const p of buildPlan(segmentDocument(doc))) expect(doc.slice(p.start, p.end)).toBe(p.text);
  });

  test("an oversized single paragraph is cut at sentence ends", () => {
    const big = rep(40); // roughly 12,000 chars, one paragraph
    expect(charLength(big)).toBeGreaterThan(MAX_UNIT_CHARS * 2);
    const pieces = splitOversized(big);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
    expect(pieces.join("")).toBe(big);
    for (const p of pieces) {
      expect(charLength(p)).toBeLessThanOrEqual(MAX_UNIT_CHARS);
      expect(/[.!?]\s*$/.test(p)).toBe(true);
    }
  });

  test("edge whitespace is reported", () => {
    expect(edgeWhitespace("\n문단\n\n")).toEqual({ lead: "\n", trail: "\n\n" });
  });
});
