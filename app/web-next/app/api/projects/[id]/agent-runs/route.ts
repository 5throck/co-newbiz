import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET /api/projects/[id]/agent-runs — agent transparency (ADR-0123 #1):
// the deal's agent_run / activity_run history with the proposal/artifact
// distinction. Read-only — the pipeline never wrote decisions (boundary #2).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const runs = db.query(
    `SELECT r.id AS run_id, r.spec_version, r.stage, r.status, r.started_by, r.started_at,
            a.activity_id, a.status AS activity_status,
            (SELECT COUNT(*) FROM gate_evaluation e WHERE e.process_run_id = r.id) AS proposals
     FROM process_run r
     LEFT JOIN activity_run a ON a.process_run_id = r.id
     WHERE r.entity_type = 'project' AND r.entity_id = ?
     ORDER BY r.started_at DESC, a.id`,
  ).all(id) as Array<Record<string, unknown>>;
  const proposals = db.query(
    `SELECT e.id, e.process_run_id, e.gate, e.recommendation, e.score, r.started_at
     FROM gate_evaluation e JOIN process_run r ON r.id = e.process_run_id
     WHERE r.entity_type = 'project' AND r.entity_id = ?
     ORDER BY r.started_at DESC`,
  ).all(id);
  return ok({ runs, proposals }, 200, { runs: runs.length, proposals: proposals.length });
}
