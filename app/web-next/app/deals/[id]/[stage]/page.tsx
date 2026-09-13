"use client";

// /deals/[id]/s[stage] — stage tab (ADR-0120). Wave 1 skeleton: resolves the
// carrier (opportunity or project), renders StageFrame-grade guidance from the
// process API, and links to the stage's working surface. Wave 2+ migrates the
// full stage workloads into these tabs.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../../lib/api.ts";
import { PageState } from "../../../../components/ui.tsx";
import { StageFrame } from "../../../../components/StageFrame.tsx";
import { RouteDecisionStage } from "../../../../components/stages/RouteDecisionStage.tsx";

const STAGE_LINK: Record<string, (projectId?: string) => string | null> = {
  S1: () => "/market", S2: () => "/opportunities", S3: () => "/synergy", S4: () => "/route-decision",
  S5: () => "/greenfield", S6: () => "/brownfield", S7: () => "/brownfield",
  S8: (p) => (p ? `/projects/${p}/business-case` : null), S9: (p) => (p ? `/projects/${p}/dd` : null),
  S10: (p) => (p ? `/projects/${p}/deal-structure` : null), S11: (p) => (p ? `/projects/${p}/ic-review` : null),
  S12: (p) => (p ? `/projects/${p}/portfolio` : null),
};

interface ProcessView {
  currentStage: string | null; nextStage: string | null; track: string | null;
  blockers: string[]; requiredArtifacts: string[]; gateStatus: Record<string, string>;
  stages: Array<{ id: string; status: string }>;
}

function StageTab() {
  const params = useParams<{ id: string; stage: string }>();
  const searchParams = useSearchParams();
  const stageId = params.stage.toUpperCase().startsWith("S") ? params.stage.toUpperCase() : `S${params.stage}`;
  const [proc, setProc] = useState<ProcessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // S4 진출방식 결정 — Wave 2 마이그레이션 완료(목업 v5 baseline 구조).
  // 다른 단계는 여전히 아래 범용 가이던스 스텁으로 처리한다.
  if (stageId === "S4") {
    return (
      <main>
        <StageFrame stageId="S4">
          선별된 기회의 진출방식을 결정하는 분기점입니다.
          Greenfield(자체 역량 진출)는 S5 역량 평가로, Brownfield(기존 기업·자산 결합)는
          S6 대상 후보 발굴로 진행됩니다. Brownfield ≠ M&A — 라우트 유형을 함께 선택합니다.
        </StageFrame>
        <RouteDecisionStage opportunityId={params.id} rationaleParam={searchParams.get("rationale")} />
      </main>
    );
  }

  useEffect(() => {
    let alive = true;
    api.get<ProcessView>(`/api/opportunities/${encodeURIComponent(params.id)}/process`)
      .then((r) => { if (alive) setProc(r.data); })
      .catch(() => {
        api.get<ProcessView>(`/api/projects/${encodeURIComponent(params.id)}/process`)
          .then((r) => { if (alive) setProc(r.data); })
          .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "프로세스를 불러오지 못했습니다."); });
      });
    return () => { alive = false; };
  }, [params.id]);

  const stage = proc?.stages.find((s) => s.id === stageId);
  const applicable = stage && stage.status !== "skipped";
  const link = applicable ? STAGE_LINK[stageId]?.(proc ? undefined : undefined) : null;

  return (
    <main>
      <p className="crumb"><Link href={`/deals/${params.id}`} className="text-[color:var(--accent)] underline">검토/안건 개요</Link> / {stageId}</p>
      <h1>{stageId} 단계</h1>
      <p className="objective">트랙에 따라 이 단계의 작업 화면으로 연결됩니다. (Wave 2에서 작업 화면이 이 탭 안으로 통합됩니다)</p>

      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      {!proc && !error && <PageState state="loading" />}

      {proc && !applicable && (
        <PageState state="empty" emptyText={`${stageId}는 이 검토/안건의 트랙(${proc.track ?? "미결정"})에 적용되지 않는 단계입니다.`} />
      )}
      {proc && applicable && (
        <div className="market-section">
          <p className="text-[0.85rem]">이 단계의 상태: <span className={`status-chip ${stage?.status === "complete" ? "status-green" : "status-amber"}`}>{stage?.status}</span></p>
          <ul className="sizing-note-list">
            {[...new Set([...proc.blockers, ...proc.requiredArtifacts])].map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          <p className="mt-3">
            {link
              ? <Link className="btn-primary" href={link}>작업 화면으로 이동</Link>
              : <span className="note">작업 화면 링크는 상위 캐리어 확인 후 활성화됩니다.</span>}
          </p>
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
