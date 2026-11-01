// @version 1.0.0
/**
 * Recipient-policy resolution (ADR-0189/0190, scheduled-jobs design section 13.4, phase P3 row 3).
 *
 * Pure DB functions: given a notification row + a db handle, resolve WHO receives it on WHICH external channel.
 * Nothing here sends or writes (except nothing at all — callers do the writes) so handlers and tests can compose it.
 *
 * Rules (design section 13.4 + D9 seed rows in migration 0185):
 *   - notification.user_id != 'system' → the addressed user IS the seed recipient (existing producer behaviour).
 *   - notification.user_id = 'system'  → audience comes from notification_recipient_policy; a trigger-specific
 *     policy row wins over a NULL-trigger row; no match = nobody.
 *   - Audiences: 'owner' → the WATCH owner only, resolved via source_ref 'watch_rule:<id>' → watch_rule → watch.user_id
 *     (design decision: resolveResponsibleUser is deliberately NOT used here — a watch notification belongs to the
 *     person who asked for the watch, not to a derived responsible party). 'role:<role>' → active project_member rows
 *     of the project whose app_user.role ranks >= the named role. 'admins' → active admin accounts.
 *     'project_members' → all active members of the project.
 *   - project_id NULL ⇒ owner/role/project_members audiences expand to NOTHING (a system batch_failure reaches
 *     admins only — per the D9 seed); 'admins' needs no project.
 *   - Channels = policy channels ∩ the producer's channel bound (notification.channel: 'all' = unrestricted;
 *     'in_app' = no external delivery; 'email'/'webhook' = that channel only).
 *   - user_notification_pref opt-outs subtract email/webhook only; in-app is never opted out, and an URGENT
 *     KILL-CRITERIA notification ignores opt-outs entirely (checked by trigger_type, not severity alone — ADR-0190 §4).
 *
 * Role-rank note: since migration 0110 project_member.project_role is only 'lead'|'member', while the D9 seed names
 * 'role:analyst'. The named role is therefore the app_user.platform role (viewer < analyst < admin), joined with an
 * ACTIVE (revoked_at IS NULL) project membership row on the notification's project.
 *
 * Layering: db/lib imports nothing from scripts/ or app/web-next/lib. Recipient addresses are read from
 * app_user.email at resolve time (migration 0185 D-3); callers must store only maskAddress(email) — never the raw form.
 */
import type { NotifyView } from "./email.ts";

export type NotifySeverity = NotifyView["severity"];
export type ExternalChannel = "email" | "webhook";

/** The notification row shape policy resolution needs (0185 shape; title/payload not needed here). */
export interface NotificationRowLike {
  id: string;
  user_id: string; // 'system' sentinel for system events (design section 13.4)
  project_id: string | null;
  trigger_type: string;
  severity: NotifySeverity;
  channel: "in_app" | "email" | "webhook" | "all";
  bundle: "immediate" | "daily";
  source_ref?: string | null; // e.g. 'watch_rule:<id>' (owner chain), 'job_run:<id>'
}

export interface ResolvedRecipient {
  recipientUserId: string;
  /** app_user.email read at resolve time; NULL until the P4 provisioning UI exists. Callers store masked only. */
  recipientAddress: string | null;
  /** external channels for this recipient after policy ∩ bound ∩ opt-outs */
  channels: ExternalChannel[];
}

export interface PolicyResolution {
  /** external-channel recipients (email/webhook delivery rows are created per recipient × channel) */
  recipients: ResolvedRecipient[];
  /** user_ids entitled to in-app delivery; for a 'system' parent the caller fans out one notification row each */
  inAppUserIds: string[];
  /** the notification_recipient_policy rows that matched ('system' rows only); empty for addressed rows */
  matchedPolicyIds: string[];
}

const EXTERNAL: ExternalChannel[] = ["email", "webhook"];

/** External channels the producer's own `channel` field permits ('all' = unrestricted; 'in_app' = none). */
export function channelBound(channel: NotificationRowLike["channel"]): ExternalChannel[] {
  if (channel === "all") return [...EXTERNAL];
  if (channel === "email" || channel === "webhook") return [channel];
  return []; // 'in_app'
}

interface PolicyRow {
  id: string;
  severity: NotifySeverity;
  trigger_type: string | null;
  audience: string;
  channels: string; // JSON array
  bundle: "immediate" | "daily";
  enabled: number;
}

