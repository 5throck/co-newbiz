// Full committee-session transcript — per-round, per-member positions plus
// the chair synthesis proposal and the verbatim dissent (ADR-0097 §5).
// Read-only; the provenance surface a recorded decision links back to via
// gate_evaluation_id (0066).
import { committeeSessionForOpportunity } from "../../../../../../lib/committee-session.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { getCommitteeSession } from "../../../../../../lib/committee-session.ts";
import { route } from "../../../../../../lib/route.ts";

export const GET = route(
  async (request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id, sessionId } = await params;
  // Session binding (opportunity + committee stage + promoted-project visibility).
  if (!committeeSessionForOpportunity(id, sessionId, (pid) => !!visibleProject(auth.auth, pid, { includeClosed: true }))) return notFound();
  const transcript = getCommitteeSession(sessionId);
  if (!transcript) return notFound();
  return ok(transcript, 200);
  },
);
