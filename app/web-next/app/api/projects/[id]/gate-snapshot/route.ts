// GET /api/projects/:id/gate-snapshot?gate=<fs|dd|entity_ic|group_ic>[&brief_id=] - ADR-0186 D1, design 3.1.
// The server-side recomputation a recorder reviews before a gate decision: kill-criteria outcomes, the latest
// stored RAG with its data-confidence cap, six-validator completeness, WACC state, open non-waivable items,
// waivers, the ladder and the AI recommendation, plus the canonical `snapshot_hash` the decision POST must echo
// and the exact acknowledgement keys (`snapshot.required_acks`) a GO needs. Read-only for the caller: the
// evaluation runs in a transaction that is rolled back (the brief and the decision persist their own ledgers),
// and the result is cached per (project, gate, user, brief, input version).
// Same visibleProject / information-wall check as the decision route; analyst role or higher (it exists to
// support recording). The snapshot never contains data the caller could not already read on the project.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { PROJECT_GATE_BRIEFS } from "../../../../../lib/gate-brief.ts";
import { previewGateSnapshot } from "../../../../../lib/gate-snapshot.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "The gate snapshot supports recording a decision and requires the analyst role or higher.");
  const { id } = await params;
  const url = new URL(request.url);
  const gate = url.searchParams.get("gate")?.trim() ?? "";
  if (!(PROJECT_GATE_BRIEFS as readonly string[]).includes(gate)) {
    return badRequest("invalid_request", `gate must be one of: ${PROJECT_GATE_BRIEFS.join(" | ")}.`);
  }
  if (!visibleProject(ctx, id)) return notFound();
  const briefId = url.searchParams.get("brief_id")?.trim() || null;
  const built = previewGateSnapshot({ entityType: "project", entityId: id, gate, actor: ctx.userId, briefId, db: getDb() });
  return ok({ gate, snapshot_hash: built.hash, snapshot: built.snapshot, cached: built.cached, legacy: false });
});
