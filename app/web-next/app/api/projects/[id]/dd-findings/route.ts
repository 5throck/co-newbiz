// Port of app/server/deal-review.ts GET/POST /api/projects/:id/dd-findings
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok, provenance } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const url = new URL(request.url);
  const category = url.searchParams.get("category") || null;
  const rows = getDb()
    .query(
      `SELECT id, category, description, value_impact, assumption_key, evidence_ref,
              trl_grade, ip_ownership_status, commercialization_path, parent_relationship_json,
              rbd_source, created_at
       FROM dd_finding
       WHERE project_id = ? AND (? IS NULL OR category = ?)
       ORDER BY created_at DESC, id DESC`,
    )
    .all(project.id, category, category);
  return ok(rows, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") {
    return forbidden("role_required", "DD findings are recorded by analysts.");
  }
  const body = (await request.json().catch(() => null)) as
    | {
      category?: string;
      description?: string;
      value_impact?: number;
      assumption_key?: string;
      evidence_ref?: string;
      trl_grade?: string;
      ip_ownership_status?: string;
      commercialization_path?: string;
      parent_relationship_json?: string;
      rbd_source?: string;
    }
    | null;
  if (!body?.category?.trim() || !body?.description?.trim()) {
    return badRequest("invalid_request", "category and description are required.");
  }
  if (body.category.trim() === "rbd" && !body.rbd_source?.trim()) {
    return badRequest(
      "rbd_source_required",
      "category='rbd' requires rbd_source (internal_only|accelerator_partnered|external_technology_acquisition).",
    );
  }
  const assumptionKey = body.assumption_key?.trim() || null;
  const db = getDb();
  const now = new Date().toISOString();
  const id2 = ulid();
  try {
    db.run(
      `INSERT INTO dd_finding (id, project_id, category, description, value_impact, assumption_key,
                               evidence_ref, trl_grade, ip_ownership_status, commercialization_path,
                               parent_relationship_json, rbd_source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id2,
        project.id,
        body.category.trim(),
        body.description.trim(),
        typeof body.value_impact === "number" ? body.value_impact : null,
        assumptionKey,
        body.evidence_ref?.trim() || null,
        body.trl_grade?.trim() || null,
        body.ip_ownership_status?.trim() || null,
        body.commercialization_path?.trim() || null,
        body.parent_relationship_json?.trim() || null,
        body.rbd_source?.trim() || null,
        now,
      ],
    );
  } catch (err) {
    return badRequest("dd_finding_rejected", err instanceof Error ? err.message : "DD finding write failed.");
  }
  let meta: Record<string, unknown> = {};
  if (assumptionKey) {
    const assumption = db
      .query("SELECT run_id, anchor_ref FROM assumption WHERE assumption_key = ? ORDER BY as_of DESC, id DESC LIMIT 1")
      .get(assumptionKey) as { run_id: string; anchor_ref: string | null } | null;
    meta = provenance({ assumption_key: assumptionKey, run_id: assumption?.run_id, anchor_ref: assumption?.anchor_ref });
  }
  appendAudit(db, { actor: ctx.userId, action: "dd_finding_add", target: `${project.id}:${body.category.trim()}`, now });
  return ok({ id: id2 }, 201, meta);
}
