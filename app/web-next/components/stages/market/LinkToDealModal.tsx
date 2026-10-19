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

export interface LinkToDealModalState { open: boolean; industry: LinkableIndustry | null }

export function LinkToDealModal({ state, projectId, onClose, onLinked }: {
  state: LinkToDealModalState;
  projectId: string | null;
  onClose: () => void;
  onLinked: (industryName: string) => void;
}) {
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state.open || !state.industry) return null;
  if (!projectId) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-panel" role="dialog" aria-modal="true" aria-label="안건에 산업 연결" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-[0.95rem] mb-1">이 안건에 연결</h2>
          <p role="note" className="text-[length:var(--fs-body)] mb-2">
            이 검토에는 아직 사업 프로젝트 행이 없어 산업을 연결할 수 없습니다. S8 승격 후 연결하거나, 먼저 S1 분석을 진행하세요.
          </p>
          <div className="flex justify-end mt-3">
            <button type="button" className="btn-ghost btn-sm" onClick={onClose}>닫기</button>
          </div>
        </div>
      </div>
    );
  }
  const close = () => { setRationale(""); setBusy(false); setError(null); onClose(); };
  const submit = async () => {
    if (!state.industry || busy) return;
    if (!rationale.trim()) {
      setError("연결 근거(rationale)는 필수입니다 — 바인딩은 판정 기록 행위입니다.");
      return;
    }
    setBusy(true);
    try {
      await api.post(
        `/api/projects/${encodeURIComponent(projectId ?? "")}/industries`,
        { industry_id: state.industry.id, rationale: rationale.trim() },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결 실패");
      setBusy(false);
      return;
    }
    close();
    onLinked(state.industry.name_ko);
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="안건에 산업 연결" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[0.95rem] mb-1">이 안건에 연결</h2>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          <strong>{state.industry.name_ko}</strong> 분석을 이 안건의 S1 근거로 연결합니다. 연결되면 목록 최상단 "이 안건의 산업
          분석" 영역으로 올라옵니다.
        </p>
        <label className="text-[length:var(--fs-caption)] block mb-2">
          <span className="block mb-1">연결 근거 *</span>
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={3}
            placeholder="예: 이 S1 시장 분석의 수요가 어느 검토 안건과 어떻게 연결되는지 한 줄로 적어 주세요"
            className="sizing-new-input w-full"
          />
        </label>
        {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={close} disabled={busy}>취소</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !rationale.trim()}>연결</button>
        </div>
      </div>
    </div>
  );
}
