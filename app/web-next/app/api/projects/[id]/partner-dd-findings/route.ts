// Port of app/server/market.ts GET/POST /api/projects/:id/partner-dd-findings
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const WORKSTREAMS = ["financial_distress", "ip_chain", "general"];
const SEVERITIES = ["red", "amber", "green"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb().query(
    `SELECT f.id, f.partner_id, p.name AS partner_name, f.workstream, f.severity, f.description, f.created_at
     FROM partner_dd_finding f JOIN partner_candidate p ON p.id = f.partner_id
     WHERE f.project_id = ? ORDER BY f.created_at DESC`,
  ).all(project.id);
  return ok(rows);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Partner DD finding writes require the analyst role.");
  const body = (await request.json().catch(() => null)) as
    | { partner_id?: string; workstream?: string; severity?: string; description?: string }
    | null;
  if (!body?.partner_id || !body?.workstream || !body?.severity?.trim() || !body?.description?.trim()) {
    return badRequest("invalid_request", "partner_id, workstream, severity and description are required.");
  }
  if (!WORKSTREAMS.includes(body.workstream)) return badRequest("invalid_workstream", `workstream must be one of ${WORKSTREAMS.join(", ")}.`);
  if (!SEVERITIES.includes(body.severity)) return badRequest("invalid_severity", `severity must be one of ${SEVERITIES.join(", ")}.`);
  const partnerExists = getDb().query("SELECT id FROM partner_candidate WHERE id = ? AND project_id = ?").get(body.partner_id, project.id);
  if (!partnerExists) return notFound("Unknown partner on this project.");
  const db = getDb();
  const rowId = ulid();
  db.run("INSERT INTO partner_dd_finding (id, project_id, partner_id, workstream, severity, description, created_at) VALUES (?,?,?,?,?,?,?)",
    [rowId, project.id, body.partner_id, body.workstream, body.severity, body.description.trim(), new Date().toISOString()]);
  appendAudit(db, { actor: ctx.userId, action: "partner_dd_finding_write", target: `${project.id}:${rowId}`, now: new Date().toISOString() });
  return ok({ id: rowId }, 201);
}
