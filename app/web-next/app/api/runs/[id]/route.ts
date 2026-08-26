// Port of app/server/analysis.ts GET /api/runs/:id
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { notFound, ok } from "../../../../lib/envelope.ts";
import { visibleProject } from "../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id: runId } = await params;
  const run = getDb()
    .query("SELECT id, project_id, label, input_hash, created_by, created_at, superseded_by FROM run WHERE id = ?")
    .get(runId) as { id: string; project_id: string; label: string | null; input_hash: string; created_by: string; created_at: string; superseded_by: string | null } | null;
  if (!run || !visibleProject(auth.auth, run.project_id)) return notFound();
  const inputs = getDb()
    .query("SELECT assumption_key, value FROM run_input WHERE run_id = ? ORDER BY assumption_key")
    .all(runId) as { assumption_key: string; value: number }[];
  return ok({ run, inputs }, 200, { input_count: inputs.length });
}
