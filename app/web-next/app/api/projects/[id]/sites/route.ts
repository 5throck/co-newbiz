// Port of app/server/deal-review.ts GET /api/projects/:id/sites
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
      `SELECT id, name, region_code, infra_score, infra_capex, incentive_npv, logistics_cost,
              labor_availability, permit_lead_time_days, affected_area_notification_status, total_score, rank
       FROM site_candidate WHERE project_id = ? ORDER BY (rank IS NULL), rank, name`,
    )
    .all(project.id);
  return ok(rows);
}

const SPEC: EntitySpec = {
  table: "site_candidate",
  columns: [
    { name: "name", type: "text", required: true },
    { name: "region_code", type: "text" },
    { name: "infra_score", type: "number" },
    { name: "infra_capex", type: "number" },
    { name: "incentive_npv", type: "number" },
    { name: "logistics_cost", type: "number" },
    { name: "labor_availability", type: "number" },
    { name: "permit_lead_time_days", type: "int" },
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

