// Required-capability summary table / judgement dialog / editor / S8 summary structure (source-reading
// checks) plus the pure view helpers. ADR-0171: S5 edits through CapabilityJudgementEditor (summary table
// + judgement dialog); S8's CapabilityAttainabilityPanel is a read-only summary on the same table.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildJudgementDetail, buildJudgementSummary, defaultFilter, filterCounts, filterRows, neighborId, type FilterRow,
} from "../../app/web-next/lib/capability-judgement-view.ts";

const read = (f: string) => readFileSync(join(import.meta.dir, "../../app/web-next/components/stages", f), "utf8");
const src = read("CapabilityJudgementTable.tsx");
const dlg = read("CapabilityJudgementDialog.tsx");
const editor = read("CapabilityJudgementEditor.tsx");
const panel = read("CapabilityAttainabilityPanel.tsx");

describe("summary table structure", () => {
  test("one <tr> per capability in a single tbody; six columns (+ conditional S9 검증); no inputs, textareas or selects", () => {
    expect(src.match(/<tr key=\{r\.id\}>/g)?.length).toBe(1);
    expect(src.match(/<tbody>/g)?.length).toBe(1);
    const head = src.slice(src.indexOf("<thead>"), src.indexOf("</thead>"));
    expect(head.match(/<th scope="col"/g)?.length).toBe(7); // 6 base + conditional S9 검증
    for (const t of ["필요 역량", "필요도", "보유 판정", "판정 요약", "확정", "S9 검증", "작업"]) expect(head).toContain(`>${t}</th>`);
    // base order unchanged; the S9 column sits between 확정 and 작업 and only renders with the s9 prop
    expect(head).toContain('>확정</th>{s9 && <th scope="col"');
    for (const k of ["<input", "<select", "<textarea", "NarrativeCell", "HeldEvidenceButton", "colSpan", "rowSpan", "aria-expanded", "cap-sticky"]) expect(src).not.toContain(k);
    const pct = src.match(/COL_PCT = \[([^\]]*)\]/)![1].split(",").map(Number);
    expect(pct.length).toBe(6);
    expect(pct.reduce((a, b) => a + b, 0)).toBe(100);
    expect(pct).toEqual([39, 9, 10, 16, 15, 11]);
    const pctS9 = src.match(/COL_PCT_S9 = \[([^\]]*)\]/)![1].split(",").map(Number);
    expect(pctS9.length).toBe(7);
    expect(pctS9.reduce((a, b) => a + b, 0)).toBe(100);
    const mins = src.match(/COL_MIN_REM = \[([^\]]*)\]/)![1].split(",").map(Number);
    expect(mins.length).toBe(6);
    pct.forEach((p, i) => expect((p / 100) * 1200).toBeGreaterThanOrEqual(mins[i] * 16)); // each column fits its content at a 1200px table
    mins.slice(1).forEach((m) => expect(src).toContain(`minWidth: "${m}rem"`));
    expect(pct[0]).toBe(Math.max(...pct)); // 필요 역량 is the widest column
    expect(pct[3]).toBeLessThan(pct[0]); // 판정 요약 is narrower than the name column
    expect(src).toContain("table-fixed-pct tmin-48");
  });
  test("판정 button only when editable; S8 gets the S5에서 판정 link; viewers get nothing", () => {
    expect(src).toContain("const canEdit = editable && !!onSet;");
    expect(src).toMatch(/\{canEdit\s*\? <button[\s\S]*?>판정<\/button>/);
    expect(src).toContain("judgeHref ? <a href={judgeHref}");
    expect(src).toContain("S5에서 판정");
    expect(src).not.toContain('"보기"');
  });
  test("판정 요약 is one clamped line (ClampedText lines=1) with a muted 미판정 fallback; status chips on ONE line", () => {
    expect(src).toContain("<ClampedText text={sentence} title={buildJudgementDetail(draftOf(r))} lines={1} />");
    expect(src).toContain('<span className="text-[color:var(--muted-fg)]">미판정</span>');
    expect(src.match(/data-testid="capability-chips"/g)?.length).toBe(1);
    expect(src).toContain("flex flex-wrap gap-1 mt-1");
    expect(src).toContain("S3 변경 — 재판정 필요");
    expect(src).toContain("cautions.map");
    expect(read("ClampedText.tsx")).toContain("line-clamp-1");
  });
  test("necessity and holding judgement are icon + text chips", () => {
    expect(src).toContain('<span aria-hidden="true">●</span> {NECESSITY_LABEL[r.necessity]}');
    expect(src).toContain("HELD_STATUS_LABEL[r.held_status]");
  });
  test("filter tabs: tablist/aria-selected, counts in labels, friendly empty line, default from counts", () => {
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toContain("aria-selected={filter === f}");
    expect(src).toContain("{FILTER_LABEL[f]} ({counts[f]})");
    expect(src).toContain('{ todo: "처리할 것", all: "전체" }');
    expect(src).toContain("defaultFilter(counts.todo)");
    expect(src).toContain("처리할 판정이 없습니다");
    expect(src).toContain('data-testid="filter-empty"');
  });
  test("removed-capabilities list and summary strip kept; no previous layout experiments", () => {
    expect(src).toContain("삭제된 역량 (판정 이력)");
    expect(src).toContain("판정 {judged}/{s.total} · 확정 {s.confirmed}");
    expect(src).toContain("미판정 {unjudged}");
    expect(src).toContain("재판정 필요 {s.stale}");
    const css = readFileSync(join(import.meta.dir, "../../app/web-next/app/styles.css"), "utf8");
    expect(css).not.toContain("cap-judge-table");
  });
  test("save payload omits evidence and S3 values", () => {
    const patch = src.slice(src.indexOf("export const judgementPatch"), src.indexOf("const levelText"));
    expect(patch).not.toContain("evidence");
    for (const f of ["requiredLevel", "currentLevel", "necessity", "capability", "held"]) expect(patch).not.toContain(`${f}:`);
    expect(patch).toContain("expectedLevel: d.expectedLevel");
  });
});

