// @version 1.1.0 (2026-11-10: added the db/lib anchor resolvers — repo-root.ts,
// kill-criteria.ts resolveRegistryDir — the PR #857 same-class follow-up,
// design 2026-11-10-db-lib-rebased-path-fix.)
/**
 * Unit tests for the DB/cache path resolvers (design 2026-11-10-db-path-resolver-marker)
 * and the db/lib module-anchor resolvers (design 2026-11-10-db-lib-rebased-path-fix).
 *
 * Defect: under the Next/Turbopack dev bundler, import.meta identity is rebased
 * against the bundler's ABSOLUTE_ROOT (observed <repo>/app), and db/client.ts
 * trusted that `here` unconditionally — one server boot created a second,
 * divergent EMPTY database at app/db/data/. dart-client.ts's cacheFile() then
 * keyed its cwd walk-up on `db/data` EXISTENCE, so the stray directory shadowed
 * the canonical cache location too. PR #857's survey left the SAME-CLASS db/lib
 * anchors (kill-criteria registry dir, python engine script paths) as a
 * follow-up — covered here now.
 *
 * Fix under test: every resolver keys on the repo-layout marker `db/migrations`
 * (which only exists in the canonical <repo>/db), `here` is marker-validated,
 * and CO_NEWBIZ_DB_PATH still overrides. All resolvers are pure helpers with
 * injected exists() so these tests build REAL decoy trees under the OS temp dir
 * without touching the repository layout. No database is opened here.
 */

import { test, expect, describe, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDbPath } from "../../db/client.ts";
import { resolveCorpCachePath } from "../../app/web-next/lib/dart-client.ts";
import { findRepoRootByMarker, resolveRepoRoot } from "../../db/lib/repo-root.ts";
import { resolveRegistryDir } from "../../db/lib/kill-criteria.ts";

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

// The db/lib anchors (kill-criteria registry dir, python engine scripts) share
// one resolution primitive — repo-root.ts (2026-11-10-db-lib-rebased-path-fix,
// the PR #857 same-class follow-up). A rebased module dir (<repo>/app/db/lib)
// must reach the REAL root by walking up, because the rebased bundler root is
// a SUBDIRECTORY of the repo.
describe("repo-root.ts resolveRepoRoot (2026-11-10-db-lib-rebased-path-fix)", () => {
  test("(a) rebased `here` (<repo>/app/db/lib, the Turbopack shim shape) resolves the real repo root", () => {
    const { repo } = makeIncidentTree(join(TEMP_ROOT, "root-a"));
    const rebasedHere = join(repo, "app", "db", "lib"); // ABSOLUTE_ROOT=<repo>/app + db/lib/<mod>
    mkdirSync(rebasedHere, { recursive: true });
    expect(resolveRepoRoot({ cwd: join(repo, "app", "web-next"), here: rebasedHere, exists: existsSync })).toBe(repo);
    expect(findRepoRootByMarker({ start: rebasedHere, exists: existsSync })).toBe(repo);
  });

  test("(b) normal Bun path is byte-identical to the legacy `here/../..` computation", () => {
    const { repo } = makeIncidentTree(join(TEMP_ROOT, "root-b"));
    const here = join(repo, "db", "lib");
    mkdirSync(here, { recursive: true });
    const root = resolveRepoRoot({ cwd: join(repo, "somewhere"), here, exists: existsSync });
    expect(root).toBe(repo);
    // The exact strings the three db/lib consumers derive on the normal path.
    expect(join(root as string, "procedures", "_kill-criteria")).toBe(join(repo, "procedures", "_kill-criteria"));
    expect(join(root as string, "python", "monte_carlo.py")).toBe(join(repo, "python", "monte_carlo.py"));
    expect(join(root as string, "python", "structure_sim.py")).toBe(join(repo, "python", "structure_sim.py"));
    expect(join(root as string, ".venv", "bin", "python3")).toBe(join(repo, ".venv", "bin", "python3"));
  });

  test("(c) `here` rebased OUTSIDE the repo tree falls back to the cwd walk-up", () => {
    const { repo, cwd } = makeIncidentTree(join(TEMP_ROOT, "root-c"));
    const foreign = join(TEMP_ROOT, "root-c", "dist", "db", "lib"); // no marker above
    mkdirSync(foreign, { recursive: true });
    expect(resolveRepoRoot({ cwd, here: foreign, exists: existsSync })).toBe(repo);
  });

  test("(d) no marker anywhere returns null — callers keep their pre-existing failure behavior", () => {
    const lonely = join(TEMP_ROOT, "root-d", "lonely");
    mkdirSync(lonely, { recursive: true });
    expect(resolveRepoRoot({ cwd: lonely, here: lonely, exists: () => false })).toBeNull();
  });
});

// Fail-closed contract of the kill-criteria registry resolution (ADR-0186,
// design Decision 8): only path RESOLUTION is marker-validated — when no
// marker can be found resolveRegistryDir returns the LEGACY join unchanged,
// so loadRegistryEntries's untouched readdirSync throw fires with exactly the
// same message and expected path as before the fix. The throw site itself is
// intentionally NOT re-tested here (it is unchanged code); the existing
// kill-criteria*.test.ts suites exercise the real registry through the new
// resolution on every run.
describe("kill-criteria.ts resolveRegistryDir (2026-11-10-db-lib-rebased-path-fix)", () => {
  test("(a) rebased `here` resolves the CANONICAL registry dir, not the rebased <repo>/app one", () => {
    const { repo } = makeIncidentTree(join(TEMP_ROOT, "kc-a"));
    const rebasedHere = join(repo, "app", "db", "lib");
    mkdirSync(rebasedHere, { recursive: true });
    const resolved = resolveRegistryDir({ cwd: join(repo, "app", "web-next"), here: rebasedHere, exists: existsSync });
    expect(resolved).toBe(join(repo, "procedures", "_kill-criteria"));
    expect(resolved).not.toBe(join(repo, "app", "procedures", "_kill-criteria"));
  });

  test("(b) normal Bun path is byte-identical to the legacy join(<here>/../..)", () => {
    const { repo } = makeIncidentTree(join(TEMP_ROOT, "kc-b"));
    const here = join(repo, "db", "lib");
    mkdirSync(here, { recursive: true });
    const resolved = resolveRegistryDir({ cwd: join(repo, "nowhere"), here, exists: existsSync });
    expect(resolved).toBe(join(here, "..", "..", "procedures", "_kill-criteria"));
  });

  test("(c) no marker anywhere → the LEGACY path is returned, preserving the fail-closed throw contract", () => {
    const lonely = join(TEMP_ROOT, "kc-c", "lonely");
    mkdirSync(lonely, { recursive: true });
    const resolved = resolveRegistryDir({ cwd: lonely, here: lonely, exists: () => false });
    // Exactly what the pre-fix computation produced, so the untouched throw
    // (`registry directory unreadable — expected ${REGISTRY_DIR}`) reports the
    // same path it always did when the registry is genuinely absent.
    expect(resolved).toBe(join(lonely, "..", "..", "procedures", "_kill-criteria"));
  });
});
