// GET/POST /api/projects/[id]/value-chain-links — the judged-link surface
// (ADR-0116 Phase 5). GET lists the project's value_chain_link rows; POST
// creates one (analyst+, validated payload, audit-logged). Statistical
// numbers (β/R² from regressions) belong to proxy_link via calibrate — this
// endpoint never writes them as input.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { createValueChainLink, listLinks } from "../../../../../../../db/repositories/value-chain-link.repository.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const links = listLinks(getDb(), id);
  return ok({ links }, 200, { count: links.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "가치사슬 링크 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();

  const body = (await request.json().catch(() => null)) as {
    from_industry_id?: string;
    to_industry_id?: string;
    direction?: string;
    elasticity?: number | null;
    lag_months?: number | null;
    correlation?: number | null;
    r2?: number | null;
    pass_through_rate?: number | null;
    pass_through_lag_months?: number | null;
    concentration_hhi?: number | null;
    switching_cost_grade?: string | null;
    substitution_threat?: string | null;
    evidence_ref?: string | null;
  } | null;

  if (!body?.from_industry_id?.trim() || !body?.to_industry_id?.trim()) {
    return badRequest("industries_required", "from_industry_id와 to_industry_id는 필수입니다.");
  }
  if (body.direction !== "upstream" && body.direction !== "downstream") {
    return badRequest("invalid_direction", "direction은 upstream 또는 downstream이어야 합니다.");
  }

  try {
    const link = createValueChainLink(getDb(), {
      project_id: id,
      from_industry_id: body.from_industry_id.trim(),
      to_industry_id: body.to_industry_id.trim(),
      direction: body.direction,
      elasticity: body.elasticity ?? null,
      lag_months: body.lag_months ?? null,
      correlation: body.correlation ?? null,
      r2: body.r2 ?? null,
      pass_through_rate: body.pass_through_rate ?? null,
      pass_through_lag_months: body.pass_through_lag_months ?? null,
      concentration_hhi: body.concentration_hhi ?? null,
      switching_cost_grade: body.switching_cost_grade ?? null,
      substitution_threat: body.substitution_threat ?? null,
      evidence_ref: body.evidence_ref ?? null,
      assessed_by: auth.auth.userId,
    });
    return ok({ link }, 201, { link_id: link.id });
  } catch (err) {
    return badRequest("link_rejected", err instanceof Error ? err.message : "링크 등록에 실패했습니다.");
  }
}
