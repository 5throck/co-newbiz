// Port of app/server/deal-review.ts GET /api/projects/:id/antitrust
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
      `SELECT id, market_definition, hhi_before, hhi_after, combination_type, filing_jurisdictions,
              remedy_type, remedy_detail, discharge_confirmed_at, created_at
       FROM antitrust_finding WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(project.id);
  return ok(rows);
}
