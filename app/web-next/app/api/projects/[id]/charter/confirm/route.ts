// POST /api/projects/[id]/charter/confirm — the human baseline confirmation
// behind S11's completionCriteria ("추진계획(차터) 기준선이 확정되고 append-only
// 변경 이력이 시작되었다" — flow.spec S11, ADR-0104 C3). The charter JSON is
// built at promotion and amended append-only; THIS is the act that stamps the
// baseline as confirmed. Re-confirming after an amendment re-baselines the
// latest version (idempotent re-stamp, not a new version). Human action,
// analyst+, member-visible only, audit-recorded.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok, forbidden } from "../../../../../../lib/envelope.ts";
import { recordHumanFinalForStageArtifacts } from "../../../../../../lib/review/human-final.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "차터 기준선 확정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const row = db.query("SELECT charter_json FROM md_project WHERE id = ?").get(id) as
    | { charter_json: string | null }
    | undefined;
  if (!row) return notFound();
  if (!row.charter_json) return badRequest("invalid_request", "차터가 아직 구성되지 않았습니다 — 승격 시 차터가 자동 생성되어야 확정할 수 있습니다.");
  const now = new Date().toISOString();
  db.run("UPDATE md_project SET charter_confirmed_at = ? WHERE id = ?", [now, id]);
  appendAudit(db, { actor: ctx.userId, action: "project_charter.confirm", target: id, now });
  // ADR-0153: the human's baseline confirmation is the human_final review of the S11 artifacts.
  recordHumanFinalForStageArtifacts("S11", id, ctx.userId, "charter_confirmed");
  return ok({ charter_confirmed_at: now }, 200);
}
