// @version 1.0.0
/**
 * ADR-0187 W3 P5.
 *  (1) M14 residual: the demo seeds carry site / pre-IC permit / incentive-with-clawback evidence (stage_captured, adopted by the
 *      S11 baseline by id) and honest non-pass checklist rows; idempotent. Own file: the seed swaps the process-wide DB handle.
 *  (2) M15: the brownfield sub-tracks JV, minority_investment, partnership, rbd and corporate_venture reach S12 through the REAL
 *      flow.spec + procedures (D8 widening), and the D9 trim keys on the two greenfield internal-expansion sub-tracks only.
 *  (3) M15 engine fixture: the seeded brownfield project re-pointed to each sub-track completes S11/S12 with the right PMI rule.
 */
import { test, expect, afterAll, describe } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDb } from "../../db/client.ts";
import {
  BROWNFIELD_SUB_TRACKS,
  GREENFIELD_SUB_TRACKS,
  ORIGINS,
  activityStepScope,
  classificationCells,
  loadFlowSpec,
  loadProcedures,
  procedureMatches,
  runAll,
  type ClassificationCell,
} from "../../scripts/co-newbiz/process-ssot-check.ts";
import { D9_TRIMMED_STEPS, d9TrimApplies } from "../../app/web-next/lib/greenfield-subtrack.ts";
import { pmiKickoffApplies } from "../../app/web-next/lib/pmi-kickoff.ts";

afterAll(() => resetDb());

const BF_PROJECT = "demo-s1-s12-project";
const GF_PROJECT = "demo-gf-project";

