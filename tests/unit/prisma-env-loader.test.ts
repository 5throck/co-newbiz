/**
 * tests/unit/prisma-env-loader.test.ts — the prisma.config.ts inline .env loader.
 *
 * Why this test does not import the config: `app/web-next/prisma.config.ts` is a
 * Prisma 7 config module — importing it pulls `prisma/config` and
 * `@prisma/adapter-better-sqlite3` into the unit run, executes its top-level
 * `await import("node:fs")` and reads `app/web-next/.env` from disk, then builds
 * a datasource with `process.env.DATABASE_URL!`. Its loader loop also runs only
 * when DATABASE_URL is unset, so any import that lets the module load cleanly
 * has already bypassed the code under test. The loop is therefore asserted two
 * ways, without adding a dependency:
 *
 *   1. `runLoader()` below is a faithful replica of the loop (same split on
 *      "\n", same regex, same `parseEnvValue(m[2], m[1])` assignment, same
 *      guard), exercised against the two value shapes the loader now feeds the
 *      parser.
 *   2. A source assertion pins the replica to the real file: if
 *      prisma.config.ts's regex or assignment line changes, this test fails and
 *      the replica must be updated with it.
 *
 * Design 2026-08-31-pipeline-execution-environment §2.5 routes prisma.config.ts
 * through the shared parser; §4 requires the behaviour be covered.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvValue } from "../../scripts/lib/env-value.ts";

const CONFIG_PATH = join(import.meta.dir, "..", "..", "app", "web-next", "prisma.config.ts");

/** Faithful replica of the loader in app/web-next/prisma.config.ts. */
function runLoader(envText: string, base: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...base };
  if (!env.DATABASE_URL) {
    for (const line of envText.split("\n")) {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m) env[m[1]] = parseEnvValue(m[2], m[1]);
    }
  }
  return env;
}

describe("prisma.config.ts env loader", () => {
  test("passes a bare sqlite URL through unchanged", () => {
    const env = runLoader("DATABASE_URL=file:/tmp/abs/path.db\n", {});
    expect(env.DATABASE_URL).toBe("file:/tmp/abs/path.db");
  });

  test("unwraps a quoted value", () => {
    const env = runLoader('DATABASE_URL="quoted value"\n', {});
    expect(env.DATABASE_URL).toBe("quoted value");
  });

  test("strips an inline comment (the behaviour change this design records)", () => {
    const env = runLoader("DATABASE_URL=file:/tmp/x.db  # local dev\n", {});
    expect(env.DATABASE_URL).toBe("file:/tmp/x.db");
  });

  test("does nothing when DATABASE_URL is already set", () => {
    const env = runLoader("DATABASE_URL=file:/from/file.db\n", { DATABASE_URL: "file:/from/env.db" });
    expect(env.DATABASE_URL).toBe("file:/from/env.db");
  });

  test("the replica still matches the real loader (drift guard)", () => {
    const source = readFileSync(CONFIG_PATH, "utf-8");
    // The four moving parts of the loop. If any of them changes in
    // prisma.config.ts, this fails and the replica above must change with it.
    expect(source).toContain("if (!process.env.DATABASE_URL) {");
    expect(source).toContain('envText.split("\\n")');
    expect(source).toContain("/^([A-Z_0-9]+)=(.*)$/");
    expect(source).toContain("if (m) process.env[m[1]] = parseEnvValue(m[2], m[1]);");
  });
});
