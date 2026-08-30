// Single report snapshot content (markdown).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; snapId: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, snapId } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const row = getDb()
    .query("SELECT id, title, content_md, created_by, created_at FROM report_snapshot WHERE id = ? AND project_id = ?")
    .get(snapId, project.id) as
    | { id: string; title: string; content_md: string; created_by: string; created_at: string }
    | null;
  if (!row) return notFound();
  return ok(row, 200);
}
