"use client";

// /deals/[id]/s[stage] — stage tab (ADR-0120). Wave 2: S2·S4·S5는 전체 작업
// 화면이 이 탭 안으로 통합되었다(components/stages/*Stage.tsx 공유 컴포넌트 —
// 독립 페이지와 동일 컴포넌트를 소비). 나머지 단계는 StageFrame-grade 가이던스
// 스텁으로 처리하며 Wave 2 후속 단계(B/C)에서 통합된다.
//
// 훅 순서 규율: 단계별 분기는 각기 다른 자식 컴포넌트로 분리한다(StageTab 자체는
// 항상 동일한 훅만 호출). 조기 반환으로 훅 호출 수가 갈리면 탭 전환 시 React
// "hooks changed" 오류가 난다.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../../lib/api.ts";
import { STAGE_STATUS_LABEL, labelText, localizeRequirement, trackLabel } from "../../../../lib/labels.ts";
import { PageState } from "../../../../components/ui.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { DealBreadcrumb } from "../../../../components/DealBreadcrumb.tsx";
import { RouteDecisionStage } from "../../../../components/stages/RouteDecisionStage.tsx";
import { GreenfieldStage } from "../../../../components/stages/GreenfieldStage.tsx";
import { OpportunityFunnelStage } from "../../../../components/stages/OpportunityFunnelStage.tsx";
import { SynergyStage } from "../../../../components/stages/SynergyStage.tsx";
import { BrownfieldStage } from "../../../../components/stages/BrownfieldStage.tsx";
import { MarketAnalysisStage } from "../../../../components/stages/MarketAnalysisStage.tsx";
import { OurCompanyStage } from "../../../../components/stages/OurCompanyStage.tsx";
import { BusinessCaseStage } from "../../../../components/stages/BusinessCaseStage.tsx";
import { DdStage } from "../../../../components/stages/DdStage.tsx";
import { DealStructureStage } from "../../../../components/stages/DealStructureStage.tsx";
import { IcReviewStage } from "../../../../components/stages/IcReviewStage.tsx";
import { useDealOpportunityId } from "../../../../components/stages/use-deal-opportunity-id.ts";
import { PortfolioStage } from "../../../../components/stages/PortfolioStage.tsx";
import { DealEntryMarketStrip } from "../../../../components/EntryMarketContextStrip.tsx";

interface ProcessView {
  currentStage: string | null; nextStage: string | null; track: string | null;
  blockers: string[]; requiredArtifacts: string[]; gateStatus: Record<string, string>;
  stages: Array<{ id: string; status: string }>;
}

