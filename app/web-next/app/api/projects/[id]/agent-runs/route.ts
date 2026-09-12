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
  // LLM reliability score (ADR-0123 #2): per gate, does the human's next
  // recorded decision on the SAME gate match the committee's recommendation?
  // Display-only learning signal — never gates anything.
  const reliability: Array<Record<string, unknown>> = [];
  const byGate = new Map<string, { total: number; accepted: number }>();
  for (const p of proposals) {
    const decision = db.query(
      `SELECT decision FROM gate_decision
       WHERE entity_type = 'project' AND entity_id = ? AND gate = ? AND decided_at >= ?
       ORDER BY decided_at ASC LIMIT 1`,
    ).get(id, p.gate, p.started_at) as { decision: string } | undefined;
    if (!decision) continue;
    const rec = byGate.get(p.gate) ?? { total: 0, accepted: 0 };
    rec.total += 1;
    if (decision.decision === p.recommendation) rec.accepted += 1;
    byGate.set(p.gate, rec);
  }
  for (const [gate, rec] of byGate) {
    reliability.push({
      gate, total: rec.total, accepted: rec.accepted,
      agreement_pct: Math.round((rec.accepted / rec.total) * 100),
    });
  }
  return ok({ runs, proposals, reliability }, 200, { runs: runs.length, proposals: proposals.length });
}
