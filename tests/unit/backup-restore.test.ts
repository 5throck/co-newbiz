// @version 1.0.0
/**
 * Wave 5.9 backup/restore tests — docs/adr/0014, docs/adr/0015.
 *
 * Encodes the real rollback rehearsal and recovery drill performed
 * manually first (verify-then-encode): a genuine WAL-replay bug was found
 * during that rehearsal (leftover -wal/-shm sidecar files at the restore
 * target replayed post-backup writes back onto the "restored" file) and
 * fixed in restore.ts before these assertions were written.
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { runBackup } from "../../scripts/co-newbiz/backup.ts";
import { runRestore } from "../../scripts/co-newbiz/restore.ts";

const TEST_DB_PATH = "db/data/test-backup-restore.sqlite";
const BACKUP_DIR = "db/data/test-backup-restore-backups";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
if (existsSync(BACKUP_DIR)) rmSync(BACKUP_DIR, { recursive: true });

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      if (existsSync(BACKUP_DIR)) rmSync(BACKUP_DIR, { recursive: true });
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

describe("backup", () => {
  // Migration 0184 seeds reference rows into md_source; the assertions count only the rows added here.
  const seededSources = () => (db.query("SELECT COUNT(*) AS n FROM md_source WHERE id LIKE 'seed_src_%'").get() as { n: number }).n;

  test("writes a self-contained copy plus a row-count manifest", () => {
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES ('t1','TEST','A',datetime('now'))");
    const result = runBackup(TEST_DB_PATH, BACKUP_DIR);
    expect(existsSync(result.backupFile)).toBe(true);
    expect(existsSync(result.manifestFile)).toBe(true);
    expect(result.tableRowCounts.md_source).toBe(seededSources() + 1);
  });

  test("checkpoints the WAL so the backup captures pre-checkpoint writes", () => {
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES ('t2','TEST2','B',datetime('now'))");
    const result = runBackup(TEST_DB_PATH, BACKUP_DIR);
    expect(result.tableRowCounts.md_source).toBe(seededSources() + 2);
  });
});

describe("restore — the real rollback/recovery-drill scenario", () => {
  test("restoring an older backup actually reverts later writes (not silently replayed back via leftover WAL)", () => {
    // Snapshot at 2 rows (from the describe-block-order-independent state above).
    const preState = runBackup(TEST_DB_PATH, BACKUP_DIR);
    const rowsBefore = preState.tableRowCounts.md_source;

    // Simulate a further write after the snapshot — the state restore must undo.
    db.run("INSERT INTO md_source (id, code, reliability_grade, created_at) VALUES ('t3','POST-BACKUP','C',datetime('now'))");
    const postWriteCount = (db.query("SELECT COUNT(*) AS n FROM md_source").get() as { n: number }).n;
    expect(postWriteCount).toBe(rowsBefore + 1);

    const result = runRestore(preState.backupFile, TEST_DB_PATH);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);

    const restoredDb = getDb(TEST_DB_PATH);
    const restoredCount = (restoredDb.query("SELECT COUNT(*) AS n FROM md_source").get() as { n: number }).n;
    expect(restoredCount).toBe(rowsBefore);
    const stillPresent = restoredDb.query("SELECT id FROM md_source WHERE id = 't3'").get();
    expect(stillPresent).toBeNull();
  });

  test("restore fails loudly on a genuine row-count mismatch rather than reporting silent success", () => {
    const snapshot = runBackup(TEST_DB_PATH, BACKUP_DIR);
    // Tamper with the manifest to assert a count that can never match, to
    // exercise the mismatch-detection path itself without depending on
    // fragile timing between backup and a real divergent write.
    const parsed = JSON.parse(readFileSync(snapshot.manifestFile, "utf-8"));
    parsed.tableRowCounts.md_source = 999999;
    writeFileSync(snapshot.manifestFile, JSON.stringify(parsed));

    const result = runRestore(snapshot.backupFile, TEST_DB_PATH);
    expect(result.ok).toBe(false);
    expect(result.mismatches.some((m) => m.table === "md_source" && m.expected === 999999)).toBe(true);
  });

  test("throws when the backup file is missing", () => {
    expect(() => runRestore("db/data/does-not-exist.bak", TEST_DB_PATH)).toThrow(/not found/);
  });

  test("throws when the manifest is missing (never restores unverifiable)", () => {
    const result = runBackup(TEST_DB_PATH, BACKUP_DIR);
    rmSync(result.manifestFile);
    expect(() => runRestore(result.backupFile, TEST_DB_PATH)).toThrow(/manifest/);
  });
});
