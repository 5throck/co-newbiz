"use client";

// S3 시너지·전략적 적합성 본문 — ADR-0120 Wave 2 Phase B 추출(/synergy 페이지와
// /deals/[id]/s3 탭이 동일 컴포넌트를 소비한다). StageFrame과 main 셸은 호출자가
// 제공한다(공통 규칙 #6).
//
// 선택 상태는 두 모드로 동작한다:
//   - 독립 페이지(기본): URL ?company= 가 선택을 운반한다(뒤로 가기 연동).
//   - deals 탭(embedded): analysisId prop(딥링크 ?analysis=) 또는 캐리어 기회에
//     연결된 분석을 자동 선택한다 — router로 /synergy를 건드리지 않는다.
// Split from components/stages/SynergyStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { PrimaryAction } from "../../ui.tsx";
import { ReviewBuckets } from "../../ReviewBuckets.tsx";
import { stageArtifactTabs } from "../../../lib/review/stage-artifact-labels.ts";
import { useSynergyList } from "./useSynergyList.ts";
import { SynergyListSection } from "./SynergyListSection.tsx";
import { NewSynergyForm } from "./NewSynergyForm.tsx";
import { SynergyResult } from "./SynergyResult.tsx";

export function SynergyStage(props0: { opportunityId?: string; analysisId?: string; embedded?: boolean }) {
  const h0 = useSynergyList(props0);
  const ctx = { ...h0 };
  const { confirmDialog, error, opportunityId, selected, detail, tab, setTab, backToList, rerun, refreshDetail, canCurate, showNewForm, setShowNewForm, targetSel, creating, createAnalysis } = ctx;


  // ── 상세 (회사 선택 시) ──
  if (selected) {
    const selectedAnalysis = detail ?? selected;
    return (
      <>
        {confirmDialog}
        <SynergyResult
          analysis={selectedAnalysis}
          tab={tab}
          onTab={(k) => setTab(k)}
          onBack={backToList}
          onRerun={() => rerun(selected)}
          onRefresh={() => refreshDetail(selectedAnalysis.id)}
        />
      </>
    );
  }
  return (
    <>
      {confirmDialog}
      {!canCurate ? (
        <PrimaryAction label="시너지 분석 실행" disabled disabledReason="시너지 분석은 analyst 권한이 필요합니다." />
      ) : !showNewForm || !targetSel ? (
        <PrimaryAction label="새 시너지 평가 입력" onClick={() => { setShowNewForm(true); setTimeout(() => document.querySelector(".sizing-new-form")?.scrollIntoView({ block: "center" }), 0); }} />
      ) : (
        <PrimaryAction label={creating ? "분석 시작 중..." : "시너지 분석 실행"} disabled={creating} disabledReason="분석을 시작하는 중입니다." onClick={() => void createAnalysis()} />
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {opportunityId && <ReviewBuckets entityType="opportunity" entityId={opportunityId} artifacts={stageArtifactTabs("S3")} />}

      <SynergyListSection ctx={ctx} />

      {/* ── 새 분석 폼 (대상 = 그룹/계열사 레지스트리 · 기회 연결 — ADR-0090) ── */}
      <NewSynergyForm ctx={ctx} />
    </>
  );
}
