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
import { StageFrame } from "../../StageFrame.tsx";
import { PrimaryAction } from "../../ui.tsx";
import { useMarketData } from "./useMarketData.ts";
import { useMarketLinking } from "./useMarketLinking.ts";
import { useMarketList } from "./useMarketList.ts";
import { IndustryListSection } from "./IndustryListSection.tsx";
import { LinkCandidatesModal } from "./LinkCandidatesModal.tsx";
import { MarketReport } from "./MarketReport.tsx";
import { IndustryChainGraph } from "./IndustryChainGraph.tsx";

export function MarketAnalysisStage(props0: { industryId?: string; embedded?: boolean }) {
  const h0 = useMarketData(props0);
  const h1 = useMarketLinking({ ...h0 });
  const h2 = useMarketList({ ...h0, ...h1 });
  const ctx = { ...h0, ...h1, ...h2 };
  const { confirmDialog, linkNotice, chainGraph, setChainGraphOpen, error, chainGraphOpen, detail, selectedIndustry, overview, openLinkModal } = ctx;


  if (detail && selectedIndustry) {
    const row = overview?.industries.find((i) => i.id === selectedIndustry);
    const analysisId = row?.analysis?.id ?? null;
    const analysisDate = row?.analysis ? (row.analysis.completed_at ?? row.analysis.created_at).slice(0, 10) : null;
    return (
      <>
        <MarketReport
          detail={detail}
          analysisId={analysisId}
          analysisDate={analysisDate}
          onAddLinked={analysisId ? () => openLinkModal(detail.industry.name_ko, analysisId) : undefined}
        />
      </>
    );
  }
  return (
    <>
      {confirmDialog}
      {linkNotice && <p role="status" className="text-[color:var(--green-fg)] text-[length:var(--fs-body)] mb-2">{linkNotice}</p>}
      <MarketPrimaryAction ctx={ctx} />
      <StageFrame stageId="S1">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span>산업을 선택하면 체계적 시장 규모 추정 8단계 절차로 분석된 리포트가 차트로 표시됩니다.</span>
          {/* 산업 간 가치사슬 관계도 — 인라인 배치는 목록 화면 공간을 너무 많이
              차지해 버튼 + 모달로 뺐다. 큐레이션된 수요 산업 연계가 하나도
              없으면(신규 워크스페이스) 버튼 자체를 숨긴다. */}
          {chainGraph && chainGraph.nodes.length > 0 && (
            <button type="button" className="btn-ghost btn-sm whitespace-nowrap" onClick={() => setChainGraphOpen(true)}>
              🔗 산업 간 가치사슬 관계도 보기 ({chainGraph.nodes.length}개 산업)
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
            aria-label="산업 간 가치사슬 관계도"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "min(90vw, 960px)" }}
          >
            <h2 className="text-[0.95rem] mb-1">산업 간 가치사슬 관계도</h2>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              사람이 확정한 전방/전전방/후방/후후방 연계만 표시합니다 — 색이 채워진 노드는 분석 완료된 산업입니다.
            </p>
            <IndustryChainGraph nodes={chainGraph.nodes} edges={chainGraph.edges} />
            <div className="flex justify-end mt-3">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setChainGraphOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** S1 primary action (design §5): run sizing once inputs are complete, else lead the user to the gap. */
function MarketPrimaryAction({ ctx }: { ctx: ReturnType<typeof useMarketData> & ReturnType<typeof useMarketLinking> }) {
  const { canCurate, showNewForm, setShowNewForm, newName, openLinkModal } = ctx;
  if (!canCurate) {
    return <PrimaryAction label="시장 규모 분석 실행" disabled disabledReason="산업 분석은 analyst 권한이 필요합니다." />;
  }
  if (!showNewForm || !newName.trim()) {
    return (
      <PrimaryAction
        label="입력 완료하기"
        onClick={() => {
          setShowNewForm(true);
          setTimeout(() => document.getElementById("market-new-name")?.focus(), 0);
        }}
      />
    );
  }
  return <PrimaryAction label="시장 규모 분석 실행" onClick={() => void openLinkModal(newName.trim())} />;
}
