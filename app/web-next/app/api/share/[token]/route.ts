// GET /api/share/[token] — PUBLIC (unauthenticated) safe-share access.
// Watermarked snapshot delivery: revoked or expired links 404-equivalent
// (indistinguishable "not_found" — a dead link never confirms it existed);
// every successful access appends a share_access row. ADR-0123 #4.
import { getDb } from "../../../../../../db/client.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const link = db.query(
    "SELECT id, title, payload_json, expires_at, revoked_at, watermark FROM share_link WHERE token = ?",
  ).get(token) as
    | { id: string; title: string; payload_json: string; expires_at: string; revoked_at: string | null; watermark: string | null }
    | undefined;
  if (!link || link.revoked_at || link.expires_at < new Date().toISOString()) {
    return ok({ found: false }, 200, { access: "not_found" });
  }
  db.run("INSERT INTO share_access (id, link_id, accessed_at) VALUES (?,?,?)",
    [ulid(), link.id, new Date().toISOString()]);
  return ok({
    found: true,
    title: link.title,
    watermark: link.watermark,
    payload: JSON.parse(link.payload_json) as unknown,
  }, 200, { access: "granted" });
}
