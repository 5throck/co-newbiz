import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST /api/projects/[id]/antitrust — S7 ⑥b ownership/antitrust screening
// (antitrust-agent). Deterministic judge-written numbers only; filing decisions
// stay human. ADR-0123 / construction plan Wave 0 (contract B2).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const rows = getDb()
    .query("SELECT * FROM antitrust WHERE project_id = ? ORDER BY created_at DESC")
    .all(id);
  return ok({ screenings: rows }, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "독점규제 스크리닝 등록은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    market_definition?: string; hhi_before?: number | null; hhi_after?: number | null;
    combination_type?: string | null; filing_jurisdictions?: string | null;
    remedy_type?: string; remedy_detail?: string | null; target_id?: string | null;
  } | null;
  if (!body?.market_definition?.trim()) return badRequest("market_required", "market_definition은 필수입니다.");
  const remedy = body.remedy_type?.trim() || "none";
  const now = new Date().toISOString();
  const row = {
    id: ulid(), project_id: id, target_id: body.target_id?.trim() || null,
    market_definition: body.market_definition.trim(),
    hhi_before: body.hhi_before ?? null, hhi_after: body.hhi_after ?? null,
    combination_type: body.combination_type?.trim() || null,
    filing_jurisdictions: body.filing_jurisdictions?.trim() || null,
    remedy_type: remedy, remedy_detail: body.remedy_detail?.trim() || null,
    created_by: auth.auth.userId, created_at: now, updated_at: now,
  };
  getDb().run(
    `INSERT INTO antitrust (id, project_id, target_id, market_definition, hhi_before, hhi_after, combination_type, filing_jurisdictions, remedy_type, remedy_detail, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.project_id, row.target_id, row.market_definition, row.hhi_before, row.hhi_after,
     row.combination_type, row.filing_jurisdictions, row.remedy_type, row.remedy_detail,
     row.created_by, row.created_at, row.updated_at],
  );
  appendAudit(getDb(), { actor: auth.auth.userId, action: "antitrust.create", target: `${id}:${row.id}`, now });
  return ok({ screening: row }, 201);
}
