// 그룹 상세 — 그룹 정보 + 계열사 목록 + 각 계열사의 최신 프로파일 요약.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { getGroupDetail } from "../../../../../lib/our-company-groups.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { id } = await params;
  const detail = getGroupDetail(getDb(), id);
  if (!detail) return notFound();
  return ok(detail, 200, { member_count: detail.members.length });
}

/** 그룹명 수정 (analyst+). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Renaming groups requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return badRequest("invalid_request", "Group name is required.");
  const db = getDb();
  if (!db.query("SELECT id FROM company_group WHERE id = ?").get(id)) return notFound();
  db.run("UPDATE company_group SET name = ? WHERE id = ?", [name, id]);
  return ok(db.query("SELECT id, name FROM company_group WHERE id = ?").get(id), 200);
}

/** 그룹 삭제 (analyst+) — deletion mark, never row removal
 *  (deal-deletion-playbook). 그룹과 소속 계열사 행은 deleted_at/deleted_by/
 *  delete_reason 표시만 남기고 원본은 그대로 보존된다. 시너지 분석 등 참조
 *  데이터도 온전히 유지되므로 FK 거부 없이 언제든 표시 가능하다. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Deleting groups requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const db = getDb();
  const group = db.query("SELECT id, name, deleted_at FROM company_group WHERE id = ?").get(id) as
    | { id: string; name: string; deleted_at: string | null }
    | undefined;
  if (!group) return notFound();
  if (group.deleted_at) return badRequest("already_deleted", "This group is already soft-deleted.");
  const now = new Date().toISOString();
  const reason = body?.reason?.trim() || `deleted by ${auth.auth.userId}`;
  db.transaction(() => {
    db.run(
      "UPDATE company_group_member SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE group_id = ? AND deleted_at IS NULL",
      [now, auth.auth.userId, reason, id],
    );
    db.run("UPDATE company_group SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?", [now, auth.auth.userId, reason, id]);
  })();
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "company_group_delete",
    target: `${id}:${group.name}`,
    now,
  });
  return ok({ id, deleted: true });
}
