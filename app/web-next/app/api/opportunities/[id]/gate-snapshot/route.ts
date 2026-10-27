// GET /api/opportunities/:id/gate-snapshot?gate=<screening|pre_fs|target_screening>[&brief_id=] - ADR-0186 D1.
// Opportunity twin of the project snapshot: no RAG / validators / waivers (those are project-scoped). Kill
// outcomes are evaluated against an opportunity-scoped variable source and live ONLY in the snapshot (no
// kill_criteria_evaluation rows: the table is project-scoped, design 3.12); a predicate over a project-only
// variable is UNASSESSED and appears in `snapshot.required_acks`, never a silent pass. Read-only, cached.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { OPPORTUNITY_GATE_BRIEFS } from "../../../../../lib/gate-brief.ts";
import { previewGateSnapshot } from "../../../../../lib/gate-snapshot.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "The gate snapshot supports recording a decision and requires the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  const url = new URL(request.url);
  const gate = url.searchParams.get("gate")?.trim() ?? "";
  if (!(OPPORTUNITY_GATE_BRIEFS as readonly string[]).includes(gate)) {
    return badRequest("invalid_request", `gate must be one of: ${OPPORTUNITY_GATE_BRIEFS.join(" | ")}.`);
  }
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();
  const briefId = url.searchParams.get("brief_id")?.trim() || null;
  const built = previewGateSnapshot({ entityType: "opportunity", entityId: id, gate, actor: ctx.userId, briefId, db });
  return ok({ gate, snapshot_hash: built.hash, snapshot: built.snapshot, cached: built.cached, legacy: false });
});
