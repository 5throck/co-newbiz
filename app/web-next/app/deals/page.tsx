"use client";

// /deals — the deal board (ADR-0120): every deal as one funnel — opportunities
// (S1–S7) and projects (S8–S12), gate aging, and paused-pipeline widgets.
// Read-only overview; decisions stay on their stage surfaces (boundary #2).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api.ts";
import { PageState, PrimaryAction } from "../../components/ui.tsx";
import { STAGE_TAB_GROUPS } from "../../lib/stage-tabs.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { GATE_LABEL, type GateMetaId } from "../../lib/stage-meta.ts";

interface PipelineProject {
  projectId: string;
  projectNo: string;
  projectName: string | null;
  track: string | null;
  currentStage: string | null;
  nextStage: string | null;
  gates: Record<string, string>;
  blockers: string[];
}
interface AgingRow {
  entityType: "opportunity" | "project";
  entityId: string;
  label: string;
  gate: string;
  decision: string;
  decidedAt: string;
  ageDays: number;
}
interface PipelineView {
  projects: PipelineProject[];
  currentHolds: AgingRow[];
}
interface OpportunityRow {
  id: string;
  name: string;
  market_scope: string | null;
  attractiveness_score: number | null;
  synergy_score: number | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  project_id: string | null;
}

type Track = "greenfield" | "brownfield";
// Shared label convention with /projects (TRACK_LABEL there).
const TRACK_LABEL: Record<Track, string> = { greenfield: "그린필드", brownfield: "브라운필드" };

type CardTone = "gray" | "amber" | "green";
type Card = {
  kind: "opportunity" | "project";
  id: string;
  name: string;
  queryText: string;
  stage: string;
  stageLabel: string;
  tone: CardTone;
  hold: boolean;
  track: Track | null;
  meta: string;
  href: string;
};
type PausedInfo = { reason: string; link: string | null };

type FilterKey = "all" | "greenfield" | "brownfield" | "gate" | "paused";
const FILTERS: Array<[FilterKey, string]> = [
  ["all", "전체"],
  ["greenfield", "그린필드"],
  ["brownfield", "브라운필드"],
  ["gate", "HOLD"],
  ["paused", "일시정지"],
];

