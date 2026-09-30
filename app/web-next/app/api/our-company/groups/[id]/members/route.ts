// 그룹에 계열사 등록/수정/제거.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "계열사 등록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { company_name?: string; dart_corp_code?: string | null; role?: "hq" | "affiliate" }
    | null;
  const name = body?.company_name?.trim();
  if (!name) return badRequest("invalid_request", "company_name은 필수입니다.");
  const role = body?.role === "hq" ? "hq" : "affiliate";
  const db = getDb();
  if (!db.query("SELECT id FROM company_group WHERE id = ?").get(id)) return notFound();

  const dup = db
    .query("SELECT id FROM company_group_member WHERE group_id = ? AND company_name = ?")
    .get(id, name) as { id: string } | undefined;
  if (dup) return ok({ id: dup.id, reused: true }, 200);

  const memberId = ulid();
  db.run(
    `INSERT INTO company_group_member (id, group_id, company_name, dart_corp_code, role, created_at)
     VALUES (?,?,?,?,?,?)`,
    [memberId, id, name, body?.dart_corp_code?.trim() || null, role, now()],
  );
  return ok({ id: memberId, company_name: name, role }, 201);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "계열사 수정은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { member_id?: string; company_name?: string; dart_corp_code?: string | null; role?: "hq" | "affiliate" }
    | null;
  const memberId = body?.member_id;
  if (!memberId) return badRequest("invalid_request", "member_id는 필수입니다.");
  const db = getDb();
  const member = db
    .query("SELECT id FROM company_group_member WHERE id = ? AND group_id = ?")
    .get(memberId, id) as { id: string } | undefined;
  if (!member) return notFound();

  if (typeof body?.dart_corp_code === "string") {
    const code = body.dart_corp_code.trim() || null;
    db.run("UPDATE company_group_member SET dart_corp_code = ? WHERE id = ?", [code, memberId]);
  }
  if (body?.company_name?.trim()) {
    db.run("UPDATE company_group_member SET company_name = ? WHERE id = ?", [body.company_name.trim(), memberId]);
  }
  if (body?.role === "hq" || body?.role === "affiliate") {
    db.run("UPDATE company_group_member SET role = ? WHERE id = ?", [body.role, memberId]);
  }
  const updated = db
    .query("SELECT id, company_name, dart_corp_code, role FROM company_group_member WHERE id = ?")
    .get(memberId);
  return ok(updated, 200);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "계열사 제거는 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { member_id?: string; reason?: string } | null;
  const memberId = body?.member_id;
  if (!memberId) return badRequest("invalid_request", "member_id는 필수입니다.");
  const db = getDb();
  const member = db
    .query("SELECT company_name, deleted_at FROM company_group_member WHERE id = ? AND group_id = ?")
    .get(memberId, id) as { company_name: string; deleted_at: string | null } | undefined;
  if (!member) return notFound();
  if (member.deleted_at) return badRequest("already_deleted", "이 계열사는 이미 삭제 표시되어 있습니다.");
  // deletion mark — 행은 남는다(시너지 분석·프로파일 참조와 감사 이력 보존).
  // 모든 목록/조회가 이 표시를 필터링한다.
  const now = new Date().toISOString();
  const reason = body?.reason?.trim() || `deleted by ${auth.auth.userId}`;
  db.run("UPDATE company_group_member SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ? AND group_id = ?", [
    now,
    auth.auth.userId,
    reason,
    memberId,
    id,
  ]);
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "company_member_delete",
    target: `${memberId}:${member.company_name}`,
    now,
  });
  return ok({ deleted: memberId }, 200);
}
