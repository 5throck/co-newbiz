"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { SectionToolbar } from "../../layout.tsx";
import { Search } from "lucide-react";
import { IndustryTable } from "./IndustryTable.tsx";
import type { MarketAnalysisStageState } from "./useMarketList.ts";
import { useTranslations } from "next-intl";

export function IndustryListSection({ ctx }: { ctx: MarketAnalysisStageState }) {const t = useTranslations("stages.s1.industryListSection"); const tc = useTranslations("common");
  const { statusCounts, query, setQuery, statusFilter, setStatusFilter, pinnedOnly, setPinnedOnly, canCurate, setShowNewForm, showNewForm, newName, setNewName, newCode, setNewCode, setKsicResults, ksicSearching, searchKsicCodes, ksicResults, llmStatus, hasInProgress, openLinkModal } = ctx;
  return (
    <section aria-label={t("industriesInAnalysisScope")} className="market-section">
        <SectionToolbar
          title={t("industriesInAnalysisScope2")}
          icon=""
          count={statusCounts.all}
          filters={
            <input
              type="search"
              aria-label={t("industrySearch")}
              placeholder={t("searchByIndustryNameOr")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sizing-new-input sizing-new-input-sm"
              style={{ width: "12rem", minWidth: "8rem" }}
            />
          }
          summary={
            <span role="group" aria-label={t("statusFilter")} className="flex items-center gap-1 flex-wrap">
              {([
                ["all", tc("all")], ["in_progress", t("analyzing")], ["completed", tc("done")], ["stale", t("updateRecommended")], ["pending", t("pending")], ["failed", t("failed")],
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
                title={t("onlyPinnedIndustriesFloatTo")}
                className={`control-chip ${pinnedOnly ? "status-amber" : "status-not-started"}`}
                onClick={() => setPinnedOnly((v) => !v)}
              >
                {pinnedOnly ? t("keyFactsOnly") : t("viewAll")}
              </button>
            </span>
          }
          actions={
            canCurate ? (
              <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setShowNewForm((v) => !v)} aria-expanded={showNewForm}>
                {t("newIndustryAnalysis")}
              </button>
            ) : null
          }
        />

        {canCurate && showNewForm && (
          <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) void openLinkModal(newName.trim()); }} aria-label={t("createNewIndustryAnalysis")} className="sizing-new-form mb-3">
            {/* 제출 시 바로 생성하지 않고 가치사슬 연계 후보 모달로 범위를 확정한다 */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{t("industryName")}</span>
                <input id="market-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("eGIndustrialRobots")} required className="sizing-new-input" />
              </label>
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{t("ksicCodeOptional")}</span>
                <span className="flex items-center gap-1">
                  <input
                    value={newCode}
                    onChange={(e) => { setNewCode(e.target.value); setKsicResults(null); }}
                    placeholder={t("eG28121")}
                    className="sizing-new-input sizing-new-input-sm"
                  />
                  <button type="button" className="btn-ghost btn-sm flex items-center gap-1" disabled={ksicSearching || (!newCode.trim() && !newName.trim())} onClick={() => void searchKsicCodes()}>
                    <Search size={16} aria-hidden="true" />
                    {ksicSearching ? tc("searching") : t("ksicSearch")}
                  </button>
                </span>
              </label>
              <button type="submit" className="btn-ghost" disabled={!newName.trim()}>
                {t("selectAnalysisScope")}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setShowNewForm(false); setNewName(""); setNewCode(""); setKsicResults(null); }}
              >
                {tc("cancel")}
              </button>
            </div>
            {ksicResults !== null && ksicResults.length > 0 && (
              <ul className="sizing-note-list mt-2" role="listbox" aria-label={t("ksicCodeSearchResults")}>
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
                      {newCode === it.code ? "✓ " : ""}{it.matched_by === "alias" && it.alias && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{it.alias} → </span>}{it.name_ko} <code className="dd-item-id">{it.code}</code>
                      {it.profile && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]"> {t("industryProfile")}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("ksicCodeIsOptionalSearch")}
              {llmStatus && (llmStatus.configured
                ? <> {t("useAiSummary")} <strong>{llmStatus.provider} / {llmStatus.model}</strong></>
                : <> {t("aiNotConfiguredRequiredEnvironment")} <strong>{t("deterministicSynthesis")}</strong>{t("item")}</>)}
            </p>
          </form>
        )}

        {/* ── 딜 컨텍스트 분할 (2026-10-16 결정자 승인 내비게이션 수정) ──
            이 안건에 연결된 산업(grouping.splitGroups, 앵커 기준)이 최상단,
            나머지는 "다른 검토의 산업 분석" 보조 영역으로 내려간다.
            비딜(/market) 컨텍스트에서는 linkedIds가 null이라 단일 목록 그대로. */}
        {ctx.linkedIds !== null ? (
          <>
            {ctx.linkedFlatRows.length > 0 ? (
              <IndustryTable ctx={ctx} rows={ctx.linkedFlatRows} />
            ) : (
              <p className="text-[color:var(--muted-fg)] italic" role="note">
                {t("noIndustryAnalysesLinkedTo")}
              </p>
            )}
            {ctx.otherFlatRows.length > 0 && (
              <div className="mt-4">
                <div className="flex items-baseline gap-2 mb-2">
                  <h3 className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--muted-fg)] uppercase tracking-wide">{t("otherDealsIndustryAnalyses")}</h3>
                  <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">({ctx.otherFlatRows.length}{tc("countSuffixParen")}</span>
                </div>
                <IndustryTable ctx={ctx} rows={ctx.otherFlatRows} />
              </div>
            )}
          </>
        ) : (
          <IndustryTable ctx={ctx} />
        )}
        {hasInProgress && (
          <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="status">
            {t("analysisInProgressTheList")}
          </p>
        )}
      </section>
  );
}
