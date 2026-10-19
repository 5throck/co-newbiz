// POST /api/projects/[id]/dd/findings — record one dd_finding (the S9 조사내역
// the workspace lists and S10 reads for value_impact). ADR-0157: an optional
// target_id scopes the finding to an OPENED comparison target (409 when DD was
// never opened there); omitted = the selected/legacy scope the gate judges.
// Analyst+; deny-by-default visibility. Findings are evidence, never a verdict.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { scopeOrResponse } from "../../../../../../lib/dd-target-http.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "조사내역 등록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    category?: string; description?: string; value_impact?: number | null; assumption_key?: string; evidence_ref?: string; target_id?: string;
  } | null;
  const category = body?.category?.trim();
  const description = body?.description?.trim();
  if (!category || !description) return badRequest("invalid_request", "category와 description은 필수입니다.");
  if (category.length > 64) return badRequest("invalid_request", "category는 64자 이내여야 합니다.");
  if (category === "rbd") return badRequest("invalid_request", "rbd 범주는 rbd_source가 필요해 이 경로로 등록할 수 없습니다.");
  if (body?.value_impact != null && !Number.isInteger(body.value_impact)) {
    return badRequest("invalid_request", "value_impact는 정수(KRW 백만)여야 합니다.");
  }
  const scope = scopeOrResponse(id, body?.target_id);
  if ("response" in scope) return scope.response;
  const db = getDb();
  const now = new Date().toISOString();
  const rowId = ulid();
  db.run(
    `INSERT INTO dd_finding (id, project_id, category, description, value_impact, assumption_key, evidence_ref, created_at, target_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [rowId, id, category, description, body?.value_impact ?? null, body?.assumption_key?.trim() || null, body?.evidence_ref?.trim() || null, now, scope.targetId],
  );
  appendAudit(db, { actor: ctx.userId, action: "dd_finding.create", target: `${id}:${rowId}`, now });
  return ok({ id: rowId, project_id: id, target_id: scope.targetId, category, description, value_impact: body?.value_impact ?? null }, 201);
});


// PUT/DELETE — 2026-10-19 decider: recorded findings needed a correction path.
// Analyst+ person writes with dd_finding.update / dd_finding.delete audit; the
// register stays append-visible in history via the audit trail (S10/IC read the
// current rows only).
export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "조사내역 정정은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as {
    finding_id?: string; description?: string; value_impact?: number | null; evidence_ref?: string;
  } | null;
  const findingId = body?.finding_id?.trim();
  if (!findingId) return badRequest("invalid_request", "finding_id는 필수입니다.");
  const existing = getDb()
    .query("SELECT id FROM dd_finding WHERE project_id = ? AND id = ?")
    .get(id, findingId) as { id: string } | undefined;
  if (!existing) return notFound();
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  if (!description) return badRequest("invalid_request", "description은 필수입니다.");
  if (body?.value_impact != null && !Number.isInteger(body.value_impact)) {
    return badRequest("invalid_request", "value_impact는 정수(KRW 백만)여야 합니다.");
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    "UPDATE dd_finding SET description = ?, value_impact = ?, evidence_ref = ? WHERE project_id = ? AND id = ?",
    [description, body?.value_impact ?? null, body?.evidence_ref?.trim() || null, id, findingId],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "dd_finding.update", target: `${id}:${findingId}`, now });
  return ok({ id: findingId }, 200);
});

export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "조사내역 삭제는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { finding_id?: string } | null;
  const findingId = body?.finding_id?.trim();
  if (!findingId) return badRequest("invalid_request", "finding_id는 필수입니다.");
  const existing = getDb()
    .query("SELECT id FROM dd_finding WHERE project_id = ? AND id = ?")
    .get(id, findingId) as { id: string } | undefined;
  if (!existing) return notFound();
  const db = getDb();
  const now = new Date().toISOString();
  db.run("DELETE FROM dd_finding WHERE project_id = ? AND id = ?", [id, findingId]);
  appendAudit(db, { actor: auth.auth.userId, action: "dd_finding.delete", target: `${id}:${findingId}`, now });
  return ok({ id: findingId }, 200);
});