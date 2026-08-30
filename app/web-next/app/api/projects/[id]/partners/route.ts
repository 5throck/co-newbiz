// Port of app/server/deal-review.ts GET /api/projects/:id/partners
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
      `SELECT id, name, partner_type, region_code, capability_score, capacity_score, financial_score,
              compliance_risk, customer_base_fit, dependency_risk, status, contacted_at, nda_signed, evidence_ref
       FROM partner_candidate WHERE project_id = ? ORDER BY name`,
    )
    .all(project.id);
  return ok(rows);
}

const SPEC: EntitySpec = {
  table: "partner_candidate",
  columns: [
    { name: "name", type: "text", required: true },
    { name: "partner_type", type: "text", required: true },
    { name: "region_code", type: "text" },
    { name: "capability_score", type: "int" },
    { name: "capacity_score", type: "int" },
    { name: "financial_score", type: "int" },
    { name: "compliance_risk", type: "int" },
    { name: "customer_base_fit", type: "int" },
    { name: "dependency_risk", type: "int" },
    { name: "status", type: "text" },
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

