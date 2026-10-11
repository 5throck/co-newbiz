"use client";

// /deals/[id] — deal overview (ADR-0120; design 2026-10-11-deal-overview-and-s3-deal-scope).
// Current stage, the single next action, completion criteria and key facts.
// The id resolves either carrier (opportunity or promoted project) via the
// process API; attractiveness/synergy come from the source opportunity.
import { resolveDealCarrier } from "../../../lib/deal-carrier.ts";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Circle, AlertTriangle, MinusCircle, ArrowRight } from "lucide-react";
import { api } from "../../../lib/api.ts";
import { PageState } from "../../../components/ui.tsx";
import { displayOrNotRecorded } from "../../../lib/labels.ts";
import { STAGE_META } from "../../../lib/stage-meta.ts";
import { buildDealOverview, NEXT_ACTION_LABEL, type OverviewOpportunity } from "../../../lib/deal-overview.ts";

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
  opportunity?: { id: string } | null;
}

const FACT_LABEL = { attractiveness: "매력도", synergy: "시너지", track: "트랙" } as const;
const STAGE_STATE_TEXT: Record<string, string> = { complete: "완료", current: "진행 중", skipped: "건너뜀" };

function Value({ v }: { v: { text: string; empty: boolean } }) {
  return <span className={v.empty ? "text-[color:var(--muted-fg)]" : "font-semibold"}>{v.text}</span>;
}

