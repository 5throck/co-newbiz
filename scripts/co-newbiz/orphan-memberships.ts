// @version 1.0.0
/**
 * Read-only report: active project_member rows whose user no longer exists
 * (deleted before account-delete cleanup existed) or is disabled. Never fixes
 * anything - revoke deliberately with revokeProjectMembership.
 * Usage: bun scripts/co-newbiz/orphan-memberships.ts [--db-path <path>] [--json]
 */
import { getDb } from "../../db/client.ts";
import { listOrphanedMemberships } from "../../db/lib/accounts.ts";

const argv = process.argv.slice(2);
const i = argv.indexOf("--db-path");
const db = getDb(i >= 0 ? argv[i + 1] : undefined);
const rows = listOrphanedMemberships(db);
if (argv.includes("--json")) {
  console.log(JSON.stringify(rows, null, 2));
} else if (rows.length === 0) {
  console.log("No orphaned active memberships.");
} else {
  console.log(`${rows.length} orphaned active membership(s):`);
  for (const r of rows) console.log(`${r.reason}\t${r.user_id}\t${r.project_id}\t${r.project_role}${r.has_active_insider_entry ? "\t(insider)" : ""}`);
}
