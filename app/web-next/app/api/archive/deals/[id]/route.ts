// GET /api/archive/deals/[id] — one deal_archive manifest. Only the members
// recorded at mark time may view it (deny-by-default, deal-archive.repository),
// and every successful view is audit-logged: the archive exists FOR audit, so
// the audit must show who inspected it.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { getDealArchiveIfVisible } from "../../../../../../../db/repositories/deal-archive.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "read");
  if (denied) return denied;
  const { id } = await params;
  const row = getDealArchiveIfVisible(ctx.userId, id);
  if (!row) return notFound();
  let marketFreeze: unknown = null;
  try {
    marketFreeze = row.market_freeze_json ? (JSON.parse(row.market_freeze_json) as unknown) : null;
  } catch {
    marketFreeze = null;
  }
  appendAudit(getDb(), { actor: ctx.userId, action: "archive_view", target: id, now: new Date().toISOString() });
  return ok({ ...row, market_freeze: marketFreeze }, 200);
}
