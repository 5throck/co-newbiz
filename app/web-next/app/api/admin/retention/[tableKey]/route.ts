// Remove one retention policy row (the policy only — never data). Admin role; audited.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function DELETE(request: Request, { params }: { params: Promise<{ tableKey: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { tableKey } = await params;
  const db = getDb();
  const res = db.run("DELETE FROM retention_policy WHERE table_key = ?", [tableKey]);
  if (res.changes === 0) return notFound();
  appendAudit(db, { actor: auth.auth.userId, action: "retention_policy_delete", target: tableKey, now: new Date().toISOString() });
  return ok({ ok: true, table_key: tableKey });
}
