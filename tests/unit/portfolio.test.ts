// @version 1.0.0
/**
 * S12 post-management — ADR-0101 regression.
 *
 * Proves, against the REAL route handlers (nextRequest harness) and the real
 * scratch SQLite:
 *  (a) GET /api/projects/[id]/scorecard aggregates the latest-cycle rollup
 *      (getPortfolioRollup, directly), the per-cycle trend, and the
 *      transition-decision history — deny-by-default (non-member 404,
 *      unauthenticated 401); ?review_cycle pins an explicit cycle;
 *  (b) POST /api/projects/[id]/transition-decision — the recorder pattern:
 *      analyst+ only (viewer 403), the 5-vocabulary enforced (invalid 400),
 *      kill requires learning_capture (400 without), decided_by is pinned to
 *      'venture-portfolio-ic' while the session user rides the recorder
 *      lineage (run.created_by, surfaced as recorded_by), and appendAudit
 *      fires;
 *  (c) S12 completion flips ONLY when a fresh-cycle scorecard row exists —
 *      no rows blocks, a stale latest cycle blocks naming the stale cycle,
 *      a current/previous-quarter cycle completes;
 *  (d) the ledger is append-only: a second POST for the same review_cycle is
 *      a NEW row (0071's index is deliberately non-unique; no UPDATE path),
 *      and the migration carries the additive-only ADR-0101 §1 shape.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
import { join } from "node:path";

const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-portfolio.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { promoteOpportunity } = await import("../../db/repositories/project.repository.ts");
const { recordVentureScorecardCycle } = await import("../../db/repositories/venture-scorecard.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { currentReviewCycle, shiftReviewCycle } = await import("../../app/web-next/lib/portfolio.ts");

const NOW = new Date().toISOString();

/** S10 투자구조 설계 완료 픽스처 (flow.spec v2.2.0 술어) — 4축 검토 완료된
 * 가설 1건 + sources == uses > 0 인 자금조달 행. 정합 술어 검사가 S10을
 * 통과하도록 직접 INSERT 한다 (거버넌스 레이어는 별도 테스트에서 검증). */
