"use client";

// /deals — the deal board (ADR-0120): every deal as one funnel — opportunities
// (S1–S7) and projects (S8–S12), gate aging, and paused-pipeline widgets.
// Read-only overview; decisions stay on their stage surfaces (boundary #2).
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api.ts";
import { PageState } from "../../components/ui.tsx";

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
  aging: AgingRow[];
}
interface OpportunityRow {
  id: string;
  name: string;
  market_scope: string | null;
  attractiveness_score: number | null;
  synergy_score: number | null;
  status: "identified" | "assessed" | "selected" | "dropped";
}

const GATES = ["fs", "dd", "entity_ic", "group_ic"] as const;
const GATE_CHIP: Record<string, { label: string; cls: string }> = {
  go: { label: "GO", cls: "status-green" },
  hold: { label: "HOLD", cls: "status-amber" },
  kill: { label: "KILL", cls: "status-red" },
};

function gateChip(value: string | undefined) {
  if (!value) return <span className="status-chip status-not-started">미기록</span>;
  const meta = GATE_CHIP[value] ?? { label: value, cls: "status-not-started" };
  return <span className={`status-chip ${meta.cls}`}>{meta.label}</span>;
}

function DealsBoard() {
  const [data, setData] = useState<PipelineView | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "greenfield" | "brownfield" | "gate" | "paused">("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const load = useCallback(() => {
    api.get<PipelineView>("/api/portfolio/pipeline").then((r) => setData(r.data)).catch((e) => setError(e instanceof Error ? e.message : "딜 보드를 불러오지 못했습니다."));
    api.get<OpportunityRow[]>("/api/opportunities").then((r) => setOpps(r.data)).catch(() => setOpps([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const stageOf = (o: OpportunityRow): string => {
    if (o.status === "identified") return "S2";
    if (o.status === "assessed") return "S3";
    if (o.status === "selected") return "S4";
    return "—";
  };
  const stageNum = (s: string) => (s.startsWith("S") ? Number(s.slice(1)) : 99);
  const oppColumn = (n: number) => (n <= 3 ? "발굴·평가 (S1~S3)" : "전략 결정 (S4~S7)");

  type Card = { kind: "opportunity" | "project"; id: string; name: string; stage: string; meta: string; track: string | null };
  const filtered: Card[] = (opps ?? [])
    .filter((o) => o.status !== "dropped")
    .filter((o) => !query || o.name.toLowerCase().includes(query.toLowerCase()))
    .map((o): Card => ({ kind: "opportunity" as const, id: o.id, name: o.name, stage: stageOf(o), meta: `매력도 ${o.attractiveness_score ?? "—"} · 시너지 ${o.synergy_score ?? "—"}`, track: null }))
    .concat(
      (data?.projects ?? []).map((p): Card => ({
        kind: "project" as const, id: p.projectId, name: p.projectName ?? p.projectNo,
        stage: p.currentStage ?? "S8", meta: p.track ?? "트랙 미결정", track: p.track,
      })),
    );

  const columns = [
    { title: "발굴·평가 (S1~S3)", test: (n: number) => n <= 3 },
    { title: "전략 결정 (S4~S7)", test: (n: number) => n >= 4 && n <= 7 },
    { title: "사업성·실사 (S8~S10)", test: (n: number) => n >= 8 && n <= 10 },
    { title: "심의·사후 (S11~S12)", test: (n: number) => n >= 11 },
  ];

  return (
    <main>
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 8 }}>
        <h1>딜 보드</h1>
        <Link href="/market" className="btn-primary btn-sm" style={{ textDecoration: "none", display: "inline-block" }}>
          ＋ 새 딜 시작 (시장분석부터)
        </Link>
      </div>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        모든 딜을 퍼널 한 장으로 봅니다 — 기회(S1~S7)와 프로젝트(S8~S12), 게이트 에이징까지.
      </p>

      <div className="market-section" style={{ marginBottom: 12 }}>
        <div className="flex flex-wrap items-center gap-1">
          {([["all", "전체"], ["greenfield", "그린필드"], ["brownfield", "브라운필드"], ["gate", "게이트 대기"], ["paused", "일시정지"]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} className={`control-chip ${filter === k ? "status-green" : ""}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
          <span className="note" style={{ flex: 1 }}>검색:</span>
          <input aria-label="딜 검색" placeholder="딜명·번호" value={query} onChange={(e) => setQuery(e.target.value)}
            className="sizing-new-input sizing-new-input-sm" style={{ width: 160 }} />
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setSearching(true); setTimeout(() => setSearching(false), 200); }}>
            <svg className="ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg> 검색
          </button>
        </div>
      </div>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {!data && !error && <PageState state="loading" rows={4} />}

      {data && (
        <>
          <div className="funnel-board" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
            {columns.map((col) => {
              const cards = filtered.filter((c) => col.test(stageNum(c.stage)));
              return (
                <div key={col.title} className="market-section" style={{ padding: 8 }}>
                  <h3 className="text-[0.75rem] text-[color:var(--muted-fg)]" style={{ padding: "2px 4px 8px" }}>{col.title}</h3>
                  {cards.map((c) => (
                    <Link key={c.id} href={c.kind === "project" ? `/projects/${c.id}/process` : `/opportunities?opportunity=${c.id}`}
                      className="market-section" style={{ display: "block", padding: "10px 12px", marginBottom: 8, borderRadius: 10 }}>
                      <span className="font-semibold text-[0.82rem]">{c.name}</span>
                      <span className="block text-[0.72rem] text-[color:var(--muted-fg)]" style={{ marginTop: 3 }}>
                        <span className={`status-chip ${c.stage === "S11" || c.stage === "S9" ? "status-amber" : "status-not-started"}`}>{c.stage}</span> {c.meta}
                      </span>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>

          <section className="market-section" aria-label="게이트 에이징">
            <h3 className="sizing-step-title text-[0.9rem]">게이트 에이징 — HOLD·KILL 경과</h3>
            {data.aging.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] text-[0.82rem]">에이징 중인 HOLD·KILL 게이트가 없습니다.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table" aria-label="게이트 에이징">
                  <caption className="sr-only">게이트 에이징 — 경과일 내림차순</caption>
                  <thead>
                    <tr><th scope="col">딜</th><th scope="col">게이트</th><th scope="col">결정</th><th scope="col">결정일</th><th scope="col" className="col-num">경과</th></tr>
                  </thead>
                  <tbody>
                    {[...data.aging].sort((a, b) => b.ageDays - a.ageDays).map((r) => (
                      <tr key={`${r.entityType}:${r.entityId}:${r.gate}`}>
                        <td className="text-[0.8rem]">{r.label}</td>
                        <td className="tabular-nums text-[0.78rem]">{r.gate}</td>
                        <td><span className={`status-chip ${r.decision === "kill" ? "status-red" : "status-amber"}`}>{r.decision.toUpperCase()}</span></td>
                        <td className="text-[0.75rem] tabular-nums">{r.decidedAt.slice(0, 10)}</td>
                        <td className="col-num tabular-nums text-[0.8rem]">{r.ageDays}일</td>
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

export default function DealsPage() {
  return (
    <Suspense fallback={null}>
      <DealsBoard />
    </Suspense>
  );
}
