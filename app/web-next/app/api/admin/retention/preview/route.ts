// Impact preview for a proposed retention policy: how many rows are older than
// N months. Count only — never row data. Admin role.
import { getDb } from "../../../../../../../db/client.ts";
import { retentionCutoff, validateRetentionPolicy } from "../../../../../../../db/lib/retention-registry.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const table = (q.get("table") ?? "").trim();
  const column = (q.get("column") ?? "").trim();
  const monthsRaw = q.get("months") ?? "";
  const months = Number(monthsRaw);
  if (!table || !column || monthsRaw === "" || !Number.isInteger(months) || months < 0) {
    return badRequest("invalid_request", "table, column and a non-negative integer months are required.");
  }
  const v = validateRetentionPolicy(table, column);
  if (!v.ok) return badRequest(v.code, v.message);
  const cutoff = retentionCutoff(months);
  const row = getDb()
    .query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} < ?`)
    .get(cutoff) as { n: number };
  return ok({ table, column, months, cutoff, affected_count: row.n });
}
