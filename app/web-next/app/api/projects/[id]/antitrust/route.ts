// Port of app/server/deal-review.ts GET /api/projects/:id/antitrust
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
      `SELECT id, market_definition, hhi_before, hhi_after, combination_type, filing_jurisdictions,
              remedy_type, remedy_detail, discharge_confirmed_at, created_at
       FROM antitrust_finding WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(project.id);
  return ok(rows);
}

const SPEC: EntitySpec = {
  table: "antitrust_finding",
  columns: [
    { name: "market_definition", type: "text", required: true },
    { name: "hhi_before", type: "number" },
    { name: "hhi_after", type: "number" },
    { name: "combination_type", type: "text" },
    { name: "remedy_type", type: "text" },
    { name: "remedy_detail", type: "text" },
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

