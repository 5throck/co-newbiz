// GET/POST /api/projects/:id/analysis-tasks — the human-final-approval
// gate mechanism (design boundary #2, docs/process-map.md's Entity IC row:
// "analysis_task.reviewed_by NULL on any required deliverable" blocks the
// gate). Prior to this route, the analysis_task table existed
// (db/migrations/0011) and was already read by the kill-criteria engine
// (db/lib/snapshot-filler.ts), but nothing ever wrote a row into it, so the
// kill-criteria check passed vacuously (zero rows, not zero unreviewed
// items) — see docs/designs/2026-08-19-co-newbiz-design_ko.md §20.4.
//
// GET lazy-creates the required-deliverable tasks (ic_memo, rag_assessment)
// the first time a project reaches the entity_ic or group_ic gate, so a
// task always exists to be reviewed rather than requiring a separate
// out-of-band creation step that could be skipped.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const REQUIRED_DELIVERABLE_TYPES_AT_ENTITY_IC = ["ic_memo", "rag_assessment"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const db = getDb();

  const gateRow = db.query("SELECT current_stage_gate FROM md_project WHERE id = ?").get(project.id) as
    | { current_stage_gate: string | null }
    | null;
  if (gateRow?.current_stage_gate === "entity_ic" || gateRow?.current_stage_gate === "group_ic") {
    const existing = db
      .query("SELECT deliverable_type FROM analysis_task WHERE project_id = ?")
      .all(project.id) as { deliverable_type: string }[];
    const existingTypes = new Set(existing.map((r) => r.deliverable_type));
    const now = new Date().toISOString();
    for (const deliverableType of REQUIRED_DELIVERABLE_TYPES_AT_ENTITY_IC) {
      if (!existingTypes.has(deliverableType)) {
        db.run("INSERT INTO analysis_task (id, project_id, deliverable_type, reviewed_by, reviewed_at) VALUES (?,?,?,NULL,NULL)", [
          ulid(),
          project.id,
          deliverableType,
        ]);
        appendAudit(db, { actor: "system", action: "analysis_task_auto_created", target: `${project.id}:${deliverableType}`, now });
      }
    }
  }

  const rows = db
    .query("SELECT id, project_id, deliverable_type, reviewed_by, reviewed_at FROM analysis_task WHERE project_id = ? ORDER BY deliverable_type")
    .all(project.id);
  return ok(rows, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Analysis tasks are created by analysts.");
  const body = (await request.json().catch(() => null)) as { deliverable_type?: string } | null;
  if (!body?.deliverable_type?.trim()) return badRequest("invalid_request", "deliverable_type is required.");

  const db = getDb();
  const now = new Date().toISOString();
  const rowId = ulid();
  db.run("INSERT INTO analysis_task (id, project_id, deliverable_type, reviewed_by, reviewed_at) VALUES (?,?,?,NULL,NULL)", [
    rowId,
    project.id,
    body.deliverable_type.trim(),
  ]);
  appendAudit(db, { actor: ctx.userId, action: "analysis_task_create", target: `${project.id}:${body.deliverable_type.trim()}`, now });
  return ok({ id: rowId }, 201);
}
