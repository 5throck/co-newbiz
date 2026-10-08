// Wave F-6: F4 predicate tightenings (S1 confidence grade, S3 capability list,
// S6 per-candidate source/attributes, S7 screening evidence, S11 PMI kickoff +
// human reviewer) — block and pass cases, plus grandfathering of pre-Wave-F
// entities. Built on the S1-S12 demo chain, which is the reference "all
// predicates satisfied" fixture (a mutation removes one artifact at a time).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, resetDb } from "../../db/client.ts";
import { seedS1ToS12Demo } from "../../scripts/co-newbiz/seed-s1-s12-demo.ts";
import { evaluateProcess, WAVE_F_PREDICATE_DATE } from "../../app/web-next/lib/process-flow.ts";
import { countSourcedCapabilityRows } from "../../app/web-next/lib/capability-gap.ts";
import { recordPmiKickoff, PmiKickoffError } from "../../app/web-next/lib/pmi-kickoff.ts";
import { SUB_TRACK_DD_CHECKLISTS, getChecklistItems } from "../../app/web-next/lib/library.ts";
import { maybeReopenStaleS12 } from "../../app/web-next/lib/pipeline.ts";

let dir: string | null = null;
afterEach(() => {
  resetDb();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const OLD = "2026-09-01T00:00:00.000Z";

function demo() {
  dir = mkdtempSync(join(tmpdir(), "co-newbiz-f6-"));
  const dbPath = join(dir, "d.sqlite");
  const ids = seedS1ToS12Demo(dbPath);
  return { db: getDb(dbPath), ...ids };
}
const opp = (id: string) => evaluateProcess({ type: "opportunity", id });
const proj = (id: string) => evaluateProcess({ type: "project", id });

describe("baseline", () => {
  test("the demo (new entities) satisfies every tightened predicate", () => {
    const { opportunityId, projectId } = demo();
    expect(opp(opportunityId).completedStages).toContain("S7");
    expect(proj(projectId).completedStages).toContain("S12");
    expect(WAVE_F_PREDICATE_DATE).toBe("2026-10-08");
  });
});

describe("S1 data-confidence grade", () => {
  test("blocks a new opportunity whose latest sizing version has no grade", () => {
    const { db, opportunityId } = demo();
    db.run("UPDATE market_sizing_version SET data_confidence_grade = NULL");
    const ev = opp(opportunityId);
    expect(ev.currentStage).toBe("S1");
    expect(ev.requiredArtifacts).toContain("데이터 신뢰도 등급");
  });
  test("grandfathered opportunity keeps the legacy predicate", () => {
    const { db, opportunityId } = demo();
    db.run("UPDATE market_sizing_version SET data_confidence_grade = NULL");
    db.run("UPDATE opportunity SET created_at = ?", [OLD]);
    expect(opp(opportunityId).completedStages).toContain("S1");
  });
  test("uses the industry FK, not the market_scope name", () => {
    const { db, opportunityId } = demo();
    db.run("UPDATE opportunity SET market_scope = '이름이 달라진 산업'"); // trigger would re-derive the FK to NULL…
    db.run("UPDATE opportunity SET industry_id = 'demo-s1-s12-industry'"); // …so restore the FK explicitly
    expect(opp(opportunityId).completedStages).toContain("S1");
    db.run("UPDATE opportunity SET industry_id = NULL");
    expect(opp(opportunityId).completedStages).not.toContain("S1");
  });
});

describe("S3 capability list", () => {
  test("blocks when no row carries an explicit source", () => {
    const { db, opportunityId } = demo();
    db.run("UPDATE opportunity SET capability_gap_json = ?", [JSON.stringify({ rows: [{ capability: "x" }] })]);
    const ev = opp(opportunityId);
    expect(ev.currentStage).toBe("S3");
    expect(ev.requiredArtifacts).toContain("필요 역량 목록(출처 포함)");
  });
  test("passes with ≥1 sourced row; grandfathered passes without", () => {
    expect(countSourcedCapabilityRows(JSON.stringify({ rows: [{ capability: "x", source: "manual" }] }))).toBe(1);
    expect(countSourcedCapabilityRows(JSON.stringify({ rows: [{ capability: "x", source: "bogus" }] }))).toBe(0);
    expect(countSourcedCapabilityRows(null)).toBe(0);
    const { db, opportunityId } = demo();
    db.run("UPDATE opportunity SET capability_gap_json = NULL, created_at = ?", [OLD]);
    expect(opp(opportunityId).completedStages).toContain("S3");
  });
});

describe("S6 per-candidate source and attributes", () => {
  test("a candidate without a source does not count toward coverage", () => {
    const { db, opportunityId } = demo();
    db.run("DELETE FROM brownfield_target_evidence WHERE target_id = 'demo-s1-s12-target-2'");
    const ev = opp(opportunityId);
    expect(ev.currentStage).toBe("S6");
    expect(ev.requiredArtifacts).toContain("Long List 후보 필수 속성·출처");
    expect(ev.requiredArtifacts).toContain("Long List 최소 커버리지");
  });
  test("a candidate without identity/universe note fails the attributes check", () => {
    const { db, opportunityId } = demo();
    db.run("UPDATE brownfield_target SET universe_note = NULL WHERE id = 'demo-s1-s12-target-3'");
    expect(opp(opportunityId).requiredArtifacts).toContain("Long List 후보 필수 속성·출처");
  });
  test("an accepted web proposal counts as a source; grandfathered ignores both", () => {
    const { db, opportunityId } = demo();
    db.run("DELETE FROM brownfield_target_evidence WHERE target_id = 'demo-s1-s12-target-2'");
    db.run("UPDATE brownfield_target SET discovery_source = 'web_proposal', proposal_accepted_at = ? WHERE id = 'demo-s1-s12-target-2'", [OLD]);
    expect(opp(opportunityId).completedStages).toContain("S6");
    db.run("DELETE FROM brownfield_target_evidence");
    db.run("UPDATE opportunity SET created_at = ?", [OLD]);
    expect(opp(opportunityId).completedStages).toContain("S7");
  });
});

describe("S7 per-candidate screening evidence", () => {
  test("blocks a shortlisted candidate with no screening evidence", () => {
    const { db, opportunityId } = demo();
    db.run("DELETE FROM brownfield_target_evidence WHERE kind = 'screening'");
    const ev = opp(opportunityId);
    expect(ev.currentStage).toBe("S7");
    expect(ev.requiredArtifacts).toContain("후보별 스크리닝 근거");
  });
  test("screening_evidence_json also counts; grandfathered exempt", () => {
    const { db, opportunityId } = demo();
    db.run("DELETE FROM brownfield_target_evidence WHERE kind = 'screening'");
    db.run("UPDATE brownfield_target SET screening_evidence_json = ? WHERE id = 'demo-s1-s12-target-1'", [JSON.stringify({ a: { reason: "r" } })]);
    expect(opp(opportunityId).completedStages).toContain("S7");
    db.run("UPDATE brownfield_target SET screening_evidence_json = NULL");
    db.run("UPDATE opportunity SET created_at = ?", [OLD]);
    expect(opp(opportunityId).completedStages).toContain("S7");
  });
});

describe("S11 PMI kickoff and human reviewer", () => {
  test("brownfield M&A blocks without a PMI kickoff record", () => {
    const { db, projectId } = demo();
    db.run("DELETE FROM process_run WHERE stage = 's11_pmi_kickoff'");
    const ev = proj(projectId);
    expect(ev.currentStage).toBe("S11");
    expect(ev.requiredArtifacts).toContain("PMI 킥오프 기록 (brownfield)");
  });
  test("a recorded kickoff clears it; agents cannot record one", () => {
    const { db, projectId } = demo();
    db.run("DELETE FROM process_run WHERE stage = 's11_pmi_kickoff'");
    expect(() => recordPmiKickoff(db, { projectId, owner: "o", planNote: "x".repeat(25), recordedBy: "pm" })).toThrow(PmiKickoffError);
    expect(() => recordPmiKickoff(db, { projectId, owner: "o", planNote: "short", recordedBy: "human1" })).toThrow(PmiKickoffError);
    recordPmiKickoff(db, { projectId, owner: "integration lead", planNote: "Day-1 plan baseline agreed", recordedBy: "human1" });
    expect(proj(projectId).completedStages).toContain("S12");
  });
  test("non-PMI sub-track (minority_investment) does not need a kickoff", () => {
    const { db, projectId } = demo();
    db.run("DELETE FROM process_run WHERE stage = 's11_pmi_kickoff'");
    db.run("UPDATE route_decision SET sub_track = 'minority_investment'");
    // Wave F-8: minority investment also judges its partnership / pre-signing checklists.
    for (const checklistId of SUB_TRACK_DD_CHECKLISTS.minority_investment) {
      for (const item of getChecklistItems(checklistId) ?? []) {
        db.run(
          "INSERT OR IGNORE INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
          [`f6-${checklistId}-${item.id}`, projectId, checklistId, item.id, "pass", "human1", "2026-10-08T00:00:00.000Z"],
        );
      }
    }
    expect(proj(projectId).completedStages).toContain("S12");
  });
  test("an IC GO decided by an agent persona id is not a reviewer record", () => {
    const { db, projectId } = demo();
    db.run("UPDATE gate_decision SET decided_by = 'pm' WHERE gate = 'group_ic' AND entity_id = ?", [projectId]);
    const ev = proj(projectId);
    expect(ev.currentStage).toBe("S11");
    expect(ev.requiredArtifacts).toContain("사람 최종 승인(reviewer 기록)");
  });
  test("grandfathered: created before the date, or pinned before it", () => {
    const a = demo();
    a.db.run("DELETE FROM process_run WHERE stage = 's11_pmi_kickoff'");
    a.db.run("UPDATE gate_decision SET decided_by = 'pm' WHERE entity_id = ?", [a.projectId]);
    a.db.run("UPDATE md_project SET created_at = ? WHERE id = ?", [OLD, a.projectId]);
    expect(proj(a.projectId).completedStages).toContain("S12");
    // pin earlier than the date wins over a fresh created_at
    a.db.run("UPDATE md_project SET created_at = ? WHERE id = ?", [new Date().toISOString(), a.projectId]);
    expect(proj(a.projectId).completedStages).not.toContain("S12");
    a.db.run(
      "INSERT INTO project_policy_pin (id, project_id, policy_doc_id, pinned_version, pinned_at, pinned_by) VALUES ('pin1', ?, 'pol', '1.0.0', ?, 't')",
      [a.projectId, OLD],
    );
    expect(proj(a.projectId).completedStages).toContain("S12");
  });
});

describe("S12 staleness and run-status consistency", () => {
  function run(db: ReturnType<typeof getDb>, projectId: string, status: string) {
    db.run("INSERT OR IGNORE INTO md_company (id, name_ko, name_en, created_at) VALUES ('c1','c','c','x')");
    db.run(
      `INSERT INTO pipeline_run (id, entity_type, entity_id, industry_id, initiating_company_id, status, current_stage, started_by, started_at, updated_at)
       VALUES ('r1','project',?,'demo-s1-s12-industry','demo-s1-s12-company',?,'S12','t','x','x')`,
      [projectId, status],
    );
    return db.query("SELECT * FROM pipeline_run WHERE id = 'r1'").get() as Parameters<typeof maybeReopenStaleS12>[0];
  }
  test("a stale scorecard cycle reopens a completed run for an open project", () => {
    const { db, projectId } = demo();
    db.run("UPDATE venture_scorecard SET review_cycle = '2020-Q1'");
    db.run("UPDATE venture_transition_decision SET review_cycle = '2020-Q1'");
    expect(proj(projectId).currentStage).toBe("S12");
    const r = maybeReopenStaleS12(run(db, projectId, "completed"));
    expect(r.status).toBe("running");
  });
  test("a fresh S12 leaves a completed run alone; a closed project is never reopened", () => {
    const { db, projectId } = demo();
    const r = maybeReopenStaleS12(run(db, projectId, "completed"));
    expect(r.status).toBe("completed");
    db.run("UPDATE venture_scorecard SET review_cycle = '2020-Q1'");
    db.run("UPDATE md_project SET status = 'closed' WHERE id = ?", [projectId]);
    expect(maybeReopenStaleS12(r).status).toBe("completed");
  });
});
