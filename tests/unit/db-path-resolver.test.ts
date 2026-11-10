// @version 1.0.0
/**
 * Unit tests for the DB/cache path resolvers (design 2026-11-10-db-path-resolver-marker).
 *
 * Defect: under the Next/Turbopack dev bundler, import.meta identity is rebased
 * against the bundler's ABSOLUTE_ROOT (observed <repo>/app), and db/client.ts
 * trusted that `here` unconditionally — one server boot created a second,
 * divergent EMPTY database at app/db/data/. dart-client.ts's cacheFile() then
 * keyed its cwd walk-up on `db/data` EXISTENCE, so the stray directory shadowed
 * the canonical cache location too.
 *
 * Fix under test: every resolver keys on the repo-layout marker `db/migrations`
 * (which only exists in the canonical <repo>/db), `here` is marker-validated,
 * and CO_NEWBIZ_DB_PATH still overrides. Both resolvers are pure helpers with
 * injected exists() so these tests build REAL decoy trees under the OS temp dir
 * without touching the repository layout. No database is opened here.
 */

import { test, expect, describe, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDbPath } from "../../db/client.ts";
import { resolveCorpCachePath } from "../../app/web-next/lib/dart-client.ts";

const TEMP_ROOT = mkdtempSync(join(tmpdir(), "db-path-resolver-test-"));
afterAll(() => rmSync(TEMP_ROOT, { recursive: true, force: true }));

/**
 * Fixture layout mirroring the incident, all under the OS temp dir:
 *
 *   <root>/repo/db/migrations/          <- the ONLY layout marker (canonical repo root)
 *   <root>/repo/db/data/                <- canonical data dir
 *   <root>/repo/app/db/data/            <- DECOY: stray dir the bundler rebasing created
 *   <root>/repo/app/web-next/           <- the dev server's cwd
 */
function makeIncidentTree(root: string): { repo: string; cwd: string; decoy: string } {
  const repo = join(root, "repo");
  const cwd = join(repo, "app", "web-next");
  const decoy = join(repo, "app", "db", "data");
  mkdirSync(join(repo, "db", "migrations"), { recursive: true });
  mkdirSync(join(repo, "db", "data"), { recursive: true });
  mkdirSync(decoy, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { repo, cwd, decoy };
}

describe("db/client.ts resolveDbPath (2026-11-10-db-path-resolver-marker)", () => {
  test("(a) decoy app/db/data must NOT shadow the canonical root — rebased `here` is rejected and the marker walk-up wins", () => {
    const { repo, cwd, decoy } = makeIncidentTree(join(TEMP_ROOT, "a"));
    // Precondition: the decoy exists, exactly as after the stray boot, and the
    // rebased `here` (<repo>/app/db) has no migrations marker.
    expect(existsSync(decoy)).toBe(true);
    expect(existsSync(join(repo, "app", "db", "migrations"))).toBe(false);
    const resolved = resolveDbPath({ cwd, here: join(repo, "app", "db"), exists: existsSync });
    expect(resolved).toBe(join(repo, "db", "data", "co-newbiz.sqlite"));
  });

  test("(b) `here` without a migrations marker is rejected — walk-up result is used", () => {
    const { repo, cwd } = makeIncidentTree(join(TEMP_ROOT, "b"));
    const bare = join(TEMP_ROOT, "b", "somewhere-else"); // no migrations/ inside
    mkdirSync(bare, { recursive: true });
    const resolved = resolveDbPath({ cwd, here: bare, exists: existsSync });
    expect(resolved).toBe(join(repo, "db", "data", "co-newbiz.sqlite"));
  });

  test("(c) CO_NEWBIZ_DB_PATH override still wins over everything", () => {
    const { repo, cwd } = makeIncidentTree(join(TEMP_ROOT, "c"));
    const override = join(TEMP_ROOT, "c", "custom", "my.sqlite");
    const resolved = resolveDbPath({ envPath: override, cwd, here: join(repo, "db"), exists: () => true });
    expect(resolved).toBe(override);
  });

  test("(d) normal Bun-native path unchanged — `here` = real repo db/ returns join(here, data, co-newbiz.sqlite)", () => {
    const { repo } = makeIncidentTree(join(TEMP_ROOT, "d"));
    const here = join(repo, "db");
    const resolved = resolveDbPath({ cwd: join(repo, "nowhere"), here, exists: existsSync });
    expect(resolved).toBe(join(here, "data", "co-newbiz.sqlite"));
  });

  test("(e) no marker anywhere falls back to cwd-relative", () => {
    const root = join(TEMP_ROOT, "e");
    const cwd = join(root, "lonely");
    mkdirSync(cwd, { recursive: true });
    const resolved = resolveDbPath({ cwd, exists: () => false });
    expect(resolved).toBe(join(cwd, "db", "data", "co-newbiz.sqlite"));
  });
});

describe("dart-client.ts resolveCorpCachePath (2026-11-10-db-path-resolver-marker)", () => {
  test("(a) decoy app/db/data must NOT be chosen — marker walk-up finds the canonical repo root", () => {
    const { repo, cwd, decoy } = makeIncidentTree(join(TEMP_ROOT, "dart-a"));
    expect(existsSync(decoy)).toBe(true);
    const resolved = resolveCorpCachePath({ cwd, exists: existsSync });
    expect(resolved).toBe(join(repo, "db", "data", "dart-corpcode-cache.json"));
  });

  test("(b) cwd adjacent to the repo root resolves the canonical cache (dev-server cwd shape)", () => {
    const { repo, cwd } = makeIncidentTree(join(TEMP_ROOT, "dart-b"));
    const resolved = resolveCorpCachePath({ cwd, exists: existsSync });
    expect(resolved).toBe(join(repo, "db", "data", "dart-corpcode-cache.json"));
  });

  test("(c) no marker anywhere falls back to cwd-relative", () => {
    const root = join(TEMP_ROOT, "dart-c");
    const cwd = join(root, "lonely");
    mkdirSync(cwd, { recursive: true });
    const resolved = resolveCorpCachePath({ cwd, exists: () => false });
    expect(resolved).toBe(join(cwd, "db", "data", "dart-corpcode-cache.json"));
  });
});
