"use client";

// Legacy-record re-confirmation notice (ADR-0186 O-6). While a requirement is open on the project it is shown on every
// project stage screen: what is still needed (icon + text, with a link to where it is done), why, and a clear action for a
// person. The server decides who may clear (IC reviewer grant, not the recorder) and every refusal text; administrators open
// requirements from the admin console (an administrator has no project visibility). Nothing here records a decision.
import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, Circle, ShieldAlert } from "lucide-react";
import { api, ApiError } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import {
  canTryClear, reconfirmErrorText, reconfirmItemHref, type ReconfirmItemKey, type ReconfirmView,
} from "../lib/reconfirm-view.ts";
import { useToast } from "./ui.tsx";

const small = "text-[length:var(--fs-caption)]";
const muted = "text-[color:var(--muted-fg)]";

export function ReconfirmNotice({ projectId }: { projectId: string }) {
  const t = useTranslations("components.reconfirm");
  const { me } = useAuth();
  const { toast } = useToast();
  const uid = useId().replace(/:/g, "");
  const [view, setView] = useState<ReconfirmView | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = useCallback((k: ReconfirmItemKey) => t(`item.${k}` as never), [t]);

  const load = useCallback(() => {
    api.get<ReconfirmView>(`/api/projects/${encodeURIComponent(projectId)}/reconfirm`)
      .then((r) => setView(r.data))
      .catch(() => setView(null)); // a notice is additional information: a failed read hides it
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  function fail(e: unknown) {
    setError(e instanceof ApiError ? reconfirmErrorText(e.message, e.details, label) : e instanceof Error ? e.message : t("failed"));
  }

  async function clear() {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/reconfirm/clear`, { reason: reason.trim() });
      toast(t("cleared")); setReason(""); load();
    } catch (e) { fail(e); load(); } finally { setBusy(false); }
  }

  if (!view) return null;

  if (!view.open) return null;

  const items = view.items ?? [];
  const tryClear = canTryClear(me?.role);
  return (
    <section className="card mb-4" aria-labelledby={`${uid}-h`} data-testid="reconfirm-notice" style={{ borderColor: "var(--amber-border)" }}>
      <h2 id={`${uid}-h`} className="m-0 mb-1"><ShieldAlert size={16} aria-hidden="true" className="inline mr-1" />{t("title")}</h2>
      <p className={`${small} m-0 mb-2`}>{t("body")}</p>
      <p className={`${small} ${muted} m-0 mb-2`}>{t("reasonPrefix")} {view.reason}</p>
      <ul className="list-none p-0 m-0 mb-2 grid gap-1">
        {items.map((i) => (
          <li key={i.key} className={`${small} flex flex-wrap items-center gap-2`}>
            {i.satisfied
              ? <span className="status-chip status-green"><CheckCircle2 size={14} aria-hidden="true" /> {t("satisfied")}</span>
              : <span className="status-chip status-amber"><Circle size={14} aria-hidden="true" /> {t("unmet")}</span>}
            <span>{label(i.key)}</span>
            {!i.satisfied && <Link href={reconfirmItemHref(projectId, i.key)} className="underline">{t("open")}</Link>}
          </li>
        ))}
      </ul>
      <p className={`${small} ${muted} m-0 mb-2`}>{t("holdKillNote")}</p>
      {tryClear ? (
        <form className="grid gap-2" aria-label={t("clear.heading")} onSubmit={(e) => { e.preventDefault(); if (view.clearable && reason.trim() && !busy) void clear(); }}>
          <label className={small} htmlFor={`${uid}-reason`}><span className="block mb-1">{t("clear.reasonLabel")}</span>
            <textarea id={`${uid}-reason`} className="sizing-new-input w-full" rows={2} aria-required="true" aria-describedby={view.clearable ? undefined : `${uid}-hint`} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {!view.clearable && <p id={`${uid}-hint`} className={`${small} ${muted} m-0`}>{t("clear.needItems")}</p>}
          <div><button type="submit" className="btn-primary btn-sm" disabled={busy || !view.clearable || !reason.trim()}>{t("clear.submit")}</button></div>
          {error && <p role="alert" className={`${small} m-0 text-[color:var(--red-fg)]`}>{error}</p>}
        </form>
      ) : (
        <p className={`${small} ${muted} m-0`}>{me?.role === "admin" ? t("clear.adminNote") : t("clear.viewerNote")}</p>
      )}
    </section>
  );
}
