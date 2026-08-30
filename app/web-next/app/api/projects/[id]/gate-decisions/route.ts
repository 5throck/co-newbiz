// Gate decision record — the audited GO/HOLD/KILL output of a gate
// evaluation (process-flow.md §4). HOLD must list missing artifacts; the
// process engine blocks re-evaluation until they exist.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const GATES = new Set(["screening", "pre_fs", "fs", "dd", "entity_ic", "group_ic"]);
const DECISIONS = new Set(["go", "hold", "kill"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query(
      "SELECT gate, decision, rationale, missing_artifacts_json, decided_by, decided_at FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? ORDER BY decided_at DESC",
    )
    .all(project.id);
  return ok(rows, 200, { count: (rows as unknown[]).length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Gate decisions are recorded by analysts.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as {
    gate?: string; decision?: string; rationale?: string; missing_artifacts?: string[];
  } | null;
  if (!body?.gate || !GATES.has(body.gate) || !body?.decision || !DECISIONS.has(body.decision) || !body?.rationale?.trim()) {
    return badRequest("invalid_request", "gate, decision (go|hold|kill) and rationale are required.");
  }
  if (body.decision === "hold" && (!body.missing_artifacts || body.missing_artifacts.length === 0)) {
    return badRequest("hold_requires_missing", "A HOLD decision must list the artifacts to supplement.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const gateId = ulid();
  db.run(
    "INSERT INTO gate_decision (id, entity_type, entity_id, gate, decision, rationale, missing_artifacts_json, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [gateId, "project", project.id, body.gate, body.decision, body.rationale.trim(),
      body.decision === "hold" ? JSON.stringify(body.missing_artifacts) : null, ctx.userId, now],
  );
  appendAudit(db, {
    actor: ctx.userId,
    action: "gate_decision",
    target: `${project.project_no}:${body.gate}=${body.decision}`,
    now,
  });
  return ok({ id: gateId, gate: body.gate, decision: body.decision }, 201);
}
