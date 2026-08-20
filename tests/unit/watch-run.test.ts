// @version 1.0.0
/**
 * Integration test for scripts/co-newbiz/watch-run.ts (Wave 5.4) — the full
 * design §12 item 17 scenario against a real scratch SQLite file: watchlist
 * registration -> a relevant data change -> watch:run -> auto re-run ->
 * RAG transition -> notification, then an immediate re-cycle proving the
 * change window (watermark) is consumed so it does not re-fire.
 *
 * Verify-then-encode: this exact sequence (including the recorded_overall
 * values and job_run status) was run manually via `bun -e` against a real
 * scratch DB before being encoded here.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { assessScenario } from "../../scripts/co-newbiz/rag.ts";
import { createWatch, addWatchRule } from "../../db/lib/watch-engine.ts";
import { runWatchCycle } from "../../scripts/co-newbiz/watch-run.ts";

const TEST_DB_PATH = "db/data/test-watch-run.sqlite";
const BASELINE_NOW = "2026-08-12T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let baselineRunId: string;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-WR1", BASELINE_NOW]);

  const baseline = assessScenario(db, {
    project_no: "NP-WR1",
    stage_gate: "fs",
    chain_grade: "A",
    financial: { irr: 0.115, hurdle: 0.1, dscr_downside: 1.5 },
    market_grade: "green",
    regulatory: { remedy_type: "none" },
    technical_grade: "green",
    risk_grade: "green",
    irr_over_hurdle_pp: 1.5,
    now: BASELINE_NOW,
  });
  expect(baseline.recorded_overall).toBe("amber"); // establishes the pre-condition the rest of the test relies on
  baselineRunId = baseline.run_id;

  // The baseline run's financial input is anchored to a live market series —
  // this is what lets watch:run's change-detection step find it.
  db.run(
    "INSERT INTO assumption (id, run_id, assumption_key, kind, value, anchor_ref, as_of) VALUES (?,?,?,?,?,?,?)",
    [ulid(), baselineRunId, "oil_price", "live", 70, "SERIES-OIL", BASELINE_NOW],
  );

  const w = createWatch(db, { projectId, userId: "analyst-1", now: BASELINE_NOW });
  addWatchRule(db, { watchId: w, triggerType: "rag_upgrade", channel: "email", cooldownHours: 24 });
  addWatchRule(db, { watchId: w, triggerType: "rag_downgrade", channel: "all", cooldownHours: 24 });
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

describe("watch:run cycle", () => {
  test("no relevant change and no rescenario -> the project is skipped, not re-run 'just in case'", () => {
    const result = runWatchCycle(db, { now: "2026-08-13T10:00:00Z" });
    expect(result.projects.length).toBe(1);
    expect(result.projects[0]).toMatchObject({ changed: false, reassessed: false });
    const jobRow = db.query("SELECT status FROM job_run WHERE id = ?").get(result.jobRunId) as { status: string };
    expect(jobRow.status).toBe("success");
  });

  test("design §12 item 17: a relevant data change + rescenario drives auto re-run -> RAG upgrade -> notification", () => {
    db.run(
      "INSERT INTO data_change_log (id, series_id, detected_at, change_type, old_value, new_value) VALUES (?,?,?,?,?,?)",
      [ulid(), "SERIES-OIL", "2026-08-20T09:00:00Z", "revised", 70, 55],
    );
    const laterNow = "2026-08-20T10:00:00Z"; // 8 days after baseline -> hysteresis hold satisfied
    const result = runWatchCycle(db, {
      now: laterNow,
      rescenarios: {
        "NP-WR1": {
          project_no: "NP-WR1",
          stage_gate: "fs",
          chain_grade: "A",
          financial: { irr: 0.13, hurdle: 0.1, dscr_downside: 1.5 },
          market_grade: "green",
          regulatory: { remedy_type: "none" },
          technical_grade: "green",
          risk_grade: "green",
          irr_over_hurdle_pp: 3.0,
          previous_irr_over_hurdle_pp: 2.2,
          now: laterNow,
        },
      },
    });

    const p = result.projects[0];
    expect(p.changed).toBe(true);
    expect(p.reassessed).toBe(true);
    expect(p.ragResult?.recorded_overall).toBe("green");
    expect(p.ragResult?.transition).toEqual({ from: "amber", to: "green" });
    expect(p.notificationsFired).toBe(1);
    expect(p.notificationsSuppressed).toBe(0);

    const notif = db.query("SELECT trigger_type, severity FROM notification ORDER BY sent_at DESC LIMIT 1").get() as {
      trigger_type: string; severity: string;
    };
    expect(notif).toMatchObject({ trigger_type: "rag_upgrade", severity: "opportunity" });

    // The auto re-run is labeled distinctly from a manually-run `rag` assessment.
    const runRow = db.query("SELECT label, created_by FROM run WHERE id = ?").get(p.ragResult!.run_id) as { label: string; created_by: string };
    expect(runRow.label.startsWith("auto ")).toBe(true);
    expect(runRow.created_by).toBe("watch:run");
  });

  test("an immediate re-cycle finds the change window already consumed (watermark advanced) — no duplicate re-run", () => {
    const result = runWatchCycle(db, {
      now: "2026-08-20T10:05:00Z",
      rescenarios: { "NP-WR1": { project_no: "NP-WR1", stage_gate: "fs", now: "2026-08-20T10:05:00Z" } },
    });
    expect(result.projects[0].changed).toBe(false);
    expect(result.projects[0].reassessed).toBe(false);
  });
});
