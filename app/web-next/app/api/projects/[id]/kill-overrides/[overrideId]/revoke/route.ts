// POST /api/projects/:id/kill-overrides/:overrideId/revoke - revoke an active Group IC kill-criteria override
// (ADR-0186 D6). Cookie session only; group-ic-reviewer grant; the row is kept (revoked_at / revoked_by) and
// the revocation is audited kill_override.revoke. See lib/kill-override-http.ts.
import { revokeOverrideHandler } from "../../../../../../../lib/kill-override-http.ts";
import { route } from "../../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string; overrideId: string }> }) => {
  const p = await params;
  return revokeOverrideHandler(request, "project", p.id, p.overrideId);
});