function seedS10Complete(pid: string) {
  db.run(
    `INSERT INTO deal_structure_hypothesis
       (id, project_id, asset_or_stock, stake_type, instrument_mix, vehicle,
        tax_structure_note, liability_isolation_note, financing_leverage_note,
        exit_structure_note, four_axis_review_completed, hypothesized_by, hypothesized_at, rationale)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
    [ulid(), pid, "stock", "majority", "mixed", "spc",
     "법인세 특례 검토", "SPC 자산 격리", "AC 대출 60%", "5년 후 매각",
     ANALYST, NOW, "SPC 경유 구조 — 4축 검토 완료"],
  );
  db.run(
    `INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), pid, "source", "출자금 + AC 대출", 1000, ANALYST, NOW],
  );
  db.run(
    `INSERT INTO financing_sources_uses (id, project_id, kind, name, amount_krw_m, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), pid, "use", "주식 인수 대금", 1000, ANALYST, NOW],
  );
}
const CURRENT_CYCLE = currentReviewCycle();
const STALE_CYCLE = shiftReviewCycle(CURRENT_CYCLE, -3); // one full quarter older than the freshness window

function req(path: string, init?: RequestInit) {
  return nextRequest(path, init);
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const ANALYST = "analyst1"; // project member (lead), the recorder
const VIEWER = "viewer1"; // authenticated, viewer role
const OUTSIDER = "outsider1"; // authenticated analyst, NOT a member
let analystCookie = "";
let viewerCookie = "";
let outsiderCookie = "";
let projectId = "";
let project2Id = ""; // a SECOND project for the S12 freshness sequence — self-contained cycle history
let runId = "";
let runId2 = ""; // project2's own run (scorecard rows are run-scoped per ADR-0005)

/** Promote another greenfield opportunity → project (the lead member is ANALYST). */
function promoteAnother(name: string): string {
  const oppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [oppId, name, "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?)",
    [ulid(), oppId, "greenfield", "test route", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, capability_gaps_json, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ulid(), oppId, JSON.stringify([{ gap: "g1", resolution: "hire" }]), "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", oppId, gate, "go", "test", ANALYST, NOW]);
  }
  return promoteOpportunity(oppId, { promotedBy: ANALYST, needToKnowBasis: `${name} promoter` }).project.id;
}

beforeAll(async () => {
  await createUser(db, { userId: ANALYST, role: "analyst", password: "pw-analyst-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: ANALYST, approvedBy: "test", now: NOW });
  await createUser(db, { userId: VIEWER, role: "viewer", password: "pw-viewer-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: VIEWER, approvedBy: "test", now: NOW });
  await createUser(db, { userId: OUTSIDER, role: "analyst", password: "pw-outsider-12345", createdBy: "test", now: NOW });
  approveUser(db, { userId: OUTSIDER, approvedBy: "test", now: NOW });
  db.run("UPDATE app_user SET must_change_password = 0");
  analystCookie = await loginCookie(ANALYST, "pw-analyst-12345");
  viewerCookie = await loginCookie(VIEWER, "pw-viewer-12345");
  outsiderCookie = await loginCookie(OUTSIDER, "pw-outsider-12345");

  // Promote a greenfield opportunity into a project (ADR-0095) — the
  // promoter becomes the lead member, which gives the deny-by-default checks
  // a real membership boundary.
  const sourceOppId = ulid();
  db.run(
    "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [sourceOppId, "S12 테스트 기회", "테스트 산업", "selected", ANALYST, NOW],
  );
  db.run(
    "INSERT INTO route_decision (id, opportunity_id, track, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?)",
    [ulid(), sourceOppId, "greenfield", "test route", ANALYST, NOW],
  );
  db.run(
    `INSERT INTO greenfield_assessment (id, opportunity_id, capability_gaps_json, entry_strategy, alternatives_considered, rationale, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ulid(), sourceOppId, JSON.stringify([{ gap: "g1", resolution: "hire" }]), "직접 진출", "M&A 대안 검토", "test", ANALYST, NOW, NOW],
  );
  for (const gate of ["screening", "pre_fs"]) {
    db.run("INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)", [ulid(), "opportunity", sourceOppId, gate, "go", "test", ANALYST, NOW]);
  }
  projectId = promoteOpportunity(sourceOppId, { promotedBy: ANALYST, needToKnowBasis: "S12 test promoter" }).project.id;
  seedS10Complete(projectId);
  // The S12 freshness sequence runs on its own project whose scorecard
  // history starts empty (no cross-test cycle pollution).
  project2Id = promoteAnother("S12 신선도 테스트 기회");
  seedS10Complete(project2Id);
  // S11 applies establishment to origin∈{internal,joint} (ADR-0047) — pin it
  // and complete the 5 steps + both IC gates so the process's current stage
  // IS S12 (blockers only surface for the current stage).
  db.run("UPDATE md_project SET origin = 'internal' WHERE id = ?", [projectId]);
  db.run("UPDATE md_project SET origin = 'internal' WHERE id = ?", [project2Id]);

  // S8 (case + simulation) and S9 (judged checklist item) artifacts.
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    ["bc-pf1", projectId, "greenfield_cost", "S12 케이스", 5, ANALYST, NOW],
  );
  db.run(
    "INSERT INTO business_case_model (id, project_id, kind, name, horizon_years, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    ["bc-pf2", project2Id, "greenfield_cost", "S12 신선도 케이스", 5, ANALYST, NOW],
  );
  for (const pid of [projectId, project2Id]) {
    const modelId = pid === projectId ? "bc-pf1" : "bc-pf2";
    db.run(
      "INSERT INTO valuation_simulation (id, project_id, model_id, scenario, percentile, npv_krw_m, irr, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), pid, modelId, "base", "p50", 9000, 0.12, "seed=42", NOW],
    );
    db.run(
      "INSERT INTO project_checklist_item_state (id, project_id, checklist_id, item_id, status, assessed_by, assessed_at) VALUES (?,?,?,?,?,?,?)",
      [ulid(), pid, "custom:commercial", ulid(), "pass", ANALYST, NOW],
    );
    // S11 prerequisites (2026-09-12 hardening): adopted S8 case + confirmed charter.
    db.run(
      "INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, started_by, started_at, meta_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [ulid(), "project", pid, pid, "2.3.0", "s8_case_adopt", "done", ANALYST, NOW, JSON.stringify({ model_id: modelId })],
    );
    db.run("UPDATE md_project SET charter_json = ?, charter_confirmed_at = ? WHERE id = ?", [JSON.stringify({ versions: [{ version: 1, purpose: "S12 테스트 목적" }] }), NOW, pid]);
  }
  // S11: 5 establishment steps + both IC gate records.
  const setupOpps: Array<{ oppId: string; pid: string }> = [{ oppId: sourceOppId, pid: projectId }];
  const p2 = db.query("SELECT source_opportunity_id FROM md_project WHERE id = ?").get(project2Id) as { source_opportunity_id: string };
  setupOpps.push({ oppId: p2.source_opportunity_id, pid: project2Id });
  for (const { oppId, pid } of setupOpps) {
    for (const n of [1, 2, 3, 4, 5]) {
      db.run(
        `INSERT INTO entity_establishment_step (id, opportunity_id, step_no, status, origin, checklist_item, owner, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [ulid(), oppId, n, "done", "internal", `ef-0${n}`, ANALYST, NOW],
      );
    }
    for (const gate of ["entity_ic", "group_ic"]) {
      const res = await req(`/api/projects/${pid}/gate-decisions`, {
        method: "POST", headers: { cookie: analystCookie },
        body: JSON.stringify({ gate, decision: "go", rationale: "S12 도달을 위한 IC 승인 기록 (테스트)" }),
      });
      expect(res.status).toBe(201);
    }
  }

  runId = ulid();
  db.run(
    "INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [runId, projectId, "스코어카드 테스트 run", "h-portfolio", ANALYST, NOW],
  );
  runId2 = ulid();
  db.run(
    "INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [runId2, project2Id, "스코어카드 신선도 테스트 run", "h-portfolio-2", ANALYST, NOW],
  );
});

afterAll(() => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      Bun.sleepSync(100);
    }
  }
});

/** One minimal-but-valid scorecard cycle through the repository's sole writer. */
function recordCycle(cycle: string, measureKey: string, status: "on_target" | "deviation" | "insufficient_evidence" = "on_target", forProjectId: string = projectId) {
  return recordVentureScorecardCycle({
    runId: forProjectId === projectId ? runId : runId2,
    projectId: forProjectId,
    sourceProcedure: "portfolio-venture-monitoring",
    reviewCycle: cycle,
    rows: [
      {
        venture_class: "driving", section: "financial", measure_key: measureKey,
        target_value: status === "insufficient_evidence" ? null : "100",
        actual_value: status === "insufficient_evidence" ? null : "96",
        status, evidence_ref: "https://example.com/scorecard-evidence", observed_at: NOW,
      },
      {
        venture_class: "driving", section: "strategic", measure_key: `${measureKey}-str`,
        target_value: "launch", actual_value: "launched",
        status: "on_target", evidence_ref: "doc:scorecard-attachment", observed_at: NOW,
      },
    ],
    actor: ANALYST,
    now: NOW,
  });
}

describe("(a) scorecard GET — rollup + trend + decision history, deny-by-default", () => {
  test("empty project: 200 with a null-cycle rollup and no decisions", async () => {
    const res = await req(`/api/projects/${projectId}/scorecard`, { headers: { cookie: analystCookie } });
    expect(res.status).toBe(200);
    const data = (await res.json()).data as {
      rollup: { review_cycle: string | null; resolved_from: string; financial: unknown[]; strategic: unknown[] };
      trend: unknown[];
      decisions: { latest: unknown; history: unknown[] };
    };
    expect(data.rollup.review_cycle).toBeNull();
    expect(data.rollup.financial).toEqual([]);
    expect(data.trend).toEqual([]);
    expect(data.decisions.latest).toBeNull();
  });

  test("non-member 404, unauthenticated 401; bad cycle shape 400", async () => {
    expect((await req(`/api/projects/${projectId}/scorecard`, { headers: { cookie: outsiderCookie } })).status).toBe(404);
    expect((await req(`/api/projects/${projectId}/scorecard`)).status).toBe(401);
    expect((await req(`/api/projects/${projectId}/scorecard?review_cycle=2026-Q9`, { headers: { cookie: analystCookie } })).status).toBe(400);
  });

  test("after recording a cycle: rollup rows + class rollup + trend, explicit pin honored", async () => {
    recordCycle(CURRENT_CYCLE, "mrr_krw_m");

    const latest = await req(`/api/projects/${projectId}/scorecard`, { headers: { cookie: analystCookie } });
    expect(latest.status).toBe(200);
    const data = (await latest.json()).data as {
      rollup: { review_cycle: string | null; resolved_from: string; financial: Array<{ measure_key: string }>; strategic: unknown[]; class_rollup: Array<{ venture_class: string; ventures: number }> };
      trend: Array<{ review_cycle: string; measures: number; on_target: number; insufficient_evidence: number }>;
    };
    expect(data.rollup.review_cycle).toBe(CURRENT_CYCLE);
    expect(data.rollup.resolved_from).toBe("latest");
    expect(data.rollup.financial.map((r) => r.measure_key)).toContain("mrr_krw_m");
    expect(data.rollup.class_rollup[0]).toMatchObject({ venture_class: "driving", ventures: 1 });
    expect(data.trend).toHaveLength(1);
    expect(data.trend[0]).toMatchObject({ review_cycle: CURRENT_CYCLE, measures: 2, on_target: 2, insufficient_evidence: 0 });

    const pinned = await req(`/api/projects/${projectId}/scorecard?review_cycle=${STALE_CYCLE}`, { headers: { cookie: analystCookie } });
    expect(pinned.status).toBe(200);
    const pinnedData = (await pinned.json()).data as { rollup: { review_cycle: string | null; resolved_from: string; financial: unknown[] } };
    expect(pinnedData.rollup.review_cycle).toBe(STALE_CYCLE);
    expect(pinnedData.rollup.resolved_from).toBe("explicit");
    expect(pinnedData.rollup.financial).toEqual([]);
  });
});

describe("(b) transition-decision POST — the recorder pattern", () => {
  test("happy path: 201, decided_by pinned to the human role, recorded_by = session user, audit row", async () => {
    const res = await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "next_tranche_released", rationale: "2분기 연속 목표 달성 — IC 심의 통과" }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()).data as { decided_by: string; recorded_by: string; review_cycle: string; run_id: string };
    expect(row.decided_by).toBe("venture-portfolio-ic"); // schema-pinned decider of record
    expect(row.recorded_by).toBe(ANALYST); // recorder = session user via run lineage
    expect(row.review_cycle).toBe(CURRENT_CYCLE); // defaults to the current quarter

    const run = db.query("SELECT created_by FROM run WHERE id = ?").get(row.run_id) as { created_by: string };
    expect(run.created_by).toBe(ANALYST); // ADR-0005 recorder lineage, not a second column

    const audit = db
      .query("SELECT actor_user_id FROM audit_log WHERE action = 'venture_transition_decision.recorded' ORDER BY created_at DESC LIMIT 1")
      .get() as { actor_user_id: string };
    expect(audit.actor_user_id).toBe(ANALYST);
  });

  test("invalid vocabulary 400; empty rationale 400; bad cycle shape 400", async () => {
    const before = (db.query("SELECT COUNT(*) c FROM venture_transition_decision").get() as { c: number }).c;
    expect((await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "double_down", rationale: "not in the five" }),
    })).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "graduate_to_core", rationale: "   " }),
    })).status).toBe(400);
    expect((await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "graduate_to_core", rationale: "ok", review_cycle: "2026-Q0" }),
    })).status).toBe(400);
    const after = (db.query("SELECT COUNT(*) c FROM venture_transition_decision").get() as { c: number }).c;
    expect(after).toBe(before); // nothing partially written
  });

  test("kill without learning_capture 400; with learning_capture 201", async () => {
    expect((await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "kill_with_learning_captured", rationale: "시장 검증 실패" }),
    })).status).toBe(400);

    const res = await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({
        decision: "kill_with_learning_captured", rationale: "시장 검증 실패",
        learning_capture: "규제 미확정 산업의 프록시 수요 추정은 2분기 이내 재검증한다",
        review_cycle: STALE_CYCLE,
      }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()).data as { learning_capture: string | null; decided_by: string };
    expect(row.learning_capture).toContain("프록시");
    expect(row.decided_by).toBe("venture-portfolio-ic");
  });

  test("viewer 403, non-member 404", async () => {
    expect((await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: viewerCookie },
      body: JSON.stringify({ decision: "graduate_to_core", rationale: "viewer must not record" }),
    })).status).toBe(403);
    expect((await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: outsiderCookie },
      body: JSON.stringify({ decision: "graduate_to_core", rationale: "outsider" }),
    })).status).toBe(404);
  });

  test("supplied run_id must exist and belong to the project (recorder lineage)", async () => {
    expect((await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "held_evidence_incomplete", rationale: "근거 미완결", run_id: "no-such-run" }),
    })).status).toBe(400);
  });
});

describe("(c) S12 completion — latest-cycle freshness (ADR-0101 §4)", () => {
  // The freshness sequence runs on project2, whose S8–S11 were completed in
  // setup so S12 is the current stage and its blockers actually surface.
  test("no scorecard rows at all: S12 is current and blocked on the artifact", () => {
    const empty = evaluateProcess({ type: "project", id: project2Id });
    expect(empty.completedStages).toContain("S11");
    expect(empty.completedStages).not.toContain("S12");
    expect(empty.currentStage).toBe("S12");
    expect(empty.blockers.join("\n")).toContain("벤처 스코어카드가 필요합니다");
  });

  test("a STALE latest cycle does not complete S12 and names the stale cycle", () => {
    recordCycle(STALE_CYCLE, "stale_measure", "on_target", project2Id);
    const stale = evaluateProcess({ type: "project", id: project2Id });
    expect(stale.completedStages).not.toContain("S12");
    expect(stale.currentStage).toBe("S12");
    expect(stale.blockers.join("\n")).toContain(STALE_CYCLE);
  });

  test("recording a CURRENT-quarter cycle flips S12 complete", () => {
    recordCycle(CURRENT_CYCLE, "fresh_measure", "on_target", project2Id);
    const done = evaluateProcess({ type: "project", id: project2Id });
    expect(done.completedStages).toContain("S12");
    expect(done.currentStage).toBeNull(); // S12 is terminal (onComplete: terminal)
  });
});

describe("(d) append-only ledger + migration shape", () => {
  test("second POST for the SAME review_cycle is a NEW row — history grows, nothing is updated", async () => {
    const first = db
      .query("SELECT COUNT(*) c FROM venture_transition_decision WHERE project_id = ? AND review_cycle = ?")
      .get(projectId, CURRENT_CYCLE) as { c: number };

    const res = await req(`/api/projects/${projectId}/transition-decision`, {
      method: "POST", headers: { cookie: analystCookie },
      body: JSON.stringify({ decision: "held_evidence_incomplete", rationale: "정략 섹션 근거 미완결 — 후속 실사 요청", review_cycle: CURRENT_CYCLE }),
    });
    expect(res.status).toBe(201); // allowed as a new ledger row, not a correction-in-place

    const after = db
      .query("SELECT COUNT(*) c FROM venture_transition_decision WHERE project_id = ? AND review_cycle = ?")
      .get(projectId, CURRENT_CYCLE) as { c: number };
    expect(after.c).toBe(first.c + 1);

    const view = await req(`/api/projects/${projectId}/scorecard`, { headers: { cookie: analystCookie } });
    const data = (await view.json()).data as { decisions: { history: Array<{ decision: string }>; latest: { decision: string } | null } };
    expect(data.decisions.history.length).toBe(3); // released + kill + held, newest first
    expect(data.decisions.latest?.decision).toBe("held_evidence_incomplete");

    // Append-only: no UPDATE/DELETE path exists anywhere for the table.
    const routeSrc = readFileSync(join(PROJECT_ROOT, "app/web-next/app/api/projects/[id]/transition-decision/route.ts"), "utf8");
    expect(routeSrc).not.toMatch(/UPDATE venture_transition_decision|DELETE FROM venture_transition_decision/i);
    expect(routeSrc).toContain("INSERT INTO venture_transition_decision");
  });

  test("0071 is additive-only and carries the ADR-0101 §1 shape verbatim", () => {
    const sql = readFileSync(join(PROJECT_ROOT, "db/migrations/0071_venture_transition_decision.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE venture_transition_decision");
    expect(sql).toContain("review_cycle GLOB '????-Q[1-4]'");
    expect(sql).toContain("decided_by TEXT NOT NULL CHECK (decided_by = 'venture-portfolio-ic')");
    expect(sql).toContain("'kill_with_learning_captured'");
    expect(sql).toContain("rationale TEXT NOT NULL CHECK (rationale <> '')");
    expect(sql).toContain("CREATE INDEX idx_vtd_project");
    // Statements only — comment lines may discuss UPDATE/DELETE in prose.
    const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(statements).not.toMatch(/DROP TABLE|ALTER TABLE|DELETE FROM|UPDATE /i);
  });
});
