"use client";

// "이 안건에 연결" CTA modal (decider-approved navigation fix, 2026-10-16).
// Binding is a judgment act (ADR-0056: rationale NOT NULL), so the dialog
// carries a mandatory rationale field and writes through the SAME governed
// REST surface the proxy-chain page uses — POST /api/projects/{id}/industries
// — which appends audit + data-access rows. No direct repository writes from
// the client path.
import { useState } from "react";
import { api } from "../../../lib/api.ts";
import type { LinkableIndustry } from "./types.ts";
import { useTranslations } from "next-intl";

export interface LinkToDealModalState { open: boolean; industry: LinkableIndustry | null }

export function LinkToDealModal({ state, projectId, onClose, onLinked }: {
  state: LinkToDealModalState;
  projectId: string | null;
  onClose: () => void;
  onLinked: (industryName: string) => void;
}) {const t = useTranslations("stages.s1.linkToDealModal"); const tc = useTranslations("common");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.open || !state.industry) return null;
  if (!projectId) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel" role="dialog" aria-modal="true" aria-label={t("linkIndustryToTheDeal")} onClick={(e) => e.stopPropagation()}>
          <h2 className="text-[length:var(--fs-body)] mb-1">{tc("linkToThisDeal")}</h2>
          <p role="note" className="text-[length:var(--fs-body)] mb-2">
            {t("thisReviewHasNoBusiness")}
          </p>
          <div className="flex justify-end mt-3">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{tc("close")}</button>
          </div>
        </div>
      </div>
    );
  }
  const close = () => { setRationale(""); setBusy(false); setError(null); onClose(); };
  const submit = async () => {
    if (!state.industry || busy) return;
    if (!rationale.trim()) {
      setError(t("theLinkingRationaleIsRequired"));
      return;
    }
    setBusy(true);
    try {
      await api.post(
        `/api/projects/${encodeURIComponent(projectId ?? "")}/industries`,
        { industry_id: state.industry.id, rationale: rationale.trim() },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("linkFailed"));
      setBusy(false);
      return;
    }
    close();
    onLinked(state.industry.name_ko);
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={t("linkIndustryToTheDeal2")} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[length:var(--fs-body)] mb-1">{tc("linkToThisDeal")}</h2>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          <strong>{state.industry.name_ko}</strong> {t("linksTheAnalysisAsThis")}
        </p>
        <label className="text-[length:var(--fs-caption)] block mb-2">
          <span className="block mb-1">{t("linkingRationale")}</span>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            placeholder={t("eGDescribeInOne")}
            className="sizing-new-input w-full"
          />
        </label>
        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={close} disabled={busy}>{tc("cancel")}</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !rationale.trim()}>{tc("link")}</button>
        </div>
      </div>
    </div>
  );
}
