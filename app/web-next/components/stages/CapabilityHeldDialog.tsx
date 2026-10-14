"use client";

// Held-by / evidence dialog for one S3 required-capability row (decider 2026-10-14).
// Edit mode (S3): holders as one entry per line + a large evidence textarea; 저장
// hands the values to the caller, which updates the draft row (page-level save
// persists). Read-only mode (S8, or a viewer in S3): the full lists, no inputs.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";

// Mirror the normalizeGapRows caps in lib/capability-gap.ts.
export const HOLDERS_MAX = 6;
export const HOLDER_LEN = 120;
export const EVIDENCE_MAX = 400;

/** Compact preview texts for the table cells. */
export function holdersPreview(holders: string[]): string {
  return holders.length === 0 ? "미입력" : holders.join(", ");
}
export function evidencePreview(evidence: string, len = 40): string {
  const t = evidence.trim();
  return t === "" ? "미입력" : t.length > len ? `${t.slice(0, len)}…` : t;
}

export function CapabilityHeldDialog({ capability, holders, evidence, readOnly, unevaluated, onSave, onClose }: {
  capability: string; holders: string[]; evidence: string; readOnly: boolean; unevaluated?: boolean;
  onSave?: (v: { holders: string[]; evidence: string }) => void; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [holderText, setHolderText] = useState(holders.join("\n"));
  const [text, setText] = useState(evidence);
  const holderId = useId();
  const evidenceId = useId();
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const title = `${capability} 보유 주체·근거`;
  const parsed = holderText.split("\n").map((x) => x.trim().slice(0, HOLDER_LEN)).filter(Boolean);
  const tooMany = parsed.length > HOLDERS_MAX;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: "36rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{title}</h2></div>
        {readOnly ? (
          <>
            <h3 className="text-[length:var(--fs-caption)] font-semibold mt-2 mb-1">보유 주체</h3>
            {holders.length === 0 ? <p className="text-[color:var(--muted-fg)] m-0">미입력</p> : <ul className="m-0 pl-4">{holders.map((h, i) => <li key={i}>{h}</li>)}</ul>}
            <h3 className="text-[length:var(--fs-caption)] font-semibold mt-3 mb-1">근거</h3>
            <p className="m-0" style={{ whiteSpace: "pre-wrap" }}>{evidence.trim() === "" ? <span className="text-[color:var(--muted-fg)]">미입력</span> : evidence}</p>
          </>
        ) : (
          <>
            <label className="block text-[length:var(--fs-caption)] font-semibold mt-2 mb-1" htmlFor={holderId}>보유 주체 (한 줄에 하나, 최대 {HOLDERS_MAX}개 · 항목당 {HOLDER_LEN}자)</label>
            <textarea id={holderId} className="sizing-new-input w-full" rows={4} autoFocus value={holderText} onChange={(e) => setHolderText(e.target.value)} />
            {unevaluated && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">보유 판정이 미판정이면 보유 주체는 저장되지 않습니다 — 먼저 보유 판정을 선택하세요.</p>}
            {tooMany && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1">보유 주체는 최대 {HOLDERS_MAX}개까지 저장됩니다 — 초과분은 제외됩니다.</p>}
            <label className="block text-[length:var(--fs-caption)] font-semibold mt-3 mb-1" htmlFor={evidenceId}>근거 (프로필 인용)</label>
            <textarea id={evidenceId} className="sizing-new-input w-full" rows={8} maxLength={EVIDENCE_MAX} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1" aria-live="polite">{text.length} / {EVIDENCE_MAX}자</p>
          </>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{readOnly ? "닫기" : "취소"}</button>
          {!readOnly && onSave && <button type="button" className="btn-ghost btn-sm" onClick={() => onSave({ holders: parsed.slice(0, HOLDERS_MAX), evidence: text })}>저장</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
