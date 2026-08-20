// @version 1.0.0
/**
 * Unit tests for db/lib/watch-engine.ts (Wave 5.4) — bidirectional
 * notification (FR-MON-02), cooldown (FR-MON-03), and kill-criteria's
 * cooldown-bypass. Real scratch SQLite file, verify-then-encode: every
 * assertion below was produced by an actual engine run before being
 * asserted (see the manual bun -e verification in the PR description).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";
import {
  createWatch,
  addWatchRule,
  evaluateTransitionNotifications,
  evaluateKillCriteriaNotifications,
  isInCooldown,
} from "../../db/lib/watch-engine.ts";

const TEST_DB_PATH = "db/data/test-watch-engine.sqlite";
const NOW = "2026-08-20T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let runId: string;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-WATCH", NOW]);
  runId = ulid();
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    runId, projectId, "test", "h1", "test", NOW,
  ]);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
});

function insertTransition(from: "green" | "amber" | "red" | null, to: "green" | "amber" | "red", at: string): string {
  const id = ulid();
  db.run(
    "INSERT INTO rag_transition (id, project_id, from_grade, to_grade, run_id, at, reason, notified) VALUES (?,?,?,?,?,?,?,0)",
    [id, projectId, from, to, runId, at, `${from ?? "initial"}->${to}`],
  );
  return id;
}

describe("subscription + bidirectional notification (FR-MON-02)", () => {
  test("an amber->green transition fires the rag_upgrade rule, opportunity/daily, and marks rag_transition.notified", () => {
    const w = createWatch(db, { projectId, userId: "analyst-1", now: NOW });
    addWatchRule(db, { watchId: w, triggerType: "rag_upgrade", channel: "email", cooldownHours: 24 });
    addWatchRule(db, { watchId: w, triggerType: "rag_downgrade", channel: "all", cooldownHours: 24 });

    const trId = insertTransition("amber", "green", NOW);
    const r = evaluateTransitionNotifications(db, { projectId, ragTransitionId: trId, fromGrade: "amber", toGrade: "green", now: NOW });

    expect(r.fired.length).toBe(1);
    expect(r.suppressedByCooldown.length).toBe(0);
    const notif = db.query("SELECT severity, bundle, trigger_type, channel FROM notification WHERE id = ?").get(r.fired[0].notificationId) as {
      severity: string; bundle: string; trigger_type: string; channel: string;
    };
    expect(notif).toMatchObject({ severity: "opportunity", bundle: "daily", trigger_type: "rag_upgrade", channel: "email" });
    const tr = db.query("SELECT notified FROM rag_transition WHERE id = ?").get(trId) as { notified: number };
    expect(tr.notified).toBe(1);
  });

  test("a green->amber transition fires the (separate) rag_downgrade rule as a warning — downgrade is never silenced", () => {
    const trId = insertTransition("green", "amber", "2026-08-21T11:00:00Z");
    const r = evaluateTransitionNotifications(db, { projectId, ragTransitionId: trId, fromGrade: "green", toGrade: "amber", now: "2026-08-21T11:00:00Z" });
    expect(r.fired.length).toBe(1);
    const notif = db.query("SELECT severity, channel FROM notification WHERE id = ?").get(r.fired[0].notificationId) as { severity: string; channel: string };
    expect(notif).toMatchObject({ severity: "warning", channel: "all" });
  });

  test("a first-ever assessment (fromGrade null) never fires an upgrade/downgrade rule — nothing to compare against", () => {
    const trId = insertTransition(null, "green", "2026-08-22T00:00:00Z");
    const r = evaluateTransitionNotifications(db, { projectId, ragTransitionId: trId, fromGrade: null, toGrade: "green", now: "2026-08-22T00:00:00Z" });
    expect(r.fired.length).toBe(0);
    expect(r.suppressedByCooldown.length).toBe(0);
  });
});

describe("cooldown (FR-MON-03)", () => {
  test("an immediate same-trigger re-fire is suppressed by cooldown", () => {
    // Most recent rag_upgrade notification landed at NOW (2026-08-20T10:00:00Z,
    // from the very first test) — one second later is well inside the 24h window.
    const trId = insertTransition("amber", "green", "2026-08-20T10:00:01Z");
    const r = evaluateTransitionNotifications(db, { projectId, ragTransitionId: trId, fromGrade: "amber", toGrade: "green", now: "2026-08-20T10:00:01Z" });
    expect(r.fired.length).toBe(0);
    expect(r.suppressedByCooldown.length).toBe(1);
  });

  test("isInCooldown reflects the configured window boundary exactly", () => {
    // Most recent rag_upgrade notification is still the one at NOW (2026-08-20T10:00:00Z).
    expect(isInCooldown(db, { projectId, triggerType: "rag_upgrade", cooldownHours: 24, now: "2026-08-21T09:00:00Z" })).toBe(true);
    expect(isInCooldown(db, { projectId, triggerType: "rag_upgrade", cooldownHours: 24, now: "2026-08-21T11:00:00Z" })).toBe(false);
  });

  test("kill_criteria bypasses cooldown entirely — repeated triggers all fire", () => {
    const k1 = evaluateKillCriteriaNotifications(db, { projectId, runId, now: "2026-08-24T02:00:00Z" });
    const k2 = evaluateKillCriteriaNotifications(db, { projectId, runId, now: "2026-08-24T02:00:00Z" });
    // No kill_criteria watch_rule exists yet on this project -> both fire zero rows.
    expect(k1.length).toBe(0);
    expect(k2.length).toBe(0);

    const w2 = createWatch(db, { projectId, userId: "analyst-2", now: "2026-08-24T02:00:00Z" });
    addWatchRule(db, { watchId: w2, triggerType: "kill_criteria", channel: "all" });
    const k3 = evaluateKillCriteriaNotifications(db, { projectId, runId, now: "2026-08-24T02:00:00Z" });
    const k4 = evaluateKillCriteriaNotifications(db, { projectId, runId, now: "2026-08-24T02:00:00Z" });
    expect(k3.length).toBe(1);
    expect(k4.length).toBe(1); // second call at the same instant still fires — no cooldown applies
    const notif = db.query("SELECT severity, bundle, channel FROM notification WHERE trigger_type = 'kill_criteria' LIMIT 1").get() as {
      severity: string; bundle: string; channel: string;
    };
    expect(notif).toMatchObject({ severity: "urgent", bundle: "immediate", channel: "all" });
  });
});
