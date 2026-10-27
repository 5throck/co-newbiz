// GET /api/projects/:id/gate-decisions/:decisionId/snapshot - the STORED acknowledged-GO snapshot of one decision
// (ADR-0186 D1). `legacy: true` (snapshot null) marks a decision recorded before the contract: never rewritten.
// Same visibleProject check as the decision history; includes closed projects (history stays readable).
import { getDb } from "../../../../../../../../../db/client.ts";
import { getGateSnapshot } from "../../../../../../../../../db/repositories/gate-snapshot.repository.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../../lib/route.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string; decisionId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id, decisionId } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();
  const decision = db.query("SELECT id, gate, decision FROM gate_decision WHERE id = ? AND entity_type = 'project' AND entity_id = ?").get(decisionId, id) as { id: string; gate: string; decision: string } | null;
  if (!decision) return notFound();
  const snap = getGateSnapshot(decisionId, db);
  return ok({ decision_id: decision.id, gate: decision.gate, decision: decision.decision, legacy: snap === null, ...(snap ? { snapshot: snap.snapshot, snapshot_hash: snap.snapshot_hash, submitted_hash: snap.submitted_hash, acknowledgements: snap.acknowledgements, computed_at: snap.computed_at, schema_version: snap.schema_version } : { snapshot: null }) });
});