describe("judgement dialog structure", () => {
  test("modal pattern: role=dialog, aria-modal, focus trap, title '<capability> 판정'", () => {
    expect(dlg).toContain('role="dialog"');
    expect(dlg).toContain('aria-modal="true"');
    expect(dlg).toContain("useModalFocus(onClose)");
    expect(dlg).toContain("const title = `${row.capability} 판정`");
    expect(dlg).toContain("onClick={onClose}"); // backdrop
  });
  test("S3 block (read-only, tinted, lock) comes before the S5 block; fields in the specified order", () => {
    const s3 = dlg.indexOf('aria-label="S3 정의 (읽기 전용)"');
    const s5 = dlg.indexOf('aria-label="S5 판정 (입력)"');
    expect(s3).toBeGreaterThan(0);
    expect(s5).toBeGreaterThan(s3);
    expect(dlg).toContain("🔒");
    expect(dlg).toContain("var(--muted-bg)");
    const s3Block = dlg.slice(s3, s5);
    const rowDefs = dlg.slice(dlg.indexOf("const s3Rows"), s3); // field list rendered by the S3 block
    const order3 = ["필요도", "필요 수준", "보유 판정", "보유 수준", "보유 근거"].map((k) => rowDefs.indexOf(`["${k}"`));
    expect(order3.every((i) => i >= 0)).toBe(true);
    expect([...order3].sort((a, b) => a - b)).toEqual(order3);
    for (const k of ["legacy-holders-caption", "stale-history", "row.s3_changes", "이전 판정 그대로 재판정", "S3 변경으로 무효화"]) {
      expect(s3Block).toContain(k);
    }
    const s5Block = dlg.slice(s5, dlg.indexOf("<div className=\"flex flex-wrap justify-end"));
    const order5 = ["해소 방식", "기대 수준", "분류", "금액(주기당, 백만원)", "주기", "시작 연차", "기간(개월)", "종료 연차", "달성 가능성", "근거·증빙", "비고"].map((k) => s5Block.indexOf(k));
    expect(order5.every((i) => i >= 0)).toBe(true);
    expect([...order5].sort((a, b) => a - b)).toEqual(order5);
  });
  test("S5 inputs: 기대 수준 textarea 4 rows / 400 cap, 근거·증빙 6 rows / 600 cap, number inputs, grade select, hint", () => {
    expect(dlg).toContain("rows={4} maxLength={NARRATIVE_CAP}");
    expect(dlg).toContain("rows={6} maxLength={RATIONALE_MAX}");
    expect(dlg).toContain("export const RATIONALE_MAX = 600");
    // 2026-10-18: the 시작 연차 input joins 금액·기간(개월) — the dialog now has three numeric inputs.
    expect(dlg.match(/type="number"/g)?.length).toBe(3);
    // Rules of Hooks guard (2026-10-18 live error): every useState must sit
    // ABOVE the dialog's `if (!mounted) return null` early return.
    {
      const early = dlg.indexOf("if (!mounted) return null;");
      expect(early).toBeGreaterThan(0);
      const beforeEarly = dlg.slice(0, early);
      const afterEarly = dlg.slice(early);
      expect((afterEarly.match(/useState\(/g) ?? []).length).toBe(0);
      expect((beforeEarly.match(/useState\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    }
    expect(dlg).toContain('{ value: "", text: "미판정" }');
    for (const [v, t] of [["high", "높음"], ["medium", "중간"], ["low", "낮음"]]) expect(dlg).toContain(`{ value: "${v}", text: "${t}" }`);
    expect(dlg).toContain("RESOLUTION_EXPECTED_LEVEL_HINT[resolution]");
    expect(dlg).toContain('data-testid="expected-level-hint"');
    expect(dlg).toContain("note !== undefined"); // 비고 only where the page shows it
    expect(dlg).toContain("AI 초안");
  });
  test("buttons: 적용 / 적용 후 다음 / 이전 / 취소; apply writes the draft, never saves or confirms", () => {
    for (const b of [">취소<", ">이전<", ">적용 후 다음<", ">적용<"]) expect(dlg).toContain(b);
    expect(dlg).toContain('apply("close")');
    expect(dlg).toContain('apply("next")');
    expect(dlg).toContain('apply("prev")');
    expect(dlg).toContain("disabled={!hasPrev}");
    expect(dlg).toContain("disabled={!hasNext}");
    expect(dlg).not.toContain("api.");
    expect(dlg).toContain("확정하려면 기대 수준이 필요합니다"); // hint only, apply is not blocked
    expect(src).toContain("onApply={(d, n, nav) => apply(editing, d, n, nav)}");
    expect(src).toContain('setEditingId(nav === "close" ? null : neighborId(shownIds, r.id, nav === "next" ? 1 : -1))');
    expect(src).toContain("onRejudge={() => onSet?.(editing.id, {})}");
  });
  test("S8 summary renders no dialog: editing is gated by canEdit and the panel passes editable={false}", () => {
    expect(src).toContain("const editing = canEdit && editingId");
    expect(panel).toContain("editable={false}");
    expect(panel).not.toContain("CapabilityJudgementDialog");
  });
});

describe("CapabilityJudgementEditor (S5)", () => {
  test("drafts via PUT, human confirm via POST .../confirm, S3 values are never sent", () => {
    expect(editor).toContain("api.put<AttainabilityViewData>(endpoint");
    expect(editor).toContain("api.post<AttainabilityViewData>(`${endpoint}/confirm`");
    expect(editor).toContain("judgementPatch(");
    expect(editor).toContain("canWriteProject(me?.role)");
    expect(editor).toContain("/capability-gap");
    expect(editor).toContain("resolution: byId.get(g.id)");
    expect(editor).toContain("dirty={dirty}");
  });
  test("초안 저장 is primary only when dirty; 판정 확정 is ghost; unsaved indicator; one location", () => {
    expect(editor).toContain('className={unsaved ? "btn-primary btn-sm" : "btn-ghost btn-sm"}');
    expect(editor.match(/btn-primary/g)?.length).toBe(1);
    expect(editor).toContain("저장하지 않은 변경");
    expect(editor.match(/판정 확정/g)?.length).toBe(1);
    expect(editor.match(/초안 저장/g)?.length).toBe(1);
  });
});

describe("S8 CapabilityAttainabilityPanel is read-only", () => {
  test("shared table with editable={false}; S5에서 판정 link; no inputs or save/confirm of its own", () => {
    expect(panel).toContain("<CapabilityJudgementTable");
    for (const k of ["<input", "<select", "<textarea", "초안 저장", "판정 확정", "api.put", "api.post", "btn-primary"]) expect(panel).not.toContain(k);
    // 2026-10-17 round 2: brownfield judgement moved to the S9 tab — the entry
    // is track-conditional and the S5/S7 anchors stay for greenfield/S7 scopes.
    expect(panel).toContain("judgeHref={isBrownfield ? s9Href : editHref}");
    expect(panel).toContain("S5에서 판정");
    expect(panel).toContain("읽기 전용");
  });
  test("keeps the compact strip for the scenario tab", () => {
    expect(panel).toContain("compact");
    expect(panel).toContain("<SummaryStrip s={view.summary} />");
  });
  test("mirrors S9 capability-dd verdicts read-only; the brownfield entry names the S9 tab (2026-10-17 round 2/3)", () => {
    // round 3: the separate S9 table is gone — verdicts ride on the canonical
    // table as the read-only "S9 검증" column (one home per fact).
    expect(panel).not.toContain('data-testid="s9-capability-dd-results"');
    expect(panel).toContain("s9ByRow");
    expect(panel).toContain("s9={ddVerdicts && ddVerdicts.length > 0 ? s9ByRow : undefined}");
    expect(panel).toContain('view.track === "brownfield"');
    expect(panel).toContain("브라운필드 필요 역량 판정 주전장은 S9 실사·검증");
    // no new writes introduced by the mirror
    expect(panel).not.toContain("api.put");
    expect(panel).not.toContain("api.post");
  });
});

describe("pure view helpers", () => {
  const d = (o: Partial<{ resolution: string; expectedLevel: string; months: string; grade: string }>) => ({ resolution: "", expectedLevel: "", months: "", grade: "", ...o });
  test("judgement summary sentence is short: 해소 방식 · 달성 가능성 (+ months); detail keeps the expected level", () => {
    expect(buildJudgementSummary(d({}))).toBe("");
    expect(buildJudgementSummary(d({ resolution: "partner", expectedLevel: "업계 평균", months: "12", grade: "high" }))).toBe("전략 제휴 · 높음");
    expect(buildJudgementSummary(d({ resolution: "partner", grade: "high" }))).toBe("전략 제휴 · 높음");
    expect(buildJudgementSummary(d({ grade: "low" }))).toBe("낮음");
    expect(buildJudgementSummary(d({ months: "6" }))).toBe("");
    expect(buildJudgementSummary(d({ resolution: "build" }))).toBe("직접 구축");
    expect(buildJudgementSummary(d({ expectedLevel: "긴 기대 수준" }))).toBe(""); // expected level never appears in the sentence
    expect(buildJudgementDetail(d({ resolution: "partner", expectedLevel: "업계 평균", months: "12", grade: "high" }))).toBe("전략 제휴 → 업계 평균 · 12개월 · 높음");
    expect(buildJudgementDetail(d({ expectedLevel: "  a \n b  " }))).toBe("→ a b");
    expect(buildJudgementDetail(d({ expectedLevel: "가".repeat(30) }))).toBe(`→ ${"가".repeat(30)}`);
  });
  const rows: FilterRow[] = [
    { id: "a", stale: false, grade: null, confirmed_at: null },
    { id: "b", stale: true, grade: "high", confirmed_at: "2026-01-01" },
    { id: "c", stale: false, grade: "high", confirmed_at: "2026-01-02" },
    { id: "d", stale: false, grade: "low", confirmed_at: null },
  ];
  test("filter counts, default and rows", () => {
    expect(filterCounts(rows, new Set())).toEqual({ todo: 2, all: 4 });
    expect(filterCounts(rows, new Set(["d"]))).toEqual({ todo: 3, all: 4 });
    expect(filterCounts(rows, new Set(["c"]))).toEqual({ todo: 3, all: 4 });
    expect(filterRows(rows, "todo", new Set()).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterRows(rows, "all", new Set()).length).toBe(4);
    expect(defaultFilter(2)).toBe("todo");
    expect(defaultFilter(0)).toBe("all");
  });
  test("next / previous follow the filtered list", () => {
    const ids = ["a", "b", "c"];
    expect(neighborId(ids, "a", 1)).toBe("b");
    expect(neighborId(ids, "c", 1)).toBeNull();
    expect(neighborId(ids, "a", -1)).toBeNull();
    expect(neighborId(ids, "b", -1)).toBe("a");
    expect(neighborId(ids, "zz", 1)).toBeNull();
  });
});
