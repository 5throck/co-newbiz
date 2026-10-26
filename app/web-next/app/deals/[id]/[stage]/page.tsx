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
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../../lib/api.ts";
import { localizeRequirement } from "../../../../lib/labels.ts";
import { STAGE_META } from "../../../../lib/stage-meta.ts";
import { STAGE_STATUS_KEY, trackKeysText, resolveLabelTokens } from "../../../../lib/label-keys.ts";
import { resolveDealCarrier } from "../../../../lib/deal-carrier.ts";
import type { TrackId } from "../../../../lib/stage-meta.ts";
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
import { LearningCorpusPanel } from "../../../../components/LearningCorpusPanel.tsx";

interface ProcessView {
  currentStage: string | null; nextStage: string | null; track: string | null;
  blockers: string[]; requiredArtifacts: string[]; gateStatus: Record<string, string>;
  stages: Array<{ id: string; status: string }>;
  /** Project carrier: source opportunity (resolveDealCarrier's CarrierProcess contract). */
  opportunity?: { id: string } | null;
}

// D-03/D-18: S5 is Green Field only, S6/S7 are Brown Field only. Opening the other track's stage
// shows a plain notice with a link to the stage that applies instead of the working screen.
// The track is the carrier's own track (resolved once by CarrierStageBody, T-20261022-018) —
// null keeps every stage applicable, same as an unresolvable track did before.
function TrackGate({ routeId, track, stageLabel, only, otherStage, children }: {
  routeId: string; track: TrackId | null; stageLabel: string; only: "greenfield" | "brownfield"; otherStage: "s5" | "s6"; children: React.ReactNode;
}) {
  const trRoot = useTranslations();
  const t = useTranslations("pages.dealStage");
  if (track && track !== only) {
    const thisName = track === "greenfield" ? "Green Field" : "Brown Field";
    return (
      <div className="card" role="note">
        <h2>{stageLabel}</h2>
        <p>
          {only === "brownfield" ? t("notApplicableGreenfield") : t("notApplicableBrownfield")}
          {" "}{t("trackIsSuffix", { p1: thisName })}
        </p>
        <p>
          <Link className="btn-primary" href={`/deals/${encodeURIComponent(routeId)}/${otherStage}`}>
            {t("goToTrackStage", { p1: STAGE_META.find((m) => m.id === (otherStage === "s5" ? "S5" : "S6"))?.name ?? "", p2: track === "greenfield" ? "Green Field" : "Brown Field" })}
          </Link>
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

// S2/S4/S5/S6/S7 body — the route id may be a promoted project id, so the carrier is
// resolved once the way the S3 body and the S8~S12 tab already do (lib/deal-carrier.ts):
// the stage screens receive the source opportunity id instead of the raw route id
// (T-20261022-010), and the track-fixed StageFrame/TrackGate get the carrier's track
// instead of a hardcoded one (T-20261022-018). A project without a source opportunity
// gets an empty state — the S1~S7 screens are opportunity-scoped by construction.
function CarrierStageBody({ routeId, children }: { routeId: string; children: (carrier: { opportunityId: string; track: TrackId | null }) => React.ReactNode }) {
  const trRoot = useTranslations();
  const t = useTranslations("pages.dealStage");
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; opportunityId: string; track: TrackId | null }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    resolveDealCarrier<ProcessView>((u) => api.get(u), routeId)
      .then((c) => {
        if (!alive) return;
        const t = c.proc.track;
        setState({
          status: "ready",
          opportunityId: c.opportunityId ?? "",
          track: t === "greenfield" || t === "brownfield" ? t : null,
        });
      })
      .catch((e) => { if (alive) setState({ status: "error", message: e instanceof Error ? e.message : t("dealLoadFailed") }); });
    return () => { alive = false; };
  }, [routeId]);

  if (state.status === "loading") return <PageState state="loading" />;
  if (state.status === "error") return <PageState state="error" errorText={state.message} onRetry={() => window.location.reload()} />;
  if (state.opportunityId === "") {
    return <PageState state="empty" emptyText={t("noOpportunityEmpty")} />;
  }
  return <>{children({ opportunityId: state.opportunityId, track: state.track })}</>;
}

