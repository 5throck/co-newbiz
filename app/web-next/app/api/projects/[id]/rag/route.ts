// Port of app/server/governance.ts GET /api/projects/:id/rag
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
      "SELECT dimension, grade, triggered_rules, rationale, run_id, assessed_at FROM rag_assessment WHERE project_id = ? ORDER BY assessed_at DESC",
    )
    .all(project.id) as { dimension: string; grade: string; triggered_rules: string; rationale: string; run_id: string; assessed_at: string }[];
  const latestPerDimension = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestPerDimension.has(row.dimension)) latestPerDimension.set(row.dimension, row);
  }
  const dimensions = [...latestPerDimension.values()];
  return ok({ project_id: project.id, dimensions }, 200, {
    assessed_at: dimensions.length > 0 ? dimensions[0].assessed_at : null,
    count: dimensions.length,
  });
}
