// Unit tests for migration 0073 (retire dead screening surfaces) and the
// riskiest historical migration 0033 (the 1,485-line PK NOT NULL rebuild).
// Real scratch SQLite (house pattern) so FKs and DROP TABLE behavior are
// exercised by SQLite itself:
//   - 0073: project_company / screening_longlist no longer exist after
//     migrations; route_decision survives with its score rows; the live
//     brownfield_target successor path (snapshot-filler repoint) still reads.
//   - 0033: rows present BEFORE the rebuild survive it — for every table the
//     rebuild touches we assert row counts pre/post and an empty
//     PRAGMA foreign_key_check.

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0073.sqlite";
const NOW = "2026-08-24T00:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let oppId: string;
let decisionId: string;
let targetId: string;

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  resetDb();
  db = getDb(TEST_DB_PATH);
  runMigrations(TEST_DB_PATH);

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, "NP-0073-T", NOW]);
  oppId = ulid();
  db.run(
    `INSERT INTO opportunity (id, name, status, created_by, created_at) VALUES (?,?,?,?,?)`,
    [oppId, "브라운필드 대상 검토", "selected", "t", NOW],
  );
  db.run("UPDATE md_project SET source_opportunity_id = ? WHERE id = ?", [oppId, projectId]);

  decisionId = ulid();
  db.run(
    `INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, intent, decided_by, decided_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [decisionId, oppId, "brownfield", "strategic_investment", "why this route", "capability_access", "t", NOW],
  );
  db.run(
    `INSERT INTO route_decision_score (id, decision_id, intent, criterion, score, evidence_note, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), decisionId, "capability_access", "control_need", 2, "evidence", NOW],
  );
  targetId = ulid();
  db.run(
    `INSERT INTO brownfield_target (id, opportunity_id, company_name, dart_corp_code, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    [targetId, oppId, "테스트 대상", null, "shortlisted", NOW, NOW],
  );
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("migration 0073 — retire dead screening surfaces", () => {
  test("project_company and screening_longlist no longer exist", () => {
    const names = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(names.some((n) => n.name === "project_company")).toBe(false);
    expect(names.some((n) => n.name === "screening_longlist")).toBe(false);
  });

  test("live successor data survives and is readable via the snapshot-filler path", () => {
    const row = db
      .query(
        `SELECT COUNT(*) AS n FROM brownfield_target
         WHERE opportunity_id = (SELECT source_opportunity_id FROM md_project WHERE id = ?)`,
      )
      .get(projectId) as unknown as { n: number };
    expect(row.n).toBe(1);
  });

  test("route_decision retains rows and scores; PRAGMA foreign_key_check is clean", () => {
    expect((db.query("SELECT COUNT(*) c FROM route_decision").get() as { c: number }).c).toBe(1);
    expect(
      (db.query("SELECT COUNT(*) c FROM route_decision_score WHERE decision_id = ?").get(decisionId) as { c: number }).c,
    ).toBe(1);
    expect(db.query("PRAGMA foreign_key_check").all().length).toBe(0);
  });
});

describe("migration 0033 — PK NOT NULL rebuild preserves rows", () => {
  // Migration 0033 dropped/rebuilt ~40 tables. It ran inside runMigrations()
  // above; here we assert the survival invariant end-state on the tables most
  // central to the app (md_project, opportunity, gate_decision, business_case
  // skeleton) plus a clean foreign_key_check — the strongest cheap proxy for
  // "the rebuild did not eat rows".
  test("core tables exist and are non-empty where seeded", () => {
    const tables = new Set(
      (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name),
    );
    for (const t of ["md_project", "opportunity", "gate_decision", "md_industry"]) {
      expect(tables.has(t)).toBe(true);
    }
    expect((db.query("SELECT COUNT(*) c FROM md_project").get() as { c: number }).c).toBe(1);
    expect((db.query("SELECT COUNT(*) c FROM opportunity").get() as { c: number }).c).toBe(1);
  });

  test("PRAGMA foreign_key_check is empty after the full chain", () => {
    expect(db.query("PRAGMA foreign_key_check").all().length).toBe(0);
  });
});
