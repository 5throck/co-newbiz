// Port of app/server/monitoring.ts DELETE /api/watch/:id
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { notFound, ok } from "../../../../lib/envelope.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const { id } = await params;
  const userId = auth.auth.userId;
  const owned = db.query("SELECT id FROM watch WHERE id = ? AND user_id = ?").get(id, userId);
  if (!owned) return notFound();
  db.run("DELETE FROM watch_rule WHERE watch_id = ?", [id]);
  db.run("DELETE FROM watch WHERE id = ?", [id]);
  appendAudit(db, { actor: userId, action: "watch_delete", target: id, now: new Date().toISOString() });
  return ok({ ok: true });
}
