import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/sites — site/facility assessment scores
// (site-facility-agent). Scores are stored, never invented (ADR-0112). B4.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const rows = getDb()
    .query("SELECT * FROM site WHERE project_id = ? ORDER BY rank IS NULL, rank, created_at DESC")
    .all(id);
  return ok({ sites: rows }, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "부지 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    name?: string; region_code?: string | null; infra_score?: number | null;
    logistics_score?: number | null; labor_score?: number | null;
    permit_lead_time_days?: number | null; infra_capex?: number | null;
    total_score?: number | null; rank?: number | null; note?: string | null;
    address?: string | null; infra_notes?: string | null; labor_notes?: string | null;
  } | null;
  if (!body?.name?.trim()) return badRequest("name_required", "부지명은 필수입니다.");
  const now = new Date().toISOString();
  const row = {
    id: ulid(), project_id: id, name: body.name.trim(),
    region_code: body.region_code?.trim() || null,
    infra_score: body.infra_score ?? null, logistics_score: body.logistics_score ?? null,
    labor_score: body.labor_score ?? null, permit_lead_time_days: body.permit_lead_time_days ?? null,
    infra_capex: body.infra_capex ?? null, total_score: body.total_score ?? null,
    rank: body.rank ?? null, note: body.note?.trim() || null,
    address: body.address?.trim() || null,
    infra_notes: body.infra_notes?.trim() || null,
    labor_notes: body.labor_notes?.trim() || null,
    created_by: auth.auth.userId, created_at: now, updated_at: now,
  };
  getDb().run(
    `INSERT INTO site (id, project_id, name, region_code, infra_score, logistics_score, labor_score, permit_lead_time_days, infra_capex, total_score, rank, note, address, infra_notes, labor_notes, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.project_id, row.name, row.region_code, row.infra_score, row.logistics_score,
     row.labor_score, row.permit_lead_time_days, row.infra_capex, row.total_score, row.rank,
     row.note, row.address, row.infra_notes, row.labor_notes, row.created_by, row.created_at, row.updated_at],
  );
  appendAudit(getDb(), { actor: auth.auth.userId, action: "site.create", target: `${id}:${row.id}`, now });
  return ok({ site: row }, 201);
}

// DELETE ?id= — remove a site candidate (2026-10-21: the register had no
// lifecycle at all — a mistyped candidate was permanent). Hard delete with an
// audit row, the financing-entry pattern; analyst+, members only.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "부지 삭제는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const siteId = new URL(request.url).searchParams.get("id") ?? "";
  const row = getDb().query("SELECT id FROM site WHERE id = ? AND project_id = ?").get(siteId, id) as { id: string } | undefined;
  if (!row) return notFound();
  const now = new Date().toISOString();
  getDb().run("DELETE FROM site WHERE id = ?", [siteId]);
  appendAudit(getDb(), { actor: auth.auth.userId, action: "site.deleted", target: `${id}:${siteId}`, now });
  return ok({ id: siteId }, 200);
}
