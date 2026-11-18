/**
 * Windows compatibility guard for the test suite (bunfig [test] preload).
 *
 * Root cause (session log 2026-11-18): on Windows, a bun:sqlite prepared
 * statement that was never finalized keeps the database file locked even
 * after `db.close()`. Tests that delete their temp dir right after closing
 * the connection then fail with `EBUSY: resource busy or locked` — on POSIX
 * unlink-on-open is allowed, which is why macOS and Linux CI never saw this.
 *
 * Fix: after every `Database.close()`, collect garbage so every prepared
 * statement that is no longer referenced gets finalized, releasing the file
 * lock. Patching `fs.rmSync` instead was probed and does NOT work — bun's
 * ESM named imports do not see CJS-side module patches. Hooking the sqlite
 * class is the propagation-safe point.
 *
 * win32 only; POSIX platforms run the stock close (zero overhead in CI).
 */
import { Database } from "bun:sqlite";

if (process.platform === "win32") {
  const origClose = Database.prototype.close;
  (Database.prototype as unknown as { close: () => unknown }).close = function (this: Database) {
    const result = origClose.apply(this);
    Bun.gc(true); // finalize unreferenced prepared statements (Windows file lock)
    return result;
  };
}

export {};
