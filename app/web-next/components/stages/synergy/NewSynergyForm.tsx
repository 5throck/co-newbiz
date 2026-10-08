"use client";

// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import type { SynergyStageState } from "./useSynergyList.ts";

export function NewSynergyForm({ ctx }: { ctx: SynergyStageState }) {
  const { canCurate, showNewForm, targets, targetSel, setTargetSel, oppSel, setOppSel, opps, setShowNewForm, creating, createAnalysis } = ctx;
  return (
    <>{canCurate && showNewForm && (
        <div className="sizing-new-form mb-3">
          <div className="mb-2">
            <span className="text-label block mb-1">① 분석 대상 — 그룹/계열사 분석에서 프로파일을 만든 대상</span>
            {targets.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)] mb-0">그룹/계열사 분석 화면에서 회사를 등록·분석하면 여기에 표시됩니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {targets.map((t) => (
                  <button
                    key={`${t.kind}-${t.id}`}
                    type="button"
                    aria-pressed={targetSel?.kind === t.kind && targetSel?.id === t.id}
                    disabled={!t.hasProfile}
                    title={t.hasProfile ? `${t.groupName} 그룹 · 프로파일 있음` : "프로파일이 없는 대상 — 그룹/계열사 분석을 먼저 실행하세요"}
                    className={`sizing-industry-chip ${targetSel?.kind === t.kind && targetSel?.id === t.id ? "sizing-industry-chip-active" : ""} ${!t.hasProfile ? "opacity-40" : ""}`}
                    onClick={() => { if (t.hasProfile) setTargetSel({ kind: t.kind, id: t.id }); }}
                  >
                    <span className="font-semibold">{t.kind === "group" ? "전체" : ""} {t.label}</span>
                    <span className="sizing-chip-meta">{t.hasProfile ? "프로파일 준비됨" : "프로파일 없음"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mb-2">
            <span className="text-label block mb-1">② 연결 기회 (선택) — S2에서 발굴한 기회를 선택하면 완료 시 synergy_score 권고가 기록됩니다</span>
            <select value={oppSel} onChange={(e) => setOppSel(e.target.value)} className="sizing-new-input" style={{ width: "100%" }}>
              <option value="">기회 없이 분석 (시장 연계만)</option>
              {opps.filter((o) => o.status !== "dropped").map((o) => (
                <option key={o.id} value={o.id}>[{o.status}] {o.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowNewForm(false)}>취소</button>
            <button type="button" className="btn-ghost" disabled={creating || !targetSel} onClick={() => void createAnalysis()}>
              {creating ? "분석 시작 중..." : "분석 시작"}
            </button>
          </div>
        </div>
      )}</>
  );
}
