// S7 — 제외 (Exclusion Reasons 기록).
import { getDb } from "../../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "제외는 analyst 역할 이상이어야 합니다.");
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;
  const reason = body?.reason?.trim();
  if (!reason) return badRequest("invalid_request", "제외 사유(reason)는 필수입니다.");
  const db = getDb();
  const existing = db
    .query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { id: string } | undefined;
  if (!existing) return notFound();
  db.run("UPDATE brownfield_target SET status = 'excluded', exclusion_reason = ?, rank = NULL, updated_at = ? WHERE id = ?", [reason, now(), targetId]);
  return ok(db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId), 200);
}
