// POST /api/reviews/[id]/audit-sample — human-only audit sampling of an ai_2nd
// review row (ADR-0153 §4.6): agree/disagree plus an optional note. The KPI is
// the agreement rate over these samples; sampling is a prompt, not a quota.
// Boundary #1/#2: an agent id can never record a sample, and a sample never
// changes the reviewed row, any decision table, or the review itself.
import { authenticate } from "../../../../../lib/auth.ts";
import { AGENT_KEYS } from "../../../../../lib/agent-registry.generated.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { AuditSampleError, insertAuditSample } from "../../../../../../../db/repositories/review-audit.repository.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "검표(audit sample) 기록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { agreed?: boolean; note?: string } | null;
  if (typeof body?.agreed !== "boolean") {
    return badRequest("invalid_request", "agreed(true|false)는 필수입니다.");
  }
  try {
    const sampleId = insertAuditSample({
      reviewStageId: id,
      sampledBy: ctx.userId,
      agreed: body.agreed,
      note: body.note ?? null,
      agentIds: AGENT_KEYS,
    });
    return ok({ id: sampleId }, 201);
  } catch (e) {
    if (e instanceof AuditSampleError) {
      if (e.code === "not_found") return notFound();
      if (e.code === "agent_forbidden") return forbidden("agent_forbidden", e.message);
      return badRequest("invalid_request", e.message);
    }
    throw e;
  }
}
