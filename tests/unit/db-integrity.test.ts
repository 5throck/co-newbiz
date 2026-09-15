import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { deleteOrphanGateDecisions, findGateDecisionReferenceIssues } from "../../scripts/co-newbiz/db-integrity.ts";

function fixtureDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  db.run("CREATE TABLE opportunity (id TEXT PRIMARY KEY NOT NULL)");
  db.run("CREATE TABLE md_project (id TEXT PRIMARY KEY NOT NULL)");
  db.run(`
    CREATE TABLE gate_decision (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      gate TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT NOT NULL,
      decided_by TEXT NOT NULL,
      decided_at TEXT NOT NULL
    )
  `);
  return db;
}

describe("db-integrity polymorphic gate_decision checks", () => {
  test("detects orphan opportunity/project gate decisions that SQLite FKs cannot express", () => {
    const db = fixtureDb();
    db.run("INSERT INTO opportunity (id) VALUES ('opp-ok')");
    db.run("INSERT INTO md_project (id) VALUES ('proj-ok')");
    db.run(`
      INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at)
      VALUES
        ('gd-ok-opp', 'opportunity', 'opp-ok', 'screening', 'go', 'ok', 'tester', '2026-09-16T00:00:00.000Z'),
        ('gd-ok-proj', 'project', 'proj-ok', 'fs', 'go', 'ok', 'tester', '2026-09-16T00:00:01.000Z'),
        ('gd-bad-opp', 'opportunity', 'opp-missing', 'screening', 'hold', 'missing', 'tester', '2026-09-16T00:00:02.000Z'),
        ('gd-bad-proj', 'project', 'proj-missing', 'fs', 'hold', 'missing', 'tester', '2026-09-16T00:00:03.000Z')
    `);

    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(findGateDecisionReferenceIssues(db).map((i) => [i.id, i.reason])).toEqual([
      ["gd-bad-opp", "missing_opportunity"],
      ["gd-bad-proj", "missing_project"],
    ]);
  });

  test("can prune local demo orphan rows without touching valid decisions", () => {
    const db = fixtureDb();
    db.run("INSERT INTO opportunity (id) VALUES ('opp-ok')");
    db.run(`
      INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, decided_by, decided_at)
      VALUES
        ('gd-ok', 'opportunity', 'opp-ok', 'screening', 'go', 'ok', 'tester', '2026-09-16T00:00:00.000Z'),
        ('gd-orphan', 'project', 'proj-missing', 'fs', 'hold', 'missing', 'tester', '2026-09-16T00:00:01.000Z')
    `);

    expect(deleteOrphanGateDecisions(db)).toBe(1);
    expect(findGateDecisionReferenceIssues(db)).toEqual([]);
    expect((db.query("SELECT COUNT(*) AS n FROM gate_decision WHERE id = 'gd-ok'").get() as { n: number }).n).toBe(1);
  });
});