/** Trigger-specific rows win over NULL-trigger rows (replace); rows within a group are additive audiences. */
export function matchPolicies(db: any, notification: NotificationRowLike): PolicyRow[] {
  const rows = db
    .query(
      `SELECT id, severity, trigger_type, audience, channels, bundle, enabled
       FROM notification_recipient_policy
       WHERE enabled = 1 AND severity = ? AND (trigger_type = ? OR trigger_type IS NULL)`,
    )
    .all(notification.severity, notification.trigger_type) as PolicyRow[];
  if (rows.length === 0) return [];
  // Trigger-specific rows WIN over NULL-trigger rows (they replace, not add); within a group the rows are
  // ADDITIVE audiences - the D9 seed expresses "urgent -> owner AND role:analyst AND admins" as three rows.
  const specific = rows.filter((r) => r.trigger_type === notification.trigger_type);
  return specific.length > 0 ? specific : rows;
}

function parseAudience(audience: string): { kind: "owner" | "admins" | "project_members" | "role"; role?: string } {
  if (audience === "owner" || audience === "admins" || audience === "project_members") return { kind: audience };
  if (audience.startsWith("role:")) return { kind: "role", role: audience.slice("role:".length) };
  return { kind: "admins" }; // defensive: an unknown audience string must not widen delivery (0185 keeps audience CHECK-free on purpose)
}

/** app_user role rank (migration 0008): viewer < analyst < admin. Unknown roles rank below analyst. */
function roleRank(role: string): number {
  return role === "admin" ? 2 : role === "analyst" ? 1 : 0;
}