// D-03/D-18: S5 is Green Field only, S6/S7 are Brown Field only. Opening the other track's stage
// shows a plain notice with a link to the stage that applies instead of the working screen.
function TrackGate({ carrierId, stageLabel, only, otherStage, children }: {
  carrierId: string; stageLabel: string; only: "greenfield" | "brownfield"; otherStage: "s5" | "s6"; children: React.ReactNode;
}) {
  const [track, setTrack] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api.get<{ track: string | null }>(`/api/opportunities/${encodeURIComponent(carrierId)}/process`)
      .catch(() => api.get<{ track: string | null }>(`/api/projects/${encodeURIComponent(carrierId)}/process`))
      .then((r) => { if (alive) setTrack(r.data.track ?? null); })
      .catch(() => { if (alive) setTrack(null); });
    return () => { alive = false; };
  }, [carrierId]);
  if (track === undefined) return <PageState state="loading" />;
  if (track && track !== only) {
    const thisName = track === "greenfield" ? "Green Field" : "Brown Field";
    return (
      <div className="card" role="note">
        <h2>{stageLabel}</h2>
        <p>
          {only === "brownfield" ? "Green Field에는 적용되지 않는 단계입니다." : "Brown Field에는 적용되지 않는 단계입니다."}
          {" "}이 검토/안건의 트랙은 {thisName}입니다.
        </p>
        <p>
          <Link className="control-chip status-green" href={`/deals/${carrierId}/${otherStage}`}>
            {otherStage === "s5" ? "S5 자체 진출로 이동" : "S6 대상 발굴로 이동"}
          </Link>
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function StageTab() {
  const params = useParams<{ id: string; stage: string }>();
  const searchParams = useSearchParams();
  const stageId = params.stage.toUpperCase().startsWith("S") ? params.stage.toUpperCase() : `S${params.stage}`;

  // S1 시장분석 — Wave 2 Phase C 통합. StageFrame 배너(가치사슬 관계도 버튼 포함)는
  // MarketAnalysisStage가 직접 렌더링한다(?industry= 딥링크로 특정 산업 지정 가능).
  if (stageId === "S1") {
    return (
      <main>
        <MarketAnalysisStage embedded dealId={params.id} industryId={searchParams.get("industry") ?? undefined} />
      </main>
    );
  }

  // S2 기회 발굴 — Wave 2 Phase A 통합. 캐리어 기회 행을 퍼널에 표시.
  if (stageId === "S2") {
    return (
      <main>
        <DealBreadcrumb dealId={params.id} stageId="S2" />
        <StageFrame stageId="S2">
          시장분석(S1) 산출물에서 기회를 발굴하고, 기회·위험 요인을 근거로 매력도를 평가합니다.
        </StageFrame>
        <OpportunityFunnelStage opportunityId={params.id} />
      </main>
    );
  }

  // S4 진출방식 결정 — Wave 2 마이그레이션 완료(목업 v5 baseline 구조).
  if (stageId === "S4") {
    return (
      <main>
        <DealBreadcrumb dealId={params.id} stageId="S4" />
        <StageFrame stageId="S4">
          선별된 기회의 진출방식을 결정하는 분기점입니다.
          Greenfield(자체 역량 진출)는 S5 역량 평가로, Brownfield(기존 기업·자산 결합)는
          S6 대상 후보 발굴로 진행됩니다. Brownfield ≠ M&A — 라우트 유형을 함께 선택합니다.
        </StageFrame>
        <DealEntryMarketStrip routeId={params.id} />
        <RouteDecisionStage opportunityId={params.id} rationaleParam={searchParams.get("rationale")} />
      </main>
    );
  }

  // S3 시너지·전략적 적합성 — Wave 2 Phase B 통합. 캐리어 기회에 연결된 분석을
  // 자동 선택(?analysis= 딥링크로 특정 분석 지정). 상단 스위처(2026-09-20 리뷰 —
  // URL 파라미터만으로는 발견되지 않았다)로 같은 S3의 우리계열사 분석 표면(Phase C)과
  // 전환한다.
  if (stageId === "S3") {
    const companySurface = searchParams.get("surface") === "company";
    return (
      <main>
        <DealBreadcrumb dealId={params.id} stageId="S3" tail={companySurface ? [{ label: "그룹·계열사 프로파일" }] : []} />
        <div role="group" aria-label="S3 화면 전환" className="flex flex-wrap gap-1 mb-2">
          <Link
            href={`/deals/${params.id}/s3`}
            aria-current={!companySurface ? "page" : undefined}
            className={`control-chip ${!companySurface ? "status-green" : "status-not-started"}`}
          >
            시너지·전략적 적합성
          </Link>
          <Link
            href={`/deals/${params.id}/s3?surface=company`}
            aria-current={companySurface ? "page" : undefined}
            className={`control-chip ${companySurface ? "status-green" : "status-not-started"}`}
          >
            그룹·계열사 프로파일
          </Link>
        </div>
        {companySurface ? (
          <>
            <StageFrame stageId="S3" heading="S3 그룹/계열사 분석">
              그룹과 계열사를 등록해 자사 강점/약점을 분석합니다. 이 프로파일은 S3 시너지·적합성 평가의 입력(자사 역량·포트폴리오 정보)으로 사용됩니다. 상장 계열사는 DART 재무제표, 전체는 애널리스트 리포트·산업 동향 리서치로 분석합니다.
            </StageFrame>
            <OurCompanyStage embedded />
          </>
        ) : (
          <>
            <StageFrame stageId="S3">
              그룹/계열사 분석에서 만든 자사 프로파일(특정 계열사 또는 그룹 전체)을 S1 시장분석·S2 기회발굴
              결과와 연결해 시너지 영역 후보를 도출하고 우선 시너지 영역으로 좁힙니다. 기회를 연결하면 완료 시 해당 기회에
              synergy_score 권고가 기록됩니다.
            </StageFrame>
            <DealEntryMarketStrip routeId={params.id} />
            <S3Synergy routeId={params.id} analysisId={searchParams.get("analysis") ?? undefined} />
          </>
        )}
      </main>
    );
  }

  // S5 자체 진출 — Wave 2 Phase A 통합. Greenfield 트랙 캐리어의 역량 평가 화면.
  if (stageId === "S5") {
    return (
      <main>
        <DealBreadcrumb dealId={params.id} stageId="S5" />
        <StageFrame stageId="S5" track="greenfield">
          Greenfield 경로 — 자체 역량으로 진입할 수 있는지 평가합니다. 진출전략을
          직접 구축 / 전략 제휴 / 인력 영입 / 지분 투자 중 결정하고, 필요 역량(S3에서 이미 정의·판정된
          내용)을 확인한 뒤 투자비 검토 요건을 정리합니다.
        </StageFrame>
        <DealEntryMarketStrip routeId={params.id} />
        <TrackGate carrierId={params.id} stageLabel="S5 자체 진출" only="greenfield" otherStage="s6">
          <GreenfieldStage opportunityId={params.id} />
        </TrackGate>
      </main>
    );
  }

  // S6/S7 대상발굴·선정 — Wave 2 Phase B 통합. Brownfield 트랙 캐리어의
  // 목표 시장 → 후보 전체 목록 → 사전 검토 → 최종 후보 목록 → 게이트·승격 화면.
  if (stageId === "S6" || stageId === "S7") {
    return (
      <main>
        <DealBreadcrumb dealId={params.id} stageId={stageId as "S6" | "S7"} />
        <StageFrame stageId={["S6", "S7"]} track="brownfield" heading="S6/S7 대상발굴·선정">
          Brownfield 경로 — 진출방식이 Brownfield로 결정된 기회의
          대상 후보를 발굴하고(S6 후보 전체 목록), <code>대상 사전 검토 체크리스트</code> 체크리스트로 스크리닝해
          최종 후보 목록으로 좁힙니다(S7). CDD/TDD는 최종 후보 목록 확정 후 S9에서 수행합니다.
        </StageFrame>
        <DealEntryMarketStrip routeId={params.id} />
        <TrackGate carrierId={params.id} stageLabel={`${stageId} 대상발굴·선정`} only="brownfield" otherStage="s5">
          <BrownfieldStage opportunityId={params.id} />
        </TrackGate>
      </main>
    );
  }

  // S8~S12 프로젝트 단계 — Wave 3 통합. 캐리어가 기회면 승격된 프로젝트 id로
  // 해석하고, 프로젝트 id면 그대로 사용한다.
  if (stageId === "S8" || stageId === "S9" || stageId === "S10" || stageId === "S11" || stageId === "S12") {
    // ADR-0181 slice 5 — S9~S12 also operate on the S2-decided entry market:
    // the subject-market header rides every project stage surface (the strip
    // resolves the promoted project back to its source opportunity).
    return (
      <>
        <DealEntryMarketStrip routeId={params.id} />
        <ProjectStageTab carrierId={params.id} stageId={stageId} />
      </>
    );
  }

  return <StageGuidanceTab carrierId={params.id} stageId={stageId} />;
}

// S3 body: the route id may be a promoted project id, so the synergy list is scoped by the
// resolved source opportunity (shared resolver with the deal overview).
function S3Synergy({ routeId, analysisId }: { routeId: string; analysisId?: string }) {
  const st = useDealOpportunityId(routeId);
  if (st.status === "loading") return <PageState state="loading" />;
  if (st.status === "error") return <PageState state="error" errorText={st.message} onRetry={() => window.location.reload()} />;
  return <SynergyStage opportunityId={st.opportunityId ?? undefined} noSourceOpportunity={st.opportunityId === null} analysisId={analysisId} embedded />;
}

// S8~S12 프로젝트 단계 탭 — Wave 3(components/stages/*Stage.tsx 공유 컴포넌트).
// ADR-0094/0095: FS 경로가 정리되면 캐리어가 기회에서 프로젝트로 교체된다 —
// carrierId가 프로젝트 id면 그대로, 기회 id면 opportunity.project_id로 해석한다.
const PROJECT_STAGES: Record<string, (props: { projectId: string }) => React.ReactNode> = {
  S8: (p) => <BusinessCaseStage projectId={p.projectId} />,
  S9: (p) => <DdStage projectId={p.projectId} />,
  S10: (p) => <DealStructureStage projectId={p.projectId} />,
  S11: (p) => <IcReviewStage projectId={p.projectId} />,
  S12: (p) => <PortfolioStage projectId={p.projectId} />,
};

function ProjectStageTab({ carrierId, stageId }: { carrierId: string; stageId: string }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setProjectId(null);
    api
      .get<{ project_id: string | null }>(`/api/opportunities/${encodeURIComponent(carrierId)}`)
      .then((r) => {
        if (!alive) return;
        if (r.data.project_id) setProjectId(r.data.project_id);
        else setError("이 기회는 아직 프로젝트로 추진되지 않았습니다 — 승격(S5→S8 또는 S7→S8)이 먼저 필요합니다.");
      })
      .catch(() => {
        // 캐리어가 이미 프로젝트 id인 경우 — process 엔드포인트(GET 지원)로
        // 멤버십 포함 검증 후 그대로 사용한다.
        api.get(`/api/projects/${encodeURIComponent(carrierId)}/process`)
          .then(() => { if (alive) setProjectId(carrierId); })
          .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "캐리어를 확인하지 못했습니다."); });
      });
    return () => { alive = false; };
  }, [carrierId]);

  const StageComponent = PROJECT_STAGES[stageId];
  return (
    <main>
      <DealBreadcrumb dealId={carrierId} stageId={stageId as "S8"} />
      {error && <PageState state="empty" emptyText={error} />}
      {!error && !projectId && <PageState state="loading" />}
      {projectId && StageComponent ? StageComponent({ projectId }) : null}
    </main>
  );
}

