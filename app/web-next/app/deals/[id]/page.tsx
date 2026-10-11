"use client";

// /deals/[id] — deal overview (ADR-0120; designs 2026-10-11-deal-overview-and-s3-deal-scope
// and 2026-10-11-deal-overview-ui-refinement). Identity, named stage stepper, current stage,
// the single next action, completion criteria, HOLD and key facts.
// The id resolves either carrier (opportunity or promoted project) via the process API;
// attractiveness/synergy come from the source opportunity.
// All new Korean copy here is INTERIM-WORDING (design O-1) pending product confirmation.
import { resolveDealCarrier } from "../../../lib/deal-carrier.ts";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Circle, AlertTriangle, ArrowRight, Flag, PauseCircle, XCircle, Clock } from "lucide-react";
import { api } from "../../../lib/api.ts";
import { PageState } from "../../../components/ui.tsx";
import { StageRail } from "../../../components/StageFrame.tsx";
import { STAGE_META, type StageMetaId } from "../../../lib/stage-meta.ts";
import {
  buildDealOverview,
  type DealOverview as Overview,
  type OverviewHold,
  type OverviewOpportunity,
  type OverviewProcess,
} from "../../../lib/deal-overview.ts";
import {
  documentTitle,
  factView,
  gateChipKind,
  holdAgeText,
  holdDatesFromHistory,
  nextActionCopy,
  railStatusFromStages,
  type FactView,
} from "../../../lib/deal-overview-view.ts";

interface StageLite { id: string; status: string; gateIds?: string[]; requiredArtifacts?: string[] }
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
  /** Opportunity carrier: linked project id. */
  projectId?: string | null;
  /** Project carrier: project header. */
  project?: { id: string; project_name: string | null } | null;
  opportunity?: { id: string } | null;
}

const EYEBROW = "현재 검토/안건 개요";
const OBJECTIVE = "현재 단계·다음 할 일·완료 조건·진행 상태를 한 장으로 봅니다.";
const SECTION = { stage: "현재 단계", next: "다음 할 일", done: "완료 조건", facts: "주요 사실", hold: "보류 중" } as const; // "보류 중": INTERIM-WORDING
const stageNameOf = (id: string): string | null => STAGE_META.find((s) => s.id === id)?.name ?? null;

type OppState = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: OverviewOpportunity };

function Value({ f }: { f: FactView }) {
  if (f.state === "pending") {
    return <span className="text-[color:var(--muted-fg)]"><Clock size={14} aria-hidden="true" className="inline mr-1" />{f.text}</span>;
  }
  if (f.state === "missing") {
    return <span className="text-[color:var(--amber-fg)]"><AlertTriangle size={14} aria-hidden="true" className="inline mr-1" />{f.text}</span>;
  }
  return <span className="font-semibold">{f.text}</span>;
}

function GateChip({ label, decision, decisionLabel }: { label: string; decision: string; decisionLabel: string }) {
  const kind = gateChipKind(decision);
  const Icon = kind === "go" ? CheckCircle2 : kind === "kill" ? XCircle : PauseCircle;
  return (
    <span className={`status-chip ${kind === "go" ? "status-green" : kind === "kill" ? "status-red" : "status-amber"}`}>
      <Icon size={14} aria-hidden="true" />{label} · {decisionLabel}
    </span>
  );
}

