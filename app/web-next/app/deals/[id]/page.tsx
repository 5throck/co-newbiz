"use client";

// /deals/[id] — deal overview (ADR-0120): current stage, the next thing,
// completion checklist and gate status from the process API. The id resolves
// either carrier (opportunity or promoted project) via the process API.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api.ts";
import { PageState } from "../../../components/ui.tsx";

interface StageLite { id: string; status: string; gateIds?: string[] }
interface ProcessView {
  currentStage: string | null;
  nextStage: string | null;
  blockers: string[];
  requiredArtifacts: string[];
  gateStatus: Record<string, string>;
  track: string | null;
  subTrack: string | null;
  terminated: boolean;
  stages: StageLite[];
}

function DealOverview() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [proc, setProc] = useState<ProcessView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<ProcessView>(`/api/opportunities/${encodeURIComponent(id)}/process`)
      .then((r) => { if (alive) setProc(r.data); })
      .catch(() => {
        api.get<ProcessView>(`/api/projects/${encodeURIComponent(id)}/process`)
          .then((r) => { if (alive) setProc(r.data); })
          .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "프로세스를 불러오지 못했습니다."); });
      });
    return () => { alive = false; };
  }, [id]);

  const current = proc?.stages.find((s) => s.status === "current");
  // 현재 단계 링크는 항상 이 캐리어의 단계 탭(deal-carrier form)으로 보낸다.
  const routeFor = current ? `/deals/${id}/${current.id.toLowerCase()}` : null;

  return (
    <main>
      <p className="crumb">검토/안건 보드</p>
      <h1>검토/안건 개요</h1>
      <p className="objective">현재 단계·다음 할 일·완료 조건·진행 상태를 한 장으로 봅니다.</p>

      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      {!proc && !error && <PageState state="loading" rows={4} />}

      {proc && (
        <>
          <nav aria-label="프로세스 단계 진행" className="sizing-step-rail mb-4">
            {proc.stages.map((s) => (
              <span key={s.id}
                className={`sizing-step-link ${s.status === "current" ? "stage-rail-current" : ""} ${s.status === "skipped" ? "stage-rail-skipped" : ""}`}
                style={s.status === "skipped" ? { opacity: 0.4, textDecoration: "line-through" } : undefined}
                title={s.id}>
                <span className="sizing-step-num">{s.id.replace("S", "")}</span>
                {s.status === "complete" ? " ✓" : s.status === "current" ? " ●" : ""}
              </span>
            ))}
          </nav>

          <div className="handoff" style={{ background: "var(--primary-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", marginBottom: 14, fontSize: "0.78rem" }}>
            <b className="text-[color:var(--muted-fg)]">입력 ←</b>
            <span className="text-[0.75rem]">상위 단계 산출물이 이 단계의 입력입니다.</span>
            <span className="text-[0.75rem]" style={{ flex: 1, textAlign: "right" }}>
              출력 → <b>{proc.nextStage ?? "종료"}</b>
            </span>
          </div>

          <section className="market-section" aria-label="지금 할 일">
            <h2 className="text-[0.9rem] mb-2">
              지금 할 일
              {routeFor && <Link className="btn-primary btn-sm" href={routeFor} style={{ textDecoration: "none", display: "inline-block", marginLeft: "0.6rem" }}>단계 화면으로 이동</Link>}
            </h2>
            {proc.blockers.length === 0 && !current ? (
              <p className="text-[0.85rem]">모든 단계가 완료되었습니다{proc.terminated ? " (KILL 기록됨)" : ""}.</p>
            ) : (
              <ul className="sizing-note-list">
                {[...new Set([...proc.blockers, ...proc.requiredArtifacts])].map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
            <p className="note" style={{ marginTop: 8 }}>
              트랙: {proc.track ?? "미결정"}{proc.subTrack ? ` · ${proc.subTrack}` : ""} · 진행:{" "}
              {Object.entries(proc.gateStatus).map(([g, v]) => (
                <span key={g} className={`status-chip ${v === "go" ? "status-green" : v === "kill" ? "status-red" : "status-amber"}`} style={{ marginRight: 4 }}>
                  {g} {v.toUpperCase()}
                </span>
              ))}
            </p>
          </section>
        </>
      )}
    </main>
  );
}

export default function DealOverviewPage() {
  return (
    <Suspense fallback={null}>
      <DealOverview />
    </Suspense>
  );
}
