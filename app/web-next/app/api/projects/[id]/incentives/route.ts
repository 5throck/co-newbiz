// Port of app/server/deal-review.ts GET /api/projects/:id/incentives
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts"
import { handleCreate, handleUpdate, handleDelete } from "../../../../../lib/crud-handlers.ts";
import type { EntitySpec } from "../../../../../lib/entity-crud.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query(
      `SELECT id, site_id, direction, type, grantor, program_name, amount, npv_value, currency_id,
              granted_on, application_deadline, construction_deadline, obligation_json, clawback_rule,
              estimated_clawback, negotiability, status, evidence_ref
       FROM incentive WHERE project_id = ? ORDER BY direction, status, id`,
    )
    .all(project.id) as { direction: string }[];
  const byDirection: Record<string, number> = {};
  for (const row of rows) byDirection[row.direction] = (byDirection[row.direction] ?? 0) + 1;
  return ok(rows, 200, byDirection);
}

const SPEC: EntitySpec = {
  table: "incentive",
  columns: [
    { name: "direction", type: "text", required: true },
    { name: "type", type: "text", required: true },
    { name: "grantor", type: "text" },
    { name: "program_name", type: "text" },
    { name: "amount", type: "number" },
    { name: "npv_value", type: "number" },
    { name: "status", type: "text" },
    { name: "estimated_clawback", type: "number" },
    ],
};


// CRUD (C-feat): create/update/delete via the allow-listed entity helper.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return badRequest("invalid_request", "body required.");
  return handleCreate({ ctx: auth.auth, project, spec: SPEC, body });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as (Record<string, unknown> & { id?: string }) | null;
  if (!body?.id) return badRequest("invalid_request", "id (row) is required.");
  return handleUpdate({ ctx: auth.auth, project, spec: SPEC, rowId: String(body.id), body });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const url = new URL(request.url);
  const rowId = url.searchParams.get("row_id");
  if (!rowId) return badRequest("invalid_request", "row_id query param is required.");
  return handleDelete({ ctx: auth.auth, project, spec: SPEC, rowId, body: {} });
}

