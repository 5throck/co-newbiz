// @version 1.0.0
/**
 * Import benchmark_case rows with mandatory provenance (ADR-0187 D2, migration
 * 0181). Same contract as import-base-rates.ts: source, verified_on,
 * maintainer and evidence_kind on every row, all-or-nothing, person-attributed.
 * deal_size_krw_m is INTEGER KRW millions (ADR-0061). Format:
 * docs/architecture/base-rate-import-format.md.
 *
 * Usage: bun scripts/co-newbiz/import-benchmark-cases.ts --file <rows.json> --actor <app_user id> [--dry-run] [--db-path <path>]
 */
import { readFileSync } from "node:fs";
import { getDb } from "../../db/client.ts";
import { importBenchmarkCases } from "../../db/lib/base-rate.ts";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const file = flag(args, "--file");
  const actor = flag(args, "--actor")?.trim();
  if (!file || !actor) {
    console.error("usage: --file <rows.json> --actor <app_user id> [--dry-run] [--db-path <path>]");
    process.exit(1);
  }
  let rows: unknown;
  try {
    rows = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    console.error(`cannot read ${file}: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!Array.isArray(rows)) {
    console.error("the file must hold a JSON array of rows");
    process.exit(1);
  }
  const dbPath = flag(args, "--db-path");
  const db = dbPath ? getDb(dbPath) : getDb();
  // Person-attributed (boundary 1): the actor must be a real user account.
  if (!db.query("SELECT user_id FROM app_user WHERE user_id = ?").get(actor)) {
    console.error(`--actor ${actor} is not an app_user id`);
    process.exit(1);
  }
  const report = importBenchmarkCases(db, rows, { actor, dryRun: args.includes("--dry-run") });
  console.log(JSON.stringify({ table: "benchmark_case", ...report }, null, 2));
  if (report.rejected.length) process.exit(2);
}
