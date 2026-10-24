// PMI 핵심인력 상태 갱신/삭제 — retention 상태(active|departed_regretted|departed_planned, DB CHECK와 동일) 변경,
// departed_* 전환 시 exit_date 자동 기록 (active 복귀 시 exit_date 해제 — DB CHECK: active 여부 = exit_date 없음).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { route } from "../../../../../../../lib/route.ts";
import { PMI_NOT_APPLICABLE_MESSAGE, pmiApplicability } from "../../../../../../../lib/pmi-kickoff.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

const STATUSES = ["active", "departed_regretted", "departed_planned"];

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string; talentId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Updating key-talent status requires the analyst role or higher.");
  const { id, talentId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  if (!pmiApplicability(getDb(), id).applies) return forbidden("not_applicable_track", PMI_NOT_APPLICABLE_MESSAGE);
  const db = getDb();
  const existing = db
    .query("SELECT id FROM pmi_key_talent WHERE id = ? AND project_id = ?")
    .get(talentId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const body = (await request.json().catch(() => null)) as { status?: string; role_ref?: string; exit_date?: string | null } | null;
  const status = body?.status?.trim();
  if (status && !STATUSES.includes(status)) {
    return badRequest("invalid_request", `status must be one of: ${STATUSES.join(" | ")}.`);
  }
  const now = new Date().toISOString();
  db.run(
    `UPDATE pmi_key_talent SET
       role_ref = COALESCE(?, role_ref),
       status = COALESCE(?, status),
       exit_date = CASE
         WHEN ? IN ('departed_regretted', 'departed_planned') THEN COALESCE(?, ?)
         WHEN ? = 'active' THEN NULL
         ELSE exit_date
       END
     WHERE id = ?`,
    [
      body?.role_ref?.trim() || null,
      status || null,
      status || "",
      body?.exit_date?.trim() || null,
      now,
      status || "",
      talentId,
    ],
  );
  appendAudit(db, { actor: ctx.userId, action: "pmi_key_talent.update", target: `${id}:${talentId}`, now });
  return ok(db.query("SELECT * FROM pmi_key_talent WHERE id = ?").get(talentId), 200);
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string; talentId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Deleting key talent requires the analyst role or higher.");
  const { id, talentId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  if (!pmiApplicability(getDb(), id).applies) return forbidden("not_applicable_track", PMI_NOT_APPLICABLE_MESSAGE);
  const db = getDb();
  const existing = db
    .query("SELECT id FROM pmi_key_talent WHERE id = ? AND project_id = ?")
    .get(talentId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const now = new Date().toISOString();
  db.run("DELETE FROM pmi_key_talent WHERE id = ?", [talentId]);
  appendAudit(db, { actor: ctx.userId, action: "pmi_key_talent.delete", target: `${id}:${talentId}`, now });
  return ok({ deleted: talentId }, 200);
});
