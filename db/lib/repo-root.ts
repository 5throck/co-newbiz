// @version 1.0.0
/**
 * Repo-root resolution via the repo-layout marker `db/migrations`
 * (design 2026-11-10-db-lib-rebased-path-fix; mechanism established by
 * 2026-11-10-db-path-resolver-marker / PR #857): under the Next/Turbopack dev
 * shim `import.meta` identity is REBASED against the bundler's ABSOLUTE_ROOT
 * (observed `<repo>/app`), so a filesystem path computed from import.meta may
 * point at a directory that does not exist. The marker `db/migrations` exists
 * only in the canonical `<repo>/db` — never in the shadow dirs a rebased
 * computation can manufacture — so it is the only trustworthy repo-root
 * witness.
 *
 * Same-class follow-up to PR #857: db/client.ts (resolveDbPath) and
 * app/web-next/lib/dart-client.ts (resolveCorpCachePath) were marker-fixed
 * first; this module serves the remaining db/lib anchors (kill-criteria
 * registry dir, python engine script paths). It deliberately does NOT import
 * db/client.ts — same rationale as dart-client: keep the DB module (and its
 * bun:sqlite require) out of graphs that never opened a database. Only
 * node:path is imported so tests can inject a synthetic `exists`.
 */

import { dirname, join } from "node:path";

/**
 * Pure, injectable for tests: walk up from `start` until a directory
 * containing the `db/migrations` marker appears; return that directory (the
 * repo root) or null when no marker is found within 8 levels (filesystem
 * root reached). The 8-level bound and the marker mirror resolveDbPath.
 */
export function findRepoRootByMarker(opts: { start: string; exists: (p: string) => boolean }): string | null {
  let dir = opts.start;
  for (let i = 0; i < 8; i++) {
    if (opts.exists(join(dir, "db", "migrations"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Pure, injectable for tests: module-anchor → repo-root resolution.
 * 1. Walk up from `here` (the rebasable module directory) — on the normal Bun
 *    path `here` is `<repo>/db/lib`, so the first marker hit is the real root
 *    and the result is byte-identical to the legacy `here/../..` computation.
 *    A rebased `here` (`<repo>/app/db/lib`) also reaches the real root: the
 *    rebased root is a SUBDIRECTORY of the repo.
 * 2. Fall back to walking up from `cwd` (covers a bundler rooted outside the
 *    repo tree).
 * 3. No marker anywhere: null — callers keep their pre-existing failure
 *    behavior (kill-criteria throws fail-closed with the legacy expected
 *    path; engine spawns fail loudly exactly as today).
 */
export function resolveRepoRoot(opts: { cwd: string; here?: string; exists: (p: string) => boolean }): string | null {
  if (opts.here) {
    const fromHere = findRepoRootByMarker({ start: opts.here, exists: opts.exists });
    if (fromHere !== null) return fromHere;
  }
  return findRepoRootByMarker({ start: opts.cwd, exists: opts.exists });
}
