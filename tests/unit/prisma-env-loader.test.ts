/**
 * tests/unit/prisma-env-loader.test.ts — the prisma.config.ts inline .env loader.
 *
 * Why this test does not import the config: `app/web-next/prisma.config.ts` is a
 * Prisma 7 config module — importing it pulls `prisma/config` and
 * `@prisma/adapter-better-sqlite3` into the unit run, executes its top-level
 * `await import("node:fs")` and reads env files from disk (the app-local
 * `app/web-next/.env` compatibility fallback, then the repo-root `.env` — the
 * unified SSOT since the design §10 amendment, 2026-11-19), then builds a
 * datasource with `process.env.DATABASE_URL!`. Its loader loop also runs only
 * when DATABASE_URL is unset, so any import that lets the module load cleanly
 * has already bypassed the code under test. The loop is therefore asserted two
 * ways, without adding a dependency:
 *
 *   1. `runLoader()` below is a faithful replica of the loop (same split on
 *      "\n", same regex, same no-override `parseEnvValue(m[2], m[1])`
 *      assignment, same DATABASE_URL guard, same app-then-root file order with
 *      silent absence), exercised against the value shapes and file
 *      combinations the loader now feeds the parser.
 *   2. A source assertion pins the replica to the real file: if
 *      prisma.config.ts's regex, assignment line or file-order lines change,
 *      this test fails and the replica must be updated with it.
 *
 * Design 2026-08-31-pipeline-execution-environment §2.5 routes prisma.config.ts
 * through the shared parser; §4 requires the behaviour be covered. The single
 * root env (§10 amendment, 2026-11-19) is what makes the root-file fallback a
 * loader responsibility.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvValue } from "../../scripts/lib/env-value.ts";

const CONFIG_PATH = join(import.meta.dir, "..", "..", "app", "web-next", "prisma.config.ts");

/**
 * Faithful replica of the loader in app/web-next/prisma.config.ts.
 * `null` text = the file does not exist on disk (the existsSync guard skips it
 * silently); app text is consulted before root text, both no-override.
 */
function runLoader(
  appText: string | null,
  rootText: string | null,
  base: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = { ...base };
  if (!env.DATABASE_URL) {
    for (const envText of [appText, rootText]) {
      if (envText === null) continue;
      for (const line of envText.split("\n")) {
        const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
        if (m && env[m[1]] === undefined) env[m[1]] = parseEnvValue(m[2], m[1]);
      }
    }
  }
  return env;
}

describe("prisma.config.ts env loader", () => {
  test("passes a bare sqlite URL through unchanged", () => {
    const env = runLoader("DATABASE_URL=file:/tmp/abs/path.db\n", null, {});
    expect(env.DATABASE_URL).toBe("file:/tmp/abs/path.db");
  });

  test("unwraps a quoted value", () => {
    const env = runLoader('DATABASE_URL="quoted value"\n', null, {});
    expect(env.DATABASE_URL).toBe("quoted value");
  });

  test("strips an inline comment (the behaviour change this design records)", () => {
    const env = runLoader("DATABASE_URL=file:/tmp/x.db  # local dev\n", null, {});
    expect(env.DATABASE_URL).toBe("file:/tmp/x.db");
  });

  test("does nothing when DATABASE_URL is already set", () => {
    const env = runLoader(
      "DATABASE_URL=file:/from/file.db\n",
      "DATABASE_URL=file:/from/root.db\n",
      { DATABASE_URL: "file:/from/env.db" },
    );
    expect(env.DATABASE_URL).toBe("file:/from/env.db");
  });

  test("the repo-root .env fills DATABASE_URL when the app copy is absent (unified layout)", () => {
    const env = runLoader(null, "DATABASE_URL=file:/root/co-newbiz.sqlite\n", {});
    expect(env.DATABASE_URL).toBe("file:/root/co-newbiz.sqlite");
  });

  test("the app-local compatibility copy keeps its historical precedence over the root file", () => {
    const env = runLoader("DATABASE_URL=file:/app/leftover.db\n", "DATABASE_URL=file:/root/x.db\n", {});
    expect(env.DATABASE_URL).toBe("file:/app/leftover.db");
  });

  test("root keys already set by the earlier load are not overridden (no-override in both loads)", () => {
    const env = runLoader(
      "DATABASE_URL=file:/app/x.db\nOTHER_KEY=from-app\n",
      "DATABASE_URL=file:/root/x.db\nOTHER_KEY=from-root\n",
      {},
    );
    expect(env.DATABASE_URL).toBe("file:/app/x.db");
    expect(env.OTHER_KEY).toBe("from-app");
  });

  test("both files absent is silent (DATABASE_URL may come from spawn env in CI)", () => {
    const env = runLoader(null, null, {});
    expect(env.DATABASE_URL).toBeUndefined();
  });

  test("the replica still matches the real loader (drift guard)", () => {
    const source = readFileSync(CONFIG_PATH, "utf-8");
    // The moving parts of the loop. If any of them change in
    // prisma.config.ts, this fails and the replica above must change with it.
    expect(source).toContain("if (!process.env.DATABASE_URL) {");
    expect(source).toContain('envText.split("\\n")');
    expect(source).toContain("/^([A-Z_0-9]+)=(.*)$/");
    expect(source).toContain(
      "if (m && process.env[m[1]] === undefined) process.env[m[1]] = parseEnvValue(m[2], m[1]);",
    );
    // The file order: app-local compatibility fallback first, then the repo-root SSOT.
    expect(source).toContain('loadEnvFile(new URL("./.env", import.meta.url));');
    expect(source).toContain('loadEnvFile(new URL("../../.env", import.meta.url));');
  });
});
