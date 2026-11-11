// Bootstrap admin password file (E3, design 2026-11-11-owner-decisions-intake-batch
// §5.1 / DEC-20261111-03 ruling 3). The first-boot initial-admin password is
// written ONCE to a 0600 file instead of being printed to the container log —
// the plaintext log line was removed, not masked (a masked credential still
// transits the docker log pipeline; the file takes the secret out of it).
//
// Fail-closed ordering lives in instrumentation.ts: the file is written
// BEFORE createUser, so a write failure aborts bootstrap and the fresh DB
// self-heals on the next boot (listUsers is still 0).
//
// Path resolution: CO_NEWBIZ_BOOTSTRAP_PASSWORD_FILE overrides; the default
// is the directory of the resolved DB file + bootstrap-admin-password.txt —
// the DB dir is gitignored (.gitignore app/web-next/db/data/**) and ships
// inside the docker volume (co-newbiz-data), so dev, prod volume, and
// CO_NEWBIZ_DB_PATH test layouts are all correct without a second knob.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BOOTSTRAP_PASSWORD_FILE_ENV = "CO_NEWBIZ_BOOTSTRAP_PASSWORD_FILE";
export const BOOTSTRAP_PASSWORD_FILE_NAME = "bootstrap-admin-password.txt";

/** The file path this boot writes the initial-admin password to. */
export function bootstrapPasswordFilePath(dbFilePath: string): string {
  const override = process.env[BOOTSTRAP_PASSWORD_FILE_ENV];
  if (override && override.trim() !== "") return override;
  // An in-memory DB ("") has no directory — fall back to cwd/db/data so the
  // write target is still a plausible repo-local location (dev only).
  const baseDir = dbFilePath && dbFilePath !== "" ? dirname(dbFilePath) : join(process.cwd(), "db", "data");
  return join(baseDir, BOOTSTRAP_PASSWORD_FILE_NAME);
}

/**
 * Write the one-time password file. `writeFileSync`'s `mode` applies only at
 * CREATION, so the explicit `chmodSync` guarantees 0600 even when a stale,
 * wider-permission file from a previous boot exists.
 */
export function writeBootstrapPasswordFile(
  filePath: string,
  opts: { userId: string; password: string; now: string },
): string {
  mkdirSync(dirname(filePath), { recursive: true });
  const banner = [
    "# Co-newbiz first-boot initial admin password — written once, 0600.",
    `# Created: ${opts.now}`,
    `user id: ${opts.userId}`,
    `password: ${opts.password}`,
    "# Change this password at first login (the account is flagged must_change_password).",
    "# Delete this file after the first login (runbook: docs/runbooks/deployment.md).",
    "",
  ].join("\n");
  writeFileSync(filePath, banner, { mode: 0o600 });
  chmodSync(filePath, 0o600);
  return filePath;
}
