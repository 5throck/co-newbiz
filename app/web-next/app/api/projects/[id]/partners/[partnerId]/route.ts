// 파트너 후보 수정/삭제 — project-scoped (partner must belong to the deal).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string; partnerId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "파트너 후보 수정은 analyst 역할 이상이어야 합니다.");
  const { id, partnerId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const existing = db
    .query("SELECT id FROM partner_candidate WHERE id = ? AND project_id = ?")
    .get(partnerId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const body = (await request.json().catch(() => null)) as {
    partner_type?: string; region_code?: string | null;
    capability_score?: number | null; capacity_score?: number | null; financial_score?: number | null;
    compliance_risk?: string | null; customer_base_fit?: number | null; dependency_risk?: string | null;
    status?: string; nda_signed?: boolean; evidence_ref?: string | null;
  } | null;
  const now = new Date().toISOString();
  db.run(
    `UPDATE partner_candidate SET
       partner_type = COALESCE(?, partner_type),
       region_code = COALESCE(?, region_code),
       capability_score = COALESCE(?, capability_score),
       capacity_score = COALESCE(?, capacity_score),
       financial_score = COALESCE(?, financial_score),
       compliance_risk = COALESCE(?, compliance_risk),
       customer_base_fit = COALESCE(?, customer_base_fit),
       dependency_risk = COALESCE(?, dependency_risk),
       status = COALESCE(?, status),
       contacted_at = CASE WHEN ? IS NOT NULL AND contacted_at IS NULL THEN ? ELSE contacted_at END,
       nda_signed = COALESCE(?, nda_signed),
       evidence_ref = COALESCE(?, evidence_ref)
     WHERE id = ?`,
    [
      body?.partner_type?.trim() || null,
      body?.region_code?.trim() || null,
      num(body?.capability_score),
      num(body?.capacity_score),
      num(body?.financial_score),
      body?.compliance_risk?.trim() || null,
      num(body?.customer_base_fit),
      body?.dependency_risk?.trim() || null,
      body?.status?.trim() || null,
      body?.status?.trim() || null,
      now,
      body?.nda_signed === undefined ? null : body.nda_signed ? 1 : 0,
      body?.evidence_ref?.trim() || null,
      partnerId,
    ],
  );
  appendAudit(db, { actor: ctx.userId, action: "partner_candidate.update", target: `${id}:${partnerId}`, now });
  return ok(db.query("SELECT * FROM partner_candidate WHERE id = ?").get(partnerId), 200);
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string; partnerId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "파트너 후보 삭제는 analyst 역할 이상이어야 합니다.");
  const { id, partnerId } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const db = getDb();
  const existing = db
    .query("SELECT id FROM partner_candidate WHERE id = ? AND project_id = ?")
    .get(partnerId, id) as { id: string } | undefined;
  if (!existing) return notFound();
  const jvCount = db.query("SELECT COUNT(*) AS n FROM jv_term WHERE partner_id = ?").get(partnerId) as { n: number };
  if (jvCount.n > 0) {
    return badRequest("partner_has_jv_terms", "JV 조건이 등록된 파트너는 먼저 JV 조건을 삭제한 후 제거할 수 있습니다.");
  }
  const now = new Date().toISOString();
  db.run("DELETE FROM partner_dd_finding WHERE partner_id = ?", [partnerId]);
  db.run("DELETE FROM partner_candidate WHERE id = ?", [partnerId]);
  appendAudit(db, { actor: ctx.userId, action: "partner_candidate.delete", target: `${id}:${partnerId}`, now });
  return ok({ deleted: partnerId }, 200);
});
