"use client";

// S1 시장분석 본문 — ADR-0120 Wave 2 Phase C 추출(/market 페이지와
// /deals/[id]/s1 탭이 동일 컴포넌트를 소비한다).
// 예외(공통 규칙 #6 완화): StageFrame 안내 배너에 가치사슬 관계도 버튼 등
// 컴포넌트 상태에 묶인 UI가 있어 StageFrame을 컴포넌트가 직접 렌더링한다 —
// 호출자는 main 셸만 제공한다.
//
// 선택 모드: 독립 페이지(기본)는 URL ?industry= 로 선택을 운반하고, embedded
// 모드(deals 탭)는 내부 상태로 선택한다 — router를 건드리지 않는다.
// industryId prop으로 특정 산업을 고정 딥링크할 수 있다.
// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useEffect, useRef, useState } from "react";
import { StageFrame, StageRail } from "../../StageFrame.tsx";
import { PrimaryAction } from "../../ui.tsx";
import { Breadcrumb } from "../../Breadcrumb.tsx";
import { DealBreadcrumb } from "../../DealBreadcrumb.tsx";
import { ListBackButton } from "../../ListBackButton.tsx";
import { useMarketData } from "./useMarketData.ts";
import { useMarketLinking } from "./useMarketLinking.ts";
import { useDealIndustryLink } from "./useDealIndustryLink.ts";
import { useMarketList } from "./useMarketList.ts";
import { IndustryListSection } from "./IndustryListSection.tsx";
import { LinkCandidatesModal } from "./LinkCandidatesModal.tsx";
import { LinkToDealModal, type LinkToDealModalState } from "./LinkToDealModal.tsx";
import { MarketReport } from "./MarketReport.tsx";
import { IndustryChainGraph } from "./IndustryChainGraph.tsx";
import { useTranslations } from "next-intl";

/**
 * `dealId` — the deal carrier when rendered as the /deals/{id}/s1 tab (drives the
 * breadcrumb and the "next: S2" link). `startNew` — land with the new-industry
 * form open and focused (board "새 검토 시작", /market?new=1).
 */
