// Admin notification history (design 2026-10-29-scheduled-jobs-design §13.5, P4).
// GET — server-side filters (from/to on sent_at, trigger_type, severity, channel,
// read, delivery_status, project_id, q) + paging (page/page_size, max 100; the old
// hard limit-500 read is gone) + a per-row delivery summary.
//
// Delivery summary contract (documented decision): per-channel STATUS COUNTS built
// from notification_delivery rows of just the page's ids (second query, GROUP BY —
// O(page), never a per-row subquery over the whole ledger). Example:
//   delivery: { "email": { "sent": 2, "pending": 1 }, "webhook": { "failed": 1 } }
// Non-zero statuses only; in-app-only rows (no external delivery) carry {}. The
// in-app channel itself has no delivery ledger rows — the notification row IS the
// in-app delivery (design §13.2).
//
// Channel filter semantics: notification.channel is the producer BOUND, so
// channel=email matches rows whose bound includes email ('email' | 'all') —
// a row bound 'all' did go out over email when policy resolved it.
//
// Masking (design §13.8): addresses are stored masked on notification_delivery and
// last_error is scrubbed at write time; this list returns neither raw addresses nor
// webhook URLs (webhook targets appear only as target_key).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";

const DELIVERY_STATUSES = ["pending", "retry", "sent", "failed", "skipped", "deferred"];
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const Q_MAX_CHARS = 100;

/** Date-only `to` values extend to end-of-day UTC so "to=2026-10-31" includes the 31st. */
function normalizeBound(value: string, kind: "from" | "to"): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}${kind === "from" ? "T00:00:00.000Z" : "T23:59:59.999Z"}`;
  if (Number.isNaN(Date.parse(trimmed))) return null;
  return trimmed;
}

/** Escape LIKE wildcards so a user-supplied % or _ matches literally, then bound the needle length. */
function likeNeedle(q: string): string {
  return q.trim().slice(0, Q_MAX_CHARS).replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;

  // ── paging (defaults 50, cap 100 — the §13.5 "drop the hard 200/500 limit" change) ──
  const pageRaw = params.get("page") ?? "1";
  const pageSizeRaw = params.get("page_size") ?? String(DEFAULT_PAGE_SIZE);
  const page = Number(pageRaw);
  const pageSize = Number(pageSizeRaw);
  if (!Number.isInteger(page) || page < 1) return badRequest("invalid_filter", "page must be an integer >= 1.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return badRequest("invalid_filter", `page_size must be an integer between 1 and ${MAX_PAGE_SIZE}.`);
  }

  // ── filters ──
  const where: string[] = [];
  const values: (string | number)[] = [];

  const fromRaw = params.get("from");
  if (fromRaw) {
    const from = normalizeBound(fromRaw, "from");
    if (!from) return badRequest("invalid_filter", "from must be an ISO date or date-time.");
    where.push("n.sent_at >= ?");
    values.push(from);
  }
  const toRaw = params.get("to");
  if (toRaw) {
    const to = normalizeBound(toRaw, "to");
    if (!to) return badRequest("invalid_filter", "to must be an ISO date or date-time.");
    where.push("n.sent_at <= ?");
    values.push(to);
  }
  const triggerType = params.get("trigger_type");
  if (triggerType) {
    where.push("n.trigger_type = ?");
    values.push(triggerType);
  }
  const severity = params.get("severity");
  if (severity) {
    where.push("n.severity = ?");
    values.push(severity);
  }
  const channel = params.get("channel");
  if (channel) {
    // Inclusive bound matching — see module docstring.
    if (channel === "in_app") where.push("n.channel IN ('in_app', 'all')");
    else if (channel === "email") where.push("n.channel IN ('email', 'all')");
    else if (channel === "webhook") where.push("n.channel IN ('webhook', 'all')");
    else return badRequest("invalid_filter", "channel must be one of: in_app, email, webhook.");
  }
  const read = params.get("read");
  if (read) {
    if (read === "read") where.push("n.read_at IS NOT NULL");
    else if (read === "unread") where.push("n.read_at IS NULL");
    else return badRequest("invalid_filter", "read must be 'read' or 'unread'.");
  }
  const projectId = params.get("project_id");
  if (projectId) {
    where.push("n.project_id = ?");
    values.push(projectId);
  }
  const deliveryStatus = params.get("delivery_status");
  if (deliveryStatus) {
    if (!(DELIVERY_STATUSES as string[]).includes(deliveryStatus)) {
      return badRequest("invalid_filter", `delivery_status must be one of: ${DELIVERY_STATUSES.join(", ")}.`);
    }
    // Rows with at least one external delivery in this status; in-app-only rows have no
    // delivery ledger rows and are (honestly) excluded by this filter.
    where.push("EXISTS (SELECT 1 FROM notification_delivery d WHERE d.notification_id = n.id AND d.status = ?)");
    values.push(deliveryStatus);
  }
  const q = params.get("q");
  if (q && q.trim() !== "") {
    const needle = likeNeedle(q);
    // Bounded excerpt: payload heads are searched, not whole blobs (§13.5 "payload excerpt").
    where.push("(n.title LIKE '%' || ? || '%' ESCAPE '\\' OR substr(n.payload, 1, 500) LIKE '%' || ? || '%' ESCAPE '\\')");
    values.push(needle, needle);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const db = getDb();

  const total = (
    db.query(`SELECT COUNT(*) AS c FROM notification n ${whereSql}`).get(...values) as { c: number }
  ).c;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rows = db
    .query(
      `SELECT n.id, n.sent_at, n.read_at, n.trigger_type, n.severity, n.title, n.channel,
              n.project_id, p.project_no
       FROM notification n LEFT JOIN md_project p ON p.id = n.project_id
       ${whereSql}
       ORDER BY n.sent_at DESC, n.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, (page - 1) * pageSize) as Array<{
    id: string;
    sent_at: string;
    read_at: string | null;
    trigger_type: string;
    severity: string;
    title: string | null;
    channel: string;
    project_id: string | null;
    project_no: string | null;
  }>;

  // Per-row delivery summary: one GROUP BY over just the page's ids (O(page), see module docstring).
  const delivery: Record<string, Record<string, Record<string, number>>> = {};
  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(",");
    const counts = db
      .query(
        `SELECT d.notification_id, d.channel, d.status, COUNT(*) AS c
         FROM notification_delivery d
         WHERE d.notification_id IN (${placeholders})
         GROUP BY d.notification_id, d.channel, d.status`,
      )
      .all(...rows.map((r) => r.id)) as Array<{ notification_id: string; channel: string; status: string; c: number }>;
    for (const r of rows) delivery[r.id] = {};
    for (const c of counts) {
      const perRow = delivery[c.notification_id];
      if (!perRow) continue;
      (perRow[c.channel] ??= {})[c.status] = c.c;
    }
  }

  return ok(
    {
      rows: rows.map((r) => ({
        id: r.id,
        sent_at: r.sent_at,
        read_at: r.read_at,
        trigger_type: r.trigger_type,
        severity: r.severity,
        title: r.title,
        project: r.project_id ? { id: r.project_id, project_no: r.project_no } : null,
        delivery: delivery[r.id] ?? {},
      })),
    },
    200,
    { page, page_size: pageSize, total, total_pages: totalPages },
  );
}
