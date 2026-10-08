"use client";

// S6/S7 후보 상세 화면 (/brownfield/targets/[targetId]) — 목록의 드릴다운을
// 대체하는 전용 페이지(사용자 결정, 2026-09-15). DART 연결 회사는 재무 facts와
// 공시(사업보고서 등)를 이 화면에서 바로 확인·활용하고, 재무 판정의 참고값을
// DART가 채워주므로 사람의 판정 작업이 기술 평가 중심이 된다(경계 #2 — 판정은
// 항상 사람이 select로 기록한다).
// Split from app/brownfield/targets/[targetId]/page.tsx (Wave U-3 decomposition); behavior unchanged.
import { Suspense } from "react";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { isFinancialDataRef } from "../../../../lib/brownfield-financial-rubric.ts";
import { ListBackButton } from "../../../../components/ListBackButton.tsx";
import { SectionToolbar } from "../../../../components/layout.tsx";
import { useTargetDetail } from "../../../../components/brownfield-target/useTargetDetail.ts";
import { useTargetActions } from "../../../../components/brownfield-target/useTargetActions.ts";
import { TargetOverviewEditTab, TargetOverviewTab } from "../../../../components/brownfield-target/TargetOverviewTabs.tsx";
import { TargetAiProfileTab } from "../../../../components/brownfield-target/TargetAiProfileTab.tsx";
import { TargetFinancialsTab, TargetDisclosuresTab, TargetSourcesTab } from "../../../../components/brownfield-target/TargetDataTabs.tsx";
import { TargetPrecheckTab } from "../../../../components/brownfield-target/TargetPrecheckTab.tsx";
import { TargetEvalTab } from "../../../../components/brownfield-target/TargetEvalTab.tsx";
import { STATUS_LABEL, PROFILE_TABS } from "../../../../components/brownfield-target/constants.ts";
import type { ScreeningItemEvidence } from "../../../../components/brownfield-target/types.ts";

export default function BrownfieldTargetPage() {
  return (
    <Suspense fallback={null}>
      <TargetDetailView />
    </Suspense>
  );
}

