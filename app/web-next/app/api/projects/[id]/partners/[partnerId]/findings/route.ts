// 파트너 실사 지적사항 등록 (partner_dd_finding) — severity는
// high | medium | low, workstream은 실사 워크스트림(재무/법무/기술/컴플라이언스 등).
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { route } from "../../../../../../../lib/route.ts";
import { visibleProject } from "../../../../../../../lib/project-visibility.ts";

const SEVERITIES = ["high", "medium", "low"] as const;

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string; partnerId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "실사 지적사항 등록은 analyst 역할 이상이어야 합니다.");
  const { id, partnerId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    workstream?: string; severity?: string; description?: string;
  } | null;
  const workstream = body?.workstream?.trim();
  const severity = body?.severity?.trim();
  const description = body?.description?.trim();
  if (!workstream || !severity || !description) {
    return badRequest("invalid_request", "workstream(워크스트림), severity(심각도), description(내용)은 필수입니다.");
  }
  if (!(SEVERITIES as readonly string[]).includes(severity)) {
    return badRequest("invalid_request", `severity는 ${SEVERITIES.join(" | ")} 중 하나입니다.`);
  }
  const db = getDb();
  if (!db.query("SELECT id FROM partner_candidate WHERE id = ? AND project_id = ?").get(partnerId, id)) return notFound();
  const now = new Date().toISOString();
  const rowId = ulid();
  db.run(
    `INSERT INTO partner_dd_finding (id, project_id, partner_id, workstream, severity, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [rowId, id, partnerId, workstream, severity, description, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "partner_dd_finding.create", target: `${id}:${rowId}`, now });
  return ok(db.query("SELECT * FROM partner_dd_finding WHERE id = ?").get(rowId), 201);
});
