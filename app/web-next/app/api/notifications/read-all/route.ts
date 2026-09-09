// POST /api/notifications/read-all — mark all of the caller's unread notifications read.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const before = db.query("SELECT COUNT(*) AS c FROM notification WHERE user_id = ? AND read_at IS NULL").get(auth.auth.userId) as { c: number };
  const now = new Date().toISOString();
  db.run("UPDATE notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL", [now, auth.auth.userId]);
  return ok({ marked: before.c }, 200, { unread_count: 0 });
}
