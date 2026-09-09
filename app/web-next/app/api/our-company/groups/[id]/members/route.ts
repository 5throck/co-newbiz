// 그룹에 계열사 등록/수정/제거.
import { getDb } from "../../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "계열사 등록은 analyst 역할 이상이어야 합니다.");
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
  if (auth.auth.role === "viewer") return forbidden("role_required", "계열사 수정은 analyst 역할 이상이어야 합니다.");
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
  if (auth.auth.role === "viewer") return forbidden("role_required", "계열사 제거는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { member_id?: string } | null;
  const memberId = body?.member_id;
  if (!memberId) return badRequest("invalid_request", "member_id는 필수입니다.");
  const db = getDb();
  const member = db
    .query("SELECT id FROM company_group_member WHERE id = ? AND group_id = ?")
    .get(memberId, id) as { id: string } | undefined;
  if (!member) return notFound();
  // synergy_analysis.member_id가 이 행을 참조하면 FK(NO ACTION)가 DELETE를
  // 거부한다 — 서버 500(빈 응답) 대신 판독 가능한 409로 안내한다.
  const refCount =
    (db.query("SELECT COUNT(*) AS n FROM synergy_analysis WHERE member_id = ?").get(memberId) as
      | { n: number }
      | undefined)?.n ?? 0;
  if (refCount > 0) {
    return fail(
      409,
      "member_in_use",
      `이 계열사를 참조하는 시너지 분석 ${refCount}건이 있어 삭제할 수 없습니다. 시너지 분석 화면에서 해당 분석을 먼저 삭제해 주세요.`,
    );
  }
  try {
    db.transaction(() => {
      db.run("DELETE FROM company_profile_version WHERE member_id = ?", [memberId]);
      db.run("DELETE FROM company_group_member WHERE id = ? AND group_id = ?", [memberId, id]);
    })();
  } catch {
    // 미처 파악한 참조가 남아 있던 경우의 방어막 — 원인을 그대로 노출한다.
    return fail(409, "member_in_use", "이 계열사를 참조하는 데이터가 있어 삭제할 수 없습니다.");
  }
  return ok({ deleted: memberId }, 200);
}
