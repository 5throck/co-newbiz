// S8 capability attainability panel structure (source-reading checks).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dir, "../../app/web-next/components/stages/CapabilityAttainabilityPanel.tsx"), "utf8");

describe("CapabilityAttainabilityPanel structure", () => {
  test("table form kept: one row per capability, nine columns", () => {
    expect(src).toContain("<table");
    expect(src).toContain("<tr key={r.id}>");
    expect(src.match(/<th scope="col">/g)?.length).toBe(9);
  });
  test("one 근거·증빙 textarea bound to rationale, no evidence textarea", () => {
    expect(src.match(/<textarea/g)?.length).toBe(1);
    expect(src).toContain("근거·증빙");
    expect(src).not.toContain("증빙 (한 줄에 하나)");
    expect(src).not.toMatch(/evidence:\s*e\.target\.value/);
  });
  test("grade control is a select with four options, no FilterChip group", () => {
    expect(src).not.toContain("FilterChip");
    expect(src).not.toContain('role="group"');
    expect(src).toContain("`${r.capability} 달성 가능성`");
    expect(src).toContain("<select");
    expect(src).toContain('{ value: "", text: "미판정" }');
    for (const [v, t] of [["high", "높음"], ["medium", "중간"], ["low", "낮음"]]) expect(src).toContain(`{ value: "${v}", text: "${t}" }`);
    expect(src).toContain("GRADE_OPTIONS.map");
  });
  test("save payload omits evidence; legacy evidence shown read-only", () => {
    const save = src.slice(src.indexOf("async function save"), src.indexOf("async function confirm"));
    expect(save).not.toContain("evidence");
    expect(src).toContain("기존 증빙");
    expect(src).toContain("r.evidence.map");
  });
});
