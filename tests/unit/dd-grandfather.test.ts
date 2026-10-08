// R2-B item 5 (risk-officer dissent): the S9 default "판정 대기" applies to NEW items only.
// Existing judgements are grandfathered - viewing, translating or filtering the checklist never
// rewrites or re-opens a judged item, so no in-flight project regresses at S9.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDb } from "../../db/client.ts";
import { seedS1ToS12Demo } from "../../scripts/co-newbiz/seed-s1-s12-demo.ts";
import { evaluateProcess } from "../../app/web-next/lib/process-flow.ts";
import { ddCompletionSummary, listDdWorkspace } from "../../app/web-next/lib/dd-checklist-tailor.ts";
import { getChecklistItems } from "../../app/web-next/lib/library.ts";
import { ddItemDisplay, matchesFilter } from "../../app/web-next/lib/dd-item-display.ts";
import { koChecklistText } from "../../app/web-next/lib/dd-checklist-ko.ts";

let dir: string | null = null;
afterEach(() => {
  resetDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function demo() {
  dir = mkdtempSync(join(tmpdir(), "co-newbiz-dd-gf-"));
  const ids = seedS1ToS12Demo(join(dir, "d.sqlite"));
  return { db: getDb(join(dir, "d.sqlite")), ...ids };
}
type Snap = Array<{ checklist_id: string; item_id: string; status: string; assessed_by: string | null; assessed_at: string | null }>;
const snapshot = (db: ReturnType<typeof getDb>, pid: string): Snap =>
  db.query("SELECT checklist_id, item_id, status, assessed_by, assessed_at FROM project_checklist_item_state WHERE project_id = ? ORDER BY checklist_id, item_id").all(pid) as Snap;

describe("S9 default state: new items only, existing judgements grandfathered", () => {
  test("display: no row = 판정 대기 (unjudged); a stored judgement is shown exactly as stored", () => {
    expect(ddItemDisplay(null)).toEqual({ status: "pending", judged: false, byline: null });
    expect(ddItemDisplay({ status: "pass", assessed_by: "analyst1", assessed_at: "2026-09-20T01:02:03Z" })).toEqual({ status: "pass", judged: true, byline: "analyst1 · 2026-09-20" });
    expect(ddItemDisplay({ status: "fail" }).judged).toBe(true);
    expect(ddItemDisplay({ status: "pending" }).judged).toBe(false);
    expect(matchesFilter("pending", ddItemDisplay(null))).toBe(true);
    expect(matchesFilter("pending", ddItemDisplay({ status: "pass" }))).toBe(false);
    expect(matchesFilter("fail", ddItemDisplay({ status: "fail" }))).toBe(true);
  });

  test("an in-flight project's judged items are untouched by reading the workspace and keep S9 complete", () => {
    const { db, projectId } = demo();
    const before = snapshot(db, projectId);
    expect(before.length).toBeGreaterThan(0);
    const ws = listDdWorkspace(projectId);
    for (const d of ws.domains) {
      for (const item of d.items) {
        const stored = before.find((r) => r.checklist_id === d.checklistId && r.item_id === item.id);
        if (stored) {
          expect(String(item.state?.status)).toBe(stored.status);
          expect(ddItemDisplay(item.state).judged).toBe(stored.status !== "pending");
        }
      }
    }
    expect(snapshot(db, projectId)).toEqual(before); // reading wrote nothing
    expect(evaluateProcess({ type: "project", id: projectId }).completedStages).toContain("S9");
  });

  test("only an item WITHOUT a row defaults to 판정 대기; every other judgement is unchanged", () => {
    const { db, projectId } = demo();
    const target = db.query("SELECT checklist_id, item_id FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = 'chk-brownfield-feasibility-checklist' LIMIT 1").get(projectId) as { checklist_id: string; item_id: string };
    const others = snapshot(db, projectId).filter((r) => !(r.checklist_id === target.checklist_id && r.item_id === target.item_id));
    db.run("DELETE FROM project_checklist_item_state WHERE project_id = ? AND checklist_id = ? AND item_id = ?", [projectId, target.checklist_id, target.item_id]);
    const d = listDdWorkspace(projectId).domains.find((x) => x.checklistId === target.checklist_id)!;
    const item = d.items.find((i) => i.id === target.item_id)!;
    expect(item.state).toBeNull();
    expect(ddItemDisplay(item.state).status).toBe("pending");
    expect(snapshot(db, projectId)).toEqual(others);
  });

  test("a project pinned before the predicate dates keeps its old counting: missing rows do not regress S9", () => {
    const { db, projectId } = demo();
    db.run("UPDATE md_project SET created_at = '2026-08-01T00:00:00.000Z' WHERE id = ?", [projectId]);
    db.run("UPDATE project_policy_pin SET pinned_at = '2026-08-01T00:00:00.000Z' WHERE project_id = ?", [projectId]);
    db.run("DELETE FROM project_checklist_item_state WHERE project_id = ? AND item_id = (SELECT item_id FROM project_checklist_item_state WHERE project_id = ? LIMIT 1)", [projectId, projectId]);
    expect(ddCompletionSummary(projectId).unassessed).toBe(0);
    expect(evaluateProcess({ type: "project", id: projectId }).completedStages).toContain("S9");
  });
});

describe("Korean display catalog (display only)", () => {
  test("every English M&A item has a Korean display text; ids and source text are untouched", () => {
    for (const checklistId of ["chk-brownfield-feasibility-checklist", "chk-ma-special-topics-checklist"]) {
      for (const item of getChecklistItems(checklistId) ?? []) {
        const ko = koChecklistText(checklistId, item.id, item.text);
        if (/[가-힣]/.test(item.text)) continue; // already Korean at the source (bf-13)
        expect(ko.translated).toBe(true);
        expect(/[가-힣]/.test(ko.text)).toBe(true);
        expect(getChecklistItems(checklistId)!.find((i) => i.id === item.id)!.text).toBe(item.text); // catalog never mutates the source
      }
    }
    expect(koChecklistText("unknown", "x-1", "English source")).toEqual({ text: "English source", translated: false });
  });
});
