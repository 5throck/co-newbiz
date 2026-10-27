"use client";

// Admin console - open a legacy-record re-confirmation requirement on a project (ADR-0186 O-6). An administrator has no
// project visibility, so the project is named by id. The server validates the project, items and reason and records an
// audit row; clearing is a person's act on the project screen, never here.
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "../../lib/api.ts";
import { RECONFIRM_ITEM_KEYS, reconfirmErrorText, type ReconfirmItemKey } from "../../lib/reconfirm-view.ts";
import { useToast } from "../ui.tsx";

const small = "text-[length:var(--fs-caption)]";
const muted = "text-[color:var(--muted-fg)]";

export function ReconfirmCreateForm() {
  const t = useTranslations("components.reconfirm");
  const { toast } = useToast();
  const uid = useId().replace(/:/g, "");
  const [projectId, setProjectId] = useState("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<ReconfirmItemKey[]>([...RECONFIRM_ITEM_KEYS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = projectId.trim() !== "" && reason.trim() !== "" && items.length > 0;

  async function create() {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId.trim())}/reconfirm`, { reason: reason.trim(), items });
      toast(t("created")); setReason(""); setProjectId("");
    } catch (e) {
      setError(e instanceof ApiError ? reconfirmErrorText(e.message, e.details, (k) => t(`item.${k}` as never)) : e instanceof Error ? e.message : t("failed"));
    } finally { setBusy(false); }
  }

  return (
    <details className="card mt-4" data-testid="reconfirm-create">
      <summary className={`${small} font-semibold`}>{t("create.summary")}</summary>
      <form className="grid gap-2 mt-2" aria-label={t("create.summary")} onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void create(); }}>
        <p className={`${small} ${muted} m-0`}>{t("create.intro")}</p>
        <label className={small} htmlFor={`${uid}-p`}><span className="block mb-1">{t("create.projectLabel")}</span>
          <input id={`${uid}-p`} className="sizing-new-input" value={projectId} aria-required="true" onChange={(e) => setProjectId(e.target.value)} /></label>
        <fieldset className="border-0 p-0 m-0">
          <legend className={`${small} font-semibold`}>{t("create.itemsLegend")}</legend>
          {RECONFIRM_ITEM_KEYS.map((k) => (
            <label key={k} className={`${small} flex items-center gap-2`}>
              <input type="checkbox" checked={items.includes(k)} onChange={(e) => setItems(e.target.checked ? [...items, k] : items.filter((x) => x !== k))} />
              {t(`item.${k}` as never)}
            </label>
          ))}
        </fieldset>
        <label className={small} htmlFor={`${uid}-r`}><span className="block mb-1">{t("create.reasonLabel")}</span>
          <textarea id={`${uid}-r`} className="sizing-new-input w-full" rows={2} aria-required="true" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div><button type="submit" className="btn-ghost btn-sm" disabled={busy || !ready}>{t("create.submit")}</button></div>
        {error && <p role="alert" className={`${small} m-0 text-[color:var(--red-fg)]`}>{error}</p>}
      </form>
    </details>
  );
}
