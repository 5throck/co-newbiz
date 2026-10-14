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
  test("segmented grade control with aria-pressed chips and text labels", () => {
    expect(src).toContain("FilterChip");
    expect(src).toContain('role="group"');
    for (const t of ["높음", "중간", "낮음", "미판정"]) expect(src).toContain(`text: "${t}"`);
    expect(src).not.toContain('<option value="high">');
  });
  test("save payload omits evidence; legacy evidence shown read-only", () => {
    const save = src.slice(src.indexOf("async function save"), src.indexOf("async function confirm"));
    expect(save).not.toContain("evidence");
    expect(src).toContain("기존 증빙");
    expect(src).toContain("r.evidence.map");
  });
});
