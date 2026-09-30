// POST /api/companies/[companyId]/sync — pull 5 business years of DART
// financials into fact_financial (ADR-0116 Phase 1). analyst+ only; fails
// closed with actionable guidance when DART_API_KEY is missing (503) or the
// corp code / retrieval fails (409). Every mutation is audit-logged.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { fail, notFound, ok } from "../../../../../lib/envelope.ts";
import { DartSyncError, syncCompanyFinancialFacts } from "../../../../../lib/dart-financial-facts.ts";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "DART 동기화는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { companyId } = await params;
  const db = getDb();
  const company = db.query("SELECT id FROM md_company WHERE id = ?").get(companyId) as { id: string } | undefined;
  if (!company) return notFound();
  try {
    const result = await syncCompanyFinancialFacts(db, companyId);
    appendAudit(db, {
      actor: auth.auth.userId,
      action: "company_financial_sync",
      target: companyId,
      now: new Date().toISOString(),
    });
    return ok({ sync: result }, 200, { inserted: result.inserted, unchanged: result.unchanged });
  } catch (err) {
    if (err instanceof DartSyncError) {
      if (err.code === "dart_not_configured") {
        return fail(503, err.code, `${err.message} (루트 .env: DART_API_KEY=...)`);
      }
      return fail(409, err.code, err.message);
    }
    throw err;
  }
}
