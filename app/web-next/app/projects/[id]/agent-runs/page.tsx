"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { ColGroup, PageState } from "../../../../components/ui.tsx";

// 실행 타임라인 6열 — 시각·단계·유형·상태는 좁게, 활동 id에 넉넉한 몫.
const AGENT_RUN_COL_PCT = [18, 12, 28, 12, 14, 16] as const;

// 에이전트 실행 이력 (ADR-0123 #1) — 어떤 에이전트가 언제 무엇을 실행/제안했는지
// 타임라인으로 추적한다. 읽기 전용 — 제안(PROPOSAL)과 사람 기록은 항상 구분된다.
interface Run {
  run_id: string; spec_version: string; stage: string; status: string; started_by: string;
  started_at: string; activity_id: string | null; activity_status: string | null; proposals: number;
}

function AgentRunsView() {
  const t = useTranslations("pages.projects.agentRuns");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ runs: Run[]; proposals: Array<{ id: string; gate: string; recommendation: string; started_at: string }>; reliability: Array<{ gate: string; total: number; accepted: number; agreement_pct: number }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ runs: Run[]; proposals: Array<{ id: string; gate: string; recommendation: string; started_at: string }>; reliability: Array<{ gate: string; total: number; accepted: number; agreement_pct: number }> }>(`/api/projects/${encodeURIComponent(id)}/agent-runs`)
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")}</h1>
      <p className="objective">{t("objective")}</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <section className="market-section" aria-label={t("timelineHeading")}>
        <h2 className=" mb-2">{t("timelineHeading")}</h2>
        {data === null ? <PageState state="loading" /> : data.runs.length === 0 ? (
          <PageState state="empty" emptyText={t("emptyRuns")} emptyAction={<Link href="/deals" className="text-[color:var(--accent)] underline not-italic">{t("startPipelineLink")}</Link>} />
        ) : (
          <div className="table-scroll" role="region" aria-label={tc("dataTableHorizontalScroll")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label={t("timelineHeading")}>
              <caption className="sr-only">{t("timelineCaption")}</caption>
              <ColGroup widths={AGENT_RUN_COL_PCT} />
              <thead><tr><th>{t("thTime")}</th><th>{tc("stage")}</th><th>{t("thActivity")}</th><th>{t("thType")}</th><th>{tc("status")}</th><th>{t("thActor")}</th></tr></thead>
              <tbody>{data.runs.map((r, i) => (
                <tr key={`${r.run_id}-${i}`}>
                  <td className="text-[length:var(--fs-caption)] tabular-nums">{r.started_at.slice(0, 16).replace("T", " ")}</td>
                  <td><span className="status-chip status-not-started">{r.stage}</span></td>
                  <td className="text-[length:var(--fs-caption)]">{r.activity_id ?? "—"}</td>
                  <td>{r.activity_id ? <span className="status-chip status-gray">{t("artifactChip")}</span> : <span className="chip gray">—</span>}</td>
                  <td>{r.activity_status ? <span className={`status-chip ${r.activity_status === "done" ? "status-green" : r.activity_status === "failed" ? "status-red" : "status-amber"}`}>{r.activity_status}</span> : "—"}</td>
                  <td className="text-[length:var(--fs-caption)]">{r.started_by}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className="market-section" aria-label={t("reliabilitySectionAria")}>
        <h2 className=" mb-2">{t("reliabilityHeading")} <span className="note">{t("reliabilityNote")}</span></h2>
        {data === null ? <PageState state="loading" /> : data.reliability.length === 0 ? (
          <PageState state="empty" emptyText={t("emptyReliability")} />
        ) : (
          <table className="data-table" aria-label={t("reliabilitySectionAria")}>
            <caption className="sr-only">{t("reliabilityCaption")}</caption>
            <thead><tr><th>{t("thGate")}</th><th className="col-num">{t("thProposals")}</th><th className="col-num">{t("thAccepted")}</th><th className="col-num">{t("thAgreement")}</th></tr></thead>
            <tbody>{data.reliability.map((r) => (
              <tr key={r.gate}>
                <td className="font-semibold">{r.gate}</td>
                <td className="col-num tabular-nums">{r.total}</td>
                <td className="col-num tabular-nums">{r.accepted}</td>
                <td className="col-num tabular-nums"><span className={`status-chip ${r.agreement_pct >= 70 ? "status-green" : "status-amber"}`}>{r.agreement_pct}%</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="note" style={{ marginBottom: 0 }}>{t("reliabilityFootnote")}</p>
      </section>
      <section className="market-section" aria-label={t("proposalsSectionAria")}>
        <h2 className=" mb-2">{t("proposalsHeading")}</h2>
        {data === null ? <PageState state="loading" /> : data.proposals.length === 0 ? (
          <PageState state="empty" emptyText={t("emptyProposals")} />
        ) : (
          <table className="data-table" aria-label={t("proposalsTableAria")}>
            <thead><tr><th>{t("thTime")}</th><th>{t("thGate")}</th><th>{t("thRecommendation")}</th></tr></thead>
            <tbody>{data.proposals.map((p) => (
              <tr key={p.id}>
                <td className="text-[length:var(--fs-caption)] tabular-nums">{p.started_at.slice(0, 16).replace("T", " ")}</td>
                <td>{p.gate}</td>
                <td><span className={`status-chip ${p.recommendation === "go" ? "status-green" : p.recommendation === "kill" ? "status-red" : "status-amber"}`}>{p.recommendation.toUpperCase()}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export default function AgentRunsPage() {
  return <Suspense fallback={null}><AgentRunsView /></Suspense>;
}
