// Port of app/server/governance.ts GET /api/projects/:id/compliance-checks
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query("SELECT gate, rule_key, layer, result, detected_at, resolved_at FROM compliance_check WHERE project_id = ? ORDER BY detected_at DESC")
    .all(project.id);
  return ok(rows);
}
