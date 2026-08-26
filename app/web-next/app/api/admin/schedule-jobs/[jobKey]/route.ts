// Port of app/server/admin.ts PUT /api/admin/schedule-jobs/:jobKey
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";

export async function PUT(request: Request, { params }: { params: Promise<{ jobKey: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const { jobKey } = await params;
  const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== "boolean") {
    return badRequest("invalid_request", "enabled (boolean) is required.");
  }
  const db = getDb();
  const res = db.run("UPDATE schedule_job SET enabled = ? WHERE job_key = ?", [body.enabled ? 1 : 0, jobKey]);
  if (res.changes === 0) return notFound();
  appendAudit(db, { actor: auth.auth.userId, action: "schedule_job_toggle", target: `${jobKey}:enabled=${body.enabled ? 1 : 0}`, now: new Date().toISOString() });
  return ok({ ok: true, job_key: jobKey, enabled: body.enabled });
}
