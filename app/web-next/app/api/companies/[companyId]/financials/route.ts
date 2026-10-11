// GET /api/companies/[companyId]/financials — the company financials screen
// payload (ADR-0116 Phase 1): latest-revision facts, the derived analysis
// (reusing ADR-0093's deterministic deriveFinancialAnalysis), the commentary
// layer, and the subject-company WACC reference card (computeWaccReference via
// toCompanyWaccReferencePayload). Beta is an explicit N/A placeholder until
// KRX data-use approval.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { getCompanyFinancialFacts, factRowsToDartItems } from "../../../../../lib/dart-financial-facts.ts";
import { deriveFinancialAnalysis } from "../../../../../lib/company-financials.ts";
import { computeWaccReference } from "../../../../../../../db/lib/wacc-reference.ts";
import { toCompanyWaccReferencePayload } from "../../../../../lib/company-wacc-reference.ts";
import { buildFinancialCommentary } from "../../../../../lib/financial-commentary.ts";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { companyId } = await params;
  const db = getDb();
  let facts;
  try {
    facts = getCompanyFinancialFacts(db, companyId);
  } catch {
    return notFound();
  }
  const analysis = deriveFinancialAnalysis({
    corpCode: facts.company.dart_corp_code ?? "",
    found: facts.rows.length > 0,
    items: factRowsToDartItems(facts.rows),
    yearly: [],
  } as Parameters<typeof deriveFinancialAnalysis>[0]);
  const commentary = buildFinancialCommentary(analysis, "target");

  // Subject-company WACC reference — single source: computeWaccReference
  // (ECOS Rf/spread, DART D/E); beta stays a placeholder until KRX approval.
  const latestYear = analysis.years[analysis.years.length - 1] ?? null;
  let ref: ReturnType<typeof computeWaccReference> | null = null;
  try {
    ref = computeWaccReference(db, companyId);
  } catch {
    ref = null;
  }
  const waccReference = toCompanyWaccReferencePayload(ref, {
    subject: { id: facts.company.id, name_ko: facts.company.name_ko },
    latestYear,
  });

  return ok(
    {
      company: facts.company,
      latest_sync_at: facts.latest_sync_at,
      financials: facts.rows,
      analysis,
      commentary,
      wacc_reference: waccReference,
    },
    200,
    { financial_count: facts.rows.length },
  );
}