function HoldCard({ holds, suffix }: { holds: Overview["holds"]; suffix: string }) {
  const headId = `ov-hold-h-${suffix}`;
  return (
    <section id={`ov-hold-${suffix}`} className={`card deal-overview-card deal-overview-hold deal-overview-hold-${suffix}`} aria-labelledby={headId} tabIndex={-1}>
      <h2 id={headId} className="text-[length:var(--fs-body)] mb-2">{SECTION.hold}</h2>
      <ul className="list-none p-0 m-0 grid gap-2">
        {holds.map((h) => {
          const age = holdAgeText(h.ageDays);
          return (
            <li key={h.gate} className="flex flex-wrap items-center gap-2">
              <span className="status-chip status-amber"><PauseCircle size={14} aria-hidden="true" />HOLD</span>
              <span>{h.gateLabel}</span>
              {age && <span className="text-[color:var(--muted-fg)]">{age}</span>}
              <Link href={h.href} className="guide-link deal-overview-link">결정 화면 열기</Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="card deal-overview-card"><PageState state="loading" rows={rows} /></div>;
}

function DealOverview() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [proc, setProc] = useState<ProcessView | null>(null);
  const [oppId, setOppId] = useState<string | null>(null);
  const [opp, setOpp] = useState<OppState>({ status: "loading" });
  const [holdDates, setHoldDates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadOpp = useCallback((opportunityId: string | null, alive: () => boolean) => {
    if (!opportunityId) { setOpp({ status: "ok", data: { status: null, attractiveness_score: null, synergy_score: null } }); return; }
    setOpp({ status: "loading" });
    api.get<OverviewOpportunity>(`/api/opportunities/${encodeURIComponent(opportunityId)}`)
      .then((r) => { if (alive()) setOpp({ status: "ok", data: r.data }); })
      .catch((e) => { if (alive()) setOpp({ status: "error", message: e instanceof Error ? e.message : "기회 정보를 불러오지 못했습니다." }); });
  }, []);

  const loadAll = useCallback((alive: () => boolean) => {
    setError(null);
    setProc(null);
    setOpp({ status: "loading" });
    resolveDealCarrier<ProcessView>((u) => api.get(u), id)
      .then((c) => {
        if (!alive()) return;
        setProc(c.proc);
        setOppId(c.opportunityId);
        loadOpp(c.opportunityId, alive);
        // Hold age: latest "hold" decision timestamp per gate (best effort; null = age not shown).
        const holdGates = Object.entries(c.proc.gateStatus ?? {}).filter(([, d]) => d === "hold");
        if (holdGates.length > 0) {
          const url = c.proc.project ? `/api/projects/${encodeURIComponent(id)}/gate-decisions` : c.opportunityId ? `/api/opportunities/${encodeURIComponent(c.opportunityId)}/gate-decisions` : null;
          if (url) {
            api.get<{ history: Array<{ gate: string; decision: string; decided_at: string }> }>(url)
              .then((r) => { if (alive()) setHoldDates(holdDatesFromHistory(r.data?.history)); })
              .catch(() => { /* heldSince stays null */ });
          }
        }
      })
      .catch((e) => { if (alive()) setError(e instanceof Error ? e.message : "프로세스를 불러오지 못했습니다."); });
  }, [id, loadOpp]);

  useEffect(() => {
    let alive = true;
    loadAll(() => alive);
    return () => { alive = false; };
  }, [loadAll]);

  const retryAll = () => { loadAll(() => true); };
  const retryOpp = () => { loadOpp(oppId, () => true); };

  const oppData: OverviewOpportunity = opp.status === "ok" ? opp.data : { status: null, attractiveness_score: null, synergy_score: null };
  const ov = useMemo<Overview | null>(() => {
    if (!proc) return null;
    const holds: OverviewHold[] = Object.entries(proc.gateStatus ?? {})
      .filter(([, d]) => d === "hold")
      .map(([gate]) => ({ entityType: "opportunity" as const, entityId: id, gate, decidedAt: holdDates[gate] ?? null }));
    const overviewProc: OverviewProcess = {
      currentStage: proc.currentStage,
      nextStage: proc.nextStage,
      blockers: proc.blockers,
      requiredArtifacts: proc.requiredArtifacts,
      gateStatus: proc.gateStatus,
      track: proc.track,
      subTrack: proc.subTrack,
      terminated: proc.terminated,
      projectName: proc.project?.project_name ?? null,
      projectId: proc.projectId ?? null,
      stages: proc.stages.map((s) => ({ id: s.id, requiredArtifacts: s.requiredArtifacts })),
    };
    return buildDealOverview(id, oppData, overviewProc, holds);
  // oppData is derived from opp
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proc, opp, id, holdDates]);

  // The name is known once the process (project carrier) or the opportunity (opportunity carrier) resolved.
  const knownName = (proc?.project?.project_name?.trim() || (opp.status === "ok" ? opp.data.name?.trim() : "")) || null;
  const nameReady = !!proc && (!!proc.project?.project_name?.trim() || opp.status !== "loading");

  useEffect(() => {
    document.title = documentTitle(knownName, EYEBROW);
  }, [knownName]);

  const railStatus = useMemo(() => (proc ? railStatusFromStages(proc.stages) : undefined), [proc]);

  const focusHold = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = [...document.querySelectorAll<HTMLElement>(".deal-overview-hold")].find((n) => n.offsetParent !== null);
    el?.focus();
    el?.scrollIntoView({ block: "center" });
  };

  if (error) {
    return (
      <main aria-labelledby="deal-title">
        <p className="eyebrow">{EYEBROW}</p>
        <h1 id="deal-title">{EYEBROW}</h1>
        <PageState state="error" errorText={error} onRetry={retryAll} />
      </main>
    );
  }

  const stageChip = ov?.identity.stage ? `${ov.identity.stage.id} ${ov.identity.stage.name}` : null;
  const hasHold = !!ov && ov.holds.length > 0;
  const factsView = ov ? ov.facts.map((f) => factView(f, stageNameOf)) : [];

  return (
    <main aria-labelledby="deal-title">
      <header className="deal-overview-head" aria-busy={!ov || !nameReady}>
        <p className="eyebrow">{EYEBROW}</p>
        {ov && nameReady ? (
          <>
            <h1 id="deal-title">{knownName ?? EYEBROW}</h1>
            <div className="chip-row flex flex-wrap items-center gap-2">
              {ov.identity.terminated && <span className="status-chip status-red"><XCircle size={14} aria-hidden="true" />종료됨</span>}
              {ov.identity.statusLabel && <span className="status-chip">{ov.identity.statusLabel}</span>}
              {stageChip && <span className="status-chip"><Flag size={14} aria-hidden="true" />{stageChip}</span>}
              {hasHold && (
                <a href="#ov-hold-aside" onClick={focusHold} className="status-chip status-amber deal-overview-link">
                  <PauseCircle size={14} aria-hidden="true" />HOLD
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 id="deal-title" className="sr-only">{EYEBROW}</h1>
            <div className="skeleton" style={{ width: "40%" }} aria-hidden="true" />
            <div className="skeleton" style={{ width: "25%" }} aria-hidden="true" />
          </>
        )}
        <p className="objective">{OBJECTIVE}</p>
      </header>

      {proc && ov && railStatus && ov.currentStage ? (
        <StageRail current={[ov.currentStage.id as StageMetaId]} status={railStatus} sticky={false} />
      ) : !ov ? (
        <div className="card deal-overview-card" aria-busy="true"><div className="skeleton" style={{ width: "100%" }} /></div>
      ) : null}

      <div className="deal-overview-grid">
        <div className="deal-overview-main">
          {!ov ? (
            <>
              <CardSkeleton /><CardSkeleton /><CardSkeleton />
            </>
          ) : (
            <>
              <section className="card deal-overview-card" aria-labelledby="ov-stage">
                <h2 id="ov-stage" className="text-[length:var(--fs-body)] mb-2">{SECTION.stage}</h2>
                {ov.currentStage ? (
                  <>
                    <p className="m-0 deal-overview-stage-name font-semibold">{ov.currentStage.id} {ov.currentStage.name}</p>
                    <p className="m-0 text-[color:var(--muted-fg)]">{ov.currentStage.objective}</p>
                  </>
                ) : (
                  <p className="m-0 text-[color:var(--muted-fg)]">{ov.statusText ?? "진행할 단계가 없습니다"}</p>
                )}
                <dl className="deal-overview-flow m-0 mt-3">
                  <FlowRow label="받는 것" entry={ov.flow.previous} />
                  <FlowRow label="넘기는 것" entry={ov.flow.next} />
                </dl>
              </section>

              <section className="card deal-overview-card" aria-labelledby="ov-next">
                <h2 id="ov-next" className="text-[length:var(--fs-body)] mb-2">{SECTION.next}</h2>
                {ov.nextAction ? (
                  <NextActionBody ov={ov} />
                ) : (
                  <p className="m-0" role="status">{ov.statusText}</p>
                )}
              </section>

              {hasHold && <HoldCard holds={ov.holds} suffix="inline" />}

              <section className="card deal-overview-card" aria-labelledby="ov-done">
                <h2 id="ov-done" className="text-[length:var(--fs-body)] mb-2">{SECTION.done}</h2>
                {ov.completion.length === 0 ? (
                  <p className="m-0 text-[color:var(--muted-fg)]">이 단계에 필수 산출물이 없습니다.</p>
                ) : (
                  <>
                    <p className="m-0 mb-2 text-[color:var(--muted-fg)]">{ov.completionCounts.total}개 중 {ov.completionCounts.done}개 완료</p>
                    <ul className="list-none p-0 m-0 grid gap-2">
                      {ov.completion.map((c) => (
                        <li key={c.label} id={c.isNext ? "ov-next-criterion" : undefined} className="flex flex-wrap items-center gap-2">
                          {c.done
                            ? <CheckCircle2 size={16} aria-hidden="true" className="text-[color:var(--green-fg)]" />
                            : <Circle size={16} aria-hidden="true" className="text-[color:var(--muted-fg)]" />}
                          <span>{c.label}</span>
                          <span className={`status-chip ${c.done ? "status-green" : ""}`}>{c.done ? "완료" : "미완료"}</span>
                          {c.isNext && <span className="status-chip status-amber"><ArrowRight size={14} aria-hidden="true" />다음</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {ov.otherBlockers.length > 0 && (
                  <>
                    <h3 className="text-[length:var(--fs-caption)] mt-3 mb-1">그 밖의 막힘 사유</h3>
                    <ul className="list-none p-0 m-0 grid gap-1">
                      {ov.otherBlockers.map((b) => (
                        <li key={b}><AlertTriangle size={16} aria-hidden="true" className="inline mr-1 text-[color:var(--amber-fg)]" />{b}</li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <aside className="deal-overview-side" aria-labelledby="ov-facts">
          {!ov ? (
            <CardSkeleton />
          ) : (
            <>
              {hasHold && <HoldCard holds={ov.holds} suffix="aside" />}
              <section className="card deal-overview-card" aria-labelledby="ov-facts">
                <h2 id="ov-facts" className="text-[length:var(--fs-body)] mb-2">{SECTION.facts}</h2>
                {opp.status === "loading" ? (
                  <PageState state="loading" rows={3} />
                ) : opp.status === "error" ? (
                  <PageState state="error" errorText={opp.message} onRetry={retryOpp} />
                ) : (
                  <>
                    <dl className="deal-overview-facts m-0">
                      {factsView.map((f) => (
                        <div key={f.key} className="deal-overview-fact">
                          <dt className="text-[color:var(--muted-fg)]">{f.label}</dt>
                          <dd className="m-0">
                            <Value f={f} />
                            {f.note && <span className="text-[color:var(--muted-fg)]"> ({f.note})</span>}
                            {f.href && f.linkText && <> <Link href={f.href} className="guide-link deal-overview-link">{f.linkText}</Link></>}
                            {f.key === "project" && f.href && !f.linkText && <> <Link href={f.href} className="guide-link deal-overview-link">열기</Link></>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {ov.gates.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2" aria-label="게이트 결정">
                        {ov.gates.map((g) => <GateChip key={g.gate} label={g.gateLabel} decision={g.decision} decisionLabel={g.decisionLabel} />)}
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

function FlowRow({ label, entry }: { label: string; entry: Overview["flow"]["previous"] }) {
  const artifacts = entry?.artifacts ?? [];
  const name = entry ? <span className="font-semibold">{entry.id} {entry.name}</span> : <span className="text-[color:var(--muted-fg)]">없음</span>;
  return (
    <div className="deal-overview-flow-row">
      <dt className="text-[color:var(--muted-fg)]">{label}</dt>
      <dd className="m-0">
        {artifacts.length > 0 ? (
          // INTERIM-WORDING: "산출물 N건" — artifact names stay one tap away so the next action stays above the fold.
          <details className="deal-overview-flow-details">
            <summary>{name} <span className="text-[color:var(--muted-fg)]">산출물 {artifacts.length}건</span></summary>
            <ul className="m-0 mt-1 pl-4 text-[color:var(--muted-fg)]">
              {artifacts.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </details>
        ) : name}
      </dd>
    </div>
  );
}

function NextActionBody({ ov }: { ov: Overview }) {
  const a = ov.nextAction!;
  const copy = nextActionCopy(a);
  const describedBy = a.type === "record_artifact" ? "ov-next-criterion" : undefined;
  return (
    <>
      <p className="m-0 font-semibold">{copy.what}</p>
      {copy.why && <p className="m-0 mb-3 text-[color:var(--muted-fg)]">{copy.why}</p>}
      <Link className="btn-primary" href={a.href} aria-describedby={describedBy}>
        {copy.cta} <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </>
  );
}

export default function DealOverviewPage() {
  return (
    <Suspense fallback={null}>
      <DealOverview />
    </Suspense>
  );
}
