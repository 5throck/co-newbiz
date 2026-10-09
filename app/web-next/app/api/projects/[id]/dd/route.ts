// GET /api/projects/[id]/dd — the S9 aggregate read surface (ADR-0099 §3):
// the three standard DD checklists with live project_checklist_item_state
// judgments, the custom (tailored) items with full provenance, the dd_finding
// list, and the mechanical S9 completion summary. Visibility is
// deny-by-default: getProjectIfVisible via visibleProject — non-members get
// 404 (existence itself is protected, FR-SEC-01); admins are excluded by
// role separation. Read-only — writes go through the tailor/review/state
// routes. ADR-0157: ?target_id= selects an opened comparison target (409 when
// DD was never opened there); the payload also carries targets[] summaries.
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { listDdWorkspace } from "../../../../../lib/dd-checklist-tailor.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { scopeOrResponse } from "../../../../../lib/dd-target-http.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  // ADR-0157: optional ?target_id= — omitted = the selected/legacy scope the gate judges.
  const scope = scopeOrResponse(id, new URL(request.url).searchParams.get("target_id"));
  if ("response" in scope) return scope.response;
  const workspace = listDdWorkspace(id, { targetId: scope.targetId });
  return ok(workspace, 200, { domain_count: workspace.domains.length });
}
