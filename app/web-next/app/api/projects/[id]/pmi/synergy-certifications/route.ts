// PMI 시너지 인증 (pmi_synergy_certification) — 시너지 항목을 정량 근거
// (run-rate bp, 지속 분기 수)와 함께 인증하고, 해제는 레코드 삭제로 처리.
// certified_by는 세션 사용자로 강제된다.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";

export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const rows = getDb()
    .query(
      `SELECT id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at, created_at
       FROM pmi_synergy_certification WHERE project_id = ? ORDER BY signed_at DESC`,
    )
    .all(id);
  return ok({ certifications: rows }, 200, { count: rows.length });
});

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "시너지 인증은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    run_rate_bp?: number; sustained_quarters?: number; baseline_locked_at?: string;
  } | null;
  const runRateBp = Number(body?.run_rate_bp);
  const quarters = Number(body?.sustained_quarters);
  if (!Number.isInteger(runRateBp) || runRateBp <= 0) {
    return badRequest("invalid_request", "run_rate_bp는 양의 정수(연환산 런레이트, basis points)입니다.");
  }
  if (!Number.isInteger(quarters) || quarters <= 0) {
    return badRequest("invalid_request", "sustained_quarters는 양의 정수(지속 분기 수)입니다.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  const baseline = body?.baseline_locked_at?.trim() || now;
  const rowId = ulid();
  db.run(
    `INSERT INTO pmi_synergy_certification
       (id, project_id, run_rate_bp, sustained_quarters, certified_by, baseline_locked_at, signed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [rowId, id, runRateBp, quarters, ctx.userId, baseline, now, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "pmi_synergy_certification.create", target: `${id}:${rowId}`, now });
  return ok(db.query("SELECT * FROM pmi_synergy_certification WHERE id = ?").get(rowId), 201);
});