export function TargetDetailView() {
  const h0 = useTargetDetail();
  const h1 = useTargetActions({ ...h0 });
  const ctx = { ...h0, ...h1 };
  const { error, canAct, busy, excludeReason, setExcludeReason, profileTab, setProfileTab, analyzing, companyProfile, companyId, runCompanyAnalysis, setEditing, confirm, confirmDialog, shortlist, exclude, deleteTarget, detail, evalDraft } = ctx;


  if (!detail) {
    return (
      <main>
        <StageFrame stageId={["S6", "S7"]} track="brownfield" heading="S6/S7 대상발굴·선정 — 후보 상세" />
        {error ? <p role="alert" className="text-[color:var(--red-fg)]">{error}</p> : <p className="text-[color:var(--muted-fg)]">불러오는 중...</p>}
      </main>
    );
  }


  const { target: t, opportunity, evalItems, scores, checklist, screening_summary, evidence } = detail;

  // 사전 검토 확정 판정 + 항목별 근거(위원회 추천 검토에서 수집·저장된 것).
  const savedVerdicts = t.screening_json ? (JSON.parse(t.screening_json) as Record<string, string>) : {};

  const itemEvidence = t.screening_evidence_json
    ? (JSON.parse(t.screening_evidence_json) as Record<string, ScreeningItemEvidence>)
    : {};

  const hasPrecheckData = evidence.length > 0 || screening_summary.assessed > 0;

  // 재무 자동 초안 대상 — 재무 빌트인 + data_ref 있는 항목 중 미판정만.
  const pendingFinancial = evalItems.filter(
    (it) => it.category === "financial" && it.source === "builtin" && isFinancialDataRef(it.data_ref) && (it.state?.status ?? "pending") === "pending",
  );

  // 기술 자동 초안 대상 — 기술 항목(시딩·커스텀 무관) 중 미판정만.
  const pendingTechnical = evalItems.filter((it) => it.category === "technical" && (it.state?.status ?? "pending") === "pending");

  const proposedCount = evalDraft ? Object.values(evalDraft).filter((d) => d.status != null).length : 0;

  const scoreChip = (score: number | null) =>
    `status-chip ${score == null ? "status-not-started" : score >= 70 ? "status-green" : score >= 40 ? "status-amber" : "status-red"}`;

  // 승격 가능 여부 = 재무·기술 평가 전 항목 판정 완료(서버 shortlist와 동일 기준)
  const evalComplete = (["financial", "technical"] as const).every(
    (c) => scores[c].totalWeight > 0 && scores[c].scoredWeight === scores[c].totalWeight,
  );
  return (
    <main>
      <StageFrame stageId={["S6", "S7"]} track="brownfield" heading="S6/S7 대상발굴·선정 — 후보 상세">
        {opportunity.name} · {t.company_name}
        {t.dart_corp_code ? <> · DART <code className="dd-item-id">{t.dart_corp_code}</code></> : null}
      </StageFrame>

      {error && <p role="alert" className="text-[color:var(--red-fg)] mb-2">{error}</p>}

      {/* ── 헤더 카드 — 상태·점수 요약 + 목록 복귀 ── */}
      <section aria-label="후보 요약" className="market-section">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-[1rem] mb-0">{t.company_name}</h2>
              <span className={`status-chip ${t.status === "shortlisted" ? "status-green" : t.status === "excluded" ? "status-red" : "status-not-started"}`}>
                {STATUS_LABEL[t.status]}{t.status === "shortlisted" && t.rank ? ` #${t.rank}` : ""}
              </span>
            </div>
            <ListBackButton href={`/brownfield?opportunity=${encodeURIComponent(opportunity.id)}`} label="Long List 목록으로" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`status-chip ${scoreChip(scores.financial.score)}`} title="재무 평가 100점 가중 점수">재무 {scores.financial.score ?? "—"}</span>
            <span className={`status-chip ${scoreChip(scores.technical.score)}`} title="기술 평가 100점 가중 점수(S3 필요 역량 기준)">기술 {scores.technical.score ?? "—"}</span>
            <span className={`status-chip ${scoreChip(scores.combined)}`} title="재무·기술 종합 점수(financial·technical 평균)">
              종합 {scores.combined != null ? `${scores.combined}점 / 100점` : "— 판정 필요"}
            </span>
            {t.exclusion_reason && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">제외 사유: {t.exclusion_reason}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {canAct && t.status !== "shortlisted" && (
              <button
                type="button"
                className="btn-premium btn-sm"
                disabled={busy || !evalComplete}
                title={evalComplete ? "Short List로 승격" : "재무·기술 평가를 모두 판정한 뒤 승격할 수 있습니다"}
                onClick={() => void shortlist()}
              >
                Short List 승격
              </button>
            )}
            {canAct && t.status !== "excluded" && (
              <span className="flex items-center gap-1">
                <input
                  aria-label="제외 사유"
                  placeholder="제외 사유"
                  value={excludeReason}
                  onChange={(e) => setExcludeReason(e.target.value)}
                  className="sizing-new-input sizing-new-input-sm"
                  style={{ flex: "1 1 12rem" }}
                />
                <button type="button" className="btn-ghost btn-sm whitespace-nowrap" disabled={busy || !excludeReason.trim()} onClick={() => void exclude()}>제외</button>
              </span>
            )}
            {t.status === "shortlisted" && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">Short List 승격 완료 — 순위 조정은 목록 화면에서</span>}
          </div>
        </div>
      </section>

      {/* ── 회사 프로파일 탭 — 그룹/계열사 프로파일과 유사한 구조(사용자 요청,
          2026-09-15). 개요 / 재무 / 공시 / 평가로 회사 정보를 구조화한다. ── */}
      <section aria-label="회사 프로파일" className="market-section">
        <SectionToolbar title="회사 프로파일" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="library-tabs" role="tablist" aria-label="후보 회사 프로파일 섹션">
            {PROFILE_TABS.filter(([key]) => key !== "precheck" || hasPrecheckData).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={profileTab === key} className={`library-tab ${profileTab === key ? "library-tab-active" : ""}`} onClick={() => setProfileTab(key)}>
                {label}
              </button>
            ))}
          </div>
          {/* 핵심 액션 — 탭 목록과 같은 줄 오른쪽에 배치. 정보 수정·후보 삭제·
              재분석은 활성 탭과 무관하게 항상 노출한다(사용자 요청, 2026-09-16).
              수정 폼은 개요 탭에 있으므로 정보 수정 클릭 시 개요 탭으로 전환한다. */}
          {canAct && (<span className="flex items-center gap-1">
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={analyzing || companyProfile === undefined || companyProfile?.status === "in_progress" || !companyId}
              title={companyId ? undefined : "회사 마스터가 연결되면 실행할 수 있습니다"}
              onClick={() => void runCompanyAnalysis()}
            >
              {companyProfile?.status === "in_progress" ? "분석 중..." : companyProfile?.profile ? "재분석" : "AI 분석 실행"}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setProfileTab("overview"); setEditing(true); }}>정보 수정</button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => confirm(
                `${t.company_name} 삭제`,
                () => void deleteTarget(),
                { body: "평가 판정을 포함해 완전히 삭제되며 되돌릴 수 없습니다. 사유를 남기고 싶다면 삭제 대신 \"제외\"를 쓰세요.", confirmLabel: "삭제" },
              )}
            >
              후보 삭제
            </button>
          </span>)}
        </div>

        {/* 후보 정보(소속 기회·상태·DART·평가 점수)는 위 요약 카드에 이미
            표시되므로 여기서는 반복하지 않는다 — 수정 폼만 필요할 때 보인다
            (사용자 요청, 2026-09-15 — "다 제거될 필요가 있어"). */}
        <TargetOverviewEditTab ctx={ctx} t={t} />

        {/* AI 분석 요약(신뢰도 상한 권고·종합 평가·산업 노출) — 서브탭 없이 개요
            탭에 바로 붙인다(사용자 요청, 2026-09-15 — "서브탭을 만들면 안될 듯"). */}
        <TargetOverviewTab ctx={ctx} />

        <TargetAiProfileTab ctx={ctx} t={t} />

        <TargetFinancialsTab ctx={ctx} />

        <TargetDisclosuresTab ctx={ctx} />

        {/* ── 사전 검토 근거(읽기 전용 참고 탭) — 위원회 추천 검토·등록·
            재분석에서 수집된 정보의 저장소(사용자 결정, 2026-09-16). 판정
            기록은 /brownfield Short List "사전 검토" 섹션에서 하고, 여기서는
            확정된 판정·항목별 근거·수집 타임라인을 나중에 참고할 수 있게
            보여준다. 수집된 근거가 없으면 탭 자체가 숨는다. ── */}
        <TargetPrecheckTab ctx={ctx} screening_summary={screening_summary} savedVerdicts={savedVerdicts} checklist={checklist} itemEvidence={itemEvidence} evidence={evidence} />

        <TargetEvalTab ctx={ctx} evalItems={evalItems} scores={scores} scoreChip={scoreChip} pendingFinancial={pendingFinancial} proposedCount={proposedCount} pendingTechnical={pendingTechnical} />

        <TargetSourcesTab ctx={ctx} />
      </section>
      {confirmDialog}
    </main>
  );
}
