"use client";

// Confirmation dialog for the S11 execution baseline. Lists every open finding with a REQUIRED
// per-finding acknowledgement (1..500 chars); the confirm button stays disabled until all are filled.
// The result is sent as acknowledged_findings: [{code, rationale}]. Human-only (boundary #2).

import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../lib/use-modal-focus.ts";
import {
  MAX_ACK_RATIONALE_LEN,
  buildAcknowledgements,
  findingText,
  type AcknowledgedFinding,
  type Finding,
} from "../../lib/execution-baseline-view.ts";

export function BaselineConfirmDialog({ findings, busy, onCancel, onConfirm }: {
  /** Open findings (already de-duplicated by code). */
  findings: Finding[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (acknowledged: AcknowledgedFinding[]) => void;
}) {
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
        aria-label="실행 기준선 확인"
        style={{ maxWidth: "36rem", width: "100%", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>실행 기준선 확인</h2></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0">
          현재 capex 트랜치와 입력한 기준선을 프로젝트 리드가 확인한 것으로 기록합니다. 확인 근거와 확인한 사람이 남으며, 이후 항목을 새로 기록하거나 트랜치가 바뀌면 다시 확정해야 합니다. 에이전트는 대신 확인할 수 없습니다. {/* INTERIM-WORDING */}
        </p>
        {findings.length > 0 && (
          <div className="mt-3" data-testid="gx-ack-list">
            <p className="text-[length:var(--fs-body)] mb-1">열린 확인 필요 항목 {findings.length}건 — 각각 확인 근거를 적어야 합니다 (1~{MAX_ACK_RATIONALE_LEN}자)</p>
            <ul className="list-none p-0 m-0">
              {findings.map((f) => {
                const v = texts[f.code] ?? "";
                const invalid = build.missingCodes.includes(f.code) || build.tooLongCodes.includes(f.code);
                return (
                  <li key={f.code} className="mb-2">
                    <label className="text-[length:var(--fs-caption)] block" htmlFor={`${uid}-${f.code}`}>
                      <span className="block mb-1"><span aria-hidden="true">▲ </span>{findingText(f)} <span className="text-[color:var(--muted-fg)]">(필수)</span></span>
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
          {remaining > 0 ? `확인 근거가 필요한 항목이 ${remaining}건 남았습니다.` : "모든 항목에 확인 근거를 적었습니다."}
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>취소</button>
          <button
            type="button"
            className="btn-premium btn-sm"
            autoFocus={findings.length === 0}
            disabled={busy || !build.ok}
            onClick={() => onConfirm(build.acknowledged)}
          >
            {busy ? "기록 중..." : "확인 기록"}
          </button>
        </div>
        {remaining > 0 && (
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 text-right">확인 근거가 남은 항목 {remaining}건</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
