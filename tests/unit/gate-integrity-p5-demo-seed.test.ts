// @version 1.0.0
/**
 * ADR-0186 P5 / owner decision O-5: the S1-S12 demo seeds record their gate ladder through the contract. Own file: the seed
 * swaps the process-wide database handle, so it must not share a process-level DB with other suites.
 */
import { test, expect, afterAll, describe } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDb } from "../../db/client.ts";
import { countersignState } from "../../db/lib/gate-effective.ts";

afterAll(() => resetDb());

describe("S1-S12 demo seed through the gate contract (O-5)", () => {
  test("brownfield and greenfield ladders carry snapshots, acknowledgements, countersigns, a cleared condition, HOLD, KILL and a waiver; idempotent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "co-newbiz-p5-seed-"));
    const path = join(dir, "demo.sqlite");
    try {
      const { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
      const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
      seedS1ToS12Demo(path);
      await seedGreenfieldS1ToS12Demo(path);
      const d = getDb(path);
      const counts = () => ({
        decisions: (d.query("SELECT COUNT(*) c FROM gate_decision").get() as any).c,
        snaps: (d.query("SELECT COUNT(*) c FROM gate_decision_snapshot").get() as any).c,
        waivers: (d.query("SELECT COUNT(*) c FROM waiver").get() as any).c,
        conditions: (d.query("SELECT COUNT(*) c FROM condition_precedent").get() as any).c,
        validators: (d.query("SELECT COUNT(*) c FROM compliance_check WHERE rule_key LIKE 'ma-validator-%'").get() as any).c,
      });
      const first = counts();
      // every demo decision went through the contract: no raw "human-final approval" row, each has its snapshot
      expect(first.decisions).toBe(first.snaps);
      expect((d.query("SELECT COUNT(*) c FROM gate_decision WHERE rationale LIKE '%demo human-final gate approval%'").get() as any).c).toBe(0);
      expect(first.validators).toBe(6);
      // WACC confirmed kind=user with the subject set (brownfield per-target scope, greenfield project scope)
      const { resolveWaccConfirmation } = await import("../../db/lib/wacc-confirmation.ts");
      expect(resolveWaccConfirmation(d, "demo-s1-s12-project")).toMatchObject({ confirmed: true, subject: "target" });
      expect(resolveWaccConfirmation(d, "demo-gf-project")).toMatchObject({ confirmed: true, subject: "project_newco" });
      // IC GOs are countersigned by a different grant holder; the conditions were created and cleared
      for (const pid of ["demo-s1-s12-project", "demo-gf-project"]) {
        for (const gate of ["entity_ic", "group_ic"]) {
          const g = d.query("SELECT id, gate, decision, decided_by FROM gate_decision WHERE entity_id = ? AND gate = ? AND decision = 'go' ORDER BY decided_at DESC LIMIT 1").get(pid, gate) as any;
          expect(countersignState(d, pid, g)).toBe("countersigned");
          const chain = d.query("SELECT decided_by FROM approval_chain WHERE gate_decision_id = ?").get(g.id) as any;
          expect(chain.decided_by).not.toBe(g.decided_by);
        }
      }
      const cps = d.query("SELECT status, created_by, cleared_by FROM condition_precedent").all() as any[];
      expect(cps.length).toBe(2);
      for (const c of cps) { expect(c.status).toBe("cleared"); expect(c.cleared_by).not.toBe(c.created_by); }
      // HOLD, KILL (with learning capture), divergence pair, waiver approved by someone else
      expect((d.query("SELECT COUNT(*) c FROM gate_decision WHERE decision = 'hold'").get() as any).c).toBeGreaterThanOrEqual(2);
      const killed = d.query("SELECT learning_capture FROM gate_decision WHERE decision = 'kill'").all() as any[];
      expect(killed.length).toBe(1);
      expect(killed[0].learning_capture).toBeTruthy();
      expect((d.query("SELECT COUNT(*) c FROM gate_decision WHERE ai_recommended_decision = 'hold' AND decision = 'go' AND divergence_reason IS NOT NULL").get() as any).c).toBe(1);
      const w = d.query("SELECT requested_by, approved_by, status FROM waiver").get() as any;
      expect(w.status).toBe("active");
      expect(w.approved_by).not.toBe(w.requested_by);
      // no blanket pass on the validator / WACC / certification items
      const own = d.query("SELECT note FROM project_checklist_item_state WHERE project_id = 'demo-s1-s12-project' AND item_id IN ('bf-01','bf-02','bf-03')").all() as any[];
      expect(own.length).toBe(3);
      for (const r of own) expect(r.note).not.toBe("Demo DD completed");
      // the chain still completes
      expect(evaluateProcess({ type: "project", id: "demo-s1-s12-project" }).completedStages).toContain("S12");
      // idempotent
      seedS1ToS12Demo(path);
      await seedGreenfieldS1ToS12Demo(path);
      expect(counts()).toEqual(first);
      // ADR-0194 item B: #5 reads clean on the greenfield demo (recorded announcement, reviewed plan finalized before it)
      const pid = "demo-gf-project";
      const ann = d.query("SELECT announced_on FROM site_announcement WHERE project_id = ? AND superseded_by IS NULL").all(pid) as Array<{ announced_on: string }>;
      expect(ann).toHaveLength(1);
      const plan = d.query("SELECT effective_on, asserted_by, reviewed_by FROM dimension_input WHERE project_id = ? AND var_key = 'infra.plan_finalized' AND superseded_by IS NULL").get(pid) as { effective_on: string; asserted_by: string; reviewed_by: string };
      expect(plan.effective_on <= ann[0].announced_on).toBe(true);
      expect(plan.reviewed_by).not.toBe(plan.asserted_by);
      const { evaluateKillCriteria } = await import("../../db/lib/kill-criteria.ts");
      const runId = `demo-gf-p5-check-${Date.now()}`;
      d.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, pid, "ADR-0194 check", "h", "demo-seed", new Date().toISOString()]);
      const five = evaluateKillCriteria(d, { runId, projectId: pid, procedure: "greenfield-screening", now: new Date().toISOString() }).outcomes.find((o) => o.criterion_id === "infrastructure_plan_not_finalized_at_site_announcement");
      expect(five?.outcome).toBe("false");
    } finally {
      resetDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

