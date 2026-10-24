// POST /api/projects/[id]/dd/targets — open DD on a shortlisted, NON-selected
// brownfield target as comparison evidence (ADR-0157, design
// 2026-10-09-optional-per-target-dd). The selected target stays the only gate
// subject; an opened target gets its own judgements, custom items, findings
// and waivers, and nothing recorded there can move the S9 predicate or the dd
// gate. Opening is the cost-control point and a HUMAN act (boundary #2): the
// route accepts a logged-in human web session only — bearer tokens (personal,
// agent or MCP-delegated) and agent identities are refused; an agent may only
// propose it (propose_approval). A rationale is required, the target must be
// shortlisted on the source opportunity, the call is idempotent on
// (project, target) and writes an audit entry on first open.
import { AGENT_KEYS } from "../../../../../../lib/agent-registry.generated.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { DdTargetError, openDdTarget } from "../../../../../../lib/dd-target.ts";
import { ddTargetErrorResponse } from "../../../../../../lib/dd-target-http.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie") {
    return forbidden("session_required", "Target DD can be opened only from a logged-in human web session — agents/tokens may only propose via propose_approval.");
  }
  if (AGENT_KEYS.has(ctx.userId)) {
    return forbidden("agent_forbidden", "Agent identities cannot open target DD (boundaries #1/#2).");
  }
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Opening per-target DD requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { target_id?: string; rationale?: string } | null;
  if (!body?.target_id?.trim()) return badRequest("invalid_request", "target_id is required.");
  if (!body.rationale?.trim()) return badRequest("invalid_request", "The rationale for opening DD is required.");
  try {
    const record = openDdTarget(id, body.target_id.trim(), body.rationale, ctx.userId);
    return ok(
      {
        id: record.id,
        project_id: record.projectId,
        target_id: record.targetId,
        opened_by: record.openedBy,
        opened_at: record.openedAt,
        rationale: record.rationale,
        source: record.source,
        already_open: !record.created,
      },
      record.created ? 201 : 200,
    );
  } catch (err) {
    if (err instanceof DdTargetError) return ddTargetErrorResponse(err);
    throw err;
  }
});
