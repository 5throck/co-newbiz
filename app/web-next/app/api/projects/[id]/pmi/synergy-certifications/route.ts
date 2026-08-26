// Port of app/server/pmi.ts GET/POST /api/projects/:id/pmi/synergy-certifications
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query("SELECT id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at FROM pmi_synergy_certification WHERE project_id = ? ORDER BY signed_at DESC")
    .all(project.id);
  return ok(rows);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Certification writes require the analyst role.");
  const body = (await request.json().catch(() => null)) as
    | { run_rate_bp?: number; sustained_quarters?: number; certified_by?: string; baseline_locked_at?: string; signed_at?: string }
    | null;
  if (
    typeof body?.run_rate_bp !== "number" || body.run_rate_bp < 0 || body.run_rate_bp > 10000 ||
    typeof body?.sustained_quarters !== "number" || body.sustained_quarters < 1 ||
    !body?.certified_by?.trim() || !body?.baseline_locked_at || !body?.signed_at
  ) {
    return badRequest("invalid_request", "run_rate_bp (0-10000), sustained_quarters (>=1), certified_by, baseline_locked_at and signed_at are required.");
  }
  const db = getDb();
  const id2 = ulid();
  try {
    db.run(
      "INSERT INTO pmi_synergy_certification (id, project_id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id2, project.id, Math.round(body.run_rate_bp), Math.round(body.sustained_quarters), body.certified_by.trim(), body.baseline_locked_at, body.signed_at, new Date().toISOString()],
    );
  } catch (err) {
    return badRequest("certification_failed", err instanceof Error ? err.message : "Certification insert failed.");
  }
  appendAudit(db, { actor: ctx.userId, action: "synergy_certification_write", target: `${project.id}:${id2}`, now: new Date().toISOString() });
  return ok({ id: id2 }, 201);
}
