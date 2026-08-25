// Port of app/server/analysis.ts GET /api/runs/:id/diff/:otherId
import { getDb } from "../../../../../../../../db/client.ts";
import { diffRuns } from "../../../../../../../../db/lib/versioning.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; otherId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, otherId } = await params;
  const db = getDb();
  const runs = [id, otherId].map(
    (rid) => db.query("SELECT id, project_id FROM run WHERE id = ?").get(rid) as { id: string; project_id: string } | null,
  );
  if (!runs[0] || !visibleProject(auth.auth, runs[0].project_id)) return notFound();
  if (!runs[1] || !visibleProject(auth.auth, runs[1].project_id)) return notFound();
  if (runs[0].project_id !== runs[1].project_id) {
    return badRequest("invalid_request", "Cannot diff runs from different projects — a version chain lives within one project (ADR-0005).");
  }
  return ok(diffRuns(db, runs[0].id, runs[1].id));
}
