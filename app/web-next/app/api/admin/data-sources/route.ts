// Port of app/server/admin.ts GET /api/admin/data-sources
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const sources = getDb()
    .query("SELECT code, reliability_grade, created_at FROM md_source ORDER BY code")
    .all() as { code: string; reliability_grade: string; created_at: string }[];
  return ok(
    sources.map((s) => ({
      code: s.code,
      reliability_grade: s.reliability_grade,
      key_var: `CO_NEWBIZ_${s.code.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY`,
      key_present: process.env[`CO_NEWBIZ_${s.code.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY`] !== undefined,
    })),
  );
}