export function MarketAnalysisStage(props0: { industryId?: string; embedded?: boolean; dealId?: string; startNew?: boolean }) {const t = useTranslations("stages.s1.marketAnalysisStage"); const tc = useTranslations("common");
  const { dealId, startNew } = props0;
  const h0 = useMarketData(props0);
  const h1 = useMarketLinking({ ...h0 });
  const h3 = useDealIndustryLink(dealId);
  const h2 = useMarketList({ ...h0, ...h1, ...h3 });
  const ctx = { ...h0, ...h1, ...h3, ...h2 };
  const { confirmDialog, linkNotice, chainGraph, setChainGraphOpen, error, chainGraphOpen, detail, selectedIndustry, overview, openLinkModal, canCurate, showNewForm, backToList } = ctx;
  const { linkedIds, projectId: linkProjectId, loading: linkLoading, reload: reloadLink } = ctx;
  // "이 안건에 연결" CTA modal state (detail view, unlinked industries only).
  const [linkToDeal, setLinkToDeal] = useState<LinkToDealModalState>({ open: false, industry: null });
  const openLinkToDeal = (s: LinkToDealModalState) => setLinkToDeal(s);

  // Known entry (R2-A item 7): scroll the open new-analysis form into view and
  // focus its first field, once, as soon as it is rendered.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!startNew || focusedRef.current || !canCurate || !showNewForm || detail) return;
    const el = document.getElementById("market-new-name");
    if (!el) return;
    focusedRef.current = true;
    el.scrollIntoView({ block: "center" });
    el.focus();
  }, [startNew, canCurate, showNewForm, detail, overview]);


  // ── Detail view ──
  // Deal-context breadcrumb decision (2026-10-16 결정자 승인): an industry
  // LINKED to this deal keeps the deal path (검토/안건 보드 › 안건 › S1 › 산업)
  // and the "다음: S2" link. An UNLINKED industry renders a NEUTRAL
  // "시장 분석 › <산업명>" path — no deal tail, no S2 hand-off — plus the
  // "이 안건에 연결" CTA (analyst+, mandatory-rationale binding). While the
  // linkage fetch is in flight we keep today's deal breadcrumb (no flicker).
  if (detail && selectedIndustry) {
    const row = overview?.industries.find((i) => i.id === selectedIndustry);
    const analysisId = row?.analysis?.id ?? null;
    const analysisDate = row?.analysis ? (row.analysis.completed_at ?? row.analysis.created_at).slice(0, 10) : null;
    const isLinkedInDeal = dealId ? (linkLoading ? true : (linkedIds?.has(detail.industry.id) ?? true)) : true;
    const inDealContext = !!dealId && isLinkedInDeal;
    const nextHref = inDealContext ? `/deals/${encodeURIComponent(dealId!)}/s2` : "/opportunities";
    return (
      <>
        {inDealContext ? (
          <DealBreadcrumb dealId={dealId!} stageId="S1" tail={[{ label: detail.industry.name_ko }]} />
        ) : (
          <Breadcrumb items={dealId
            ? [{ label: t("marketAnalysis"), href: "/market" }, { label: detail.industry.name_ko }]
            : [{ label: t("reviewDealBoard"), href: "/deals" }, { label: t("s1MarketAnalysis"), href: "/market" }, { label: detail.industry.name_ko }]}
          />
        )}
        <StageRail current={["S1"]} />
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <ListBackButton onClick={backToList} label={t("toTheIndustryList")} />
          <div className="flex flex-wrap items-center gap-2">
            {inDealContext && <PrimaryAction readOnly inline href={nextHref} label={t("nextS2OpportunityDiscovery")} />}
            {!inDealContext && dealId && canCurate && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => openLinkToDeal({ open: true, industry: { id: detail.industry.id, name_ko: detail.industry.name_ko } })}
                title={t("linksThisIndustryAnalysisAs")}
              >
                {tc("linkToThisDeal")}
              </button>
            )}
          </div>
        </div>
        <MarketReport
          detail={detail}
          analysisId={analysisId}
          analysisDate={analysisDate}
          onAddLinked={analysisId ? () => openLinkModal(detail.industry.name_ko, analysisId) : undefined}
        />
        <LinkToDealModal
          state={linkToDeal}
          projectId={linkProjectId}
          onClose={() => setLinkToDeal({ open: false, industry: null })}
          onLinked={() => { reloadLink(); }}
        />
      </>
    );
  }
  return (
    <>
      {confirmDialog}
      {linkNotice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-body)] mb-2">{linkNotice}</p>}
      {dealId && <DealBreadcrumb dealId={dealId} stageId="S1" />}
      <MarketPrimaryAction ctx={ctx} />
      <StageFrame stageId="S1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>{t("selectingAnIndustryShowsThe")}</span>
          {/* 산업 간 가치사슬 관계도 — 인라인 배치는 목록 화면 공간을 너무 많이
              차지해 버튼 + 모달로 뺐다. 큐레이션된 수요 산업 연계가 하나도
              없으면(신규 워크스페이스) 버튼 자체를 숨긴다. */}
          {chainGraph && chainGraph.nodes.length > 0 && (
            <button type="button" className="btn-ghost btn-sm whitespace-nowrap" onClick={() => setChainGraphOpen(true)}>
              <span aria-hidden="true">🔗</span> {t("viewTheValueChainMap")}{chainGraph.nodes.length}{t("industries")}
            </button>
          )}
        </span>
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 분석 대상 산업 (테이블) ── */}
      <IndustryListSection ctx={ctx} />

      {/* ── 가치사슬 연계 후보 모달 (분석·재분석 범위 선택, ADR-0126 확장) ── */}
      <LinkCandidatesModal ctx={ctx} />

      {/* ── 산업 간 가치사슬 관계도 모달 ── */}
      {chainGraphOpen && chainGraph && (
        <div className="modal-backdrop" onClick={() => setChainGraphOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label={tc("industryValueChainMap")}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "min(90vw, var(--content-modal))" }}
          >
            <h2 className="text-[length:var(--fs-body)] mb-1">{tc("industryValueChainMap")}</h2>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("showsOnlyDownstreamDownstreamUpstream")}
            </p>
            <IndustryChainGraph nodes={chainGraph.nodes} edges={chainGraph.edges} />
            <div className="flex justify-end mt-3">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setChainGraphOpen(false)}>{tc("close")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** S1 primary action (design §5): run sizing once inputs are complete, else lead the user to the gap. */
function MarketPrimaryAction({ ctx }: { ctx: ReturnType<typeof useMarketData> & ReturnType<typeof useMarketLinking> }) {const t = useTranslations("stages.s1.marketAnalysisStage");
  const { canCurate, showNewForm, setShowNewForm, newName, openLinkModal } = ctx;
  if (!canCurate) {
    return <PrimaryAction inline label={t("runMarketSizing")} disabled disabledReason={t("industryAnalysisRequiresTheAnalyst")} />;
  }
  if (!showNewForm || !newName.trim()) {
    return (
      <PrimaryAction
        inline
        label={t("newIndustryAnalysisInput")}
        onClick={() => {
          setShowNewForm(true);
          setTimeout(() => document.getElementById("market-new-name")?.focus(), 0);
        }}
      />
    );
  }
  return <PrimaryAction inline label={t("runMarketSizing2")} onClick={() => void openLinkModal(newName.trim())} />;
}
