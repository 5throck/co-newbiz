/**
 * Unit tests for competitor web-search proposal normalization (ADR-0142
 * follow-up): the LLM response normalizer keeps only candidates that cite a
 * valid evidence index — names without source_indices are treated as
 * fabrication and dropped; dedupe runs against already-registered names; the
 * cap is 5.
 */

import { test, expect, describe } from "bun:test";

const { normalizeWebSuggestions } = await import("../../app/web-next/lib/competitor-web-proposals.ts");

const sources = [
  { title: "업계 보도", url: "https://example.com/1", snippet: "A사 경쟁 심화" },
  { title: "애널리스트 리포트", url: "https://example.com/2", snippet: "B사 점유율" },
  { title: "공시", url: "https://example.com/3", snippet: "C사 신규 진입" },
];

function llmOk(candidates: unknown[]): { source: "llm"; provider: string; text: string } {
  return { source: "llm", provider: "test", text: JSON.stringify({ candidates }) };
}

describe("normalizeWebSuggestions", () => {
  test("keeps only candidates citing a valid evidence index", () => {
    const out = normalizeWebSuggestions(
      llmOk([
        { name: "A사", note: "직접 경쟁", source_indices: [1] },
        { name: "근거없음사", note: "지어낸 이름", source_indices: [] },
        { name: "범위초과사", note: "잘못된 인덱스", source_indices: [99] },
      ]),
      sources,
      [],
    );
    expect(out.map((s) => s.name)).toEqual(["A사"]);
    expect(out[0].sources[0].url).toBe("https://example.com/1");
    expect(out[0].reliability).toBe("B");
  });

  test("dedupes against registered names and caps at 5", () => {
    const candidates = [
      { name: "이미등록", note: "", source_indices: [1] },
      ...Array.from({ length: 7 }, (_, i) => ({ name: `후보${i}`, note: "", source_indices: [2] })),
    ];
    const out = normalizeWebSuggestions(llmOk(candidates), sources, ["이미등록"]);
    expect(out).toHaveLength(5);
    expect(out.some((s) => s.name === "이미등록")).toBe(false);
  });

  test("non-llm fallback sources yield no suggestions", () => {
    const out = normalizeWebSuggestions(
      { source: "synthesis", provider: "deterministic", text: JSON.stringify({ candidates: [{ name: "X", source_indices: [1] }] }) },
      sources,
      [],
    );
    expect(out).toEqual([]);
  });
});
