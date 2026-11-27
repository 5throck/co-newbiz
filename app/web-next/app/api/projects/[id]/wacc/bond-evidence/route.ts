// GET /api/projects/[id]/wacc/bond-evidence — the subject company's OUTSTANDING bonds (coupon, maturity, balance) and
// each large bond's latest price-implied yield from the data.go.kr FSC bond APIs (금융위원회_채권기본정보 getBondBasiInfo_V2,
// 금융위원회_채권시세정보 getBondPriceInfo_V2), as reference evidence next to the credit spread (ADR-0208 slice 4).
//
// CROSS-CHECK ONLY: the answer is never an applied value, never part of apply-all (GET .../wacc/suggestions does not
// include it), never stored and never audited as an input. It carries the 공공누리 source attribution (basic info type 2,
// price info type 4: no commercial use, no modification) in `evidence.attribution`. Issuer matching is by NAME
// (md_company has no corporate registration number): an ambiguous name (several crno) shows nothing.
//
// This is a user-triggered live lookup (the panel's button), not part of the suggestions GET, because it calls the portal
// (up to 1 + 5 calls); results are cached in process for 15 minutes. `?target_id=` looks up a shortlisted target's company
// (ADR-0156), like the suggestions route. Authorization: project visibility (membership, 404-not-403); read-only.
// Errors: 400 no_subject_company, 503 data_go_kr_api_key_missing. A portal problem (key not yet propagated after the
// 활용신청 approval, quota, expired approval) is NOT an HTTP error: 200 with evidence.status "unavailable" and a reason_code.
import { getDb } from "../../../../../../../../db/client.ts";
import { listProjectAnalysisTargets } from "../../../../../../../../db/lib/wacc.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { FscKeyMissingError, fetchBondEvidence } from "../../../../../../lib/fsc-bond-client.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const targetId = new URL(request.url).searchParams.get("target_id");
  let companyId =
    (db.query("SELECT company_id FROM md_project WHERE id = ?").get(id) as { company_id: string | null } | undefined)
      ?.company_id ?? null;
  if (targetId) {
    const t = listProjectAnalysisTargets(db, id).find((x) => x.targetId === targetId);
    if (!t?.companyId) {
      return badRequest("invalid_request", "target_id must be a shortlisted target (a company that can be analyzed).");
    }
    companyId = t.companyId;
  }
  const company = companyId
    ? (db.query("SELECT id, name_ko FROM md_company WHERE id = ?").get(companyId) as
        | { id: string; name_ko: string | null }
        | undefined)
    : undefined;
  if (!company?.name_ko) {
    return fail(400, "no_subject_company", "No subject company with a name is set, so its bonds cannot be looked up.");
  }
  try {
    const evidence = await fetchBondEvidence(company.name_ko);
    return ok({ project_id: id, company: { id: company.id, name_ko: company.name_ko }, evidence });
  } catch (err) {
    if (err instanceof FscKeyMissingError) {
      return fail(
        503,
        "data_go_kr_api_key_missing",
        "DATA_GO_KR_API_KEY is not configured on the server, so the bond cross-check cannot be looked up.",
      );
    }
    throw err;
  }
}
