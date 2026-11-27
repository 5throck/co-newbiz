// @version 1.0.0
/**
 * Hermetic root-env for tests that assert on an env switch being UNSET (e.g. CO_NEWBIZ_KOFIA_COLLECT).
 *
 * app/web-next/lib/root-env.ts lifts allowlisted keys from the repo-root `.env` into process.env the first time any
 * reader (kofiaCollectEnabled() and friends) runs and a key is unset, so a developer's local `.env` (for example
 * CO_NEWBIZ_KOFIA_COLLECT=on) leaks into a test that did `delete process.env.X`. This helper anchors the loader's walk at an
 * empty temp directory (no `.env` in it, and none above it in the temp tree), so "unset" stays unset. Call it BEFORE the
 * first reader runs; call the returned `restore` in afterAll (it hands the loader back to its default anchor and removes
 * the directory). The assertions stay as strict as before - only the ambient file is out of the picture.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function isolateRootEnv(): Promise<() => void> {
  const { resetRootEnvForTests } = await import("../../../app/web-next/lib/root-env.ts");
  const dir = mkdtempSync(join(tmpdir(), "co-newbiz-root-env-"));
  resetRootEnvForTests(dir);
  return () => {
    resetRootEnvForTests(null);
    rmSync(dir, { recursive: true, force: true });
  };
}
