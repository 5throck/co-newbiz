// Full project-scoped committee-session transcript (ADR-0196 Phase E) —
// per-round, per-member positions plus the chair synthesis proposal and the
// verbatim dissent. Read-only; the provenance surface the IC package links.
import { committeeSessionForProject } from "../../../../../../lib/committee-session.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { getCommitteeSession } from "../../../../../../lib/committee-session.ts";

export const GET = route(
  async (request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    {
      const denied = requireBusinessActor(auth.auth, "read");
      if (denied) return denied;
    }
    const { id, sessionId } = await params;
    // Session binding (project + committee stage). Membership is gated by
    // visibleProject — non-members get 404 (FR-SEC-01).
    if (!committeeSessionForProject(id, sessionId)) return notFound();
    if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
    // Turn engine (ADR-0204 §4.7): `afterSeq` returns only turns newer than the cursor.
  const afterRaw = new URL(request.url).searchParams.get("afterSeq");
  if (afterRaw !== null && !/^\d+$/.test(afterRaw)) {
    return badRequest("invalid_request", "afterSeq must be a non-negative integer.");
  }
  const transcript = getCommitteeSession(sessionId, { afterSeq: afterRaw === null ? undefined : Number(afterRaw) });
    if (!transcript) return notFound();
    return ok(transcript, 200);
  },
);
