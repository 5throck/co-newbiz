// GET /api/archive/deals — delete-marked deal manifests visible to the caller.
// Deny-by-default: only manifests whose member allowlist (members at mark
// time) includes the caller. Admins are blocked from deal content entirely
// (role separation, ADR-0091).
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { listDeletedDealArchives } from "../../../../../../db/repositories/deal-archive.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "read");
  if (denied) return denied;
  const rows = listDeletedDealArchives(ctx.userId);
  appendAudit(getDb(), {
    actor: ctx.userId,
    action: "archive_list",
    target: `${rows.length} rows`,
    now: new Date().toISOString(),
  });
  return ok(rows, 200, { count: rows.length });
}
