"use client";

// S6 bulk AI evaluation dialogs (ADR-0199): the start dialog and the per-candidate confirm-from-version dialog.
// Bodies are plain components (no portal) so they render under test; AiEvalModal adds the portal + shared focus trap.
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import type { ConfirmPlan } from "./aiEvalTypes.ts";
import type { StartOptions } from "./useAiEval.ts";

/** Dialog panel on the shared `.modal-backdrop` pattern: focus moves in, Tab cycles, Escape closes, focus returns.
 * The focus hook lives HERE, not in AiEvalModal: this component only mounts after the shell's `mounted` gate, so
 * useModalFocus' initial-focus effect runs with panelRef already attached (calling the hook in the gated shell ran it
 * while the ref was still null and never re-ran: focus stayed on BODY and Escape never reached the backdrop).
 * Exported without the portal so it renders under test. */
export function AiEvalModalPanel({
  title,
  onClose,
  children,
  titleId,
  showClose = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** When set, the dialog is labelled by its heading (aria-labelledby) instead of the raw title string. */
  titleId?: string;
  /** Adds a visible text + icon close button to the head (read-only dialogs without their own cancel button). */
  showClose?: boolean;
}) {
  const tc = useTranslations("common");
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: shared .modal-backdrop pattern (crud.tsx ConfirmDialog); Escape and Tab are handled by useModalFocus
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click only stops propagation to the backdrop; the dialog panel is not a click target */}
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={titleId ? undefined : title}
        style={{ maxWidth: "32rem", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId} style={{ fontSize: "0.95rem" }}>
            {title}
          </h2>
          {showClose && (
            <button type="button" className="btn-ghost btn-sm" aria-label={tc("close")} onClick={onClose}>
              <span aria-hidden="true">✕ </span>
              {tc("close")}
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Portal shell: renders the panel into document.body after mount (SSR-safe). */
export function AiEvalModal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  titleId?: string;
  showClose?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<AiEvalModalPanel {...props} />, document.body);
}

export interface StartStats {
  candidates: number;
  dartEligible: number;
  estimatedCalls: number;
}

export function AiEvalStartForm({
  value,
  onChange,
  stats,
  busy,
  onSubmit,
  onCancel,
  summary,
}: {
  value: StartOptions;
  onChange: (v: StartOptions) => void;
  stats: StartStats;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  /** Overrides the bulk summary line (the per-candidate dialog names the candidate). */
  summary?: string;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const tc = useTranslations("common");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-3 mt-2"
    >
      <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {summary ??
          t("startSummary", { candidates: stats.candidates, dart: stats.dartEligible, calls: stats.estimatedCalls })}
      </p>
      <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("humanConfirms")}</p>
      <fieldset className="m-0 p-0 border-0">
        <legend className="text-[length:var(--fs-caption)] font-semibold">{t("categories")}</legend>
        <div className="flex gap-3 flex-wrap mt-1">
          {(["both", "financial", "technical"] as const).map((c) => (
            <label key={c} className="flex items-center gap-1 text-[length:var(--fs-body)]">
              <input
                type="radio"
                name="ai-eval-categories"
                checked={value.categories === c}
                onChange={() => onChange({ ...value, categories: c })}
              />
              {t(`category.${c}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="flex items-center gap-1 text-[length:var(--fs-body)]">
          <input
            type="checkbox"
            checked={value.web_evidence}
            onChange={(e) => onChange({ ...value, web_evidence: e.target.checked })}
          />
          {t("webEvidence")}
        </label>
        {value.web_evidence && (
          <p role="note" className="m-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--amber-fg)]">
            <span aria-hidden="true">⚠ </span>
            {t("webEvidenceWarning")}
          </p>
        )}
      </div>
      <div>
        <label className="flex items-center gap-1 text-[length:var(--fs-body)]">
          <input
            type="checkbox"
            checked={value.force_refresh}
            onChange={(e) => onChange({ ...value, force_refresh: e.target.checked })}
          />
          {t("forceRefresh")}
        </label>
        <p className="m-0 mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("forceRefreshHint")}</p>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          {tc("cancel")}
        </button>
        <button type="submit" className="btn-premium btn-sm" disabled={busy || stats.candidates === 0}>
          {t("startRun")}
        </button>
      </div>
    </form>
  );
}

function ItemList({
  heading,
  items,
}: {
  heading: string;
  items: Array<{ criterion_id: string; label: string; suffix?: string }>;
}) {
  return (
    <div>
      <h3 className="m-0 text-[length:var(--fs-body)]">
        {heading} ({items.length})
      </h3>
      {items.length > 0 && (
        <ul className="m-0 mt-1 pl-5 text-[length:var(--fs-caption)]">
          {items.map((i) => (
            <li key={i.criterion_id}>
              {i.label}
              {i.suffix ? ` — ${i.suffix}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AiEvalConfirmBody({
  versionNo,
  plan,
  statusLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  versionNo: number;
  plan: ConfirmPlan;
  statusLabel: (status: string) => string;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("stages.s67.aiEval");
  const tc = useTranslations("common");
  return (
    <div className="flex flex-col gap-3 mt-2">
      <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {t("confirmIntro", { n: versionNo })} {t("humanConfirms")}
      </p>
      <ItemList heading={t("willWrite")} items={plan.write.map((w) => ({ ...w, suffix: statusLabel(w.status) }))} />
      <ItemList heading={t("skippedHuman")} items={plan.skippedHuman} />
      <ItemList heading={t("skippedUnverified")} items={plan.skippedUnverified} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          {tc("cancel")}
        </button>
        <button
          type="button"
          className="btn-premium btn-sm"
          disabled={busy || plan.write.length === 0}
          onClick={onSubmit}
        >
          {t("confirmSubmit", { n: plan.write.length })}
        </button>
      </div>
    </div>
  );
}
