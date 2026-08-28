// GET/POST /api/projects/:id/review-audit-samples — measurement mechanism
// for the "AI 검토 신뢰도" (AI review reliability) governance KPI (design
// §6.6): the agreed-ratio of sampled ai_2nd review_stage conclusions
// against the same run's human_final outcome. No table for this existed
// anywhere in the schema prior to migration 0038 (design doc §20.4,
// 2026-08-28 audit) — the KPI had no way to be measured at all.
//
// GET returns both the raw sample rows and an aggregate { total, agreed,
// agreed_pct } so the caller (a KPI dashboard) doesn't need to recompute
// the ratio client-side from potentially-paginated rows.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();

  const db = getDb();
  const rows = db
    .query(
      `SELECT ras.id, ras.review_stage_id, ras.sampled_by, ras.agreed, ras.note, ras.created_at
       FROM review_audit_sample ras
       JOIN review_stage rs ON rs.id = ras.review_stage_id
       JOIN run r ON r.id = rs.run_id
       WHERE r.project_id = ? ORDER BY ras.created_at DESC`,
    )
    .all(project.id) as { agreed: number }[];
  const total = rows.length;
  const agreed = rows.filter((r) => r.agreed === 1).length;
  const agreedPct = total > 0 ? Math.round((agreed / total) * 1000) / 10 : null;
  return ok(rows, 200, { total, agreed, agreed_pct: agreedPct });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Review audit samples are recorded by analysts.");

  const body = (await request.json().catch(() => null)) as { review_stage_id?: string; agreed?: boolean; note?: string } | null;
  if (!body?.review_stage_id?.trim()) return badRequest("invalid_request", "review_stage_id is required.");
  if (typeof body.agreed !== "boolean") {
    return badRequest("invalid_request", "agreed (boolean) is required — a sample is always recorded as agree or disagree, never left ambiguous.");
  }

  const db = getDb();
  const stage = db
    .query(
      `SELECT rs.id, rs.stage, r.project_id FROM review_stage rs JOIN run r ON r.id = rs.run_id WHERE rs.id = ?`,
    )
    .get(body.review_stage_id) as { id: string; stage: string; project_id: string } | null;
  if (!stage || stage.project_id !== project.id) return badRequest("invalid_request", "review_stage_id does not belong to this project.");
  if (stage.stage !== "ai_2nd") {
    return badRequest("invalid_request", "Review audit samples measure ai_2nd conclusions against the human_final outcome — review_stage_id must reference an ai_2nd stage.");
  }

  const now = new Date().toISOString();
  const rowId = ulid();
  db.run("INSERT INTO review_audit_sample (id, review_stage_id, sampled_by, agreed, note, created_at) VALUES (?,?,?,?,?,?)", [
    rowId,
    body.review_stage_id,
    ctx.userId,
    body.agreed ? 1 : 0,
    body.note?.trim() || null,
    now,
  ]);
  appendAudit(db, { actor: ctx.userId, action: "review_audit_sample_create", target: `${project.id}:${body.review_stage_id}`, now });
  return ok({ id: rowId }, 201);
}
