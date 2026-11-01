// Admin test send (design 2026-10-29-scheduled-jobs-design §13.7, P4).
// POST /api/admin/notifications/test — body {channel: 'email'|'webhook'|'in_app', target}:
//   - email   → target is a user id; the user must exist AND carry app_user.email (400 otherwise)
//   - in_app  → target is a user id; the user must exist
//   - webhook → target is a CONFIGURED webhook channel key (notify_webhook_target, enabled)
//
// Creates one notification row: trigger_type 'test' (0185 added it to the CHECK so test
// traffic never pollutes real trigger statistics), severity info, title "Test notification",
// bundle immediate. It is NOT sent here — expansion + send happen on the next notify.deliver
// tick (≤ 60 s); the UI polls the delivery status. The deliver worker tags the expansion's
// delivery rows is_test = 1 (P3 threading, verified in tests).
//
// Webhook note: the admin names the channel key EXPLICITLY, so the requested key is carried
// on the payload and honored by the expansion (notify-deliver.testWebhookTargetKey) — the
// regular severity→target mapping (webhookTargetKeyFor) applies to real traffic only, and the
// D9 seed grants webhook to urgent/ops traffic only.
//
// Audited as notification_test_sent with the MASKED target (§13.8); rate-limited to 5 per
// admin per hour, counted over this action's own audit rows, 429 on excess.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { maskAddress } from "../../../../../../../db/lib/notify/email.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, fail, ok } from "../../../../../lib/envelope.ts";

const TEST_SEND_LIMIT_PER_HOUR = 5;
const TEST_CHANNELS = ["email", "webhook", "in_app"] as const;
type TestChannel = (typeof TEST_CHANNELS)[number];

interface TestBody {
  channel?: unknown;
  target?: unknown;
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as TestBody | null;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "request body must be a JSON object.");
  }
  if (typeof body.channel !== "string" || !(TEST_CHANNELS as readonly string[]).includes(body.channel)) {
    return badRequest("invalid_request", `channel must be one of: ${TEST_CHANNELS.join(", ")}.`);
  }
  if (typeof body.target !== "string" || body.target.trim() === "") {
    return badRequest("invalid_request", "target is required (user id for email/in_app, webhook channel key for webhook).");
  }
  const channel = body.channel as TestChannel;
  const target = body.target.trim();

  const db = getDb();
  const nowIso = new Date().toISOString();

  // Resolve and validate the target per channel; the masked target is the audit form (§13.8).
  let recipientUserId: string;
  let maskedTarget: string;
  if (channel === "webhook") {
    const targetRow = db
      .query("SELECT channel_key FROM notify_webhook_target WHERE channel_key = ? AND enabled = 1")
      .get(target) as { channel_key: string } | undefined;
    if (!targetRow) {
      return badRequest("invalid_target", `webhook target '${target}' is not a configured, enabled channel key.`);
    }
    recipientUserId = "system"; // channel-level target, no single user (0185 convention)
    maskedTarget = target; // a channel key is config, not a secret — the URL in env is
  } else {
    const user = db
      .query("SELECT user_id, email FROM app_user WHERE user_id = ? AND status = 'active'")
      .get(target) as { user_id: string; email: string | null } | undefined;
    if (!user) {
      return badRequest("invalid_target", `target user '${target}' does not exist or is not active.`);
    }
    if (channel === "email" && !user.email) {
      return badRequest("invalid_target", `target user '${target}' has no app_user.email on record.`);
    }
    recipientUserId = user.user_id;
    maskedTarget = channel === "email" && user.email ? maskAddress(user.email) : user.user_id;
  }

  // Rate limit: 5 per admin per hour, counted over this action's audit rows (§13.7).
  const hourAgo = new Date(Date.parse(nowIso) - 3_600_000).toISOString();
  const recent = (
    db
      .query(
        "SELECT COUNT(*) AS c FROM audit_log WHERE actor_user_id = ? AND action = 'notification_test_sent' AND created_at >= ?",
      )
      .get(auth.auth.userId, hourAgo) as { c: number }
  ).c;
  if (recent >= TEST_SEND_LIMIT_PER_HOUR) {
    return fail(429, "rate_limited", `test-send limit reached: ${TEST_SEND_LIMIT_PER_HOUR} per admin per hour.`);
  }

  const notificationId = ulid();
  const payload = JSON.stringify({
    test: true,
    channel,
    target_masked: maskedTarget,
    ...(channel === "webhook" ? { webhook_target_key: target } : {}),
    requested_by: auth.auth.userId,
    requested_at: nowIso,
  });
  db.run(
    `INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, title, source_ref)
     VALUES (?, ?, NULL, 'test', 'info', ?, ?, 'immediate', ?, 'Test notification', ?)`,
    [notificationId, recipientUserId, payload, channel, nowIso, `admin_test:${auth.auth.userId}`],
  );
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "notification_test_sent",
    target: `${channel}:${maskedTarget}`,
    now: nowIso,
  });

  return ok(
    {
      notification_id: notificationId,
      channel,
      target_masked: maskedTarget,
      note: "Queued — notify.deliver expands and sends it on its next tick (≤ 60 s); delivery status is visible on the notification detail.",
    },
    201,
  );
}
