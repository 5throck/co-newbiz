"use client";

// Port of app/web/src/pages/ProjectDetail.tsx — react-router's useParams ->
// next/navigation's useParams (same hook name, same shape for a client
// component). Tabs remain client-side state (design's 3-depth nav max).
import { useEffect, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  api,
  ApiError,
  provenanceOf,
  type ProjectSummary,
  type ProvenanceMeta,
  type RagDimension,
  type ResolvedProcedure,
} from "../../../lib/api.ts";
import { RagSignalCard } from "../../../components/RagCard.tsx";
import { ProcedureViewer } from "../../../components/ProcedureViewer.tsx";
import { GlossaryTerm } from "../../../components/GlossaryTerm.tsx";
import { DataTab } from "../../../components/DataTab.tsx";
import { AssumptionsTab } from "../../../components/AssumptionsTab.tsx";
import { DdWorkspaceTab } from "../../../components/DdWorkspaceTab.tsx";
import { ActivityTab } from "../../../components/ActivityTab.tsx";
import { WorkflowTab } from "../../../components/WorkflowTab.tsx";
import { PermitsTab } from "../../../components/PermitsTab.tsx";
import { MaReviewTab } from "../../../components/MaReviewTab.tsx";
import { ModelTab } from "../../../components/ModelTab.tsx";
import { RoicTree } from "../../../components/RoicTree.tsx";
import { SimulationTab } from "../../../components/SimulationTab.tsx";
import { VersionCompareTab } from "../../../components/VersionCompareTab.tsx";
import { PmiEvidenceTab } from "../../../components/PmiEvidenceTab.tsx";
import { MarketChainTab, ChainSensitivityEditor } from "../../../components/MarketChainTab.tsx";
import { ProxyChainGrade } from "../../../components/ProxyChainGrade.tsx";
import { OverviewTab } from "../../../components/OverviewTab.tsx";
import { ReviewStatusTab } from "../../../components/ReviewStatusTab.tsx";

type Tab =
  | "overview"
  | "workflow"
  | "procedure"
  | "data"
  | "assumptions"
  | "model"
  | "simulation"
  | "compare"
  | "dd"
  | "permits"
  | "ma"
  | "market"
  | "pmi"
  | "review"
  | "activity"
  | "members";

