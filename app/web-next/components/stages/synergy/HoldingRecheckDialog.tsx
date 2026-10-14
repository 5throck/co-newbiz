"use client";

// Compact review dialog for the per-row "다시 확인" (AI holding re-check, ADR-0172 amendment 2026-10-14).
// Shows the PROPOSED 보유 판정 / 보유 수준 / 보유 주체·근거 with basis and source links; nothing
// changes until a person presses 적용 (the only path that may replace existing values).
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useModalFocus } from "../../../lib/use-modal-focus.ts";
import { HELD_STATUS_CHIP, HELD_STATUS_LABEL } from "../../../lib/capability-gap.ts";
import type { CitedHeld } from "../../../lib/capability-gap-necessity-draft.ts";

export type RecheckProposal = (CitedHeld & { reason?: string }) | { status: "unevaluated"; reason: string };

export function SourceLinks({ sources }: { sources?: Array<{ title: string; url: string }> }) {
  const safe = (sources ?? []).filter((s) => /^https?:\/\//i.test(s.url));
  if (safe.length === 0) return null;
  return (
    <span className="block text-[length:var(--fs-caption)]">
      출처:{" "}
      {safe.map((s, i) => (
        <span key={s.url}>{i > 0 && ", "}<a href={s.url} target="_blank" rel="noopener noreferrer" className="underline" title={s.title}>{hostOf(s.url)}</a></span>
      ))}
    </span>
  );
}
function hostOf(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.slice(0, 40); } }

export function HoldingRecheckDialog({ capability, busy, proposal, note, onApply, onClose }: {
  capability: string; busy: boolean; proposal: RecheckProposal | null; note: string; onApply: () => void; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onClose);
  if (!mounted) return null;
  const cited = proposal && "evidence" in proposal ? proposal : null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose} role="presentation" onKeyDown={onKeyDown}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-label={`${capability} 보유 판정 다시 확인`} style={{ maxWidth: "32rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{capability} — 보유 판정 다시 확인 (AI 제안)</h2></div>
        {busy ? (
          <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">프로필과 외부 검색으로 확인하는 중...</p>
        ) : cited ? (
          <div className="text-[length:var(--fs-caption)]">
            <p className="mb-1"><span className={`status-chip ${HELD_STATUS_CHIP[cited.status]}`}>{HELD_STATUS_LABEL[cited.status]}</span> <span className="status-chip status-in-progress"><span aria-hidden="true">✦</span> AI 초안</span></p>
            {cited.currentLevel && <p className="mb-1"><b>보유 수준</b> {cited.currentLevel}</p>}
            {cited.holders.length > 0 && <p className="mb-1"><b>보유 주체</b> {cited.holders.join(", ")}</p>}
            <p className="mb-1"><b>근거</b> {cited.evidence}</p>
            <p className="mb-1 text-[color:var(--muted-fg)]">판단 이유: {cited.basis.held}</p>
            <SourceLinks sources={cited.web} />
            <p className="mt-2 mb-0 text-[color:var(--muted-fg)]">적용하면 이 행의 보유 판정·보유 수준·근거가 위 제안으로 바뀝니다(저장 전까지는 화면에만 반영). 웹 출처는 직접 확인하세요.</p>
          </div>
        ) : (
          <p role="status" className="text-[length:var(--fs-caption)]">{proposal && "reason" in proposal && proposal.reason ? proposal.reason : note || "제안할 근거가 없습니다."}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{cited ? "취소" : "닫기"}</button>
          {cited && !busy && <button type="button" className="btn-ghost btn-sm" onClick={onApply}>적용</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
