// POST /api/projects/{id}/target-costing/price-draft — web-search evidence
// drafts for the target-costing market price (design
// 2026-09-18-target-costing-price-anchor §3, ADR-0141 pattern). PROPOSALS
// ONLY: nothing is persisted here — the human confirms through the existing
// target-costing POST, which lands with their name on it.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { draftPriceEvidence } from "../../../../../../lib/price-evidence.ts";

/** Subject resolution — company name (md_project.company_id) first, then the
 *  source opportunity's name + market scope as the fallback subject. */
function resolveSubject(db: ReturnType<typeof getDb>, projectId: string): { subject: string; company: string | null } {
  const row = db
    .query(
      `SELECT mc.name_ko AS company_name, o.name AS opp_name, o.market_scope AS market_scope
       FROM md_project p
       LEFT JOIN md_company mc ON mc.id = p.company_id
       LEFT JOIN opportunity o ON o.id = p.source_opportunity_id
       WHERE p.id = ?`,
    )
    .get(projectId) as { company_name: string | null; opp_name: string | null; market_scope: string | null } | undefined;
  const company = row?.company_name?.trim() || null;
  const subject = row?.opp_name?.trim() || row?.market_scope?.trim() || "신규사업 제품";
  return { subject, company };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "가격 초안 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { subject?: unknown } | null;
  if (body?.subject !== undefined && typeof body.subject !== "string") {
    return badRequest("invalid_request", "subject는 문자열이어야 합니다.");
  }
  const custom = typeof body?.subject === "string" && body.subject.trim() ? body.subject.trim() : null;
  const { subject, company } = resolveSubject(getDb(), id);
  try {
    const draft = await draftPriceEvidence({ subject: custom ?? subject, company });
    return ok({ ...draft, subject: custom ?? subject }, 200);
  } catch (err) {
    return badRequest("price_draft_failed", err instanceof Error ? err.message : "가격 초안 생성에 실패했습니다.");
  }
}
