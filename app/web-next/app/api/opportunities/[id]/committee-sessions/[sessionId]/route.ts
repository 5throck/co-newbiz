// Full committee-session transcript — per-round, per-member positions plus
// the chair synthesis proposal and the verbatim dissent (ADR-0097 §5).
// Read-only; the provenance surface a recorded decision links back to via
// gate_evaluation_id (0066).
import { authenticate } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { getCommitteeSession } from "../../../../../../lib/committee-session.ts";
import { route } from "../../../../../../lib/route.ts";

export const GET = route(
  async (request: Request, { params }: { params: Promise<{ id: string; sessionId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, sessionId } = await params;
  if (!getDb().query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  // Session binding: the session IS a process_run — it must address THIS path
  // opportunity, or the transcript is not addressable here (404, existence
  // protection).
  const run = getDb().query("SELECT entity_type, entity_id FROM process_run WHERE id = ?").get(sessionId) as
    | { entity_type: string; entity_id: string }
    | undefined;
  if (!run || run.entity_type !== "opportunity" || run.entity_id !== id) return notFound();
  const transcript = getCommitteeSession(sessionId);
  if (!transcript) return notFound();
  return ok(transcript, 200);
  },
);
