// GET /api/projects/[id]/dd — the S9 aggregate read surface (ADR-0099 §3):
// the three standard DD checklists with live project_checklist_item_state
// judgments, the custom (tailored) items with full provenance, the dd_finding
// list, and the mechanical S9 completion summary. Visibility is
// deny-by-default: getProjectIfVisible via visibleProject — non-members get
// 404 (existence itself is protected, FR-SEC-01); admins are excluded by
// role separation. Read-only — writes go through the tailor/review/state
// routes.
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { listDdWorkspace } from "../../../../../lib/dd-checklist-tailor.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const workspace = listDdWorkspace(id);
  return ok(workspace, 200, { domain_count: workspace.domains.length });
}