/** The watch owner from a source_ref 'watch_rule:<id>' — rule → watch.user_id. NULL when the chain is broken. */
export function watchOwnerFromSourceRef(db: any, sourceRef: string | null | undefined): string | null {
  const m = /^watch_rule:([A-Za-z0-9-]+)$/.exec(sourceRef ?? "");
  if (!m) return null;
  const row = db
    .query("SELECT w.user_id FROM watch_rule wr JOIN watch w ON w.id = wr.watch_id WHERE wr.id = ?")
    .get(m[1]) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

/** cooldown_hours from the watch_rule named in source_ref; fallback (24h) when the ref is absent or not a rule. */
export function cooldownHoursFromSourceRef(db: any, sourceRef: string | null | undefined, fallbackHours = 24): number {
  const m = /^watch_rule:([A-Za-z0-9-]+)$/.exec(sourceRef ?? "");
  if (!m) return fallbackHours;
  const row = db.query("SELECT cooldown_hours FROM watch_rule WHERE id = ?").get(m[1]) as
    | { cooldown_hours: number }
    | undefined;
  return row && Number.isFinite(row.cooldown_hours) && row.cooldown_hours > 0 ? row.cooldown_hours : fallbackHours;
}

function activeAdmins(db: any): string[] {
  return (
    db.query("SELECT user_id FROM app_user WHERE role = 'admin' AND status = 'active'").all() as { user_id: string }[]
  ).map((r) => r.user_id);
}

/** Opt-out check (D12): pref row with opt_in = 0 for this user × channel × severity. */
function isOptedOut(db: any, userId: string, channel: ExternalChannel, severity: NotifySeverity): boolean {
  const row = db
    .query("SELECT opt_in FROM user_notification_pref WHERE user_id = ? AND channel = ? AND severity = ?")
    .get(userId, channel, severity) as { opt_in: number } | undefined;
  return row?.opt_in === 0;
}

/** Resolve one policy row's audience to user ids (no opt-out filtering here). */
function resolveAudience(
  db: any,
  audience: { kind: "owner" | "admins" | "project_members" | "role"; role?: string },
  notification: NotificationRowLike,
): string[] {
  const { kind, role } = audience;
  if (kind === "admins") return [...new Set(activeAdmins(db))];
  // Every audience below is project-scoped: project_id NULL ⇒ expands to nothing (design D9).
  if (!notification.project_id) return [];
  if (kind === "owner") {
    const owner = watchOwnerFromSourceRef(db, notification.source_ref);
    return owner ? [owner] : [];
  }
  if (kind === "project_members") {
    return (
      db
        .query(
          `SELECT pm.user_id FROM project_member pm JOIN app_user u ON u.user_id = pm.user_id
           WHERE pm.project_id = ? AND pm.revoked_at IS NULL AND u.status = 'active'`,
        )
        .all(notification.project_id) as { user_id: string }[]
    ).map((r) => r.user_id);
  }
  // role:<role> — active members whose platform role ranks at least the named role (see module docstring).
  const minRank = roleRank(role ?? "");
  return (
    db
      .query(
        `SELECT pm.user_id, u.role AS role FROM project_member pm JOIN app_user u ON u.user_id = pm.user_id
         WHERE pm.project_id = ? AND pm.revoked_at IS NULL AND u.status = 'active'`,
      )
      .all(notification.project_id) as { user_id: string; role: string }[]
  )
    .filter((r) => roleRank(r.role ?? "") >= minRank)
    .map((r) => r.user_id);
}

/**
 * Resolve the recipient policy for one notification row (design section 13.4). All matching policy rows contribute
 * ADDITIVELY (the D9 urgent seed is three rows: owner + role:analyst + admins); each recipient's channel set is the
 * union of the channels of the rows that reach them. Reads app_user/project_member/watch tables; performs NO writes
 * and NO sends.
 */
export function resolveRecipients(db: any, notification: NotificationRowLike): PolicyResolution {
  const bound = channelBound(notification.channel);
  const isSystem = notification.user_id === "system";

  if (!isSystem) {
    // Addressed-user row: the audience is the seed recipient, but CHANNELS still come from the policy
    // (severity + trigger) intersected with the producer bound — the policy is the source of channel truth
    // (design section 13.4 "resolves the policy (severity + trigger -> audience -> channels)"; D9 fatigue rules).
    const policies = matchPolicies(db, notification);
    const policyChannels = new Set<string>();
    for (const p of policies) {
      const parsed = JSON.parse(p.channels) as string[];
      for (const c of parsed) policyChannels.add(c);
    }
    const external = bound.filter((c) => policyChannels.has(c));
    const keptChannels =
      applyOptOuts(db, [notification.user_id], external, notification).get(notification.user_id) ?? [];
    const addr = readAddress(db, notification.user_id);
    return {
      recipients:
        keptChannels.length > 0
          ? [{ recipientUserId: notification.user_id, recipientAddress: addr, channels: keptChannels }]
          : [],
      inAppUserIds: [],
      matchedPolicyIds: policies.map((p) => p.id),
    };
  }

  const policies = matchPolicies(db, notification);
  if (policies.length === 0) return { recipients: [], inAppUserIds: [], matchedPolicyIds: [] };

  const channelsByUser = new Map<string, Set<ExternalChannel>>();
  const inAppUsers = new Set<string>();
  for (const policy of policies) {
    const users = [...new Set(resolveAudience(db, parseAudience(policy.audience), notification))];
    const policyChannels = (JSON.parse(policy.channels) as string[]).filter(
      (c): c is ExternalChannel | "in_app" => EXTERNAL.includes(c as ExternalChannel) || c === "in_app",
    );
    if (policyChannels.includes("in_app")) for (const u of users) inAppUsers.add(u); // in-app has no opt-out (D12)
    const external = bound.filter((c) => policyChannels.includes(c));
    const keptPerUser = applyOptOuts(db, users, external, notification);
    for (const [uid, keptChannels] of keptPerUser) {
      if (keptChannels.length === 0) continue;
      const set = channelsByUser.get(uid) ?? new Set<ExternalChannel>();
      for (const c of keptChannels) set.add(c);
      channelsByUser.set(uid, set);
    }
  }

  return {
    recipients: [...channelsByUser.entries()].map(([recipientUserId, channels]) => ({
      recipientUserId,
      recipientAddress: readAddress(db, recipientUserId),
      channels: [...channels],
    })),
    inAppUserIds: [...inAppUsers],
    matchedPolicyIds: policies.map((p) => p.id),
  };
}

/** Subtract per-user opt-outs; urgent kill-criteria ignores opt-outs entirely (ADR-0190 §4). Returns per-user kept channels. */
function applyOptOuts(
  db: any,
  userIds: string[],
  channels: ExternalChannel[],
  notification: NotificationRowLike,
): Map<string, ExternalChannel[]> {
  const out = new Map<string, ExternalChannel[]>();
  const ignoresOptOuts = notification.severity === "urgent" && notification.trigger_type === "kill_criteria";
  for (const uid of userIds) {
    out.set(
      uid,
      ignoresOptOuts ? [...channels] : channels.filter((c) => !isOptedOut(db, uid, c, notification.severity)),
    );
  }
  return out;
}

function readAddress(db: any, userId: string): string | null {
  const row = db.query("SELECT email FROM app_user WHERE user_id = ?").get(userId) as
    | { email: string | null }
    | undefined;
  return row?.email ?? null;
}
