// Opportunity closure (ADR-0152): the typed replacement for the bare
// status='dropped' PUT.
//   GET  /api/opportunities/[id]/close — per-type precondition status
//        (read-only; agents may call it).
//   POST /api/opportunities/[id]/close — {closureType, basisId?, closureReason,
//        learningCapture?}; closed_by is the session user. 409 names the
//        missing record.
import { getDb } from "../../../../../../../db/client.ts";
import { ClosureError, closeEntity, getClosurePreconditions } from "../../../../../../../db/repositories/closure.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { AGENT_IDS, closureErrorResponse, parseCloseBody } from "../../../../../lib/closure-http.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  if (!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  return ok(getClosurePreconditions("opportunity", id, { agentIds: AGENT_IDS }));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Opportunity closure requires the analyst role." }); if (denied) return denied; }
  const { id } = await params;
  const parsed = parseCloseBody(await request.json().catch(() => null), "opportunity");
  if ("response" in parsed) return parsed.response;
  try {
    const record = closeEntity({
      entityType: "opportunity",
      entityId: id,
      closureType: parsed.body.closureType,
      basisId: parsed.body.basisId,
      closureReason: parsed.body.closureReason,
      learningCapture: parsed.body.learningCapture,
      closedBy: auth.auth.userId,
      agentIds: AGENT_IDS,
    });
    return ok({ closure: record }, 200, { closure_type: record.closure_type });
  } catch (err) {
    if (err instanceof ClosureError) return closureErrorResponse(err);
    throw err;
  }
}
