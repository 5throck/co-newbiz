// @version 1.0.0
/**
 * CLI tests for scripts/co-newbiz/assume.ts (the `assume` case of
 * newbiz.ts) — the CLI face of the shared FR-DATA-07 write path
 * (db/lib/assumption.ts recordAssumption, also used by POST
 * /api/assumptions), following the model.test.ts pattern of importing the
 * command's business function directly rather than spawning the CLI.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";

const TEST_DB_PATH = "db/data/test-assume-cli.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createProject } = await import("../../db/repositories/project.repository.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { runAssume } = await import("../../scripts/co-newbiz/assume.ts");
const { AssumptionValidationError } = await import("../../db/lib/assumption.ts");

let runId: string;

beforeAll(() => {
  const project = createProject("NP-2026-902");
  runId = ulid();
  db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    runId,
    project.id,
    "assume CLI test",
    "ababab",
    "cli",
    new Date().toISOString(),
  ]);
});

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

test("assume writes an audited assumption row through the shared FR-DATA-07 path", () => {
  const row = runAssume(
    {
      runId,
      assumptionKey: "test.wacc",
      kind: "assumed",
      value: 0.08,
      asOf: "2026-08-21",
      rationale: "proxy-chain anchor",
      anchorRef: "docs/test.md#anchor",
      ttlDays: 90,
    },
    TEST_DB_PATH,
  );
  expect(row).toMatchObject({
    run_id: runId,
    assumption_key: "test.wacc",
    kind: "assumed",
    value: 0.08,
    rationale: "proxy-chain anchor",
    anchor_ref: "docs/test.md#anchor",
    as_of: "2026-08-21",
    ttl_days: 90,
  });
  expect(row.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID (db/lib/ulid.ts)

  const stored = db.query("SELECT * FROM assumption WHERE id = ?").get(row.id);
  expect(stored).toMatchObject({ assumption_key: "test.wacc", kind: "assumed" });

  // Audited as actor "cli" — same appendAudit the REST route uses.
  const audit = db
    .query("SELECT actor_user_id, action FROM audit_log WHERE action = 'assumption_set' AND target LIKE ?")
    .get(`%${row.assumption_key}%`);
  expect(audit).toMatchObject({ actor_user_id: "cli", action: "assumption_set" });
});

test("kind='assumed' without rationale is refused before the DB (FR-DATA-07)", () => {
  try {
    runAssume({ runId, assumptionKey: "test.churn", kind: "assumed", value: 0.12, asOf: "2026-08-21" }, TEST_DB_PATH);
    throw new Error("expected runAssume to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(AssumptionValidationError);
    expect((err as AssumptionValidationError).code).toBe("rationale_required");
    expect((err as Error).message).toMatch(/rationale/);
  }
  expect(db.query("SELECT COUNT(*) AS n FROM assumption WHERE assumption_key = 'test.churn'").get()).toMatchObject({ n: 0 });
});

test("invalid kind / non-finite value / missing as_of are refused as invalid_request", () => {
  const cases: Parameters<typeof runAssume>[0][] = [
    { runId, assumptionKey: "k", kind: "guessed", value: 1, asOf: "2026-08-21" },
    { runId, assumptionKey: "k", kind: "live", value: Number.NaN, asOf: "2026-08-21" },
    { runId, assumptionKey: "k", kind: "live", value: 1, asOf: "   " },
  ];
  for (const input of cases) {
    try {
      runAssume(input, TEST_DB_PATH);
      throw new Error("expected runAssume to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AssumptionValidationError);
      expect((err as AssumptionValidationError).code).toBe("invalid_request");
    }
  }
});

test("assume against an unknown run fails loudly, never silently", () => {
  expect(() =>
    runAssume({ runId: "no-such-run", assumptionKey: "k", kind: "live", value: 1, asOf: "2026-08-21" }, TEST_DB_PATH),
  ).toThrow(/not found/);
});
