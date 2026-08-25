// Port of app/server/projects.ts GET /api/projects/:id
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { notFound, ok } from "../../../../lib/envelope.ts";
import { visibleProject } from "../../../../lib/project-visibility.ts";

function classificationOf(projectId: string) {
  return getDb()
    .query("SELECT sensitivity, mnpi_flag, wall_group, classified_by, classified_at FROM project_classification WHERE project_id = ?")
    .get(projectId) as { sensitivity: string; mnpi_flag: number; wall_group: string | null; classified_by: string | null; classified_at: string | null } | null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const classification = classificationOf(project.id);
  return ok(project, 200, {
    mnpi_banner: classification?.mnpi_flag === 1,
    sensitivity: classification?.sensitivity ?? null,
    wall_group: classification?.wall_group ?? null,
  });
}
