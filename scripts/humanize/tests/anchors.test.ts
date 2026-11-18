// @version 1.0.0
import { describe, expect, test } from "bun:test";
import { anchorDiff } from "../lib/anchors";
import {
  ANCHOR_ACRONYM_CHANGED,
  ANCHOR_DATE_CHANGED,
  ANCHOR_NUMBER_CHANGED,
  ANCHOR_SENTENCE,
  ANCHOR_STATUTE_DROPPED,
} from "./fixtures/korean";

const cats = (a: string, b: string) => anchorDiff(a, b).map((d) => d.category);

describe("anchor gate", () => {
  test("identical text has no differences", () => {
    expect(anchorDiff(ANCHOR_SENTENCE, ANCHOR_SENTENCE)).toEqual([]);
  });

  test("equality ignores order", () => {
    const a = "수치는 10%와 20%이며 LNG와 KOGAS가 언급된다.";
    const b = "KOGAS와 LNG가 나오고 20%와 10%가 제시된다.";
    expect(anchorDiff(a, b)).toEqual([]);
  });

  test("a changed number is detected", () => {
    expect(cats(ANCHOR_SENTENCE, ANCHOR_NUMBER_CHANGED)).toContain("number");
  });

  test("a changed date is detected", () => {
    expect(cats(ANCHOR_SENTENCE, ANCHOR_DATE_CHANGED)).toContain("date");
  });

  test("a dropped statute reference is detected", () => {
    expect(cats(ANCHOR_SENTENCE, ANCHOR_STATUTE_DROPPED)).toContain("statute");
  });

  test("an altered acronym is detected", () => {
    expect(cats(ANCHOR_SENTENCE, ANCHOR_ACRONYM_CHANGED)).toContain("latin");
  });

  test("an added number is detected", () => {
    expect(cats("매출은 늘었다.", "매출은 12% 늘었다.")).toContain("number");
  });

  test("units and percentages are part of the number anchor", () => {
    expect(cats("규모는 3억원이다.", "규모는 3억이다.")).toContain("number");
    expect(cats("비중은 30%다.", "비중은 30퍼센트다.")).toContain("number");
  });

  test("spacing inside a date does not matter", () => {
    expect(anchorDiff("2026년 3월 5일에 시행", "2026년3월5일 시행")).toEqual([]);
  });

  test("inline code, link targets and heading markers must match", () => {
    expect(cats("설정은 `a.b` 이다.", "설정은 `a.c` 이다.")).toContain("code");
    expect(cats("[문서](https://a.example/x) 참고", "[문서](https://a.example/y) 참고")).toContain("link");
    expect(cats("## 제목\n본문", "### 제목\n본문")).toContain("heading");
  });

  test("glossary terms keep their count", () => {
    expect(anchorDiff("시너지 효과를 본다.", "결합 효과를 본다.", ["시너지"]).map((d) => d.category)).toEqual(["glossary"]);
  });

  test("article references keep their full form", () => {
    expect(cats("제12조 제3항 제2호에 따른다.", "제12조 제3항에 따른다.")).toContain("statute");
  });
});
