// 그룹 상세 — 그룹 정보 + 계열사 목록 + 각 계열사의 최신 프로파일 요약.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { loadLatestProfile } from "../../../../../lib/company-profile-pipeline.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();

  const group = db.query("SELECT id, name, created_at FROM company_group WHERE id = ?").get(id) as
    | { id: string; name: string; created_at: string }
    | null;
  if (!group) return notFound();

  const members = db
    .query(
      `SELECT m.id, m.company_name, m.dart_corp_code, m.role, m.created_at,
              (SELECT MAX(version_no) FROM company_profile_version v WHERE v.member_id = m.id) AS latest_version,
              (SELECT MAX(created_at) FROM company_profile_version v WHERE v.member_id = m.id) AS analyzed_at
       FROM company_group_member m WHERE m.group_id = ? ORDER BY m.created_at`,
    )
    .all(id) as Array<{
    id: string; company_name: string; dart_corp_code: string | null; role: "hq" | "affiliate";
    created_at: string; latest_version: number | null; analyzed_at: string | null;
  }>;

  // 계열사 최신 프로파일 롤업 — 강점/약점 취합 + 그룹 요약(LLM 없이 취합만)
  const profiles = members.map((m) => ({
    member_id: m.id,
    company_name: m.company_name,
    role: m.role,
    latest_version: m.latest_version,
    profile: m.latest_version ? loadLatestProfile(db, m.id) : null,
  }));

  return ok({ group, members, profiles }, 200, { member_count: members.length });
}

/** 그룹명 수정 (analyst+). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "그룹명 수정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return badRequest("invalid_request", "그룹명은 필수입니다.");
  const db = getDb();
  if (!db.query("SELECT id FROM company_group WHERE id = ?").get(id)) return notFound();
  db.run("UPDATE company_group SET name = ? WHERE id = ?", [name, id]);
  return ok(db.query("SELECT id, name FROM company_group WHERE id = ?").get(id), 200);
}
