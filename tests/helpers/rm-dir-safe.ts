/**
 * Windows-safe temp-dir cleanup for tests.
 *
 * On Windows a bun:sqlite prepared statement that was never finalized keeps
 * the DB file locked even after `db.close()`. A test that deletes its temp
 * dir right after closing therefore hits `EBUSY: resource busy or locked`
 * — on POSIX unlink-on-open is allowed, which is why this never surfaced on
 * the macOS operator machine or Linux CI. `Bun.gc(true)` finalizes every
 * statement that is no longer referenced; statements still referenced from
 * module scope cannot be collected, so the last resort is to warn and leave
 * the directory for OS temp cleanup — deleting a temp dir must never be what
 * fails a test.
 *
 * Usage (replacing a bare `rmSync(dir, { recursive: true, force: true })`):
 *   rmDirSafe(dir);
 */
import { rmSync } from "node:fs";

const RETRIES = 3;
const BACKOFF_MS = 100;

export function rmDirSafe(dir: string): void {
  if (typeof dir !== "string" || dir.length === 0) return;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === RETRIES) {
        console.error(`rm-dir-safe: gave up deleting ${dir} after ${RETRIES + 1} attempts (${(err as Error).message}) — left for OS temp cleanup`);
        return;
      }
      if (typeof Bun !== "undefined") Bun.gc(true); // finalize unreferenced sqlite statements (Windows file lock)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BACKOFF_MS * (attempt + 1));
    }
  }
}
