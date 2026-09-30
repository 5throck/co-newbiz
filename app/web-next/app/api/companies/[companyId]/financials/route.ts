// GET /api/companies/[companyId]/financials — the company financials screen
// payload (ADR-0116 Phase 1): latest-revision facts, the derived analysis
// (reusing ADR-0093's deterministic deriveFinancialAnalysis), the commentary
// layer, and the subject-company WACC reference card. Beta is absent until
// the KRX price source lands (Phase 8) — the response marks it explicitly
// rather than inventing a value.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { getCompanyFinancialFacts, factRowsToDartItems } from "../../../../../lib/dart-financial-facts.ts";
import { deriveFinancialAnalysis } from "../../../../../lib/company-financials.ts";
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

  // Subject-company WACC reference — only facts-derived entries; market
  // parameters arrive with the ECOS adapter (Phase 3) and beta with KRX
  // (Phase 8). Absent entries are explicit nulls with a reason.
  const byAccount = new Map(facts.rows.map((r) => [r.account_name, r]));
  const latestYear = analysis.years[analysis.years.length - 1] ?? null;
  const debt = byAccount.get("부채총계");
  const equity = byAccount.get("자본총계");
  const observedDe = debt && equity && equity.value !== 0 ? debt.value / equity.value : null;
  const waccReference = {
    subject: { id: facts.company.id, name_ko: facts.company.name_ko },
    entries: [
      { key: "risk_free", label: "무위험이자율 (Rf)", value: null, as_of: null, anchor_ref: null, reason: "ECOS 시세 원천 연결 예정" },
      { key: "credit_spread", label: "신용등급 가산금리", value: null, as_of: null, anchor_ref: null, reason: "ECOS 시세 원천 연결 예정" },
      {
        key: "observed_de",
        label: "관측 D/E",
        value: observedDe,
        as_of: debt?.created_at ?? null,
        anchor_ref: debt ? "src:dart" : null,
        reason: observedDe === null ? "부채총계/자본총계 fact 부족" : null,
      },
      { key: "beta_levered", label: "베타 (레버드)", value: null, as_of: null, anchor_ref: null, reason: "KRX 시세 원천 연결 예정" },
    ],
    latest_year: latestYear,
  };

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
