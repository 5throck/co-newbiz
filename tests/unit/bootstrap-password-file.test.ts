// @version 1.0.0
/**
 * Bootstrap admin password file — E3 (design
 * 2026-11-11-owner-decisions-intake-batch §5.1 + §5.3 test 1).
 *
 * The one-time credential is written ONCE to a 0600 file (writeFileSync mode
 * applies only at creation, so the explicit chmod guarantees 0600 even over a
 * stale wider-permission file), directories are created recursively, the
 * default path derives from the resolved DB file (env override honored), and
 * the banner carries the password exactly once with no log artifacts.
 */
import { test, expect, describe, afterAll } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const lib = await import("../../app/web-next/lib/bootstrap-password-file.ts");

const DIRS: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cnb-bootstrap-pw-"));
  DIRS.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of DIRS) if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});
const modeOf = (p: string) => statSync(p).mode & 0o777;

describe("writeBootstrapPasswordFile", () => {
  test("writes 0600 and the banner carries the password exactly once", () => {
    const dir = tempDir();
    const file = join(dir, "bootstrap-admin-password.txt");
    const returned = lib.writeBootstrapPasswordFile(file, {
      userId: "admin",
      password: "S3cret-Value!",
      now: "2026-11-11T00:00:00.000Z",
    });
    expect(returned).toBe(file);
    expect(modeOf(file)).toBe(0o600);
    const content = readFileSync(file, "utf8");
    expect(content).toContain("S3cret-Value!");
    expect(content.split("S3cret-Value!")).toHaveLength(2); // exactly once
    expect(content).toContain("user id: admin");
    expect(content).toContain("2026-11-11T00:00:00.000Z");
    expect(content).toContain("first login"); // change-it guidance, not a log artifact
  });

  test("overwriting a pre-existing wider-permission file re-chmods to 0600", () => {
    const dir = tempDir();
    const file = join(dir, "bootstrap-admin-password.txt");
    writeFileSync(file, "stale\n", { mode: 0o644 });
    chmodSync(file, 0o644);
    expect(modeOf(file)).toBe(0o644);
    lib.writeBootstrapPasswordFile(file, {
      userId: "admin",
      password: "New-Pw-Value",
      now: "2026-11-11T01:00:00.000Z",
    });
    expect(modeOf(file)).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("New-Pw-Value");
  });

  test("creates a missing directory recursively (mkdir -p)", () => {
    const dir = tempDir();
    const file = join(dir, "deep", "nested", "bootstrap-admin-password.txt");
    lib.writeBootstrapPasswordFile(file, {
      userId: "admin",
      password: "Deep-Pw-1234",
      now: "2026-11-11T02:00:00.000Z",
    });
    expect(modeOf(file)).toBe(0o600);
  });
});

describe("bootstrapPasswordFilePath", () => {
  const ENV = lib.BOOTSTRAP_PASSWORD_FILE_ENV;
  const saved = process.env[ENV];

  test("env override wins over the DB-dir default", () => {
    process.env[ENV] = "/tmp/override-path.txt";
    try {
      expect(lib.bootstrapPasswordFilePath("/repo/db/data/app.sqlite")).toBe("/tmp/override-path.txt");
    } finally {
      restore();
    }
  });

  test("default derives from the resolved DB file's directory", () => {
    restore();
    expect(lib.bootstrapPasswordFilePath("/repo/db/data/app.sqlite")).toBe(
      "/repo/db/data/bootstrap-admin-password.txt",
    );
  });

  test("an in-memory DB falls back to cwd/db/data (dev layout)", () => {
    restore();
    const fallback = lib.bootstrapPasswordFilePath("");
    expect(fallback.endsWith(join("db", "data", "bootstrap-admin-password.txt"))).toBe(true);
  });

  function restore() {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  }
});
