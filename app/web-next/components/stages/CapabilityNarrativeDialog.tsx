"use client";

// Shared narrative dialog for the S3-owned 필요 수준 / 보유 수준 fields (ADR-0172).
// Same pattern as CapabilityHeldDialog: field title + the row's capability, a textarea with
// a live counter (cap NARRATIVE_CAP) and a read-only mode (viewers, S5/S7/S8). The table
// cell shows a 2-line ClampedText preview and a 입력/수정/보기 button (NarrativeCell).
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { NARRATIVE_CAP } from "../../lib/capability-gap.ts";
import { type KoNarrativeField } from "../../lib/ko-data-values.ts";
import { ClampedText } from "./ClampedText.tsx";
import { useTranslations } from "next-intl";

export type NarrativeField = KoNarrativeField;

/** Button label keys: input when empty, edit when filled and editable, view when read-only. Resolve through the common catalog at render. */
export function narrativeButtonLabelKey(value: string, readOnly: boolean): string {
  if (readOnly) return "common.view";
  return value.trim() === "" ? "common.input" : "common.edit";
}

export function CapabilityNarrativeDialog({ capability, field, value, readOnly, onSave, onClose }: {
  capability: string; field: NarrativeField; value: string; readOnly: boolean;
  onSave?: (v: string) => void; onClose: () => void;
}) {const t = useTranslations("components.capabilityJudgement.narrativeDialog"); const tc = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState(value);
  const areaId = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const title = `${capability} ${field}`;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: "36rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{title}</h2></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-2">{t("requiredCapabilities")} {capability}</p>
        {readOnly ? (
          <p className="m-0" style={{ whiteSpace: "pre-wrap" }}>{value.trim() === "" ? <span className="text-[color:var(--muted-fg)]">{tc("notEntered")}</span> : value}</p>
        ) : (
          <>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={areaId}>{field} {t("narrative")}</label>
            <textarea id={areaId} className="sizing-new-input w-full" rows={8} autoFocus maxLength={NARRATIVE_CAP} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" aria-live="polite">{text.length} / {NARRATIVE_CAP}{tc("charSuffix")}</p>
          </>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{readOnly ? tc("close") : tc("cancel")}</button>
          {!readOnly && onSave && <button type="button" className="btn-ghost btn-sm" onClick={() => onSave(text.trim())}>{tc("save")}</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Table cell: 2-line preview (single 미입력 marker when empty) + the dialog button. */
export function NarrativeCell({ capability, field, value, readOnly, onOpen }: {
  capability: string; field: NarrativeField; value: string; readOnly: boolean; onOpen: () => void;
}) {const t = useTranslations(); const tc = useTranslations("common");
  return (
    <>
      {value.trim() === "" ? <span className="block text-[color:var(--muted-fg)]">{tc("notEntered")}</span> : <ClampedText text={value} />}
      <button type="button" className="btn-ghost btn-sm mt-1" aria-label={`${capability} ${field} ${t(narrativeButtonLabelKey(value, readOnly))}`} onClick={onOpen}>
        {t(narrativeButtonLabelKey(value, readOnly))}
      </button>
    </>
  );
}

/**
 * Inline narrative field for the S3 table (필요 수준 / 보유 수준; decider 2026-10-14 — edited directly
 * in the table, no 입력/수정 button). Four rows (min 5.75rem), vertical resize with auto-grow, maxLength
 * NARRATIVE_CAP, counter shown on focus or near the cap. Read-only users see the clamped text.
 */
export function NarrativeInput({ capability, field, value, readOnly, onChange }: {
  capability: string; field: NarrativeField; value: string; readOnly: boolean; onChange: (v: string) => void;
}) {const tc = useTranslations("common");
  const [focused, setFocused] = useState(false);
  const counterId = useId();
  if (readOnly) {
    return value.trim() === "" ? <span className="block text-[color:var(--muted-fg)]">{tc("notEntered")}</span> : <ClampedText text={value} />;
  }
  const near = value.length >= NARRATIVE_CAP * 0.8;
  return (
    <>
      <textarea
        aria-label={`${capability} ${field}`} aria-describedby={focused || near ? counterId : undefined}
        placeholder={field} rows={4} maxLength={NARRATIVE_CAP} value={value}
        className="sizing-new-input sizing-new-input-sm w-full" style={{ resize: "vertical", minHeight: "5.75rem", maxHeight: "15rem" }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => { onChange(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight + 2, 240)}px`; }}
      />
      {(focused || near) && <span id={counterId} className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" aria-live="polite">{value.length} / {NARRATIVE_CAP}{tc("charSuffix")}</span>}
    </>
  );
}
