// Port of app/server/monitoring.ts GET /api/notifications
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const rows = getDb()
    .query(
      `SELECT id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at
       FROM notification WHERE user_id = ? ORDER BY sent_at DESC, id DESC LIMIT 200`,
    )
    .all(auth.auth.userId) as Array<{ read_at: string | null }>;
  const unread = rows.filter((r) => r.read_at === null).length;
  return ok(rows, 200, { count: rows.length, unread_count: unread });
}
