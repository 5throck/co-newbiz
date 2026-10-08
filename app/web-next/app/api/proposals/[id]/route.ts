// GET /api/proposals/[id] — proposal status (the get_proposal_status tool).
// Read-only and bearer-friendly: it never issues the confirm nonce, which only
// the cookie-session confirm view does.
import { getProposal } from "../../../../../../db/repositories/decision-proposal.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { notFound, ok } from "../../../../lib/envelope.ts";
import { confirmUrl, proposalVisible } from "../../../../lib/proposals.ts";
import { route } from "../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  const p = getProposal(id);
  if (!p || !proposalVisible(auth.auth, p)) return notFound();
  return ok({ ...p, confirm_url: confirmUrl(request, p.id) });
});
