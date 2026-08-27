// Admin — governance document registry (read-only). Lists policy/procedure/
// guideline/checklist/template documents with their enforceability and
// supersession status.
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
      `SELECT id, layer, key, title, scope, version, enforceability, owner_agent,
              doc_path, effective_from, superseded_by, review_cycle_months
       FROM governance_doc ORDER BY layer, key`,
    )
    .all();
  return ok(rows, 200, { count: (rows as unknown[]).length });
}
