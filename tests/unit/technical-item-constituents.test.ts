// S8 기술적 타당성 T2~T5 — 2026-10-20 decider rounds 4-5c: the items are DERIVED from the S9
// DD structure as it is. Each names the S9 checklist items that constitute it (기술·인사·법무
// 실사 tabs); people judge those on their own tabs; the roll-up is the lens value. No separate
// per-item verdict, route or S9 block exists (the round-4 recording block was retracted).
// T1 (brownfield) derives from the S9 capability-dd coverage; T6 is the pairing progress.
import { test, expect, describe } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  TECHNICAL_ITEM_KEYS,
  TECHNICAL_ITEM_CONSTITUENTS,
  TECHNICAL_EVIDENCE_BASE,
  constituentsOf,
  ddItemStatusView,
  indexDdItems,
  rollupConstituentStatuses,
} from "../../app/web-next/lib/technical-item-constituents.ts";
import { summarizeTechnicalLens } from "../../app/web-next/lib/technical-lens.ts";

const ROOT = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ru = (status: "pass" | "fail" | "pending" | "na", judged: number, total: number, failed = 0) => ({ status, judged, total, failed });

describe("constituents — the S9 structure behind each S8 item", () => {
  test("every T2-T5 maps to real checklist item ids across the technical / hr / legal DD checklists", () => {
    expect([...TECHNICAL_ITEM_KEYS]).toEqual(["T2", "T3", "T4", "T5"]);
    const yamlIds = new Set<string>();
    for (const f of ["technical-dd-checklist.yaml", "hr-dd-checklist.yaml", "legal-dd-checklist.yaml"]) {
      for (const m of read(`checklists/${f}`).matchAll(/^\s*- id: ([a-z]+-\d+)/gm)) yamlIds.add(m[1]);
    }
    for (const k of TECHNICAL_ITEM_KEYS) {
      expect(TECHNICAL_ITEM_CONSTITUENTS[k].length).toBeGreaterThan(0);
      for (const id of TECHNICAL_ITEM_CONSTITUENTS[k]) expect(yamlIds.has(id)).toBe(true);
    }
    for (const id of TECHNICAL_EVIDENCE_BASE) expect(yamlIds.has(id)).toBe(true);
    // the technical checklist's own items are all placed (TRL/병목 → T2, 설비/CAPEX → T3, EHS/인증 → T5, 현장·증적 → evidence base)
    const placed = new Set([...Object.values(TECHNICAL_ITEM_CONSTITUENTS).flat(), ...TECHNICAL_EVIDENCE_BASE]);
    for (const id of ["tdd-01", "tdd-02", "tdd-03", "tdd-04", "tdd-05", "tdd-06", "tdd-07", "tdd-08"]) expect(placed.has(id)).toBe(true);
  });

  test("index/lookup joins live DD state and keeps missing ids explicit", () => {
    const idx = indexDdItems([{ title: "기술 실사", items: [{ id: "tdd-03", text: "TRL", state: { status: "pass" } }, { id: "tdd-04", text: "병목", state: null }] }]);
    expect(constituentsOf("T2", idx).map((r) => ("missing" in r ? `${r.id}:missing` : `${r.id}:${r.status}`))).toEqual(["tdd-03:pass", "tdd-04:null"]);
    expect(constituentsOf("T4", idx).every((r) => "missing" in r)).toBe(true);
    expect(ddItemStatusView("pass").label).toBe("충족");
    expect(ddItemStatusView("fail").label).toBe("미충족");
    expect(ddItemStatusView(null).label).toBe("판정 대기");
  });

  test("roll-up rules: any fail → fail; any unjudged → pending; all pass/na with a pass → pass; all na → na; nothing → pending(0)", () => {
    expect(rollupConstituentStatuses(["pass", "fail", null])).toMatchObject({ status: "fail", judged: 2, total: 3, failed: 1 });
    expect(rollupConstituentStatuses(["pass", null])).toMatchObject({ status: "pending", judged: 1, total: 2 });
    expect(rollupConstituentStatuses(["pass", "na"])).toMatchObject({ status: "pass", judged: 2, total: 2 });
    expect(rollupConstituentStatuses(["na", "na"])).toMatchObject({ status: "na" });
    expect(rollupConstituentStatuses([])).toMatchObject({ status: "pending", total: 0 });
  });
});

