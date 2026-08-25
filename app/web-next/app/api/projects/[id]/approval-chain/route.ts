// Port of app/server/governance.ts GET /api/projects/:id/approval-chain
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
    .query(
      "SELECT level, gate, sequence, required_procedure_id, approver_role, entity_id, status, decision, decided_at, conditions, blocked_reason FROM approval_chain WHERE project_id = ? ORDER BY level, sequence",
    )
    .all(project.id);
  return ok(rows);
}
