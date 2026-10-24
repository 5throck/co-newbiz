"use client";

// Confirmation dialog for the S11 execution baseline. Lists every open finding with a REQUIRED
// per-finding acknowledgement (1..500 chars); the confirm button stays disabled until all are filled.
// The result is sent as acknowledged_findings: [{code, rationale}]. Human-only (boundary #2).

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { useTranslations } from "next-intl";
import {
  MAX_ACK_RATIONALE_LEN,
  buildAcknowledgements,
  findingText,
  type AcknowledgedFinding,
  type Finding,
  type I18nText,
} from "../../lib/execution-baseline-view.ts";

export function BaselineConfirmDialog({ findings, busy, onCancel, onConfirm }: {
  /** Open findings (already de-duplicated by code). */
  findings: Finding[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (acknowledged: AcknowledgedFinding[]) => void;
}) {const t = useTranslations("stages.s11.baselineConfirm"); const tc = useTranslations("common"); const tr = useTranslations();
  /** Resolve a lib-emitted render reference: catalog key + params, or raw server text passthrough. */
  const tx = (m: I18nText): string => (m.key ? tr(m.key, m.params) : m.text ?? "");
  const uid = useId();
  const { panelRef, onKeyDown } = useModalFocus(onCancel);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const build = buildAcknowledgements(findings.map((f) => f.code), texts);
  const remaining = build.missingCodes.length;

  return createPortal(
    <div className="modal-backdrop" onClick={onCancel} role="presentation" onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="alertdialog"
        aria-modal="true"
        aria-label={tc("confirmExecutionBaseline")}
        style={{ maxWidth: "36rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{tc("confirmExecutionBaseline")}</h2></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0">
          {t("recordsThatTheProjectLead")} {/* INTERIM-WORDING */}
        </p>
        {findings.length > 0 && (
          <div className="mt-3" data-testid="gx-ack-list">
            <p className="text-[length:var(--fs-body)] mb-1">{t("openItemsNeedingConfirmation")} {findings.length}{t("itemSEachNeedsConfirmation")}{MAX_ACK_RATIONALE_LEN}{t("chars")}</p>
            <ul className="list-none p-0 m-0">
              {findings.map((f) => {
                const v = texts[f.code] ?? "";
                const invalid = build.missingCodes.includes(f.code) || build.tooLongCodes.includes(f.code);
                return (
                  <li key={f.code} className="mb-2">
                    <label className="text-[length:var(--fs-caption)] block" htmlFor={`${uid}-${f.code}`}>
                      <span className="block mb-1"><span aria-hidden="true">▲ </span>{tx(findingText(f))} <span className="text-[color:var(--muted-fg)]">{t("required")}</span></span>
                    </label>
                    <textarea
                      id={`${uid}-${f.code}`}
                      className="sizing-new-input w-full"
                      rows={2}
                      maxLength={MAX_ACK_RATIONALE_LEN}
                      value={v}
                      aria-required="true"
                      aria-invalid={invalid && v.length > 0 ? true : undefined}
                      onChange={(e) => setTexts({ ...texts, [f.code]: e.target.value })}
                    />
                    <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums">{v.trim().length}/{MAX_ACK_RATIONALE_LEN}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {remaining > 0 ? t("p1ItemSStillNeed", { p1: remaining }) : t("confirmationEvidenceEnteredForEvery")}
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>{tc("cancel")}</button>
          <button
            type="button"
            className="btn-premium btn-sm"
            autoFocus={findings.length === 0}
            disabled={busy || !build.ok}
            onClick={() => onConfirm(build.acknowledged)}
          >
            {busy ? tc("recording") : t("recordConfirmation")}
          </button>
        </div>
        {remaining > 0 && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 text-right">{t("itemsWithConfirmationEvidenceRemaining")} {remaining}{tc("countUnit")}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
