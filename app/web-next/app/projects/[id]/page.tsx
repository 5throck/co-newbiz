"use client";

// Port of app/web/src/pages/ProjectDetail.tsx — react-router's useParams ->
// next/navigation's useParams (same hook name, same shape for a client
// component). Tabs remain client-side state (design's 3-depth nav max).
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
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
import { DdTab } from "../../../components/DdTab.tsx";
import { PermitsTab } from "../../../components/PermitsTab.tsx";
import { MaReviewTab } from "../../../components/MaReviewTab.tsx";
import { ModelTab } from "../../../components/ModelTab.tsx";
import { SimulationTab } from "../../../components/SimulationTab.tsx";
import { VersionCompareTab } from "../../../components/VersionCompareTab.tsx";
import { PmiEvidenceTab } from "../../../components/PmiEvidenceTab.tsx";
import { MarketChainTab, ChainSensitivityEditor } from "../../../components/MarketChainTab.tsx";

type Tab =
  | "overview"
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
  const id = params.id;
  const [tab, setTab] = useState<Tab>("overview");
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
      <h1>{project?.project_no ?? "..."}</h1>
      {mnpiBanner && (
        <div role="alert" className="mnpi-banner">
          ⚠ 본 프로젝트는 미공개중요정보(MNPI)로 분류되어 있습니다. 모든 열람은 감사 로그에 기록됩니다.
        </div>
      )}
      <nav
        className="flex flex-wrap gap-2 border-b border-[color:var(--border)] my-4 [&>button]:border-0 [&>button]:border-b-2 [&>button]:border-b-transparent [&>button]:rounded-none [&>button]:bg-transparent [&>button[aria-current=true]]:border-b-[color:var(--accent)] [&>button[aria-current=true]]:font-bold"
        aria-label="프로젝트 탭"
      >
        <button type="button" aria-current={tab === "overview"} onClick={() => setTab("overview")}>
          개요
        </button>
        <button type="button" aria-current={tab === "procedure"} onClick={() => setTab("procedure")}>
          절차 뷰어
        </button>
        <button type="button" aria-current={tab === "market"} onClick={() => setTab("market")}>시장·체인</button>
      <button type="button" aria-current={tab === "data"} onClick={() => setTab("data")}>
          데이터
        </button>
        <button type="button" aria-current={tab === "assumptions"} onClick={() => setTab("assumptions")}>
          가정
        </button>
        <button type="button" aria-current={tab === "model"} onClick={() => setTab("model")}>
          모델
        </button>
        <button type="button" aria-current={tab === "simulation"} onClick={() => setTab("simulation")}>
          시뮬레이션
        </button>
        <button type="button" aria-current={tab === "compare"} onClick={() => setTab("compare")}>
          버전 비교
        </button>
        <button type="button" aria-current={tab === "dd"} onClick={() => setTab("dd")}>
          실사
        </button>
        <button type="button" aria-current={tab === "permits"} onClick={() => setTab("permits")}>
          법령·인허가
        </button>
        <button type="button" aria-current={tab === "ma"} onClick={() => setTab("ma")}>
          M&A 검토
        </button>
        <button type="button" aria-current={tab === "pmi"} onClick={() => setTab("pmi")}>PMI·증거</button>
      <button type="button" aria-current={tab === "members"} onClick={() => setTab("members")}>
          멤버십
        </button>
      </nav>

      {tab === "overview" && (
        <section aria-label="개요">
          <RagSignalCard dimensions={dimensions} provenance={ragProvenance} />
          <p className="glossary-hint">
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
          <AssumptionsTab projectId={id} />
        </section>
      )}

      {tab === "model" && id && (
        <section aria-label="모델">
          <ModelTab projectId={id} />
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
          <DdTab projectId={id} />
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
