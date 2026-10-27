// @version 1.0.0
/**
 * ADR-0186 design 3.15 - the `effectiveGateState` consumer inventory. Every module that reads a gate decision is
 * classified here; a new reader (a raw `FROM gate_decision` query or a `latestGateDecisions(` call) fails this test
 * until it is added with a disposition, so a consumer can never silently read an un-countersigned IC GO as in force.
 *
 *   effective : reads the maker/checker-aware state (latestGateDecisions default, effectiveState / effectiveGoTimes /
 *               countersignState from db/lib/gate-effective.ts) - the ladder, process engine / S11 / pipeline, stage-gate
 *               derivation, establishment reference times, IC package, monitoring brief, gate brief, panel data
 *   raw       : reads the RECORDED decision on purpose (history views, identity of the recorder, display-only corpus signals)
 *   n/a       : never concerns an entity_ic / group_ic GO (opportunity gates, DD pins, KILL learning, lookups by id, text search)
 *   offline   : operator scripts outside the request path
 */
import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const SCAN = ["app/web-next/app", "app/web-next/lib", "app/web-next/components", "db", "mcp", "scripts", "packages"];

type Disposition = "effective" | "raw" | "n/a" | "offline";
const INVENTORY: Record<string, { disposition: Disposition; note: string }> = {
  // ── effective ──
  "app/web-next/lib/process-flow.ts": { disposition: "effective", note: "latestGateDecisions is the maker/checker-aware reader (S11, pipeline, deal overview, gate aging, inbox blockers); the recorder-identity query for the human-final rule stays raw by design" },
  "app/web-next/lib/gate-ladder.ts": { disposition: "effective", note: "ladderBlock over latestGateDecisions (P1 TODO resolved)" },
  "app/web-next/lib/gate-snapshot.ts": { disposition: "effective", note: "snapshot ladder section reports prior_awaiting_countersign via countersignState" },
  "app/web-next/lib/ic-review-steps.ts": { disposition: "effective", note: "IC review step view over latestGateDecisions" },
  "app/web-next/lib/gate-brief.ts": { disposition: "effective", note: "prior-gate context labels an IC GO awaiting its countersign" },
  "app/web-next/app/api/projects/[id]/ic-package/route.ts": { disposition: "effective", note: "gates.latest carries decision (effective), recorded_decision, awaiting_countersign, countersign_state; conditions listed" },
  "app/web-next/app/api/projects/[id]/monitoring-brief/route.ts": { disposition: "effective", note: "IC decision shown to the briefing is labelled when awaiting a countersign" },
  "app/web-next/app/api/projects/[id]/gate-decisions/route.ts": { disposition: "effective", note: "GET latest[].decision is the effective verdict; history rows carry countersign_state and the checker's decision; POST uses the effective predecessor" },
  "db/lib/rag-service.ts": { disposition: "effective", note: "deriveStageGate maps an un-countersigned IC GO to not-reached" },
  "db/lib/gate-effective.ts": { disposition: "effective", note: "the definition" },
  "app/web-next/lib/gate-countersign.ts": { disposition: "effective", note: "the countersign engine (reads the decision it countersigns)" },
  // ── raw by design ──
  "app/web-next/lib/report-composer.ts": { disposition: "raw", note: "decision history prints what was recorded, labelled when awaiting a countersign (raw: true)" },
  "app/web-next/app/api/projects/[id]/timeline/route.ts": { disposition: "raw", note: "S11 milestone date = first recorded decision" },
  "app/web-next/app/api/projects/[id]/agent-runs/route.ts": { disposition: "raw", note: "display-only agreement signal between a committee proposal and the next recorded human decision" },
  "app/web-next/lib/track-advisory.ts": { disposition: "raw", note: "display-only historical base rate (entity_ic GO share by track); never gates" },
  "db/lib/human-roles.ts": { disposition: "raw", note: "pendingCountersignConflicts: the maker of the latest recorded GO (grant rule)" },
  // ── not an IC-GO reader ──
  "app/web-next/app/api/opportunities/[id]/gate-decisions/route.ts": { disposition: "n/a", note: "opportunity gates (screening, pre_fs, target_screening) have no maker/checker" },
  "app/web-next/app/api/opportunities/[id]/gate-decisions/[decisionId]/snapshot/route.ts": { disposition: "n/a", note: "lookup by id" },
  "app/web-next/app/api/projects/[id]/gate-decisions/[decisionId]/snapshot/route.ts": { disposition: "n/a", note: "lookup by id" },
  "app/web-next/app/api/projects/[id]/gate-decisions/[decisionId]/countersign/route.ts": { disposition: "n/a", note: "lookup of the decision's gate before the engine runs" },
  "app/web-next/lib/business-case-cleanup.ts": { disposition: "n/a", note: "text search in rationales" },
  "app/web-next/lib/dd-target.ts": { disposition: "n/a", note: "stale-marking of dd decisions" },
  "app/web-next/lib/gate-aging.ts": { disposition: "n/a", note: "HOLD aging; the stage view comes from evaluateProcess (effective)" },
  "app/web-next/lib/gate-write-checks.ts": { disposition: "n/a", note: "rationale duplicate rule over OTHER gates' recorded text" },
  "app/web-next/lib/greenfield-subtrack.ts": { disposition: "n/a", note: "dd gate pin" },
  "db/repositories/condition-precedent.repository.ts": { disposition: "n/a", note: "J1: the recorder of the condition's source decision cannot clear it (identity lookup)" },
  "db/repositories/closure.repository.ts": { disposition: "n/a", note: "KILL learning capture and closure basis" },
  "db/repositories/gate-snapshot.repository.ts": { disposition: "n/a", note: "snapshot FK guard" },
  "db/repositories/project.repository.ts": { disposition: "n/a", note: "opportunity promotion preconditions" },
  "app/web-next/lib/reconfirm.ts": { disposition: "effective", note: "ic_countersign item uses latestProjectDecision + countersignState; the clearer-is-maker rule reads recorded IC deciders (identity lookup)" },
  "app/web-next/lib/gate-integrity-kpis.ts": { disposition: "raw", note: "G1/G2/G5 count recorded decisions and snapshots (what was recorded, not its effectiveness); G7 reports pending countersigns separately" },
  // ── offline operator scripts ──
  "scripts/co-newbiz/gate-integrity-shadow-report.ts": { disposition: "offline", note: "read-only shadow review report (readiness counts)" },
  "scripts/co-newbiz/seed-demo-gate-contract.ts": { disposition: "offline", note: "demo seed idempotency lookup of its own contract-recorded decisions" },
  "scripts/co-newbiz/align-existing-projects.ts": { disposition: "offline", note: "alignment script" },
  "scripts/co-newbiz/db-integrity.ts": { disposition: "offline", note: "integrity checker" },
  "scripts/co-newbiz/scope-impact.ts": { disposition: "offline", note: "impact report" },
};

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.generated\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
}

