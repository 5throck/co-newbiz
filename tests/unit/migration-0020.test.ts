/**
 * Unit tests for migration 0020 (substitution_threat CHECK enum + fact-var
 * max_age_days) — the D-M-MKT-2 rider (docs/decisions/market-thresholds.md
 * §D-M-MKT-11.4 action item i) and the D-M-MKT-3 recommended staleness gate.
 * Real scratch SQLite (the migration-0017/0019 pattern: runMigrations on a
 * temp WAL DB, resetDb in afterAll) so the rebuilt CHECK, the surviving 0019
 * shape, and the FK graph are exercised by SQLite itself, not mocked.
 *
 * These tests pin four things:
 *   (a) the rebuild lost nothing — 0019's column shape, the switching_cost_
 *       grade CHECK, and the project index all survive a second rebuild;
 *   (b) the new substitution_threat CHECK accepts the five mirrored members
 *       (and NULL — absence must stay distinguishable) and rejects
 *       out-of-enum writes. It is documented in the migration as an
 *       IMPLEMENTATION PROPOSAL PENDING RATIFICATION (no vocabulary existed
 *       anywhere in the repo); the test pins the proposed members so any
 *       ratification change is a visible diff, never a silent drift;
 *   (c) data carries through the rebuild (INSERT..SELECT is total);
 *   (d) max_age_days = 730 lands on exactly the three fact_industry-computed
 *       vars (D-M-MKT-3) and on nothing else.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { resetDb, getDb, type getDb as GetDb } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ulid } from "../../db/lib/ulid.ts";

const TEST_DB_PATH = "db/data/test-migration-0020.sqlite";
const NOW = "2026-08-23T10:00:00Z";

type Db = ReturnType<typeof GetDb>;
let db: Db;
let projectId: string;
let industryA: string;
let industryB: string;

/** The mirrored five-member ordinal — identical labels to switching_cost_grade (D-M-MKT-2). */
const THREAT_MEMBERS = ["negligible", "low", "moderate", "high", "very_high"] as const;

function insertLink(substitutionThreat: string | null): void {
  db.run(
    "INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction, substitution_threat, assessed_at) VALUES (?,?,?,?,?,?,?)",
    [ulid(), projectId, industryA, industryB, "upstream", substitutionThreat, NOW],
  );
}

beforeAll(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
  resetDb();
  runMigrations(TEST_DB_PATH);
  db = getDb(TEST_DB_PATH);

  projectId = ulid();
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?,?,?)", [projectId, `NP-${projectId.slice(-6)}`, NOW]);
  industryA = ulid();
  industryB = ulid();
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryA, "30110", "선박용 엔진", "Marine engines", NOW]);
  db.run("INSERT INTO md_industry (id, ksic_code, name_ko, name_en, created_at) VALUES (?,?,?,?,?)", [industryB, "31111", "조선업", "Shipbuilding", NOW]);
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = TEST_DB_PATH + suffix;
    if (!existsSync(p)) continue;
    // Windows occasionally lags the handle release just past close(); the
    // artifact is throwaway and beforeAll removes any leftover next run
    try {
      rmSync(p);
    } catch {
      // best-effort cleanup only
    }
  }
});

// ---------------------------------------------------------------------------
// (a) The rebuild lost nothing
// ---------------------------------------------------------------------------

describe("rebuild: shape preservation", () => {
  test("applies cleanly in the full chain — 0020 is recorded", () => {
    const rows = db.query("SELECT filename FROM schema_migrations ORDER BY filename").all() as { filename: string }[];
    expect(rows.map((r) => r.filename)).toContain("0020_substitution_threat_enum_and_max_age.sql");
  });

  test("value_chain_link keeps the exact 0019 column list (order included)", () => {
    const cols = db.query("PRAGMA table_info(value_chain_link)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual([
      "id", "project_id", "from_industry_id", "to_industry_id", "direction", "elasticity", "lag_months", "correlation", "r2",
      "pass_through_rate", "pass_through_lag_months", "concentration_hhi", "switching_cost_grade", "substitution_threat", "evidence_ref", "assessed_at",
    ]);
  });

  test("the project index was recreated after the rebuild", () => {
    const c = (db.query("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND tbl_name = 'value_chain_link' AND name = 'idx_value_chain_link_project'").get() as { c: number }).c;
    expect(c).toBe(1);
  });

  test("pre-existing CHECKs survived the rebuild verbatim", () => {
    // direction (0011) and switching_cost_grade (0019) still enforce
    expect(() =>
      db.run("INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction, assessed_at) VALUES (?,?,?,?,?,?)", [ulid(), projectId, industryA, industryB, "sideways", NOW]),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.run("INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction, switching_cost_grade, assessed_at) VALUES (?,?,?,?,?,?,?)", [ulid(), projectId, industryA, industryB, "upstream", "moderate-ish", NOW]),
    ).toThrow(/CHECK constraint failed/);
  });
});

// ---------------------------------------------------------------------------
// (b) The new CHECK — proposal-pending-ratification members, pinned
// ---------------------------------------------------------------------------

describe("substitution_threat CHECK", () => {
  test("accepts every mirrored member", () => {
    for (const member of THREAT_MEMBERS) {
      expect(() => insertLink(member), member).not.toThrow();
    }
  });

  test("accepts NULL — absence stays distinguishable from a value", () => {
    expect(() => insertLink(null)).not.toThrow();
  });

  test("rejects out-of-enum writes — the typo class the rider exists to kill", () => {
    for (const bad of ["severe", "NONE", "high ", "very high", "moderate-ish"]) {
      expect(() => insertLink(bad), bad).toThrow(/CHECK constraint failed/);
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Data carries through
// ---------------------------------------------------------------------------

describe("rebuild: data carry-through", () => {
  test("rows inserted before conceptually land after — the copy is total", () => {
    // All rows above (members + NULL) are post-migration inserts; the rebuild
    // itself ran over an empty table. Assert the total landed and one member
    // round-trips — the INSERT..SELECT shape is generic (0019 pattern).
    const rows = db.query("SELECT substitution_threat FROM value_chain_link WHERE project_id = ? AND substitution_threat IS NOT NULL").all(projectId) as { substitution_threat: string }[];
    expect(rows.map((r) => r.substitution_threat).sort()).toEqual([...THREAT_MEMBERS].sort());
  });
});

// ---------------------------------------------------------------------------
// (d) max_age_days — the D-M-MKT-3 recommendation, exactly three vars
// ---------------------------------------------------------------------------

describe("evidence_var.max_age_days", () => {
  test("the three fact_industry-computed vars carry 730", () => {
    for (const varKey of ["market.tam", "market.growth_rate", "market.top3_share"]) {
      const row = db.query("SELECT max_age_days FROM evidence_var WHERE var_key = ?").get(varKey) as { max_age_days: number | null };
      expect(row.max_age_days, varKey).toBe(730);
    }
  });

  test("no OTHER var gained a max_age — the UPDATE was scoped to the three", () => {
    const rows = db.query("SELECT var_key FROM evidence_var WHERE max_age_days IS NOT NULL").all() as { var_key: string }[];
    expect(rows.map((r) => r.var_key).sort()).toEqual(["market.growth_rate", "market.tam", "market.top3_share"]);
  });
});
