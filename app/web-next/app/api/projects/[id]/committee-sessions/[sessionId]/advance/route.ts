// Advance a project-scoped committee session — the next deliberation round,
// or the chair synthesis (ADR-0196 Phase E). The synthesis writes a
// gate_evaluation PROPOSAL with verbatim dissent; it NEVER writes a
// gate_decision record (design boundary #2 — the confirm click is human).
import { committeeSessionForProject } from "../../../../../../../lib/committee-session.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { badRequest, fail, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { CommitteeError, advanceCommitteeSession } from "../../../../../../../lib/committee-session.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Committee facilitation requires the analyst role or higher.",
    });
    if (denied) return denied;
  }
  const { id, sessionId } = await params;
  const db = getDb();
  // Session binding (project + committee stage) + membership.
  if (!committeeSessionForProject(id, sessionId)) return notFound();
  if (!visibleProject(ctx, id, { includeClosed: true })) return notFound();
  try {
    // ADR-0196 §2.2 (decision 3): a hybrid/human_only convener may replace
    // the chair agenda before round 2 via the optional `agenda` body.
    const body = (await request.json().catch(() => ({}))) as { agenda?: unknown } | null;
    const result = await advanceCommitteeSession(sessionId, {
      actor: ctx.userId,
      agenda: body?.agenda,
      // Turn engine: a resumed meeting runs in the background (the proxy timeout rules out an inline run).
      background: true,
    });
    appendAudit(db, {
      actor: ctx.userId,
      action: `committee_session.${result.status}`,
      target: `${id}:${sessionId}`,
      now: new Date().toISOString(),
    });
    return ok(result, 200);
  } catch (err) {
    if (err instanceof CommitteeError) {
      if (err.code === "not_found") return notFound();
      // Turn engine: the human has not answered yet and the deadline has not passed.
      if (err.code === "awaiting_human") return fail(409, err.code, err.message);
      return badRequest(err.code, err.message);
    }
    return badRequest("advance_failed", err instanceof Error ? err.message : String(err));
  }
}