// 미통합 단계의 범용 가이던스 탭 — 프로세스 상태·블로커 표시(작업 화면 링크는
// STAGE_LINK 제거 후 탭 자체가 단계 화면이므로 더 이상 제공하지 않는다).
// 자식 컴포넌트로 분리해 StageTab의 훅 순서가 단계와 무관하게 일정하다.
function StageGuidanceTab({ carrierId, stageId }: { carrierId: string; stageId: string }) {
  const [proc, setProc] = useState<ProcessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<ProcessView>(`/api/opportunities/${encodeURIComponent(carrierId)}/process`)
      .then((r) => { if (alive) setProc(r.data); })
      .catch(() => {
        api.get<ProcessView>(`/api/projects/${encodeURIComponent(carrierId)}/process`)
          .then((r) => { if (alive) setProc(r.data); })
          .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "프로세스를 불러오지 못했습니다."); });
      });
    return () => { alive = false; };
  }, [carrierId]);

  const stage = proc?.stages.find((s) => s.id === stageId);
  const applicable = stage && stage.status !== "skipped";

  return (
    <main>
      <DealBreadcrumb dealId={carrierId} stageId={stageId as "S1"} />
      <h1>{stageId} 단계</h1>
      <p className="objective">트랙에 따라 이 단계의 작업 화면으로 연결됩니다. (Wave 2 후속 단계에서 작업 화면이 이 탭 안으로 통합됩니다)</p>

      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      {!proc && !error && <PageState state="loading" />}

      {proc && !applicable && (
        <PageState state="empty" emptyText={`${stageId}는 이 검토/안건의 트랙(${trackLabel(proc.track)})에 적용되지 않는 단계입니다.`} />
      )}
      {proc && applicable && (
        <div className="market-section">
          <p className="text-[length:var(--fs-body)]">이 단계의 상태: <span className={`status-chip ${stage?.status === "complete" ? "status-green" : "status-amber"}`}>{labelText(STAGE_STATUS_LABEL, stage?.status)}</span></p>
          <ul className="sizing-note-list">
            {[...new Set([...proc.blockers, ...proc.requiredArtifacts])].map((b, i) => <li key={i}>{localizeRequirement(b)}</li>)}
          </ul>
        </div>
      )}
    </main>
  );
}

export default function StageTabPage() {
  return (
    <Suspense fallback={null}>
      <StageTab />
    </Suspense>
  );
}
