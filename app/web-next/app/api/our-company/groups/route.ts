// 그룹/계열사 분석 — 그룹 등록/목록/상세 (그룹+계열사+최신 프로파일 롤업).
import { getDb } from "../../../../../../db/client.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const groups = db
    .query(
      `SELECT g.id, g.name, g.created_at,
              (SELECT COUNT(*) FROM company_group_member m WHERE m.group_id = g.id AND m.deleted_at IS NULL) AS member_count
       FROM company_group g WHERE g.deleted_at IS NULL ORDER BY g.created_at DESC`,
    )
    .all() as Array<{ id: string; name: string; created_at: string; member_count: number }>;
  return ok({ groups }, 200, { count: groups.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return badRequest("role_required", "그룹 등록은 analyst 역할 이상이어야 합니다.");
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return badRequest("invalid_request", "그룹명(name)은 필수입니다.");
  const db = getDb();
  const existing = db.query("SELECT id FROM company_group WHERE name = ? AND deleted_at IS NULL").get(name) as { id: string } | undefined;
  if (existing) return ok({ id: existing.id, name, reused: true }, 200);
  const id = ulid();
  db.run("INSERT INTO company_group (id, name, created_by, created_at) VALUES (?,?,?,?)", [id, name, ctx.userId, now()]);
  return ok({ id, name, reused: false }, 201);
}
