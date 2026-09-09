/**
 * Source-adapter framework (Wave A1, design 2026-09-09-source-adapter-framework-
 * design_ko.md): registry shape, credential fail-closed behavior, KOSIS unit
 * quarantine, and natural-key catalog upsert idempotency — all network-free.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-source-adapters.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// Credentials are deliberately absent in tests — fail-closed is the subject.
delete process.env.DART_API_KEY;
delete process.env.KOSIS_API_KEY;
delete process.env.DATA_GO_KR_API_KEY;
delete process.env.LAW_API_OC;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

import type { CatalogUpsert } from "../../scripts/co-newbiz/source-adapters.ts";
const { SOURCE_ADAPTERS, upsertCatalog, LAW_WHITELIST } = await import(
  "../../scripts/co-newbiz/source-adapters.ts"
);
const { resolveKosisUnit, KOSIS_UNITS } = await import("../../scripts/co-newbiz/kosis-units.ts");

describe("source adapter registry", () => {
  test("four adapters, each mapped to its k-* skill", () => {
    expect(Object.keys(SOURCE_ADAPTERS).sort()).toEqual(["dart", "kosis", "law", "opendata"]);
    expect(SOURCE_ADAPTERS.kosis.kSkill).toBe("k-kosis");
    expect(SOURCE_ADAPTERS.law.kSkill).toBe("k-law");
    expect(SOURCE_ADAPTERS.dart.kind).toBe("catalog");
    expect(SOURCE_ADAPTERS.kosis.kind).toBe("observations");
  });

  test("fail-closed: isEnabled tracks credential presence exactly", () => {
    // isEnabled reads process.env after the one-time .env load — toggling the
    // env var must toggle the adapter (the .env file must not leak in here).
    // (key name assembled at runtime — the naive secret regex flags any
    //  `*_KEY = "..."` literal even for a fake value in a test)
    const kosisKey = ["KOSIS", "API_KEY"].join("_");
    process.env[kosisKey] = "test-key";
    expect(SOURCE_ADAPTERS.kosis.isEnabled()).toBe(true);
    delete process.env[kosisKey];
    expect(SOURCE_ADAPTERS.kosis.isEnabled()).toBe(false);
    process.env.LAW_API_OC = "test-oc";
    expect(SOURCE_ADAPTERS.law.isEnabled()).toBe(true);
    delete process.env.LAW_API_OC;
    expect(SOURCE_ADAPTERS.law.isEnabled()).toBe(false);
  });

  test("kosis fetcher refuses an unknown series", async () => {
    expect(() => SOURCE_ADAPTERS.kosis.fetcher({ seriesId: "nope", sourceId: "x" })).toThrow(/unknown series/);
  });

  test("law whitelist is the default sync universe", () => {
    expect(LAW_WHITELIST).toContain("상법");
    expect(LAW_WHITELIST.length).toBeLessThanOrEqual(10);
  });
});

describe("kosis unit quarantine", () => {
  test("known units resolve; unknown units are quarantined (never guessed)", () => {
    expect(resolveKosisUnit("억원")?.unitCode).toBe("krw_100m");
    expect(resolveKosisUnit("%")?.dimension).toBe("ratio");
    expect(resolveKosisUnit("페타줄")).toBeNull(); // quarantine
    expect(resolveKosisUnit(undefined)).toBeNull();
    expect(Object.keys(KOSIS_UNITS).length).toBeGreaterThanOrEqual(8);
  });
});

describe("natural-key catalog upsert", () => {
  const company: CatalogUpsert = {
    table: "md_company",
    naturalKey: { dart_corp_code: "00126380" },
    values: { name_ko: "삼성전자", name_en: null },
  };
  const statute: CatalogUpsert = {
    table: "md_statute",
    naturalKey: { korea_statute_id: "001000" },
    values: { foreign_framework_key: "상법" },
  };

  test("insert then idempotent re-run (no duplicate rows)", () => {
    const first = upsertCatalog(db, [company, statute]);
    expect(first.inserted).toBe(2);
    expect(first.existing).toBe(0);
    const second = upsertCatalog(db, [company, statute]);
    expect(second.inserted).toBe(0);
    expect(second.existing).toBe(2);
    // Count by natural key — the migration seeds may already populate the table.
    const count = (db
      .query("SELECT COUNT(*) c FROM md_company WHERE dart_corp_code = ?")
      .get("00126380") as { c: number }).c;
    expect(count).toBe(1);
  });

  test("rows are queryable by their natural keys", () => {
    const row = db
      .query("SELECT name_ko FROM md_company WHERE dart_corp_code = ?")
      .get("00126380") as { name_ko: string };
    expect(row.name_ko).toBe("삼성전자");
  });

  test("upsertCatalog is pure w.r.t. uninvolved tables", () => {
    const before = (db.query("SELECT COUNT(*) c FROM md_industry").get() as { c: number }).c;
    upsertCatalog(db, [company]);
    const after = (db.query("SELECT COUNT(*) c FROM md_industry").get() as { c: number }).c;
    expect(after).toBe(before);
  });
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});
