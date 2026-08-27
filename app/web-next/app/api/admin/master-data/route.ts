// Admin — master data staging_unmapped queue (read-only). Surfaces raw values
// that failed to match an existing master-data code so they can be resolved
// or explicitly rejected, rather than accumulating silently.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const rows = getDb()
    .query(
      "SELECT id, raw_value, attempted_master_table, first_seen_at FROM staging_unmapped ORDER BY first_seen_at DESC, attempted_master_table",
    )
    .all();
  return ok(rows, 200, { count: (rows as unknown[]).length });
}
