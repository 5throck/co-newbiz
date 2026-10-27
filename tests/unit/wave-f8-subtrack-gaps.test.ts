// Wave F-8 (audit B1/B4): sub-track-specific S9 checklists + origin derivation.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDb } from "../../db/client.ts";
import { seedS1ToS12Demo } from "../../scripts/co-newbiz/seed-s1-s12-demo.ts";
import { evaluateProcess } from "../../app/web-next/lib/process-flow.ts";
import { ddCompletionSummary, listDdWorkspace, subTrackChecklistIds } from "../../app/web-next/lib/dd-checklist-tailor.ts";
import { getChecklistItems } from "../../app/web-next/lib/library.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { deriveOriginFromSubTrack } from "../../db/lib/origin-derivation.ts";

let dir: string | null = null;
afterEach(() => {
  resetDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function demo() {
  dir = mkdtempSync(join(tmpdir(), "co-newbiz-f8-"));
  const ids = seedS1ToS12Demo(join(dir, "d.sqlite"), { gateDecisions: false });
  return { db: getDb(join(dir, "d.sqlite")), ...ids };
}
const proj = (id: string) => evaluateProcess({ type: "project", id });
const setSub = (db: ReturnType<typeof getDb>, sub: string) => db.run("UPDATE route_decision SET sub_track = ? WHERE is_current = 1", [sub]);

describe("S9 sub-track checklists (B1)", () => {
  test("the demo (M&A) completes S9 with the six-validator + special-topics checklists judged", () => {
    const { projectId } = demo();
    expect(subTrackChecklistIds(projectId)).toEqual(["chk-brownfield-feasibility-checklist", "chk-ma-special-topics-checklist"]);
    expect(proj(projectId).completedStages).toContain("S9");
  });

  test("M&A cannot complete S9 while the binding validator item is not judged", () => {
    const { db, projectId } = demo();
    db.run("DELETE FROM project_checklist_item_state WHERE checklist_id = 'chk-brownfield-feasibility-checklist' AND item_id = 'bf-01'");
    expect(ddCompletionSummary(projectId).unassessed).toBe(1);
    expect(proj(projectId).completedStages).not.toContain("S9");
  });

  test("the six-validator item cannot be passed by na or waiver", () => {
    const { db, projectId } = demo();
    db.run("UPDATE project_checklist_item_state SET status = 'na' WHERE checklist_id = 'chk-brownfield-feasibility-checklist' AND item_id = 'bf-01'");
    expect(ddCompletionSummary(projectId).mandatoryUnmet).toBe(1);
    expect(proj(projectId).completedStages).not.toContain("S9");
  });

  test("a failing mandatory M&A special-topic item blocks S9", () => {
    const { db, projectId } = demo();
    db.run("UPDATE project_checklist_item_state SET status = 'fail' WHERE checklist_id = 'chk-ma-special-topics-checklist' AND item_id = 'ma-01'");
    expect(proj(projectId).completedStages).not.toContain("S9");
  });

  test.each([
    ["jv", ["chk-partnership-checklist", "chk-deal-shape-presigning-checklist", "chk-ma-special-topics-checklist"]], // ADR-0185: ma-13 only (ma-01..12 N via overlay)
    ["partnership", ["chk-partnership-checklist", "chk-deal-shape-presigning-checklist"]],
    // DEC-20261013-03: in-scope (by date) projects also get the merger-control / FDI extras
    ["minority_investment", ["chk-partnership-checklist", "chk-deal-shape-presigning-checklist", "chk-ma-special-topics-checklist"]],
    ["rbd", ["chk-rbd-technology-checklist"]],
    ["strategic_investment", ["chk-ma-special-topics-checklist", "chk-deal-shape-presigning-checklist"]],
    ["corporate_venture", ["chk-ma-special-topics-checklist", "chk-deal-shape-presigning-checklist"]],
  ])("sub_track %s gets its own checklist set", (sub, expected) => {
    const { db, projectId } = demo();
    setSub(db, sub);
    // DEC-20261013-05: a recorded dd decision pins the pre-scope view; model a project not yet gated.
    db.run("DROP TRIGGER IF EXISTS trg_gate_decision_no_delete"); // fixture cleanup only (ADR-0186 H1 guard)
    db.run("DELETE FROM gate_decision WHERE entity_type = 'project' AND gate = 'dd'");
    expect(subTrackChecklistIds(projectId)).toEqual(expected);
    const view = listDdWorkspace(projectId);
    expect(view.domains.map((d) => d.checklistId)).toEqual(expect.arrayContaining(expected));
    // Unjudged extra checklist items block S9; judged ones (or none) do not.
    if (expected.length > 0) {
      const first = getChecklistItems(expected[0])![0].id;
      expect(ddCompletionSummary(projectId).unassessed).toBeGreaterThan(0);
      expect(proj(projectId).completedStages).not.toContain("S9");
      expect(first).toBeTruthy();
    } else {
      expect(proj(projectId).completedStages).toContain("S9");
    }
  });

  test("projects pinned before 2026-10-08 are grandfathered", () => {
    const { db, projectId } = demo();
    db.run("DELETE FROM project_checklist_item_state WHERE checklist_id = 'chk-brownfield-feasibility-checklist'");
    db.run("UPDATE md_project SET created_at = '2026-09-01T00:00:00.000Z' WHERE id = ?", [projectId]);
    db.run("DELETE FROM project_policy_pin WHERE project_id = ?", [projectId]);
    expect(subTrackChecklistIds(projectId)).toEqual([]);
    expect(ddCompletionSummary(projectId).unassessed).toBe(0);
  });
});

describe("origin derivation at promotion (B4)", () => {
  test("mapping", () => {
    expect(deriveOriginFromSubTrack("brownfield", "jv")).toBe("joint");
    expect(deriveOriginFromSubTrack("brownfield", "corporate_venture")).toBe("internal");
    expect(deriveOriginFromSubTrack("brownfield", "intra_venture")).toBe("internal");
    expect(deriveOriginFromSubTrack("brownfield", "m_and_a")).toBe("external");
    expect(deriveOriginFromSubTrack("brownfield", "strategic_investment")).toBe("external");
    expect(deriveOriginFromSubTrack("brownfield", "minority_investment")).toBe("hybrid");
    expect(deriveOriginFromSubTrack("brownfield", "partnership")).toBeNull();
    // ADR-0166: Green Field defaults to internal for every sub-track (and none); explicit joint is respected.
    for (const sub of ["jv", "intra_venture", "existing_business_rbd", "corporate_venture", "unknown_sub", null]) {
      expect(deriveOriginFromSubTrack("greenfield", sub)).toBe("internal");
    }
    expect(deriveOriginFromSubTrack("greenfield", "jv")).toBe("internal");
    expect(deriveOriginFromSubTrack(null, "jv")).toBeNull();
    expect(deriveOriginFromSubTrack("brownfield", null)).toBeNull();
  });
});
