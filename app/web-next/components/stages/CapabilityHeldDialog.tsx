"use client";

// 보유 근거 dialog for one S3 required-capability row (ADR-0172 amendment 2026-10-14 (2)).
// Edit mode (S3): a single evidence textarea; 저장 hands the value to the caller, which updates the draft
// row (page-level save persists). The table cell shows only the HeldEvidenceButton. Read-only mode (S5/S8, or a viewer in S3): the text, no inputs.
// 보유 주체 is no longer editable: legacy stored holders are shown only as a read-only caption.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";

// Mirrors the normalizeGapRows cap in lib/capability-gap.ts.
export const EVIDENCE_MAX = 400;

/** Preview text (used for the button tooltip); "" when empty. */
export function evidencePreview(evidence: string, len = 40): string {
  const t = evidence.trim();
  return t.length > len ? `${t.slice(0, len)}…` : t;
}

/** Read-only caption for rows that still carry legacy holders; "" when there are none. */
export function legacyHoldersCaption(holders: string[] | undefined): string {
  const h = (holders ?? []).map((x) => x.trim()).filter(Boolean);
  return h.length === 0 ? "" : `기존 보유 주체: ${h.join(", ")}`;
}

/**
 * Table-cell control for 보유 근거: ONLY the button (no preview text, no "미입력" marker) plus the small
 * legacy-holders caption when the row still carries legacy holders. Label: `입력` when empty, `수정` when
 * filled (editors), `보기` for read-only viewers; a filled row adds a check icon next to the label (icon +
 * text, never colour alone) and a title showing the first ~60 characters of the evidence.
 */
export function HeldEvidenceButton({ capability, evidence, legacyHolders, readOnly, onOpen, disabled, className = "" }: {
  capability: string; evidence: string; legacyHolders?: string[]; readOnly: boolean; onOpen: () => void; disabled?: boolean; className?: string;
}) {
  const filled = evidence.trim() !== "";
  const caption = legacyHoldersCaption(legacyHolders);
  const label = readOnly ? "보기" : filled ? "수정" : "입력";
  return (
    <>
      <button type="button" className={`btn-ghost btn-sm ${className}`} disabled={disabled}
        aria-label={`${capability} 보유 근거 ${readOnly ? "보기" : "입력"}${filled ? " (입력됨)" : ""}`}
        title={filled ? evidencePreview(evidence, 60) : undefined} onClick={onOpen}>
        {filled && <span aria-hidden="true" className="text-[color:var(--muted-fg)] mr-1">✓</span>}{label}
      </button>
      {caption && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" data-testid="legacy-holders-caption">{caption}</span>}
    </>
  );
}

export function CapabilityHeldDialog({ capability, evidence, legacyHolders, readOnly, onSave, onClose }: {
  capability: string; evidence: string; legacyHolders?: string[]; readOnly: boolean;
  onSave?: (v: { evidence: string }) => void; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState(evidence);
  const evidenceId = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const title = `${capability} 보유 근거`;
  const caption = legacyHoldersCaption(legacyHolders);
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: "36rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{title}</h2></div>
        {readOnly ? (
          <>
            <h3 className="text-[length:var(--fs-caption)] font-semibold mt-2 mb-1">근거</h3>
            <p className="m-0" style={{ whiteSpace: "pre-wrap" }}>{evidence.trim() === "" ? <span className="text-[color:var(--muted-fg)]">미입력</span> : evidence}</p>
          </>
        ) : (
          <>
            <label className="block text-[length:var(--fs-caption)] font-semibold mt-2 mb-1" htmlFor={evidenceId}>근거 (프로필 인용, 보유 주체가 있으면 함께 적습니다)</label>
            <textarea id={evidenceId} className="sizing-new-input w-full" rows={8} maxLength={EVIDENCE_MAX} autoFocus value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" aria-live="polite">{text.length} / {EVIDENCE_MAX}자</p>
          </>
        )}
        {caption && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0">{caption}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{readOnly ? "닫기" : "취소"}</button>
          {!readOnly && onSave && <button type="button" className="btn-ghost btn-sm" onClick={() => onSave({ evidence: text })}>저장</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
