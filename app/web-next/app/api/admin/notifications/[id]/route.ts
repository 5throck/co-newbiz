// Admin notification detail (design 2026-10-29-scheduled-jobs-design §13.5, P4).
// GET /api/admin/notifications/[id] — the full row for the detail drawer: parsed
// payload (JSON viewer), title, source_ref, timestamps, project, and the complete
// notification_delivery attempts table.
//
// Masking (design §13.8, for everyone incl. admins): recipient addresses come back
// exactly as stored — MASKED at write time (j***@example.com); last_error was
// scrubbed at write time through the central scrubber; webhook targets appear only
// as target_key (the URL lives in env and is never read here).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { id } = await params;
  const db = getDb();

  const row = db
    .query(
      `SELECT n.id, n.user_id, n.project_id, n.trigger_type, n.severity, n.payload, n.channel, n.bundle,
              n.sent_at, n.read_at, n.dedupe_key, n.title, n.source_ref, p.project_no
       FROM notification n LEFT JOIN md_project p ON p.id = n.project_id
       WHERE n.id = ?`,
    )
    .get(id) as
    | {
        id: string;
        user_id: string;
        project_id: string | null;
        trigger_type: string;
        severity: string;
        payload: string;
        channel: string;
        bundle: string;
        sent_at: string;
        read_at: string | null;
        dedupe_key: string | null;
        title: string | null;
        source_ref: string | null;
        project_no: string | null;
      }
    | undefined;
  if (!row) return notFound();

  // The payload is stored as JSON by every producer; a malformed row falls back to the
  // raw string so the viewer always has something honest to show.
  let payload: unknown = row.payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    /* keep the raw string */
  }

  const deliveries = db
    .query(
      `SELECT id, channel, recipient_user_id, recipient_address_masked, target_key, status, attempt,
              next_attempt_at, last_error, provider_message_id, digest_id, is_test, created_at, sent_at
       FROM notification_delivery WHERE notification_id = ? ORDER BY created_at, id`,
    )
    .all(id) as Array<Record<string, unknown>>;

  return ok({
    id: row.id,
    user_id: row.user_id,
    project: row.project_id ? { id: row.project_id, project_no: row.project_no } : null,
    trigger_type: row.trigger_type,
    severity: row.severity,
    title: row.title,
    payload,
    channel: row.channel,
    bundle: row.bundle,
    sent_at: row.sent_at,
    read_at: row.read_at,
    dedupe_key: row.dedupe_key,
    source_ref: row.source_ref,
    deliveries,
  });
}
