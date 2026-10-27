// GET/POST /api/opportunities/:id/kill-overrides - Group IC override of a binding (halt) kill criterion
// (ADR-0186 D1/D6, owner decision O-7). GET lists the active overrides (?include_revoked=1 adds revoked ones).
// POST { procedure_key, criterion_id, reason } issues one: cookie session only, group-ic-reviewer grant
// (403 human_role_required), halt criteria only (422 override_not_applicable), one active override per
// criterion (409 override_exists). The issuer cannot use their own override to record the GO it unblocks.
// Audited kill_override.issue. See lib/kill-override-http.ts.
import { issueOverrideHandler, listOverridesHandler } from "../../../../../lib/kill-override-http.ts";
import { route } from "../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => listOverridesHandler(request, "opportunity", (await params).id));
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => issueOverrideHandler(request, "opportunity", (await params).id));