describe("lens derivation from the S9 structure", () => {
  test("T2-T5: a complete roll-up judges the item (pass→met, fail→caution, all-na→undetermined); partial stays unjudged (fail already → caution); no constituents → fallback note", () => {
    const item = (k: "T2" | "T3" | "T4" | "T5", r: ReturnType<typeof ru>) => summarizeTechnicalLens([], null, { s9Rollups: { [k]: r } }).items.find((i) => i.key === k)!;
    expect(item("T2", ru("pass", 2, 2))).toMatchObject({ judged: true, status: "met", derived: true });
    expect(item("T2", ru("pass", 2, 2)).note).toContain("롤업");
    expect(item("T3", ru("fail", 4, 4, 1))).toMatchObject({ judged: true, status: "caution" });
    expect(item("T3", ru("fail", 4, 4, 1)).note).toContain("미충족 1건");
    expect(item("T4", ru("na", 3, 3))).toMatchObject({ judged: false, status: "undetermined" });
    const part = item("T5", ru("pending", 1, 3));
    expect(part).toMatchObject({ judged: false, status: "undetermined" });
    expect(part.note).toContain("1/3");
    expect(item("T5", ru("fail", 1, 3, 1))).toMatchObject({ judged: false, status: "caution" });
    const none = item("T4", ru("pending", 0, 0));
    expect(none.judged).toBe(false);
    expect(none.note).toContain("구성 항목이 없습니다");
  });

  test("T6 counts complete roll-ups; 4/4 → judged + met", () => {
    const two = summarizeTechnicalLens([], null, { s9Rollups: { T2: ru("pass", 2, 2), T3: ru("pass", 4, 4) } }).items.find((i) => i.key === "T6")!;
    expect(two.judged).toBe(false);
    expect(two.note).toContain("2/4");
    const all = summarizeTechnicalLens([], null, { s9Rollups: { T2: ru("pass", 2, 2), T3: ru("pass", 4, 4), T4: ru("pass", 3, 3), T5: ru("fail", 3, 3, 1) } }).items.find((i) => i.key === "T6")!;
    expect(all).toMatchObject({ judged: true, status: "met" });
  });

  test("brownfield T1 derives from the S9 capability-dd coverage: all resolved → met, any partial/unresolved → caution, incomplete → undetermined; no verdicts → legacy", () => {
    const t1 = (cov: { total: number; judged: number; resolved: number; partial: number; unresolved: number }) =>
      summarizeTechnicalLens([], null, { brownfield: true, s9Capability: cov }).items[0];
    expect(t1({ total: 7, judged: 7, resolved: 7, partial: 0, unresolved: 0 })).toMatchObject({ key: "T1", judged: true, status: "met" });
    expect(t1({ total: 7, judged: 7, resolved: 5, partial: 2, unresolved: 0 })).toMatchObject({ judged: true, status: "caution" });
    const partial = t1({ total: 7, judged: 3, resolved: 3, partial: 0, unresolved: 0 });
    expect(partial).toMatchObject({ judged: false, status: "undetermined" });
    expect(partial.note).toContain("3/7");
    expect(t1({ total: 7, judged: 0, resolved: 0, partial: 0, unresolved: 0 }).note).not.toContain("S9");
  });
});

describe("source guards — S8 mirrors S9, nothing is judged or recorded in S8; the round-4 S9 block is gone", () => {
  test("S8 panel: tabs, constituents grouped by S9 tab, roll-up baseline, read-only (no writes, no record link)", () => {
    const panel = read("app/web-next/components/stages/TechnicalLensPanel.tsx");
    expect(panel).toContain('role="tablist"');
    expect(panel).toContain("data-testid={`tech-item-group-${item.key}`}");
    expect(panel).toContain("data-testid={`tech-item-rollup-${item.key}`}");
    expect(panel).toContain('data-testid="tech-item-evidence-base"');
    expect(panel).toContain("}/dd`");
    expect(panel).not.toContain("api.put");
    expect(panel).not.toContain("api.post");
    expect(panel).not.toContain("판정 기록");
    expect(panel).not.toContain("technical-items");
    const cap = read("app/web-next/components/stages/CapabilityAttainabilityPanel.tsx");
    expect(cap).toContain("showFilter={false}");
    expect(cap).toContain('data-testid="capability-s9-summary"');
    const table = read("app/web-next/components/stages/CapabilityJudgementTable.tsx");
    expect(table).toContain("const shown = showFilter ? filterRows(rows, filter, dirty) : rows;");
  });

  test("S9: no separate T2-T5 recording block, no technical-items route; the summary rolls up only constituents present in this project's checklists", () => {
    expect(existsSync(join(ROOT, "app/web-next/components/stages/TechnicalItemsDdBlock.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "app/web-next/app/api/projects/[id]/technical-items/route.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "app/web-next/lib/technical-item-verdicts.ts"))).toBe(false);
    expect(read("app/web-next/components/stages/DdStage.tsx")).not.toContain("TechnicalItemsDdBlock");
    const summary = read("app/web-next/lib/s8-lens-summary.ts");
    expect(summary).toContain("constituentRollupsOf(db, projectId, selected)");
    expect(summary).toContain("listDdWorkspace(projectId, { targetId })");
    expect(summary).not.toContain("technical_item_verdicts_json");
    expect(read("docs/architecture/openapi.yaml")).not.toContain("/technical-items");
  });
});
