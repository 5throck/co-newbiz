"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectSubNav } from "../../../../components/ProjectSubNav.tsx";
import { api } from "../../../../lib/api.ts";
import { PageState } from "../../../../components/ui.tsx";

// 프로세스 타임라인·SLA (ADR-0122 #1) — 단계별 마일스톤 산출일과 SLA 정책
// 목표를 대비해 경과·위반을 표시한다. 경과는 계산값(저장 안 함), SLA는 운영
// 정책 테이블(stage_sla)에서 온다.
interface StageRow { stage_id: string; milestone_at: string | null; elapsed_days: number | null; sla_target_days: number | null; sla_breach: boolean | null; sla_set: boolean; in_progress: boolean }

function TimelineView() {
  const { id } = useParams<{ id: string }>();
  const [stages, setStages] = useState<StageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ stages: StageRow[] }>(`/api/projects/${encodeURIComponent(id)}/timeline`)
      .then((r) => setStages(r.data.stages))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [id]);

  const maxElapsed = Math.max(1, ...(stages ?? []).map((s) => s.elapsed_days ?? 0));

  return (
    <main>
      <ProjectSubNav projectId={id} />
      <h1>프로세스 타임라인·SLA</h1>
      <p className="objective">단계별 목표 리드타임(SLA 정책) 대비 실제 경과를 추적하고 병목을 찾아냅니다 — 경과는 계산값이며 저장되지 않습니다 (ADR-0122).</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <section className="market-section" aria-label="타임라인">
        {stages === null ? <PageState state="loading" /> : (
          <table className="data-table" aria-label="단계 타임라인">
            <caption className="sr-only">단계 타임라인 — SLA 대비</caption>
            <thead><tr><th>단계</th><th>SLA 목표</th><th style={{ width: "38%" }}>경과</th><th className="col-num">경과/목표</th><th>상태</th></tr></thead>
            <tbody>{stages.map((s) => (
              <tr key={s.stage_id} className={s.sla_breach ? "row-selected" : undefined}>
                <td className="font-semibold">{s.stage_id}</td>
                <td className="tabular-nums">{s.sla_set ? `${s.sla_target_days}일` : <span className="note">정책 미설정</span>}</td>
                <td>
                  <div style={{ position: "relative", height: 12, background: "var(--bg)", borderRadius: 6 }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                      width: `${Math.min(100, ((s.elapsed_days ?? 0) / maxElapsed) * 100)}%`,
                      background: s.sla_breach ? "var(--red)" : s.in_progress ? "var(--accent)" : "var(--green)",
                      opacity: 0.75, borderRadius: 6 }} />
                  </div>
                </td>
                <td className="col-num tabular-nums">{s.elapsed_days != null ? `${s.elapsed_days}일${s.sla_set ? ` / ${s.sla_target_days}일` : ""}` : "—"}</td>
                <td>{s.sla_breach ? <span className="status-chip status-red">SLA 초과</span>
                  : s.in_progress ? <span className="status-chip status-amber">진행 중</span>
                  : s.elapsed_days != null ? <span className="status-chip status-green">완료</span>
                  : <span className="chip gray">대기</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
          마일스톤은 각 단계 대표 산출물의 최초/최종 산출 시각에서 계산됩니다. SLA 초과 단계는 <a href="#" className="text-[color:var(--accent)] underline">리스크 히트맵</a>·감시 규칙과 연동됩니다.
        </p>
      </section>
    </main>
  );
}

export default function TimelinePage() {
  return <Suspense fallback={null}><TimelineView /></Suspense>;
}
