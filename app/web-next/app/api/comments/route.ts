// GET/POST /api/comments?entity_type=&entity_id= — collaboration annotation
// threads (round-2 #6, `deal_comment`). Project entities are membership-gated
// (visibleProject); opportunity entities require authentication.
import { getDb } from "../../../../../db/client.ts";
import { ulid } from "../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../lib/envelope.ts";
import { visibleProject } from "../../../lib/project-visibility.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entity_type");
  const entityId = url.searchParams.get("entity_id");
  if ((entityType !== "opportunity" && entityType !== "project") || !entityId) {
    return badRequest("entity_required", "entity_type(opportunity|project)·entity_id는 필수입니다.");
  }
  if (entityType === "project" && !visibleProject(auth.auth, entityId, { includeClosed: true, includeDeleted: true })) {
    return notFound();
  }
  const rows = getDb()
    .query(
      `SELECT c.id, c.author_id, u.user_id AS author, c.body, c.created_at
       FROM deal_comment c JOIN app_user u ON u.user_id = c.author_id
       WHERE c.entity_type = ? AND c.entity_id = ? ORDER BY c.created_at`,
    )
    .all(entityType, entityId);
  return ok({ comments: rows }, 200, { count: rows.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    entity_type?: string; entity_id?: string; body?: string;
  } | null;
  if ((body?.entity_type !== "opportunity" && body?.entity_type !== "project") || !body?.entity_id) {
    return badRequest("entity_required", "entity_type(opportunity|project)·entity_id는 필수입니다.");
  }
  if (!body.body?.trim()) return badRequest("body_required", "본문은 필수입니다.");
  if (body.entity_type === "project" && !visibleProject(auth.auth, body.entity_id)) return notFound();
  const now = new Date().toISOString();
  const rid = ulid();
  getDb().run(
    "INSERT INTO deal_comment (id, entity_type, entity_id, author_id, body, created_at) VALUES (?,?,?,?,?,?)",
    [rid, body.entity_type, body.entity_id, auth.auth.userId, body.body.trim(), now],
  );
  return ok({ id: rid }, 201);
}
