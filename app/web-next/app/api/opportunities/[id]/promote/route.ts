// 기회 → 프로젝트 승격 (ADR-0095). Promotion is a bookkeeping transition, not a
// gate — it creates the S8+ execution carrier and decides nothing; the
// fs/dd/entity_ic/group_ic gates stay human-authority (ADR-0053). Preconditions
// are FACT checks (greenfield S5 artifacts / brownfield S7 Short List), enforced
// inside promoteOpportunity; this route only maps the typed results to the
// envelope. Analyst+ role: a promotion is a funnel-state write, not a read.
import { getDb } from "../../../../../../../db/client.ts";
import { promoteOpportunity, PromotionError } from "../../../../../../../db/repositories/project.repository.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "프로젝트 승격은 analyst 역할 이상이어야 합니다.");

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    needToKnowBasis?: string;
    origin?: string;
  } | null;
  const basis = body?.needToKnowBasis?.trim();
  if (!basis) return badRequest("invalid_request", "needToKnowBasis는 필수입니다 — 승격자의 멤버십 근거가 기록되지 않으면 승격할 수 없습니다.");
  const origin = body?.origin;
  if (origin && !["internal", "external", "hybrid", "joint"].includes(origin)) {
    return badRequest("invalid_request", "origin은 internal | external | hybrid | joint 중 하나입니다 (ADR-0013).");
  }

  const db = getDb();
  const opp = db.query("SELECT id FROM opportunity WHERE id = ?").get(id) as { id: string } | undefined;
  if (!opp) return notFound();

  try {
    const result = promoteOpportunity(id, {
      promotedBy: ctx.userId,
      needToKnowBasis: basis,
      origin: origin as "internal" | "external" | "hybrid" | "joint" | undefined,
    });
    return ok(
      {
        project_id: result.project.id,
        project_no: result.project.project_no,
        track: result.project.track,
        source_opportunity_id: result.opportunityId,
        promoted_at: result.promotedAt,
      },
      200,
    );
  } catch (err) {
    if (err instanceof PromotionError) {
      if (err.code === "not_found") return notFound();
      return badRequest(err.code, err.message);
    }
    return badRequest("promotion_failed", err instanceof Error ? err.message : "승격에 실패했습니다.");
  }
}
