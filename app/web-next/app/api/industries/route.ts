// GET /api/industries?q= — md_industry list + search for the binding UI
// (ADR-0116 Phase 5). Read-only.
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const rows = getDb()
    .query(
      `SELECT id, ksic_code, name_ko, name_en FROM md_industry
       WHERE (? = '' OR name_ko LIKE '%' || ? || '%' OR name_en LIKE '%' || ? || '%')
       ORDER BY name_ko LIMIT 50`,
    )
    .all(q, q, q);
  return ok({ industries: rows }, 200, { count: (rows as unknown[]).length });
}