function DealOverview() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [proc, setProc] = useState<ProcessView | null>(null);
  const [opp, setOpp] = useState<OverviewOpportunity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    resolveDealCarrier<ProcessView>((u) => api.get(u), id)
      .then((c) => {
        if (!alive) return;
        setProc(c.proc);
        if (c.opportunityId) {
          api.get<OverviewOpportunity>(`/api/opportunities/${encodeURIComponent(c.opportunityId)}`)
            .then((r) => { if (alive) setOpp(r.data); })
            .catch(() => { if (alive) setOpp({ status: null, attractiveness_score: null, synergy_score: null }); });
        } else setOpp({ status: null, attractiveness_score: null, synergy_score: null });
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "프로세스를 불러오지 못했습니다."); });
    return () => { alive = false; };
  }, [id]);

  const ov = useMemo(() => {
    if (!proc || !opp) return null;
    const holds = Object.entries(proc.gateStatus ?? {})
      .filter(([, d]) => d === "hold")
      .map(([gate]) => ({ entityType: "opportunity" as const, entityId: id, gate }));
    return buildDealOverview(id, opp, proc, holds);
  }, [proc, opp, id]);

  return (
    <main>
      <h1>현재 검토/안건 개요</h1>
      <p className="objective">현재 단계·다음 할 일·완료 조건·진행 상태를 한 장으로 봅니다.</p>

      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      {!ov && !error && <PageState state="loading" rows={4} />}

      {proc && ov && (
        <>
          <nav aria-label="프로세스 단계 진행" className="sizing-step-rail mb-4">
            <ol className="flex flex-wrap gap-1 list-none m-0 p-0">
              {proc.stages.map((s) => {
                const meta = STAGE_META.find((m) => m.id === s.id);
                const state = STAGE_STATE_TEXT[s.status];
                const isCurrent = s.status === "current";
                return (
                  <li key={s.id}
                    className={`sizing-step-link ${isCurrent ? "stage-rail-current" : ""} ${s.status === "skipped" ? "text-[color:var(--muted-fg)]" : ""}`}
                    aria-current={isCurrent ? "step" : undefined}>
                    <span className="sizing-step-num">{s.id.replace("S", "")}</span>
                    <span>{meta?.name ?? s.id}</span>
                    {state && <span className="text-[length:var(--fs-caption)]">
                      {s.status === "complete" ? <CheckCircle2 size={14} aria-hidden="true" /> : s.status === "skipped" ? <MinusCircle size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                      {" "}{state}
                    </span>}
                  </li>
                );
              })}
            </ol>
          </nav>

          {(ov.flow.previous || ov.flow.next) && (
            <div className="handoff">
              <b className="handoff-hl">입력 ←</b>
              <span>{ov.flow.previous ?? <span className="text-[color:var(--muted-fg)]">없음</span>}</span>
              <span className="handoff-out">
                <b className="handoff-hl">출력 →</b>
                <span>{ov.flow.next ?? <span className="text-[color:var(--muted-fg)]">없음</span>}</span>
              </span>
            </div>
          )}

          <section className="market-section" aria-labelledby="ov-stage">
            <h2 id="ov-stage" className="text-[length:var(--fs-body)] mb-2">현재 단계</h2>
            {ov.currentStage ? (
              <p className="m-0"><strong>{ov.currentStage.id} {ov.currentStage.name}</strong>
                <span className="text-[color:var(--muted-fg)]"> — {ov.currentStage.objective}</span></p>
            ) : (
              <p className="m-0"><Value v={displayOrNotRecorded(null)} /></p>
            )}
          </section>

          <section className="market-section" aria-labelledby="ov-next">
            <h2 id="ov-next" className="text-[length:var(--fs-body)] mb-2">다음 할 일</h2>
            {ov.nextAction ? (
              <Link className="btn-primary" href={ov.nextAction.href}>
                {NEXT_ACTION_LABEL} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            ) : (
              <p className="m-0" role="status">{ov.statusText}</p>
            )}
          </section>

          <section className="market-section" aria-labelledby="ov-done">
            <h2 id="ov-done" className="text-[length:var(--fs-body)] mb-2">완료 조건</h2>
            {ov.completion.length === 0 ? (
              <p className="m-0 text-[color:var(--muted-fg)]">이 단계에 필수 산출물이 없습니다.</p>
            ) : (
              <ul className="sizing-note-list list-none p-0">
                {ov.completion.map((c) => (
                  <li key={c.label}>
                    {c.done
                      ? <CheckCircle2 size={16} aria-hidden="true" className="inline mr-1 text-[color:var(--green-fg)]" />
                      : <Circle size={16} aria-hidden="true" className="inline mr-1 text-[color:var(--muted-fg)]" />}
                    {c.label} <span className="text-[color:var(--muted-fg)]">({c.done ? "완료" : "미완료"})</span>
                  </li>
                ))}
              </ul>
            )}
            {ov.otherBlockers.length > 0 && (
              <>
                <h3 className="text-[length:var(--fs-caption)] mt-3 mb-1">그 밖의 막힘 사유</h3>
                <ul className="sizing-note-list list-none p-0">
                  {ov.otherBlockers.map((b) => (
                    <li key={b}><AlertTriangle size={16} aria-hidden="true" className="inline mr-1 text-[color:var(--amber-fg)]" />{b}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="market-section" aria-labelledby="ov-facts">
            <h2 id="ov-facts" className="text-[length:var(--fs-body)] mb-2">주요 사실</h2>
            <dl className="m-0 grid gap-1" style={{ gridTemplateColumns: "max-content 1fr", columnGap: "1rem" }}>
              {ov.facts.map((f) => (
                <div key={f.key} className="contents">
                  <dt className="text-[color:var(--muted-fg)]">{FACT_LABEL[f.key]}</dt>
                  <dd className="m-0"><Value v={f.value} />{f.note && <span className="text-[color:var(--muted-fg)]"> ({f.note})</span>}</dd>
                </div>
              ))}
              <div className="contents">
                <dt className="text-[color:var(--muted-fg)]">게이트</dt>
                <dd className="m-0">
                  {ov.gates.length === 0 ? <Value v={displayOrNotRecorded(null)} /> : (
                    <span className="flex flex-wrap gap-1">
                      {ov.gates.map((g) => (
                        <span key={g.gate} className={`status-chip ${g.decision === "go" ? "status-green" : g.decision === "kill" ? "status-red" : "status-amber"}`}>
                          {g.gateLabel} · {g.decisionLabel}
                        </span>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            {ov.holds.length > 0 && (
              <ul className="sizing-note-list list-none p-0 mt-2">
                {ov.holds.map((h) => (
                  <li key={h.gate}>
                    <AlertTriangle size={16} aria-hidden="true" className="inline mr-1 text-[color:var(--amber-fg)]" />
                    {h.gateLabel} 게이트가 보류(HOLD) 상태입니다 —{" "}
                    <Link href={h.href} className="guide-link">결정 화면 열기</Link>
                  </li>
                ))}
              </ul>
            )}
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
