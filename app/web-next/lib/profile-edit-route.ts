// @version 1.0.0
/** Shared route plumbing for analyst edits of a member profile (same permission as starting a profile job). */
import { getDb } from "../../../db/client.ts";
import { authenticate, requireBusinessActor } from "./auth.ts";
import { badRequest, fail, notFound, ok } from "./envelope.ts";
import { EditError } from "./profile-analyst-edit.ts";

export async function handleMemberProfileEdit(
  request: Request,
  memberId: string,
  run: (db: ReturnType<typeof getDb>, userId: string, body: Record<string, unknown>) => unknown,
  opts: { hasBody?: boolean; status?: number } = {},
): Promise<Response> {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "프로파일 수정은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const db = getDb();
  const member = db.query("SELECT id FROM company_group_member WHERE id = ?").get(memberId);
  if (!member) return notFound();
  let body: Record<string, unknown> = {};
  if (opts.hasBody !== false) {
    try {
      const parsed = JSON.parse(await request.text()) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return badRequest("invalid_body", "요청 본문은 JSON 객체여야 합니다.");
      body = parsed as Record<string, unknown>;
    } catch {
      return badRequest("invalid_body", "요청 본문이 올바른 JSON이 아닙니다.");
    }
  }
  try {
    const data = run(db, auth.auth.userId, body);
    return ok(data, opts.status === 201 ? 201 : 200);
  } catch (err) {
    if (err instanceof EditError) return fail(err.status as 400 | 403 | 404, err.code, err.message);
    throw err;
  }
}