interface ProjectMember {
  user_id: string;
  project_role: string;
  granted_by: string;
  granted_at: string;
  need_to_know_basis: string;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;
  const tabParam = searchParams.get("tab") as Tab | null;
  const validTabs: Tab[] = ["workflow", "overview", "procedure", "market", "data", "assumptions", "model", "simulation", "compare", "dd", "permits", "ma", "pmi", "review", "activity", "members"];
  const initialTab: Tab = tabParam && validTabs.includes(tabParam) ? tabParam : "workflow";
  const [tab, setTabState] = useState<Tab>(initialTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url.toString());
  };
  // value_impact 딥링크: 실사 탭의 가정 키 클릭 → 가정 탭에서 해당 키 조회.
  const [assumptionFocus, setAssumptionFocus] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [mnpiBanner, setMnpiBanner] = useState(false);
  const [dimensions, setDimensions] = useState<RagDimension[]>([]);
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [procedure, setProcedure] = useState<ResolvedProcedure | null>(null);
  const [procedureProvenance, setProcedureProvenance] = useState<ProvenanceMeta>({});
  const [procedureKey, setProcedureKey] = useState("brownfield-screening");
  const [ragProvenance, setRagProvenance] = useState<ProvenanceMeta>({});
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .get<ProjectSummary>(`/api/projects/${id}`)
      .then((res) => {
        setProject(res.data);
        setMnpiBanner(res.meta.mnpi_banner === true);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      });
    api
      .get<{ project_id: string; dimensions: RagDimension[] }>(`/api/projects/${id}/rag`)
      .then((res) => {
        setDimensions(res.data.dimensions);
        setRagProvenance(provenanceOf(res.meta));
      })
      .catch(() => setDimensions([]));
  }, [id]);

  useEffect(() => {
    if (tab === "members" && id && members === null) {
      api
        .get<ProjectMember[]>(`/api/projects/${id}/members`)
        .then((res) => setMembers(res.data))
        .catch(() => setMembers([]));
    }
  }, [tab, id, members]);

  async function resolveProcedure(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api.get<ResolvedProcedure>(`/api/procedures/resolve?procedure=${encodeURIComponent(procedureKey)}`);
      setProcedure(res.data);
      setProcedureProvenance(provenanceOf(res.meta));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "절차를 찾을 수 없습니다.");
      setProcedure(null);
    }
  }

  if (notFound) {
    return (
      <main>
        <p>프로젝트를 찾을 수 없습니다.</p>
      </main>
    );
  }

  return (
    <main className="project-detail-page">
      <div className="deal-header">
        <h1 className="mb-0">{project?.project_no ?? "..."}</h1>
        <select
          aria-label="화면 전환"
          value={tab}
          onChange={(e) => setTab(e.target.value as Tab)}
          className="deal-view-select"
        >
          <option value="workflow">워크플로우</option>
          <option value="overview">개요</option>
          <option value="market">시장·체인</option>
          <option value="data">데이터</option>
          <option value="assumptions">가정</option>
          <option value="model">모델</option>
          <option value="simulation">시뮬레이션</option>
          <option value="dd">실사</option>
          <option value="permits">법령·인허가</option>
          <option value="ma">M&A 검토</option>
          <option value="pmi">PMI·증거</option>
          <option value="review">검토 현황</option>
          <option value="activity">활동·보고서</option>
          <option value="members">멤버십</option>
        </select>
      </div>
      {mnpiBanner && (
        <div role="alert" className="mnpi-banner">
          ⚠ 본 프로젝트는 미공개중요정보(MNPI)로 분류되어 있습니다. 모든 열람은 감사 로그에 기록됩니다.
        </div>
      )}

      {tab === "workflow" && id && (
        <section aria-label="워크플로우">
          <WorkflowTab projectId={id} />
        </section>
      )}

      {tab === "overview" && (
        <section aria-label="개요">
          <OverviewTab
            projectId={id}
            dimensions={dimensions}
            ragProvenance={ragProvenance}
          />
          <p className="glossary-hint mt-4">
            용어 예: <GlossaryTerm term="WACC">WACC</GlossaryTerm>, <GlossaryTerm term="CGT">CGT</GlossaryTerm>
          </p>
        </section>
      )}

      {tab === "procedure" && (
        <section aria-label="절차 뷰어">
          <form onSubmit={resolveProcedure} className="procedure-form">
            <label htmlFor="procedureKey">절차 키</label>
            <input id="procedureKey" value={procedureKey} onChange={(e) => setProcedureKey(e.target.value)} />
            <button type="submit">조회</button>
          </form>
          {error && (
            <p role="alert" className="text-[color:var(--red-fg)]">
              {error}
            </p>
          )}
          {procedure && <ProcedureViewer procedure={procedure} provenance={procedureProvenance} />}
        </section>
      )}

      {tab === "data" && (
        <section aria-label="데이터">
          <DataTab />
        </section>
      )}

      {tab === "assumptions" && id && (
        <section aria-label="가정">
          <AssumptionsTab
            projectId={id}
            focusKey={assumptionFocus}
            onFocusClear={() => setAssumptionFocus(null)}
          />
        </section>
      )}

      {tab === "model" && id && (
        <section aria-label="모델">
          <ModelTab projectId={id} />
          <RoicTree projectId={id} />
        </section>
      )}

      {tab === "simulation" && id && (
        <section aria-label="시뮬레이션">
          <SimulationTab projectId={id} />
        </section>
      )}

      {tab === "compare" && id && (
        <section aria-label="버전 비교">
          <VersionCompareTab projectId={id} />
        </section>
      )}

      {tab === "dd" && id && (
        <section aria-label="실사">
          <DdWorkspaceTab
            projectId={id}
            onOpenAssumption={(key) => {
              setAssumptionFocus(key);
              setTab("assumptions");
            }}
          />
        </section>
      )}

      {tab === "permits" && id && (
        <section aria-label="법령·인허가">
          <PermitsTab projectId={id} />
        </section>
      )}

      {tab === "market" && id && (
        <section aria-label="시장·체인">
          <MarketChainTab projectId={id} />
          <ChainSensitivityEditor projectId={id} />
          <ProxyChainGrade projectId={id} />
        </section>
      )}

      {tab === "ma" && id && (
        <section aria-label="M&A 검토">
          <MaReviewTab projectId={id} />
        </section>
      )}

      {tab === "pmi" && id && (
        <section aria-label="PMI 및 증거 팩">
          <PmiEvidenceTab projectId={id} />
        </section>
      )}

      {tab === "review" && id && (
        <section aria-label="검토 현황">
          <ReviewStatusTab projectId={id} />
        </section>
      )}

      {tab === "activity" && id && (
        <section aria-label="활동 및 보고서">
          <ActivityTab projectId={id} />
        </section>
      )}

      {tab === "members" && (
        <section aria-label="멤버십">
          {members === null ? (
            <p>불러오는 중...</p>
          ) : (
            <table className="w-full border-collapse [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
              <caption className="sr-only">프로젝트 멤버 목록</caption>
              <thead>
                <tr>
                  <th scope="col">사용자</th>
                  <th scope="col">역할</th>
                  <th scope="col">부여자</th>
                  <th scope="col">부여일</th>
                  <th scope="col">Need-to-know 근거</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.user_id}</td>
                    <td>{m.project_role}</td>
                    <td>{m.granted_by}</td>
                    <td>{new Date(m.granted_at).toLocaleDateString("ko-KR")}</td>
                    <td>{m.need_to_know_basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
