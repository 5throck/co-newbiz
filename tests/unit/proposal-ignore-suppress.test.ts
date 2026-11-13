// @version 1.0.0
/**
 * Brownfield proposal-ignore suppression — lib-level store semantics (design
 * 2026-11-13-proposal-ignore-suppression §3.1/§3.2, DEC-20261113-04 rulings
 * 1/4) + migration 0192 pins (§5.11). Scratch SQLite per the house fixture
 * pattern; route-level contracts live in proposal-ignore-route.test.ts,
 * extractor-level pins in brownfield-llm-support.test.ts.
 *
 * Locked in:
 *   - threshold: 0/1 events → key absent from suppressedProposalKeys; 2
 *     events → present (the ONLY threshold decision site, §3.4).
 *   - accumulation across legal-form variants: 주식회사 한양 → 한양(주) both
 *     map to one key and the count accumulates (count = row count).
 *   - NO unique constraint on (opportunity_id, company_key): repeated ignores
 *     accumulate rows — the user's rule counts EVENTS.
 *   - per-opportunity isolation: an ignore in opportunity A never suppresses
 *     in opportunity B (§5.10).
 *   - append-only: no update/delete path in the lib; ignored raw names loader
 *     returns DISTINCT raw names most-recent-first capped at 20 (prompt hint).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "proposal-ignore-suppress-"));
const TEST_DB_PATH = join(TMP, "suppress.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const {
  PROPOSAL_IGNORE_SUPPRESS_THRESHOLD,
  IGNORED_NAMES_PROMPT_CAP,
  recordProposalIgnore,
  suppressedProposalKeys,
  proposalIgnoreCounts,
  ignoredProposalRawNames,
} = await import("../../app/web-next/lib/brownfield-proposal-ignore.ts");
const { companyKey } = await import("../../app/web-next/lib/name-similarity.ts");

const NOW = "2026-11-13T10:00:00Z";
let oppA = "";
let oppB = "";

const insertOpp = (id: string, name: string) =>
  db.run("INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    id,
    name,
    "한양 산업",
    "selected",
    "test",
    NOW,
  ]);

beforeAll(() => {
  oppA = "opp-ignore-a";
  oppB = "opp-ignore-b";
  insertOpp(oppA, "무시 임계값 기회 A");
  insertOpp(oppB, "무시 임계값 기회 B");
});

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

describe("migration 0192 — header and shape (§5.11)", () => {
  const MIGRATION_FILE = join(import.meta.dirname, "..", "..", "db", "migrations", "0192_target_proposal_ignore.sql");

  test("carries the reversible metadata header (ADR-0014) and ROLLBACK-SQL block", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("@reversible:");
    expect(sql).toContain("ROLLBACK-SQL-BEGIN");
    expect(sql).toContain("ROLLBACK-SQL-END");
    expect(sql).toContain("DROP TABLE brownfield_target_proposal_ignore;");
  });

  test("table exists with the design's columns and NO unique constraint on (opportunity_id, company_key)", () => {
    const table = db
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("brownfield_target_proposal_ignore") as { sql: string };
    expect(table.sql).toContain("company_name_raw");
    expect(table.sql).toContain("company_key");
    expect(table.sql).toContain("ignored_by");
    // count = rows — repeated ignores MUST accumulate, so no UNIQUE anywhere.
    expect(table.sql.toUpperCase()).not.toContain("UNIQUE");
    const idx = db
      .query(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'brownfield_target_proposal_ignore'",
      )
      .all() as Array<{ name: string; sql: string }>;
    const found = idx.find((i) => i.name === "idx_btpi_opp_key");
    expect(found).toBeTruthy();
    expect(found?.sql).not.toContain("UNIQUE");
  });

  test("applies on a DB already migrated to 0191 (runMigrations ran the full chain — 0192 present in schema_migrations)", () => {
    const rows = db
      .query("SELECT filename FROM schema_migrations WHERE filename LIKE '%019%' ORDER BY filename")
      .all() as Array<{ filename: string }>;
    const filenames = rows.map((r) => r.filename);
    expect(filenames.some((v) => v.includes("0191"))).toBe(true);
    expect(filenames.some((v) => v.includes("0192"))).toBe(true);
  });
});

describe("suppressedProposalKeys — the one threshold decision site (§5.4 threshold)", () => {
  test("threshold constant is 2 (user ruling: ignored 2 or more times)", () => {
    expect(PROPOSAL_IGNORE_SUPPRESS_THRESHOLD).toBe(2);
    expect(IGNORED_NAMES_PROMPT_CAP).toBe(20);
  });

  test("0 events → key absent; 1 event → key ABSENT (chip state, door still open); 2 events → key PRESENT", () => {
    expect(suppressedProposalKeys(db, oppA).has(companyKey("한양"))).toBe(false);
    const first = recordProposalIgnore(db, oppA, "주식회사 한양", "ana");
    expect(first).toEqual({ companyKey: companyKey("한양"), ignoreCount: 1 });
    expect(suppressedProposalKeys(db, oppA).has(companyKey("한양"))).toBe(false); // 1 — not yet
    const second = recordProposalIgnore(db, oppA, "한양(주)", "ana"); // variant → SAME key
    expect(second.ignoreCount).toBe(2); // accumulation across variants (§5.2)
    expect(suppressedProposalKeys(db, oppA).has(companyKey("한양"))).toBe(true); // 2 — closed
  });

  test("counts and raw-names loaders share the same scan data (chip payload + prompt hint)", () => {
    const counts = proposalIgnoreCounts(db, oppA);
    expect(counts.get(companyKey("한양"))).toBe(2);
    expect(counts.get(companyKey("한양전자"))).toBeUndefined(); // 0 events → absent
    const raws = ignoredProposalRawNames(db, oppA);
    expect(raws).toEqual(["한양(주)", "주식회사 한양"]); // DISTINCT raws, most recent first
  });

  test("raw-names loader caps at IGNORED_NAMES_PROMPT_CAP (prompt length bound, §3.4)", () => {
    for (let i = 0; i < IGNORED_NAMES_PROMPT_CAP + 5; i++) {
      recordProposalIgnore(db, oppA, `상한회사${i}`, "ana");
    }
    expect(ignoredProposalRawNames(db, oppA).length).toBe(IGNORED_NAMES_PROMPT_CAP);
  });
});

describe("per-opportunity isolation and append-only shape (§5.10, ruling 6)", () => {
  test("an ignore in opportunity A never suppresses the same key in opportunity B", () => {
    expect(suppressedProposalKeys(db, oppA).has(companyKey("한양"))).toBe(true);
    expect(suppressedProposalKeys(db, oppB).size).toBe(0); // B untouched
    recordProposalIgnore(db, oppB, "한양", "ana"); // 1 event in B — still below threshold
    expect(suppressedProposalKeys(db, oppB).has(companyKey("한양"))).toBe(false);
  });

  test("repeated identical clicks accumulate rows (no idempotence, no unique constraint) and each lands an audit row", () => {
    const before = (
      db.query("SELECT COUNT(*) AS n FROM brownfield_target_proposal_ignore WHERE opportunity_id = ?").get(oppB) as {
        n: number;
      }
    ).n;
    const auditBefore = (
      db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'target_proposal.ignore'").get() as { n: number }
    ).n;
    recordProposalIgnore(db, oppB, "한양", "ana");
    const after = (
      db.query("SELECT COUNT(*) AS n FROM brownfield_target_proposal_ignore WHERE opportunity_id = ?").get(oppB) as {
        n: number;
      }
    ).n;
    expect(after).toBe(before + 1); // append-only event store — row count IS the event count
    expect(
      (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'target_proposal.ignore'").get() as { n: number })
        .n,
    ).toBe(auditBefore + 1);
  });

  test("stored rows keep the raw name untouched and the key derived from it (audit trail, §3.1)", () => {
    recordProposalIgnore(db, oppB, "㈜한양", "ana");
    const row = db
      .query(
        "SELECT company_name_raw, company_key, ignored_by FROM brownfield_target_proposal_ignore WHERE opportunity_id = ? AND company_name_raw = ?",
      )
      .get(oppB, "㈜한양") as { company_name_raw: string; company_key: string; ignored_by: string };
    expect(row.company_name_raw).toBe("㈜한양");
    expect(row.company_key).toBe(companyKey("한양"));
    expect(row.ignored_by).toBe("ana");
  });
});