const READER = /latestGateDecisions\(|\b(?:FROM|JOIN|from|join)\s+gate_decision(?![_a-z])/;

function readers(): string[] {
  const files: string[] = [];
  for (const d of SCAN) walk(join(ROOT, d), files);
  return files.filter((f) => READER.test(readFileSync(f, "utf-8"))).map((f) => relative(ROOT, f).split("\\").join("/")).sort();
}

describe("effectiveGateState consumer inventory (ADR-0186 design 3.15)", () => {
  test("every reader of gate decisions is inventoried with a disposition (a new reader must be classified here)", () => {
    expect(readers()).toEqual(Object.keys(INVENTORY).sort());
  });

  test("only inventoried raw readers pass { raw: true }; no ladder / engine consumer opts out of the effective view", () => {
    const rawCallers: string[] = [];
    for (const f of readers()) {
      const src = readFileSync(join(ROOT, f), "utf-8");
      if (/latestGateDecisions\("(?:project|opportunity)"[^)]*raw:\s*true/.test(src)) rawCallers.push(f);
    }
    for (const f of rawCallers) {
      expect(["raw", "effective"], f).toContain(INVENTORY[f].disposition);
    }
    // the ladder and the process engine never ask for the raw view
    for (const f of ["app/web-next/lib/gate-ladder.ts", "app/web-next/lib/ic-review-steps.ts"]) {
      expect(/raw:\s*true/.test(readFileSync(join(ROOT, f), "utf-8")), f).toBe(false);
    }
  });

  test("effective consumers use the shared helper (latestGateDecisions without raw, or db/lib/gate-effective)", () => {
    for (const [f, { disposition }] of Object.entries(INVENTORY)) {
      if (disposition !== "effective" || f === "db/lib/gate-effective.ts") continue;
      const src = readFileSync(join(ROOT, f), "utf-8");
      const usesHelper = /gate-effective\.ts|latestGateDecisions\(/.test(src);
      expect(usesHelper, f).toBe(true);
    }
  });

  test("the stage evaluator reads the gate status through the effective reader (no direct SQL for gateStatus)", () => {
    const src = readFileSync(join(ROOT, "app/web-next/lib/process-flow.ts"), "utf-8");
    const calls = src.match(/latestGateDecisions\("(?:project|opportunity)"[^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.includes("raw")).length).toBe(0);
    expect(src).toContain("effectiveState(");
  });

  test("MCP get_project_gate_decisions / get_gate_decisions are REST pass-throughs of the effective-aware routes and expose no human action", async () => {
    const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
    const project = REGISTRY.find((t) => t.name === "get_project_gate_decisions")!;
    expect(project.routes).toEqual(["GET /api/projects/{projectId}/gate-decisions"]);
    expect(project.description).toContain("EFFECTIVE verdict");
    expect(project.scope).toBe("read");
    const opportunity = REGISTRY.find((t) => t.name === "get_gate_decisions")!;
    expect(opportunity.routes).toEqual(["GET /api/opportunities/{opportunityId}/gate-decisions"]); // opportunity gates: no maker/checker
    // nothing in the registry reaches a human-only P3 route
    const forbidden = [/countersign/, /\/conditions\/\{\w+\}\/(clear|withdraw)/, /kill-overrides/, /admin\/human-roles/, /waivers\/\{\w+\}\/approve/];
    for (const tool of REGISTRY) for (const r of tool.routes) for (const re of forbidden) expect(re.test(r), `${tool.name}: ${r}`).toBe(false);
  });
});
