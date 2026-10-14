"use client";

// Shared narrative dialog for the S3-owned 필요 수준 / 보유 수준 fields (ADR-0172).
// Same pattern as CapabilityHeldDialog: field title + the row's capability, a textarea with
// a live counter (cap NARRATIVE_CAP) and a read-only mode (viewers, S5/S7/S8). The table
// cell shows a 2-line ClampedText preview and a 입력/수정/보기 button (NarrativeCell).
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import { NARRATIVE_CAP } from "../../lib/capability-gap.ts";
import { ClampedText } from "./ClampedText.tsx";

export type NarrativeField = "필요 수준" | "보유 수준" | "기대 수준";

/** Button label: 입력 when empty, 수정 when filled and editable, 보기 when read-only. */
export function narrativeButtonLabel(value: string, readOnly: boolean): "입력" | "수정" | "보기" {
  if (readOnly) return "보기";
  return value.trim() === "" ? "입력" : "수정";
}

export function CapabilityNarrativeDialog({ capability, field, value, readOnly, onSave, onClose }: {
  capability: string; field: NarrativeField; value: string; readOnly: boolean;
  onSave?: (v: string) => void; onClose: () => void;
}) {
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
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-2">필요 역량: {capability}</p>
        {readOnly ? (
          <p className="m-0" style={{ whiteSpace: "pre-wrap" }}>{value.trim() === "" ? <span className="text-[color:var(--muted-fg)]">미입력</span> : value}</p>
        ) : (
          <>
            <label className="block text-[length:var(--fs-caption)] font-semibold mb-1" htmlFor={areaId}>{field} (서술)</label>
            <textarea id={areaId} className="sizing-new-input w-full" rows={8} autoFocus maxLength={NARRATIVE_CAP} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" aria-live="polite">{text.length} / {NARRATIVE_CAP}자</p>
          </>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{readOnly ? "닫기" : "취소"}</button>
          {!readOnly && onSave && <button type="button" className="btn-ghost btn-sm" onClick={() => onSave(text.trim())}>저장</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Table cell: 2-line preview (single 미입력 marker when empty) + the dialog button. */
export function NarrativeCell({ capability, field, value, readOnly, onOpen }: {
  capability: string; field: NarrativeField; value: string; readOnly: boolean; onOpen: () => void;
}) {
  return (
    <>
      {value.trim() === "" ? <span className="block text-[color:var(--muted-fg)]">미입력</span> : <ClampedText text={value} />}
      <button type="button" className="btn-ghost btn-sm mt-1" aria-label={`${capability} ${field} ${narrativeButtonLabel(value, readOnly)}`} onClick={onOpen}>
        {narrativeButtonLabel(value, readOnly)}
      </button>
    </>
  );
}
