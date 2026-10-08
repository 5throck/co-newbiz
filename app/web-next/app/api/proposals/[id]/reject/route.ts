// POST /api/proposals/[id]/reject — the human declines a decision proposal.
// Session cookie only (same rule as confirm); writes decision_proposal and an
// audit entry, never a decision row.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { getProposal, markRejected } from "../../../../../../../db/repositories/decision-proposal.repository.ts";
import { AGENT_KEYS } from "../../../../../lib/agent-registry.generated.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { proposalVisible } from "../../../../../lib/proposals.ts";
import { route } from "../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie") return forbidden("session_required", "A proposal can be rejected only from a logged-in human web session.");
  if (AGENT_KEYS.has(ctx.userId)) return forbidden("agent_forbidden", "An agent identity cannot act on a decision proposal.");
  { const denied = requireBusinessActor(ctx, "write"); if (denied) return denied; }
  const { id } = await params;
  const p = getProposal(id);
  if (!p || !proposalVisible(ctx, p)) return notFound();
  if (p.status !== "pending") return fail(409, `proposal_${p.status}`, `This proposal is already ${p.status}.`);
  markRejected(p.id);
  appendAudit(getDb(), { actor: ctx.userId, action: "decision_proposal.reject", target: `${p.kind}:${p.id}`, now: new Date().toISOString() });
  return ok({ proposal_id: p.id, status: "rejected" });
});
