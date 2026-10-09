"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { Search } from "lucide-react";
import { IndustryTable } from "./IndustryTable.tsx";
import type { MarketAnalysisStageState } from "./useMarketList.ts";

export function IndustryListSection({ ctx }: { ctx: MarketAnalysisStageState }) {
  const { statusCounts, query, setQuery, statusFilter, setStatusFilter, pinnedOnly, setPinnedOnly, canCurate, setShowNewForm, showNewForm, newName, setNewName, newCode, setNewCode, setKsicResults, ksicSearching, searchKsicCodes, ksicResults, llmStatus, hasInProgress, openLinkModal } = ctx;
  return (
    <section aria-label="분석 대상 산업" className="market-section">
        <SectionToolbar
          title="분석 대상 산업"
          icon=""
          count={statusCounts.all}
          filters={
            <input
              type="search"
              aria-label="산업 검색"
              placeholder="산업명·코드 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sizing-new-input sizing-new-input-sm"
              style={{ width: "12rem", minWidth: "8rem" }}
            />
          }
          summary={
            <span role="group" aria-label="상태 필터" className="flex items-center gap-1 flex-wrap">
              {([
                ["all", "전체"], ["in_progress", "분석 중"], ["completed", "완료"], ["stale", "업데이트 권장"], ["pending", "대기"], ["failed", "실패"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={statusFilter === key}
                  className={`control-chip ${statusFilter === key ? "status-green" : "status-not-started"}`}
                  onClick={() => setStatusFilter(key)}
                >
                  {label} {statusCounts[key]}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={pinnedOnly}
                title="고정(★)한 산업만 최상위로 보여줍니다 — 고정한 본 산업은 연계 그룹째로, 고정한 연계 산업은 개별 최상위 행으로 표시됩니다."
                className={`control-chip ${pinnedOnly ? "status-amber" : "status-not-started"}`}
                onClick={() => setPinnedOnly((v) => !v)}
              >
                {pinnedOnly ? "★ 핵심만 보기" : "전체 보기"}
              </button>
            </span>
          }
          actions={
            canCurate ? (
              <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setShowNewForm((v) => !v)} aria-expanded={showNewForm}>
                ＋ 신규 산업 분석
              </button>
            ) : null
          }
        />

        {canCurate && showNewForm && (
          <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void openLinkModal(newName.trim()); }} aria-label="신규 산업 분석 생성" className="sizing-new-form mb-3">
            {/* 제출 시 바로 생성하지 않고 가치사슬 연계 후보 모달로 범위를 확정한다 */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">산업명 *</span>
                <input id="market-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 산업용 로봇" required className="sizing-new-input" />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">KSIC 코드 (선택)</span>
                <span className="flex items-center gap-1">
                  <input
                    value={newCode}
                    onChange={(e) => { setNewCode(e.target.value); setKsicResults(null); }}
                    placeholder="예: 28121"
                    className="sizing-new-input sizing-new-input-sm"
                  />
                  <button type="button" className="btn-ghost btn-sm flex items-center gap-1" disabled={ksicSearching || (!newCode.trim() && !newName.trim())} onClick={() => void searchKsicCodes()}>
                    <Search size={16} aria-hidden="true" />
                    {ksicSearching ? "검색 중..." : "KSIC 검색"}
                  </button>
                </span>
              </label>
              <button type="submit" className="btn-ghost" disabled={!newName.trim()}>
                분석 범위 선택 →
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setShowNewForm(false); setNewName(""); setNewCode(""); setKsicResults(null); }}
              >
                취소
              </button>
            </div>
            {ksicResults !== null && ksicResults.length > 0 && (
              <ul className="sizing-note-list mt-2" role="listbox" aria-label="KSIC 코드 검색 결과">
                {ksicResults.map((it) => (
                  <li key={it.code}>
                    <button
                      type="button"
                      aria-pressed={newCode === it.code}
                      className={`btn-ghost btn-sm w-full text-left ${newCode === it.code ? "font-semibold" : ""}`}
                      title={it.detail ?? it.name_ko}
                      onClick={() => {
                        setNewCode(it.code);
                        setKsicResults(null); // 선택 후 목록을 닫는다 — 다른 산업 선택 시 다시 검색
                        if (!newName.trim()) setNewName(it.name_ko);
                      }}
                    >
                      {newCode === it.code ? "✔ " : ""}{it.name_ko} <code className="dd-item-id">{it.code}</code>
                      {it.profile && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> · 업종 프로필</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              KSIC 코드는 선택 — 산업명 또는 코드로 검색한 뒤 목록에서 선택하거나 직접 입력하세요(미지정 시 "—" 표시). 업종 프로필이 있는 코드는 표기됩니다.
              systematic-market-sizing 8단계 파이프라인이 순서대로 실행되며, 완료 전까지는 목록에 "분석 중"으로 표시됩니다.
              {llmStatus && (llmStatus.configured
                ? <> AI 요약 사용: <strong>{llmStatus.provider} / {llmStatus.model}</strong></>
                : <> AI 미설정 — 필요한 환경변수가 설정되지 않아 <strong>결정론 합성</strong>으로 분석됩니다.</>)}
            </p>
          </form>
        )}

        <IndustryTable ctx={ctx} />
        {hasInProgress && (
          <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="status">
            분석이 진행 중입니다 — 완료되면 목록이 자동으로 갱신됩니다.
          </p>
        )}
      </section>
  );
}
