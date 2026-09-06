// 파트너 실사 지적사항 수정/삭제 — project+partner 스코프 검증 후 갱신.
import { getDb } from "../../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../../lib/envelope.ts";
import { route } from "../../../../../../../../lib/route.ts";
import { visibleProject } from "../../../../../../../../lib/project-visibility.ts";

const SEVERITIES = ["high", "medium", "low"];

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string; partnerId: string; findingId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "실사 지적사항 수정은 analyst 역할 이상이어야 합니다.");
  const { id, partnerId, findingId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const existing = db
    .query("SELECT id FROM partner_dd_finding WHERE id = ? AND partner_id = ? AND project_id = ?")
    .get(findingId, partnerId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const body = (await request.json().catch(() => null)) as {
    workstream?: string; severity?: string; description?: string;
  } | null;
  if (body?.severity && !SEVERITIES.includes(body.severity.trim())) {
    return badRequest("invalid_request", `severity는 ${SEVERITIES.join(" | ")} 중 하나입니다.`);
  }
  const now = new Date().toISOString();
  db.run(
    `UPDATE partner_dd_finding SET
       workstream = COALESCE(?, workstream),
       severity = COALESCE(?, severity),
       description = COALESCE(?, description)
     WHERE id = ?`,
    [body?.workstream?.trim() || null, body?.severity?.trim() || null, body?.description?.trim() || null, findingId],
  );
  appendAudit(db, { actor: ctx.userId, action: "partner_dd_finding.update", target: `${id}:${findingId}`, now });
  return ok(db.query("SELECT * FROM partner_dd_finding WHERE id = ?").get(findingId), 200);
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string; partnerId: string; findingId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "실사 지적사항 삭제는 analyst 역할 이상이어야 합니다.");
  const { id, partnerId, findingId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const existing = db
    .query("SELECT id FROM partner_dd_finding WHERE id = ? AND partner_id = ? AND project_id = ?")
    .get(findingId, partnerId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const now = new Date().toISOString();
  db.run("DELETE FROM partner_dd_finding WHERE id = ?", [findingId]);
  appendAudit(db, { actor: ctx.userId, action: "partner_dd_finding.delete", target: `${id}:${findingId}`, now });
  return ok({ deleted: findingId }, 200);
});
