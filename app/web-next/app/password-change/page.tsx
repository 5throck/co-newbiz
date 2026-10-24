"use client";

// Self-service password change — also the completion step of the forced
// must-change-password flow after an admin reset. Three fields: the
// current (or admin-issued temporary) password plus the new password with
// a confirmation field, so "same value in both boxes" can no longer be
// mistaken for a verify-and-confirm form.
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api, ApiError } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";

export default function PasswordChangePage() {
  const t = useTranslations("auth.passwordChange");
  const { refresh } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // T-20261022-034: same pre-hydration native-submit defect as the login page
  // (T-20261022-020). Until React attaches onSubmit, a submit POSTs natively —
  // the form declares method="post" + action="/api/auth/password-change" so the
  // credentials never land in a URL query, and the route (session-gated, JSON
  // body only) refuses the form-encoded POST with 4xx. The button stays
  // disabled until hydration; once the handler is attached, preventDefault
  // keeps the fetch-based flow below.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("mismatch"));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t("sameAsCurrent"));
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/password-change", { currentPassword, newPassword });
      await refresh();
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form onSubmit={onSubmit} method="post" action="/api/auth/password-change" className="login-form" aria-labelledby="pw-heading">
        <h1 id="pw-heading">{t("heading")}</h1>
        <p>
          {t("intro")}
        </p>
        <label htmlFor="currentPassword">{t("lblCurrent")}</label>
        <input id="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        <label htmlFor="newPassword">{t("lblNew")}</label>
        <input id="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        <label htmlFor="confirmPassword">{t("lblConfirm")}</label>
        <input id="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
        {error && (
          <p role="alert" className="text-[color:var(--red-fg)]">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={busy || !hydrated}>
          {busy ? t("saving") : t("submit")}
        </button>
      </form>
    </main>
  );
}
