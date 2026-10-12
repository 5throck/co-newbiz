// PMI 시너지 인증 해제 — 인증 레코드 삭제(=un-certify). viewer 불가, analyst+.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { route } from "../../../../../../../lib/route.ts";
import { PMI_NOT_APPLICABLE_MESSAGE, pmiApplicability } from "../../../../../../../lib/pmi-kickoff.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string; certificationId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "시너지 인증 해제는 analyst 역할 이상이어야 합니다.");
  const { id, certificationId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  if (!pmiApplicability(getDb(), id).applies) return forbidden("not_applicable_track", PMI_NOT_APPLICABLE_MESSAGE);
  const db = getDb();
  const existing = db
    .query("SELECT id FROM pmi_synergy_certification WHERE id = ? AND project_id = ?")
    .get(certificationId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const now = new Date().toISOString();
  db.run("DELETE FROM pmi_synergy_certification WHERE id = ?", [certificationId]);
  appendAudit(db, { actor: ctx.userId, action: "pmi_synergy_certification.delete", target: `${id}:${certificationId}`, now });
  return ok({ deleted: certificationId }, 200);
});
