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
  test("근거·증빙 cell is a preview plus a modal button; one textarea lives in the dialog", () => {
    expect(src.match(/<textarea/g)?.length).toBe(1);
    const cell = src.slice(src.indexOf("const txt = d.rationale"), src.indexOf("기존 증빙"));
    expect(cell).not.toContain("<textarea");
    expect(cell).toContain("미입력");
    expect(cell).toContain("근거 필수");
    expect(cell).toContain("PREVIEW_LEN");
    expect(cell).toContain("근거·증빙 ${canAct");
    expect(src).not.toMatch(/evidence:\s*e\.target\.value/);
  });
  test("modal dialog: aria, focus trap, counter, cap, save writes the draft", () => {
    const dlg = src.slice(src.indexOf("function RationaleDialog"), src.indexOf("function SummaryStrip"));
    expect(dlg).toContain('role="dialog"');
    expect(dlg).toContain('aria-modal="true"');
    expect(dlg).toContain("useModalFocus(onClose)");
    expect(dlg).toContain("modal-panel");
    expect(dlg).toContain("rows={10}");
    expect(dlg).toContain("autoFocus");
    expect(dlg).toContain("maxLength={RATIONALE_MAX}");
    expect(dlg).toContain("RATIONALE_MAX}자");
    expect(src).toContain("const RATIONALE_MAX = 600");
    expect(src).toContain("set(row.id, { rationale: t })");
    expect(src).toContain('readOnly={!canAct}');
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
  test("no redundant grade chip or human-input marker; AI draft marker kept", () => {
    expect(src).not.toContain("GRADE_CHIP");
    expect(src).not.toContain("GRADE_TEXT");
    expect(src).not.toContain("사람 입력");
    expect(src).toContain('r.drafted_by === "ai"');
    expect(src).toContain("AI 초안");
  });
  test("save payload omits evidence; legacy evidence shown read-only", () => {
    const save = src.slice(src.indexOf("async function save"), src.indexOf("async function confirm"));
    expect(save).not.toContain("evidence");
    expect(src).toContain("기존 증빙");
    expect(src).toContain("r.evidence.map");
  });
});
