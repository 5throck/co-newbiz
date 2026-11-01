"use client";

// Test-send dialog (design 2026-10-29-scheduled-jobs-design §13.7, P4).
// POST /api/admin/notifications/test {channel, target}: email/in_app take a user id (picked
// from the admin user list), webhook takes a configured channel key (the admin names it
// explicitly — no list endpoint exists, the server 400 invalid_target is authoritative).
// The notification row is written server-side; delivery happens on the next notify.deliver
// tick (≤ 60 s), so success shows the notification id + that note. 429 rate_limited renders
// the localized limit message. Masked-target audit happens server-side (§13.8).
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type AdminUser } from "../../../lib/api.ts";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { useAdminLabel } from "./admin-ui.tsx";

const TEST_CHANNELS = ["in_app", "email", "webhook"] as const;
type TestChannel = (typeof TEST_CHANNELS)[number];

export function TestSendDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("admin.ops");
  const tc = useTranslations("common");
  const label = useAdminLabel();
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  const [channel, setChannel] = useState<TestChannel>("in_app");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<{ notification_id: string } | null>(null);

  // User pickers come from the admin user list (user ids are admin-surface data; the email
  // requirement (app_user.email) is validated server-side and its 400 renders inline).
  useEffect(() => {
    if (channel === "webhook" || users !== null) return;
    let cancelled = false;
    api.get<AdminUser[]>("/api/admin/users")
      .then((res) => { if (!cancelled) setUsers(res.data.filter((u) => u.status === "active")); })
      .catch(() => { if (!cancelled) setUsers([]); });
    return () => { cancelled = true; };
  }, [channel, users]);

  const canSubmit = target.trim() !== "" && !busy && queued === null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ notification_id: string; channel: string; target_masked: string }>("/api/admin/notifications/test", { channel, target: target.trim() });
      setQueued({ notification_id: res.data.notification_id });
    } catch (err) {
      if (err instanceof ApiError && err.code === "rate_limited") setError(t("testRateLimited"));
      else setError(err instanceof Error ? err.message : t("testFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("testSendAria")} onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" style={{ maxWidth: "30rem", width: "100%" }}>
        <div className="modal-head"><h2>{t("testSendAria")}</h2></div>
        <p className="mt-2 mb-3 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("testIntro")}</p>
        {queued !== null ? (
          <>
            <p className="text-[color:var(--green-fg)] font-semibold">{t("testSuccessTitle")}</p>
            <p className="mt-1 mb-0"><span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("testSuccessId")}: </span>
              <code className="font-mono text-[length:var(--fs-caption)]" style={{ wordBreak: "break-all" }}>{queued.notification_id}</code>
            </p>
            <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("testSuccessNote")}</p>
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn-ghost" onClick={onClose}>{tc("close")}</button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { void submit(e); }} aria-label={t("testSendAria")} className="stack-form">
            <div className="stack-form-row">
              <label htmlFor="testChannel">{t("testChannelLabel")}</label>
              <select id="testChannel" value={channel} onChange={(e) => { setChannel(e.target.value as TestChannel); setTarget(""); setError(null); }}>
                {TEST_CHANNELS.map((c) => <option key={c} value={c}>{label("channel", c)}</option>)}
              </select>
            </div>
            <div className="stack-form-row">
              <label htmlFor="testTarget">{t("testTargetLabel")}</label>
              {channel === "webhook" ? (
                <>
                  <input
                    id="testTarget"
                    className="sizing-new-input"
                    placeholder={t("testTargetPlaceholder")}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    autoComplete="off"
                    aria-describedby="testTargetHint"
                  />
                  <p id="testTargetHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("testTargetWebhookHint")}</p>
                </>
              ) : (
                <>
                  <select id="testTarget" value={target} onChange={(e) => setTarget(e.target.value)} aria-describedby="testTargetHint" required>
                    <option value="" disabled>—</option>
                    {(users ?? []).map((u) => (
                      <option key={u.user_id} value={u.user_id}>{u.user_id}{u.display_name ? ` (${u.display_name})` : ""}</option>
                    ))}
                  </select>
                  <p id="testTargetHint" className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("testTargetUserHint")}</p>
                </>
              )}
            </div>
            {users !== null && users.length === 0 && channel !== "webhook" && <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("testUsersFailed")}</p>}
            {error !== null && <p role="alert" className="m-0 text-[length:var(--fs-body)] text-[color:var(--red-fg)]">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>{tc("cancel")}</button>
              <button type="submit" className="btn-primary" disabled={!canSubmit}>{busy ? tc("saving") : t("testSubmit")}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