describe("M14 residual - demo seed evidence rows", () => {
  test("greenfield seed carries site, pre-IC permit and incentive-with-clawback rows adopted by the S11 baseline; non-pass checklist rows; idempotent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "co-newbiz-p5-evidence-"));
    const path = join(dir, "demo.sqlite");
    try {
      const { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
      seedS1ToS12Demo(path);
      await seedGreenfieldS1ToS12Demo(path);
      const d = getDb(path);
      const counts = () => ({
        sites: (d.query("SELECT COUNT(*) c FROM site WHERE project_id = ?").get(GF_PROJECT) as any).c,
        permits: (d.query("SELECT COUNT(*) c FROM permit WHERE project_id = ?").get(GF_PROJECT) as any).c,
        incentives: (d.query("SELECT COUNT(*) c FROM incentive WHERE project_id = ?").get(GF_PROJECT) as any).c,
        states: (d.query("SELECT COUNT(*) c FROM project_checklist_item_state").get() as any).c,
        audit: (d.query("SELECT COUNT(*) c FROM audit_log").get() as any).c,
        baselines: (d.query("SELECT COUNT(*) c FROM process_run WHERE stage = 'execution_baseline'").get() as any).c,
      });
      const first = counts();

      // site assessment: scored and ranked, audited like the route
      expect(first.sites).toBe(2);
      const sites = d.query("SELECT rank, total_score, permit_lead_time_days FROM site WHERE project_id = ? ORDER BY rank").all(GF_PROJECT) as any[];
      expect(sites.map((s) => s.rank)).toEqual([1, 2]);
      expect((d.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'site.create' AND target LIKE ?").get(`${GF_PROJECT}:%`) as any).c).toBe(2);

      // pre-IC capture: both stages are represented, a person captured them, the incentive carries its clawback terms
      const permits = d.query("SELECT stage_captured, captured_by, captured_at, status FROM permit WHERE project_id = ?").all(GF_PROJECT) as any[];
      expect(permits.map((p) => p.stage_captured).sort()).toEqual(["S5", "S8"]);
      for (const p of permits) { expect(p.captured_by).toBe("demo-seed"); expect(p.captured_at).toBeTruthy(); }
      const inc = d.query("SELECT stage_captured, clawback_rule, direction, evidence_ref, npv_value FROM incentive WHERE project_id = ?").all(GF_PROJECT) as any[];
      expect(inc.length).toBe(1);
      expect(inc[0]).toMatchObject({ stage_captured: "S8", direction: "prospective", evidence_ref: "src:demo-gf", npv_value: 1500 });
      expect(inc[0].clawback_rule).toBeTruthy();
      expect((d.query("SELECT COUNT(*) c FROM audit_log WHERE action IN ('permit.pre_ic_captured','incentive.pre_ic_captured')").get() as any).c).toBe(3);

      // S11 adoption by reference: nothing re-entered, every capture is linked and the baseline is confirmed
      const geo = await import("../../app/web-next/lib/greenfield-execution.ts");
      const pre = await import("../../app/web-next/lib/pre-ic-capture.ts");
      const baseline = geo.latestConfirmedBaseline(GF_PROJECT, d);
      expect(baseline).toBeTruthy();
      const link = pre.preIcLinkStatus(GF_PROJECT, baseline!.entries, d);
      expect(link.unlinked).toBe(0);
      expect(link.permits.length).toBe(2);
      expect(link.incentives.length).toBe(1);
      expect(baseline!.entries.incentive_obligations[0]?.obligation).toContain("clawback");

      // non-pass checklist rows: a fail with its reason, a not-applicable with its note (optional items only)
      const { getChecklistItems } = await import("../../app/web-next/lib/library.ts");
      const nonPass = d
        .query("SELECT project_id, status, note, checklist_id, item_id FROM project_checklist_item_state WHERE status IN ('fail','na')")
        .all() as any[];
      for (const pid of [BF_PROJECT, GF_PROJECT]) {
        const rows = nonPass.filter((r) => r.project_id === pid);
        expect(rows.map((r) => r.status).sort()).toEqual(["fail", "na"]);
        for (const r of rows) {
          expect(r.note.length).toBeGreaterThan(20);
          expect(r.note).not.toBe("Demo DD completed");
          expect((getChecklistItems(r.checklist_id) ?? []).find((i) => i.id === r.item_id)?.mandatory).toBe(false);
        }
      }
      // the brownfield waiver path from ADR-0186 is still the single `waived` row
      expect((d.query("SELECT COUNT(*) c FROM project_checklist_item_state WHERE status = 'waived'").get() as any).c).toBe(1);

      // the chain still completes with the non-pass rows present
      const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
      expect(evaluateProcess({ type: "project", id: BF_PROJECT }).completedStages).toContain("S12");
      expect(evaluateProcess({ type: "project", id: GF_PROJECT }).completedStages).toContain("S12");

      // idempotent
      seedS1ToS12Demo(path);
      await seedGreenfieldS1ToS12Demo(path);
      expect(counts()).toEqual(first);
    } finally {
      resetDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("M15 - brownfield sub-tracks reach S12 through the real spec and procedures", () => {
  const spec = loadFlowSpec();
  const procedures = loadProcedures();
  const s12 = (spec.stages ?? []).find((s) => s.id === "S12")!;

  /** The S12 activities whose procedure (and declared step scope) applies to a classification cell. */
  function s12Activities(cell: ClassificationCell): string[] {
    return (s12.activities ?? [])
      .filter((a) => (a.procedure ?? []).some((p) => {
        const proc = procedures.get(p);
        return proc ? procedureMatches(proc, cell, activityStepScope(a, p)) : false;
      }))
      .map((a) => a.id)
      .sort();
  }
  const cell = (sub_track: string, origin = "external"): ClassificationCell => ({ case_type: "brownfield", origin, sub_track });

  test("each sub-track resolves to exactly the S12 activities the design (D8, ADR-0161 Q3) assigns", () => {
    expect(s12Activities(cell("m_and_a"))).toEqual(["integration-monitoring"]);
    expect(s12Activities(cell("strategic_investment"))).toEqual(["integration-monitoring"]);
    expect(s12Activities(cell("jv"))).toEqual(["partnership-monitoring"]);
    expect(s12Activities(cell("partnership"))).toEqual(["partnership-monitoring"]);
    expect(s12Activities(cell("minority_investment"))).toEqual(["portfolio-monitoring"]);
    expect(s12Activities(cell("rbd"))).toEqual(["portfolio-monitoring"]);
    expect(s12Activities(cell("corporate_venture"))).toEqual(["portfolio-monitoring"]);
  });

  test("a JV recorded as origin=joint is covered by both the venture portfolio and the partnership activity", () => {
    expect(s12Activities(cell("jv", "joint"))).toEqual(["partnership-monitoring", "portfolio-monitoring"]);
  });

  test("the non-PMI sub-tracks never match the PMI integration step; every origin of every brownfield sub-track has an S12 activity", () => {
    for (const sub of ["jv", "minority_investment", "partnership", "rbd", "corporate_venture"]) {
      for (const origin of ORIGINS) {
        const acts = s12Activities(cell(sub, origin));
        expect(acts.length).toBeGreaterThan(0);
        expect(acts).not.toContain("integration-monitoring");
      }
    }
    expect(BROWNFIELD_SUB_TRACKS).toEqual(expect.arrayContaining(["jv", "minority_investment", "partnership", "rbd", "corporate_venture"]));
  });

  test("every greenfield cell is covered too, and the S12 coverage validator is clean on the real tree", () => {
    for (const c of classificationCells().filter((x) => x.case_type === "greenfield")) {
      expect(s12Activities(c)).toContain("portfolio-monitoring");
    }
    expect(runAll("check-s12-coverage")).toEqual([]);
  });

  test("D9 trim: greenfield-dd steps 9 and 12-16 drop out only for the two greenfield internal-expansion sub-tracks, whatever the origin", () => {
    const gfDd = procedures.get("greenfield-dd")!;
    const trimmed = D9_TRIMMED_STEPS.map(String);
    const stepApplies = (stepId: string, c: ClassificationCell) => procedureMatches({ ...gfDd, steps: gfDd.steps.filter((s) => s.id === stepId) }, c);
    for (const c of classificationCells()) {
      const internalExpansion = c.case_type === "greenfield" && ["existing_business_rbd", "intra_venture"].includes(c.sub_track);
      // keyed on sub_track alone, never on origin
      for (const id of trimmed) expect(stepApplies(id, c)).toBe(!["existing_business_rbd", "intra_venture"].includes(c.sub_track));
      if (c.case_type === "greenfield") {
        for (const id of ["10", "11", "17"]) expect(stepApplies(id, c)).toBe(true); // legal-regulatory, financial, waiver stay
        expect(d9TrimApplies(c.sub_track as never)).toBe(internalExpansion);
      }
    }
    // a new-site plant (plain route, origin=internal by ADR-0166 default) keeps the full DD
    for (const origin of ORIGINS) {
      for (const id of trimmed) expect(stepApplies(id, { case_type: "greenfield", origin, sub_track: "none" })).toBe(true);
    }
  });

  test("D9 trim: no brownfield sub-track trims anything, and brownfield-dd carries no expansion-sub-track narrowing", () => {
    for (const sub of BROWNFIELD_SUB_TRACKS) expect(d9TrimApplies(sub as never)).toBe(false);
    expect(d9TrimApplies("unknown")).toBe(false);
    expect(d9TrimApplies("none")).toBe(false);
    const bfDd = procedures.get("brownfield-dd")!;
    expect(JSON.stringify(bfDd.steps.map((s) => s.applies_when ?? null))).not.toMatch(/existing_business_rbd|intra_venture/);
    for (const sub of ["jv", "minority_investment", "partnership", "rbd", "corporate_venture"]) {
      expect(procedureMatches(bfDd, cell(sub))).toBe(true);
    }
    expect(GREENFIELD_SUB_TRACKS).toEqual(["none", "existing_business_rbd", "intra_venture"]);
  });
});

describe("M15 engine fixture - the seeded brownfield project re-pointed to each sub-track", () => {
  test("S11 asks for the PMI kickoff exactly where pmiKickoffApplies says so, and S12 completes for every sub-track", async () => {
    const dir = mkdtempSync(join(tmpdir(), "co-newbiz-p5-subtracks-"));
    const path = join(dir, "demo.sqlite");
    try {
      const { seedS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
      const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
      const { subTrackChecklistIds } = await import("../../app/web-next/lib/dd-checklist-tailor.ts");
      const { getChecklistItems } = await import("../../app/web-next/lib/library.ts");
      seedS1ToS12Demo(path);
      const d = getDb(path);
      const kickoff = d.query("SELECT id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json FROM process_run WHERE id = 'demo-s1-s12-pmi-kickoff'").get() as Record<string, unknown>;
      expect(kickoff).toBeTruthy();
      const extraChecklists: Record<string, string[]> = {};
      const results: Record<string, { s11Missing: boolean; s11Complete: boolean; s12Complete: boolean }> = {};
      for (const sub of ["m_and_a", "jv", "minority_investment", "partnership", "rbd", "corporate_venture"]) {
        d.run("UPDATE route_decision SET sub_track = ? WHERE id = 'demo-s1-s12-route'", [sub]);
        // each sub-track brings its own S9 checklists (SUB_TRACK_DD_CHECKLISTS / scoped extras): judge them as the seed does for M&A
        const extras = subTrackChecklistIds(BF_PROJECT);
        extraChecklists[sub] = extras;
        for (const checklistId of extras) {
          for (const item of getChecklistItems(checklistId) ?? []) {
            d.run(
              `INSERT OR IGNORE INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, note, assessed_by, assessed_at)
               VALUES (?, ?, ?, ?, 'pass', 'Sub-track fixture: judged', 'demo-seed', ?)`,
              [`p5-fixture-${checklistId}-${item.id}`, BF_PROJECT, checklistId, item.id, new Date().toISOString()],
            );
          }
        }
        // no kickoff recorded: the blocker must appear only where the PMI kickoff applies
        d.run("DELETE FROM process_run WHERE id = 'demo-s1-s12-pmi-kickoff'");
        const without = evaluateProcess({ type: "project", id: BF_PROJECT });
        const s11Missing = without.blockers.some((b) => b.includes("PMI 킥오프"));
        // with the kickoff recorded the stage completes for every sub-track
        d.run(
          `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, finished_at, meta_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          Object.values(kickoff) as never,
        );
        const withKickoff = evaluateProcess({ type: "project", id: BF_PROJECT });
        results[sub] = {
          s11Missing,
          s11Complete: withKickoff.completedStages.includes("S11"),
          s12Complete: withKickoff.completedStages.includes("S12"),
        };
        expect(withKickoff.subTrack).toBe(sub);
        expect(s11Missing).toBe(pmiKickoffApplies("brownfield", sub));
      }
      for (const [sub, r] of Object.entries(results)) expect({ sub, s11: r.s11Complete, s12: r.s12Complete }).toEqual({ sub, s11: true, s12: true });
      // the shapes differ: R&BD brings the technology checklist, the partner shapes their own, M&A its feasibility pair
      expect(extraChecklists.rbd).toContain("chk-rbd-technology-checklist");
      expect(extraChecklists.m_and_a).toEqual(expect.arrayContaining(["chk-brownfield-feasibility-checklist"]));
      for (const sub of ["jv", "partnership", "minority_investment"]) expect(extraChecklists[sub].length).toBeGreaterThan(0);
      expect(Object.entries(results).filter(([, r]) => r.s11Missing).map(([k]) => k).sort()).toEqual(["jv", "m_and_a"]);
    } finally {
      resetDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