function DealsBoard() {
  const [data, setData] = useState<PipelineView | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [paused, setPaused] = useState<Record<string, PausedInfo>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get<PipelineView>("/api/portfolio/pipeline").then((r) => setData(r.data)).catch((e) => setError(e instanceof Error ? e.message : "검토/안건 보드를 불러오지 못했습니다."));
    api.get<OpportunityRow[]>("/api/opportunities").then((r) => setOpps(r.data)).catch(() => setOpps([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Paused-pipeline banners (ADR-0102 deep links): fetched only for board-size
  // N once the list arrives. Keyed by the run's current carrier (entity_id) so
  // a project-segment pause lights up the project card, not the source opp.
  useEffect(() => {
    if (!opps) return;
    const targets = opps.filter((o) => o.status !== "dropped");
    for (const o of targets) {
      api.get<{ status: string; entity_id: string; paused_reason: string | null; deep_link: string | null }>(`/api/opportunities/${encodeURIComponent(o.id)}/pipeline/status`)
        .then((r) => {
          // status "none" = 아직 파이프라인 실행 없음(정상 상태) — 배너 없이 무시
          if (r.data.status === "none") return;
          if (r.data.status === "paused_for_human" && r.data.paused_reason) {
            setPaused((prev) => ({ ...prev, [r.data.entity_id]: { reason: r.data.paused_reason as string, link: r.data.deep_link } }));
          }
        })
        .catch(() => undefined);
    }
  }, [opps]);

  const stageOf = (o: OpportunityRow): string => {
    if (o.status === "identified") return "S2";
    if (o.status === "assessed") return "S3";
    if (o.status === "selected") return "S4";
    return "—";
  };
  const stageNum = (s: string) => (s.startsWith("S") ? Number(s.slice(1)) : 99);

  // 검토/안건(기회) 단위 HOLD — /deals의 "HOLD" 필터와 같은 출처
  // (currentHolds, 나이 무관). 카드 자체의 HOLD 표시에도 그대로 쓴다. 단순히
  // 다음 단계를 기다리는 "대기" 상태(예: "S4 대기")와는 다른 개념이다 —
  // 필터 이름을 "진행 대기"로 두면 이 둘이 혼동된다(2026-09-15 사용자 리포트).
  const opportunityHolds = useMemo(
    () => new Set((data?.currentHolds ?? []).filter((r) => r.decision === "hold" && r.entityType === "opportunity").map((r) => r.entityId)),
    [data],
  );

  const cards: Card[] = useMemo(() => {
    // 승격(project_id)됐지만 그 프로젝트가 실제로 보이는(열려있고 삭제 안 된)
    // 경우에만 기회 카드를 뺀다 — 프로젝트가 나중에 삭제돼 project_id가
    // 허상으로 남은 기회는 계속 기회 카드로 보여야, 카드가 통째로 사라지지
    // 않는다.
    const visibleProjectIds = new Set((data?.projects ?? []).map((p) => p.projectId));
    // 기회는 S4(진출방식 결정)에서 트랙이 정해지므로 S1~S4 기회 카드는 항상
    // 트랙 미결정 — 그린필드/브라운필드 필터는 프로젝트(S8+)에만 걸린다.
    const oppCards: Card[] = (opps ?? [])
      .filter((o) => o.status !== "dropped")
      .filter((o) => !(o.project_id && visibleProjectIds.has(o.project_id)))
      .map((o): Card => {
        const stage = stageOf(o);
        const hold = opportunityHolds.has(o.id);
        return {
          kind: "opportunity", id: o.id, name: o.name, queryText: o.name, stage,
          // "대기"(자연스러운 다음 단계 대기)와 "HOLD"(게이트에서 명시적으로
          // 내린 보류 결정)는 서로 다른 개념이다 — 둘 다 amber로 칠하면
          // 구분이 안 된다(2026-09-15 사용자 리포트). HOLD만 amber, 단순
          // 대기는 gray.
          stageLabel: hold ? `${stage} HOLD` : o.status === "selected" ? "S4 대기" : stage,
          tone: hold ? "amber" : "gray",
          hold, track: null,
          meta: `매력도 ${o.attractiveness_score ?? "—"} · 시너지 ${o.synergy_score ?? "—"}`,
          href: `/opportunities?opportunity=${o.id}`,
        };
      });
    const projectCards: Card[] = (data?.projects ?? []).map((p): Card => {
      const stage = p.currentStage ?? "S8";
      const hold = Object.values(p.gates).some((v) => v === "hold");
      const track: Track | null = p.track === "greenfield" || p.track === "brownfield" ? p.track : null;
      return {
        kind: "project", id: p.projectId, name: p.projectName ?? p.projectNo, queryText: `${p.projectName ?? ""} ${p.projectNo}`, stage,
        stageLabel: hold ? `${stage} HOLD` : stage,
        tone: hold ? "amber" : stage === "S12" ? "green" : "gray",
        hold, track,
        meta: p.projectNo,
        href: projectStageHref(p.projectId, stage),
      };
    });
    return [...oppCards, ...projectCards];
  }, [opps, data, opportunityHolds]);

  const pausedIds = useMemo(() => new Set(Object.keys(paused)), [paused]);

  const matches = useCallback(
    (c: Card, f: FilterKey) =>
      f === "all" ? true
        : f === "greenfield" ? c.track === "greenfield"
        : f === "brownfield" ? c.track === "brownfield"
        : f === "gate" ? c.hold
        : pausedIds.has(c.id),
    [pausedIds],
  );

  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const [k] of FILTERS) out[k] = cards.filter((c) => matches(c, k)).length;
    return out;
  }, [cards, matches]);

  const visible = cards
    .filter((c) => matches(c, filter))
    .filter((c) => !query || c.queryText.toLowerCase().includes(query.toLowerCase()));

  const columns = [
    { title: "발굴·평가 (S1~S3)", test: (n: number) => n <= 3 },
    { title: "전략 결정 (S4~S7)", test: (n: number) => n >= 4 && n <= 7 },
    { title: "사업성·실사 (S8~S10)", test: (n: number) => n >= 8 && n <= 10 },
    { title: "심의·사후 (S11~S12)", test: (n: number) => n >= 11 },
  ];

  const stageTone: Record<CardTone, string> = { gray: "status-not-started", amber: "status-amber", green: "status-green" };

  return (
    <main>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 8 }}>
        <h1>검토/안건 보드</h1>
        <span className="ml-auto">
          <PrimaryAction inline href="/market" label="＋ 새 검토 시작 (시장분석부터)" />
        </span>
      </div>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        모든 검토/안건을 퍼널 한 장으로 봅니다 — 기회(S1~S7)와 프로젝트(S8~S12), 진행 에이징까지.
      </p>

      <SectionToolbar
        filters={
          <span role="group" aria-label="검토/안건 필터" className="flex flex-wrap items-center gap-1">
            <span className="section-meta">필터:</span>
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={filter === k} className="control-chip" onClick={() => setFilter(k)}>
                {label} <span className="tabular-nums">{counts[k]}</span>
              </button>
            ))}
          </span>
        }
        actions={
          <span className="flex items-center gap-1">
            <input ref={searchRef} aria-label="검토/안건 검색" placeholder="검토/안건명·번호" value={query} onChange={(e) => setQuery(e.target.value)}
              className="sizing-new-input sizing-new-input-sm" style={{ width: 160 }} />
            <button type="button" className="btn-ghost btn-sm" onClick={() => searchRef.current?.focus()}>
              <svg className="ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg> 검색
            </button>
          </span>
        }
      />

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {!data && !error && <PageState state="loading" rows={4} />}

      {data && (opps ?? []).filter((o) => o.status !== "dropped").length === 0 && data.projects.length === 0 && (
        <div className="market-section mb-4" style={{ border: "1px dashed var(--border)" }}>
          <h2 className="text-[0.9rem] mb-1">아직 진행 중인 검토/안건이 없습니다</h2>
          <p className="text-[length:var(--fs-caption)]" style={{ margin: "0 0 8px" }}>
            첫 신규사업 검토는 시장분석(S1)부터 시작합니다 — 4단계 가이드가 준비되어 있습니다.
          </p>
          <Link href="/onboarding" className="btn-ghost btn-sm" style={{ textDecoration: "none", display: "inline-block" }}>
            시작하기 가이드 보기
          </Link>
        </div>
      )}

      {data && (
        <>
          <div className="funnel-board" style={{ marginBottom: 16 }}>
            {columns.map((col) => {
              const colCards = visible.filter((c) => col.test(stageNum(c.stage)));
              return (
                <section key={col.title} className="funnel-col" aria-label={col.title}>
                  <h3>{col.title} <span className="funnel-count tabular-nums">{colCards.length}</span></h3>
                  <div className="funnel-cards">
                    {colCards.map((c) => {
                      const p = paused[c.id];
                      return (
                        <Link key={c.id} href={c.href} className="funnel-card" style={{ color: "inherit", textDecoration: "none" }}>
                          <span className="funnel-card-name font-semibold">{c.name}</span>
                          <span className="funnel-card-meta">
                            <span className={`status-chip ${stageTone[c.tone]}`}>{c.stageLabel}</span>
                            {c.track ? (
                              <span className={`status-chip ${c.track === "greenfield" ? "status-green" : "status-amber"}`}>{TRACK_LABEL[c.track]}</span>
                            ) : c.kind === "project" ? (
                              <span className="status-chip status-not-started">트랙 미결정</span>
                            ) : null}
                            <span>{c.meta}</span>
                          </span>
                          {p && (
                            <span className="funnel-card-meta" style={{ color: "var(--amber-fg)" }}>
                              ⚠ 파이프라인 일시정지 — {p.reason}
                              {p.link && (
                                <> · <span className="font-semibold">재개 →</span></>
                              )}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                    {colCards.length === 0 && <p className="funnel-empty">해당 단계의 검토/안건이 없습니다</p>}
                  </div>
                </section>
              );
            })}
          </div>

          <section className="market-section" aria-label="진행 에이징">
            <h3 className="sizing-step-title text-[0.9rem] mb-1">진행 에이징 — HOLD·KILL 경과</h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              위 퍼널(S1~S7, S8~S12) 어느 한쪽에 속한 목록이 아니라, 전체 단계의 게이트({Object.values(GATE_LABEL).join("·")}) HOLD·KILL 결정을 모두 모은 목록입니다 — &quot;진행&quot; 열이 각 행이 어느 게이트에서 나온 결정인지 나타냅니다.
            </p>
            {data.currentHolds.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">HOLD·KILL 진행이 없습니다.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table" aria-label="진행 에이징">
                  <caption className="sr-only">진행 에이징 — 경과일 내림차순</caption>
                  <thead>
                    <tr><th scope="col">검토/안건</th><th scope="col">게이트</th><th scope="col">결정</th><th scope="col">결정일</th><th scope="col" className="col-num">경과</th></tr>
                  </thead>
                  <tbody>
                    {[...data.currentHolds].sort((a, b) => b.ageDays - a.ageDays).map((r) => (
                      <tr key={`${r.entityType}:${r.entityId}:${r.gate}`}>
                        <td className="text-[length:var(--fs-caption)]">
                          <Link href={r.entityType === "project" ? `/projects/${r.entityId}/process` : `/opportunities?opportunity=${r.entityId}`}>
                            {r.label}
                          </Link>
                        </td>
                        <td className="tabular-nums text-[length:var(--fs-caption)]">{GATE_LABEL[r.gate as GateMetaId] ?? r.gate}</td>
                        <td><span className={`status-chip ${r.decision === "kill" ? "status-red" : "status-amber"}`}>{r.decision.toUpperCase()}</span></td>
                        <td className="text-[length:var(--fs-caption)] tabular-nums">{r.decidedAt.slice(0, 10)}</td>
                        <td className="col-num tabular-nums text-[length:var(--fs-caption)]">{r.ageDays}일</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

/** Opening a deal lands on the workspace of the stage it is currently in (design: "one thing to do next"). */
function projectStageHref(projectId: string, stage: string): string {
  const group = STAGE_TAB_GROUPS.find((g) => g.stage === stage);
  return `/projects/${projectId}${group?.tabs[0]?.seg ?? "/process"}`;
}

export default function DealsPage() {
  return (
    <Suspense fallback={null}>
      <DealsBoard />
    </Suspense>
  );
}