function StageTab() {
  const trRoot = useTranslations();
  const t = useTranslations("pages.dealStage");
  const params = useParams<{ id: string; stage: string }>();
  const searchParams = useSearchParams();
  const stageId = params.stage.toUpperCase().startsWith("S") ? params.stage.toUpperCase() : `S${params.stage}`;

  // S1 시장분석 — Wave 2 Phase C 통합. StageFrame 배너(가치사슬 관계도 버튼 포함)는
  // MarketAnalysisStage가 직접 렌더링한다(?industry= 딥링크로 특정 산업 지정 가능).
  if (stageId === "S1") {
    return (
      <main>
        <MarketAnalysisStage embedded dealId={params.id} industryId={searchParams.get("industry") ?? undefined} />
        {/* ADR-0150 criterion 6 — kill learnings as S1 base-rate reference (display-only). */}
        <LearningCorpusPanel />
      </main>
    );
  }

  // S2 기회 발굴 — Wave 2 Phase A 통합. 캐리어 기회 행을 퍼널에 표시.
  if (stageId === "S2") {
    return (
      <main>
        <DealBreadcrumb dealId={params.id} stageId="S2" />
        <StageFrame stageId="S2">
          {t("s2Guidance")}
        </StageFrame>
        <CarrierStageBody routeId={params.id}>
          {({ opportunityId }) => <OpportunityFunnelStage opportunityId={opportunityId} />}
        </CarrierStageBody>
        {/* ADR-0150 criterion 6 — kill learnings as S2 base-rate reference (display-only). */}
        <LearningCorpusPanel />
      </main>
    );
  }

  // S4 진출방식 결정 — Wave 2 마이그레이션 완료(목업 v5 baseline 구조).
  if (stageId === "S4") {
    return (
      <main>
        <DealBreadcrumb dealId={params.id} stageId="S4" />
        <StageFrame stageId="S4">
          {t("s4Guidance")}
        </StageFrame>
        <DealEntryMarketStrip routeId={params.id} />
        <CarrierStageBody routeId={params.id}>
          {({ opportunityId }) => <RouteDecisionStage opportunityId={opportunityId} rationaleParam={searchParams.get("rationale")} tabParam={searchParams.get("tab")} />}
        </CarrierStageBody>
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
        <DealBreadcrumb dealId={params.id} stageId="S3" tail={companySurface ? [{ label: t("companySurfaceLabel") }] : []} />
        <div role="group" aria-label={t("s3SwitcherAria")} className="flex flex-wrap gap-1 mb-2">
          <Link
            href={`/deals/${params.id}/s3`}
            aria-current={!companySurface ? "page" : undefined}
            className={`control-chip ${!companySurface ? "status-green" : "status-not-started"}`}
          >
            {t("synergySurfaceLabel")}
          </Link>
          <Link
            href={`/deals/${params.id}/s3?surface=company`}
            aria-current={companySurface ? "page" : undefined}
            className={`control-chip ${companySurface ? "status-green" : "status-not-started"}`}
          >
            {t("companySurfaceLabel")}
          </Link>
        </div>
        {companySurface ? (
          <>
            <StageFrame stageId="S3" heading={t("s3CompanyHeading")}>
              {t("s3CompanyGuidance")}
            </StageFrame>
            <OurCompanyStage embedded />
          </>
        ) : (
          <>
            <StageFrame stageId="S3">
              {t("s3SynergyGuidance")}
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
        <CarrierStageBody routeId={params.id}>
          {({ opportunityId, track }) => (
            <>
              <StageFrame stageId="S5" track={track ?? undefined}>
                {t("s5Guidance")}
              </StageFrame>
              <DealEntryMarketStrip routeId={params.id} />
              <TrackGate routeId={params.id} track={track} stageLabel={t("s5StageLabel")} only="greenfield" otherStage="s6">
                <GreenfieldStage opportunityId={opportunityId} />
              </TrackGate>
            </>
          )}
        </CarrierStageBody>
      </main>
    );
  }

  // S6/S7 대상발굴·선정 — Wave 2 Phase B 통합. Brownfield 트랙 캐리어의
  // 목표 시장 → 후보 전체 목록 → 사전 검토 → 최종 후보 목록 → 게이트·승격 화면.
  if (stageId === "S6" || stageId === "S7") {
    return (
      <main>
        <DealBreadcrumb dealId={params.id} stageId={stageId as "S6" | "S7"} />
        <CarrierStageBody routeId={params.id}>
          {({ opportunityId, track }) => (
            <>
              <StageFrame stageId={["S6", "S7"]} track={track ?? undefined} heading={t("s67Heading")}>
                {t("s67GuidancePre")}<code>{t("s67GuidanceCode")}</code>{t("s67GuidancePost")}
              </StageFrame>
              <DealEntryMarketStrip routeId={params.id} />
              <TrackGate routeId={params.id} track={track} stageLabel={t("s67StageLabel", { p1: stageId })} only="brownfield" otherStage="s5">
                <BrownfieldStage opportunityId={opportunityId} />
              </TrackGate>
            </>
          )}
        </CarrierStageBody>
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
  const trRoot = useTranslations();
  const t = useTranslations("pages.dealStage");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 미승격 빈 상태의 유도 링크 (F3) — 트랙 최종 단계(greenfield S5 / brownfield
  // S7)의 승격 화면으로 보낸다. 트랙을 못 받으면 기회 개요로 폴백한다.
  const [promoHref, setPromoHref] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setProjectId(null);
    setPromoHref(null);
    api
      .get<{ project_id: string | null }>(`/api/opportunities/${encodeURIComponent(carrierId)}`)
      .then((r) => {
        if (!alive) return;
        if (r.data.project_id) setProjectId(r.data.project_id);
        else {
          setError(t("notPromoted"));
          // 캐리어 트랙으로 승격 링크의 착지 단계를 정한다 — resolveDealCarrier가
          // 이 파일의 다른 바디에서 쓰는 것과 동일한 process 뷰의 track 필드.
          api.get<{ track: string | null }>(`/api/opportunities/${encodeURIComponent(carrierId)}/process`)
            .then((p) => {
              if (!alive) return;
              setPromoHref(
                p.data.track === "greenfield" ? `/deals/${encodeURIComponent(carrierId)}/s5`
                  : p.data.track === "brownfield" ? `/deals/${encodeURIComponent(carrierId)}/s7`
                    : `/opportunities/${encodeURIComponent(carrierId)}`,
              );
            })
            .catch(() => { if (alive) setPromoHref(`/opportunities/${encodeURIComponent(carrierId)}`); });
        }
      })
      .catch(() => {
        // 캐리어가 이미 프로젝트 id인 경우 — process 엔드포인트(GET 지원)로
        // 멤버십 포함 검증 후 그대로 사용한다.
        api.get(`/api/projects/${encodeURIComponent(carrierId)}/process`)
          .then(() => { if (alive) setProjectId(carrierId); })
          .catch((e) => { if (alive) setError(e instanceof Error ? e.message : t("carrierCheckFailed")); });
      });
    return () => { alive = false; };
  }, [carrierId]);

  const StageComponent = PROJECT_STAGES[stageId];
  return (
    <main>
      <DealBreadcrumb dealId={carrierId} stageId={stageId as "S8"} />
      {error && (
        <PageState
          state="empty"
          emptyText={error}
          emptyAction={promoHref && (
            <Link className="btn-ghost btn-sm" href={promoHref}>{t("goToPromotion")}</Link>
          )}
        />
      )}
      {!error && !projectId && <PageState state="loading" />}
      {projectId && StageComponent ? StageComponent({ projectId }) : null}
    </main>
  );
}

// 미통합 단계의 범용 가이던스 탭 — 프로세스 상태·블로커 표시(작업 화면 링크는
// STAGE_LINK 제거 후 탭 자체가 단계 화면이므로 더 이상 제공하지 않는다).
// 자식 컴포넌트로 분리해 StageTab의 훅 순서가 단계와 무관하게 일정하다.
function StageGuidanceTab({ carrierId, stageId }: { carrierId: string; stageId: string }) {
  const trRoot = useTranslations();
  const t = useTranslations("pages.dealStage");
  const [proc, setProc] = useState<ProcessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<ProcessView>(`/api/opportunities/${encodeURIComponent(carrierId)}/process`)
      .then((r) => { if (alive) setProc(r.data); })
      .catch(() => {
        api.get<ProcessView>(`/api/projects/${encodeURIComponent(carrierId)}/process`)
          .then((r) => { if (alive) setProc(r.data); })
          .catch((e) => { if (alive) setError(e instanceof Error ? e.message : t("processLoadFailed")); });
      });
    return () => { alive = false; };
  }, [carrierId]);

  const stage = proc?.stages.find((s) => s.id === stageId);
  const applicable = stage && stage.status !== "skipped";

  return (
    <main>
      <DealBreadcrumb dealId={carrierId} stageId={stageId as "S1"} />
      <h1>{t("stageHeading", { p1: stageId })}</h1>
      <p className="objective">{t("guidanceIntro")}</p>

      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      {!proc && !error && <PageState state="loading" />}

      {proc && !applicable && (
        <PageState state="empty" emptyText={t("notApplicableForTrack", { p1: stageId, p2: resolveLabelTokens(trackKeysText(proc.track), trRoot) })} />
      )}
      {proc && applicable && (
        <div className="market-section">
          <p className="text-[length:var(--fs-body)]">{t("statusPrefix")} <span className={`status-chip ${stage?.status === "complete" ? "status-green" : "status-amber"}`}>{trRoot(STAGE_STATUS_KEY[stage?.status ?? ""] ?? stage?.status ?? "")}</span></p>
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
