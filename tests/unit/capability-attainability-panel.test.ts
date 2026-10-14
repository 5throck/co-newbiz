// Required-capability judgement table / editor / S8 summary structure (source-reading checks).
// ADR-0171: S5 edits through CapabilityJudgementEditor; S8's CapabilityAttainabilityPanel is a
// read-only summary built on the same CapabilityJudgementTable.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f: string) => readFileSync(join(import.meta.dir, "../../app/web-next/components/stages", f), "utf8");
const src = read("CapabilityJudgementTable.tsx");
const editor = read("CapabilityJudgementEditor.tsx");
const panel = read("CapabilityAttainabilityPanel.tsx");

describe("CapabilityJudgementTable structure", () => {
  test("table form kept: one row per capability, thirteen columns (+ optional 비고)", () => {
    expect(src).toContain("<table");
    expect(src).toContain("<tr key={r.id}>");
    expect(src.match(/<th scope="col">/g)?.length).toBe(14); // 13 canonical + the S5-only 비고
    expect(src).toContain("{note && <th scope=\"col\">비고</th>}");
  });
  test("근거·증빙 cell is a preview plus a modal button; one textarea lives in the dialog", () => {
    expect(src.match(/<textarea/g)?.length).toBe(1);
    const cell = src.slice(src.indexOf("const txt = d.rationale"), src.indexOf("<td className=\"text-[length:var(--fs-caption)]\">\n                    {r.confirmed_at"));
    expect(cell).not.toContain("<textarea");
    expect(cell).toContain("미입력");
    expect(cell).toContain("근거 필수");
    expect(cell).toContain("PREVIEW_LEN");
    expect(cell).toContain("근거·증빙 ${canEdit");
    expect(src).not.toMatch(/evidence:\s*e\.target\.value/);
  });
  test("modal dialog: aria, focus trap, counter, cap, save writes the draft", () => {
    const dlg = src.slice(src.indexOf("function RationaleDialog"), src.indexOf("export function SummaryStrip"));
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
    expect(src).toContain("readOnly={!canEdit}");
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
    const patch = src.slice(src.indexOf("export const judgementPatch"), src.indexOf("const RESOLUTIONS"));
    expect(patch).not.toContain("evidence");
    expect(src).toContain("기존 증빙");
    expect(src).toContain("r.evidence.map");
  });
  test("every judgement control is gated by canEdit; S3 columns have no inputs", () => {
    // all controls that change a draft sit behind `canEdit`; the S3 narrative cells are always readOnly
    expect(src).toContain("const canEdit = editable && !!onSet;");
    for (const f of ["필요 수준", "보유 수준"]) expect(src).toContain(`field="${f}"`);
    expect(src.match(/readOnly\b(?!=)/g)?.length).toBeGreaterThanOrEqual(2);
  });
  test("기대 수준 hint is muted suggestion text only (no comparison with 필요 수준)", () => {
    expect(src).toContain("RESOLUTION_EXPECTED_LEVEL_HINT[resolution]");
    expect(src).toContain("text-[color:var(--muted-fg)]");
    expect(src).toContain('data-testid="expected-level-hint"');
  });
});

describe("CapabilityJudgementEditor (S5)", () => {
  test("drafts via PUT, human confirm via POST .../confirm, S3 values are never sent", () => {
    expect(editor).toContain("api.put<AttainabilityViewData>(endpoint");
    expect(editor).toContain("api.post<AttainabilityViewData>(`${endpoint}/confirm`");
    expect(editor).toContain("judgementPatch(");
    expect(editor).toContain("초안 저장");
    expect(editor).toContain("판정 확정");
    expect(editor).toContain("canWriteProject(me?.role)");
    // 비고 keeps saving through the S3 register route; the judgement save refreshes 해소 방식 locally
    expect(editor).toContain("/capability-gap");
    expect(editor).toContain("resolution: byId.get(g.id)");
  });
});

describe("S8 CapabilityAttainabilityPanel is read-only", () => {
  test("renders the shared table with editable={false}; no inputs, selects, save or confirm of its own", () => {
    expect(panel).toContain("<CapabilityJudgementTable");
    expect(panel).toContain("editable={false}");
    for (const k of ["<input", "<select", "<textarea", "초안 저장", "판정 확정", "api.put", "api.post"]) expect(panel).not.toContain(k);
    expect(panel).toContain("S5에서 판정");
    expect(panel).toContain("읽기 전용");
  });
  test("keeps the compact strip for the scenario tab", () => {
    expect(panel).toContain("compact");
    expect(panel).toContain("<SummaryStrip s={view.summary} />");
  });
});
