// @version 1.0.0
/**
 * ADR-0208 slice 2 - migration 0200 (dart_credit_rating_snapshot), its repository and the cache-only resolution of
 * the disclosed rating (db/lib/credit-rating-evidence.ts). Scratch SQLite, no network.
 *
 * Covers: filename / header markers (ADR-0014: @reversible + ROLLBACK-SQL), additive shape (CHECK vocabularies,
 * UNIQUE (source_rcept_no, parser_version), immutability trigger, no user/project column), rollback rehearsal,
 * idempotent writes, the 'parsed needs rows' write guard, and the resolution rules: newest report only, fresh
 * beats stale, lower of two sources with the other returned, recorded misses (never "unrated").
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitSqlStatements } from "../../db/migrate.ts";

const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const F200 = files.find((f) => f.startsWith("0200_")) ?? "";
const SQL200 = readFileSync(join(DIR, F200), "utf-8");
const NOW = "2026-11-26T00:00:00.000Z";

const TMP = mkdtempSync(join(tmpdir(), "credit-rating-snapshot-"));
process.env.CO_NEWBIZ_DB_PATH = join(TMP, "boot.sqlite");
const { runMigrations } = await import("../../db/migrate.ts");
const { getDb, resetDb } = await import("../../db/client.ts");
resetDb();
const DB_PATH = join(TMP, "store.sqlite");
runMigrations(DB_PATH);
const db = getDb(DB_PATH);

const repo = await import("../../db/repositories/dart-credit-rating.repository.ts");
const { resolveDisclosedRating } = await import("../../db/lib/credit-rating-evidence.ts");
const { CREDIT_RATING_PARSER_VERSION } = await import("../../db/lib/credit-rating-disclosure.ts");
const { loadKrCreditRatingRegistry } = await import("../../db/lib/credit-spread-map.ts");
const loaded = loadKrCreditRatingRegistry();
if (!loaded.ok) throw new Error("registry");
const REG = loaded.registry;
const V = CREDIT_RATING_PARSER_VERSION;

describe("migration 0200", () => {
  test("filename follows 0199 and the header carries @reversible + ROLLBACK-SQL markers (ADR-0014)", () => {
    expect(F200).toBe("0200_dart_credit_rating_snapshot.sql");
    expect(files[files.indexOf(F200) - 1]?.startsWith("0199_")).toBe(true);
    expect(SQL200).toMatch(/^-- @reversible: true/);
    expect(SQL200).toContain("ROLLBACK-SQL-BEGIN");
    expect(SQL200).toContain("ROLLBACK-SQL-END");
  });

  test("additive shape: columns, no user/project/verdict column, unique identity, immutability trigger", () => {
    const cols = (db.query("PRAGMA table_info(dart_credit_rating_snapshot)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toEqual([
      "id",
      "corp_code",
      "source_kind",
      "source_rcept_no",
      "parser_version",
      "status",
      "ratings_json",
      "issues_json",
      "truncated",
      "content_hash",
      "fetched_at",
    ]);
    expect(cols.some((c) => /user|project|opportunity|verdict|candidate/.test(c))).toBe(false);
    const ins = (over: Record<string, unknown> = {}) => {
      const r = {
        id: "01JABCDEFGHJKMNPQRSTVWXYZ0",
        corp_code: "00123456",
        source_kind: "business_report",
        source_rcept_no: "20260310000001",
        parser_version: "t-1",
        status: "parsed",
        ratings_json: "[]",
        ...over,
      };
      db.run(
        "INSERT INTO dart_credit_rating_snapshot (id, corp_code, source_kind, source_rcept_no, parser_version, status, ratings_json, content_hash, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [r.id, r.corp_code, r.source_kind, r.source_rcept_no, r.parser_version, r.status, r.ratings_json, "h", NOW],
      );
    };
    ins();
    expect(() => ins({ id: "01JABCDEFGHJKMNPQRSTVWXYZ1" })).toThrow(); // UNIQUE (rcept_no, parser_version)
    ins({ id: "01JABCDEFGHJKMNPQRSTVWXYZ2", parser_version: "t-2" }); // new parser version re-parses once
    expect(() => ins({ id: "01JABCDEFGHJKMNPQRSTVWXYZ3", source_rcept_no: "2026" })).toThrow(); // 14 digits
    expect(() =>
      ins({ id: "01JABCDEFGHJKMNPQRSTVWXYZ4", source_rcept_no: "20260310000002", corp_code: "1" }),
    ).toThrow();
    expect(() =>
      ins({ id: "01JABCDEFGHJKMNPQRSTVWXYZ5", source_rcept_no: "20260310000003", status: "unrated" }),
    ).toThrow();
    expect(() =>
      ins({ id: "01JABCDEFGHJKMNPQRSTVWXYZ6", source_rcept_no: "20260310000004", source_kind: "web" }),
    ).toThrow();
    expect(() =>
      ins({ id: "01JABCDEFGHJKMNPQRSTVWXYZ7", source_rcept_no: "20260310000005", ratings_json: "{" }),
    ).toThrow();
    expect(() => db.run("UPDATE dart_credit_rating_snapshot SET status = 'parse_failed'")).toThrow(/immutable/);
    db.run("DELETE FROM dart_credit_rating_snapshot"); // rows are removable only as a whole by an operator (no trigger on delete)
  });

  test("rollback rehearsal: applied alone (no FK to other tables), the ROLLBACK-SQL block drops table, trigger and index", () => {
    const block = SQL200.split("ROLLBACK-SQL-BEGIN")[1]?.split("ROLLBACK-SQL-END")[0] ?? "";
    const stmts = splitSqlStatements(block.replace(/^--\s?/gm, ""));
    expect(stmts.length).toBe(3);
    const scratch = new Database(":memory:");
    for (const st of splitSqlStatements(SQL200)) scratch.run(st);
    const names = (
      scratch.query("SELECT name FROM sqlite_master WHERE name LIKE '%dart_credit_rating_snapshot%'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(names).toContain("dart_credit_rating_snapshot");
    expect(names).toContain("trg_dart_credit_rating_snapshot_immutable");
    expect(names).toContain("idx_dart_credit_rating_snapshot_corp");
    for (const st of stmts) scratch.run(st);
    expect(
      scratch.query("SELECT name FROM sqlite_master WHERE name LIKE '%dart_credit_rating_snapshot%'").all(),
    ).toEqual([]);
    scratch.close();
  });
});

describe("repository", () => {
  const CORP = "00999001";
  test("idempotent per (rcept_no, parser_version): the first parse is kept and returned", () => {
    const a = repo.insertCreditRatingSnapshot(db, {
      corpCode: CORP,
      sourceKind: "business_report",
      sourceRceptNo: "20260301000010",
      parserVersion: V,
      status: "section_absent",
      ratings: [],
      issues: null,
      now: NOW,
    });
    const b = repo.insertCreditRatingSnapshot(db, {
      corpCode: CORP,
      sourceKind: "business_report",
      sourceRceptNo: "20260301000010",
      parserVersion: V,
      status: "not_disclosed",
      ratings: [],
      issues: null,
      now: "2027-01-01T00:00:00.000Z",
    });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe("section_absent");
    expect(repo.getCreditRatingSnapshot(db, a.id)?.fetched_at).toBe(NOW);
    expect(repo.getCreditRatingSnapshot(db, "nope")).toBeNull();
    expect(repo.hasCreditRatingSnapshots(db, CORP, V)).toBe(true);
    expect(repo.hasCreditRatingSnapshots(db, "00000000", V)).toBe(false);
  });

  test("write guards: a transient failure has no representable status; parsed needs rows", () => {
    const base = {
      corpCode: CORP,
      sourceKind: "business_report" as const,
      sourceRceptNo: "20260301000011",
      parserVersion: V,
      ratings: [],
      issues: null,
      now: NOW,
    };
    expect(() => repo.insertCreditRatingSnapshot(db, { ...base, status: "transient_error" as never })).toThrow(
      repo.CreditRatingSnapshotError,
    );
    expect(() => repo.insertCreditRatingSnapshot(db, { ...base, status: "parsed" })).toThrow(
      repo.CreditRatingSnapshotError,
    );
    expect(() =>
      repo.insertCreditRatingSnapshot(db, { ...base, status: "section_absent", sourceKind: "x" as never }),
    ).toThrow(repo.CreditRatingSnapshotError);
  });

  test("the content hash covers ratings and issues; issues null is distinct from an empty list", () => {
    const mk = (rcept: string, issues: unknown[] | null) =>
      repo.insertCreditRatingSnapshot(db, {
        corpCode: CORP,
        sourceKind: "business_report",
        sourceRceptNo: rcept,
        parserVersion: V,
        status: "section_absent",
        ratings: [],
        issues,
        now: NOW,
      });
    const a = mk("20260301000012", null);
    const b = mk("20260301000013", []);
    expect(a.content_hash).not.toBe(b.content_hash);
    expect(a.issues_json).toBeNull();
    expect(b.issues_json).toBe("[]");
  });
});

describe("resolveDisclosedRating (cache only)", () => {
  const NOW_D = new Date("2026-11-26T03:00:00Z");
  const row = (agency: string, grade: string, rated_on: string, source = "section") => ({
    source,
    agency,
    agency_raw: agency,
    instrument: "corporate_bond",
    grade,
    grade_raw: grade,
    outlook: null,
    rated_on,
    rated_on_precision: "day",
    excluded_reason: null,
    raw: "",
  });
  let n = 100;
  const put = (
    corp: string,
    kind: "business_report" | "debt_securities_filing",
    rcept: string,
    status: "parsed" | "not_disclosed" | "parse_failed" | "section_absent" | "section_present_no_bond_rating",
    ratings: unknown[],
  ) =>
    repo.insertCreditRatingSnapshot(db, {
      corpCode: corp,
      sourceKind: kind,
      sourceRceptNo: rcept,
      parserVersion: V,
      status,
      ratings,
      issues: null,
      now: `2026-11-26T00:00:${String(n++ % 60).padStart(2, "0")}.000Z`,
    });

  test("no DART code and nothing collected are distinct recorded statuses", () => {
    expect(resolveDisclosedRating(db, null, REG, NOW_D)).toEqual({ ok: false, status: "no_dart_corp_code" });
    expect(resolveDisclosedRating(db, "00777000", REG, NOW_D)).toEqual({ ok: false, status: "rating_not_collected" });
  });

  test("report only: lowest of the latest per agency, with agency, date, rcept_no and snapshot id", () => {
    const corp = "00777001";
    const snap = put(corp, "business_report", "20260310000101", "parsed", [
      row("kis", "A+", "2026-03-05"),
      row("nice", "A", "2026-03-04"),
      row("nice", "A+", "2024-03-04"),
    ]);
    const r = resolveDisclosedRating(db, corp, REG, NOW_D);
    expect(r).toMatchObject({
      ok: true,
      rating: "A",
      rated_on: "2026-03-04",
      stale: false,
      instrument: "corporate_bond",
      source_kind: "business_report",
      source_rcept_no: "20260310000101",
      snapshot_id: snap.id,
      alternative: null,
    });
    if (r.ok)
      expect(r.agencies.map((a) => [a.agency, a.grade])).toEqual([
        ["nice", "A"],
        ["kis", "A+"],
      ]);
  });

  test("only the newest business report counts (an older report's better rating is not mixed in)", () => {
    const corp = "00777002";
    put(corp, "business_report", "20250310000201", "parsed", [row("kis", "AA-", "2025-03-05")]);
    put(corp, "business_report", "20260310000202", "parsed", [row("kis", "A", "2026-03-05")]);
    expect(resolveDisclosedRating(db, corp, REG, NOW_D)).toMatchObject({
      ok: true,
      rating: "A",
      source_rcept_no: "20260310000202",
    });
  });

  test("stale flag: a rating older than 18 months stays resolvable but stale", () => {
    const corp = "00777003";
    put(corp, "business_report", "20250310000301", "parsed", [row("kis", "BBB+", "2025-03-05")]);
    expect(resolveDisclosedRating(db, corp, REG, NOW_D)).toMatchObject({ ok: true, rating: "BBB+", stale: true });
  });

  test("bdRs supplements a report with no rating (not_disclosed): rating 'at issuance'", () => {
    const corp = "00777004";
    put(corp, "business_report", "20260310000401", "not_disclosed", []);
    const b = put(corp, "debt_securities_filing", "20260601000402", "parsed", [
      row("korea-ratings", "BBB", "2026-06-10", "bdrs"),
    ]);
    expect(resolveDisclosedRating(db, corp, REG, NOW_D)).toMatchObject({
      ok: true,
      rating: "BBB",
      source_kind: "debt_securities_filing",
      snapshot_id: b.id,
      alternative: null,
    });
  });

  test("both sources and they differ: the LOWER is used and the other is returned (both fresh)", () => {
    const corp = "00777005";
    put(corp, "business_report", "20260310000501", "parsed", [row("kis", "A", "2026-03-05")]);
    put(corp, "debt_securities_filing", "20260801000502", "parsed", [row("kis", "BBB+", "2026-08-10", "bdrs")]);
    const r = resolveDisclosedRating(db, corp, REG, NOW_D);
    expect(r).toMatchObject({ ok: true, rating: "BBB+", source_kind: "debt_securities_filing" });
    if (r.ok) expect(r.alternative).toMatchObject({ rating: "A", source_kind: "business_report", stale: false });
  });

  test("fresh evidence beats a stale one even when the stale one is lower", () => {
    const corp = "00777006";
    put(corp, "business_report", "20240310000601", "parsed", [row("kis", "BBB", "2024-03-05")]); // stale
    put(corp, "debt_securities_filing", "20260801000602", "parsed", [row("kis", "A-", "2026-08-10", "bdrs")]); // fresh
    const r = resolveDisclosedRating(db, corp, REG, NOW_D);
    expect(r).toMatchObject({ ok: true, rating: "A-", stale: false });
    if (r.ok) expect(r.alternative).toMatchObject({ rating: "BBB", stale: true });
  });

  const bureau = (agency: string | null, grade: string, rated_on: string, cashflow = "C+") => ({
    source: "section",
    agency,
    agency_raw: agency,
    instrument: "issuer_bureau",
    grade,
    grade_raw: grade,
    outlook: null,
    rated_on,
    rated_on_precision: "day",
    excluded_reason: null,
    raw: "",
    cashflow_grade_raw: cashflow,
    agency_carried: false,
  });

  test("bureau rung: no bond rating -> the latest bureau issuer rating (lowest on that date), basis 'bureau'", () => {
    const corp = "00777021";
    const snap = put(corp, "business_report", "20260310002101", "parsed", [
      bureau("nice-dnb", "BBB", "2025-12-31", "C+"),
      bureau("ecredible", "BB+", "2026-06-30", "B"),
      bureau("ked", "BBB-", "2026-06-30", "C"),
    ]);
    const r = resolveDisclosedRating(db, corp, REG, NOW_D);
    expect(r).toMatchObject({
      ok: true,
      basis: "bureau",
      instrument: "issuer_bureau",
      rating: "BB+",
      rated_on: "2026-06-30",
      stale: false,
      snapshot_id: snap.id,
      source_kind: "business_report",
      alternative: null,
    });
    if (r.ok && r.bureau) {
      expect(r.bureau).toMatchObject({ agency: "ecredible", cashflow_grade: "B", agency_carried: false });
      expect(r.bureau.rows.map((x) => x.grade)).toEqual(["BB+", "BBB-"]);
    }
  });

  test("ladder: a fresh bond rating wins; a fresh bureau beats a stale bond; two stale -> the bond rating; stale bureau alone is returned", () => {
    const fresh = "2026-06-30";
    const stale = "2024-06-30";
    const run = (corp: string, rows: unknown[]) => {
      put(corp, "business_report", `2026031000${corp.slice(-4)}`, "parsed", rows);
      return resolveDisclosedRating(db, corp, REG, NOW_D);
    };
    expect(run("00777031", [row("kis", "A", fresh), bureau("ked", "BB", fresh)])).toMatchObject({
      basis: "disclosed",
      rating: "A",
    });
    expect(run("00777032", [row("kis", "A", stale), bureau("ked", "BB", fresh)])).toMatchObject({
      basis: "bureau",
      rating: "BB",
      stale: false,
    });
    expect(run("00777033", [row("kis", "A", stale), bureau("ked", "BB", stale)])).toMatchObject({
      basis: "disclosed",
      rating: "A",
      stale: true,
    });
    expect(run("00777034", [bureau("ked", "BB", stale)])).toMatchObject({ basis: "bureau", rating: "BB", stale: true });
  });

  test("bureau rows never feed the bond selection, and a bdRs filing is never a bureau source", () => {
    const corp = "00777035";
    put(corp, "business_report", "20260310003501", "not_disclosed", []);
    put(corp, "debt_securities_filing", "20260601003502", "parsed", [bureau("ked", "BB", "2026-06-10")]);
    expect(resolveDisclosedRating(db, corp, REG, NOW_D)).toMatchObject({ ok: false });
  });

  test("recorded misses are reported by their status, never as 'unrated'", () => {
    const status = (
      corp: string,
      st: "not_disclosed" | "parse_failed" | "section_absent" | "section_present_no_bond_rating",
    ) => {
      put(corp, "business_report", `2026031000${corp.slice(-4)}`, st, []);
      return resolveDisclosedRating(db, corp, REG, NOW_D);
    };
    expect(status("00777011", "not_disclosed")).toEqual({ ok: false, status: "not_disclosed" });
    expect(status("00777012", "parse_failed")).toEqual({ ok: false, status: "parse_failed" });
    expect(status("00777013", "section_absent")).toEqual({ ok: false, status: "section_absent" });
    expect(status("00777014", "section_present_no_bond_rating")).toEqual({
      ok: false,
      status: "section_present_no_bond_rating",
    });
  });

  test("snapshots of another parser version are ignored (a new version re-collects)", () => {
    const corp = "00777020";
    repo.insertCreditRatingSnapshot(db, {
      corpCode: corp,
      sourceKind: "business_report",
      sourceRceptNo: "20260310002001",
      parserVersion: "old-parser",
      status: "parsed",
      ratings: [row("kis", "A", "2026-03-05")],
      issues: null,
      now: NOW,
    });
    expect(resolveDisclosedRating(db, corp, REG, NOW_D)).toEqual({ ok: false, status: "rating_not_collected" });
  });
});
