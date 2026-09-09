// POST /api/notifications/[id]/read — mark one notification read for the caller only.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.query("SELECT id, read_at FROM notification WHERE id = ? AND user_id = ?").get(id, auth.auth.userId) as { id: string; read_at: string | null } | undefined;
  if (!existing) return notFound("Notification not found.");
  if (existing.read_at === null) db.run("UPDATE notification SET read_at = ? WHERE id = ? AND user_id = ?", [now, id, auth.auth.userId]);
  const row = db.query("SELECT id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at FROM notification WHERE id = ? AND user_id = ?").get(id, auth.auth.userId);
  return ok(row, 200, { changed: existing.read_at === null });
}
