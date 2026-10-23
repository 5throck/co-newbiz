"use client";

// 플로우 콘솔 — 런 레저 탭 (화면 설계 2026-10-24 §5, J2 "수행 이력 추적").
// 요약 카드(A5-1) + 고정 필터(B1-1) + 인라인 계층 확장(B3-1/A1-1 변형) +
// EChart 타임라인(A2-1, 데이터 테이블 대체 필수) + 커서 페이지네이션
// (admin audit-log limit+before 패턴). 필터 상태는 URL 쿼리에 동기된다(§11 감사 화면 요건).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { EChartsOption } from "echarts";
import { SectionToolbar } from "../../components/layout.tsx";
import { ColGroup, FilterChip, PageState } from "../../components/ui.tsx";
import { EChart } from "../../components/EChart.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { RunExpansionRows } from "./run-expansion.tsx";
import {
  bucketLlmCallsByDay,
  classifiedByChip,
  dryRunGroupOf,
  fmtDateTime,
  fmtInt,
  fmtPct,
  fmtSeconds,
  fmtUsd,
  type BlueprintAgent,
  type LlmCallRow,
  type ProcessRunRow,
  type RunsMeta,
  type RunsPayload,
  type RunsSummary,
  totalTokens,
} from "./flows-view-lib.ts";

const RUNS_COL_PCT = [14, 27, 20, 12, 13, 14] as const;
const LLM_COL_PCT = [13, 13, 20, 12, 10, 9, 9, 8, 6] as const;
const CHART_TABLE_COL_PCT = [25, 25, 25, 25] as const;

const RUNS_COLS = 6;
const LLM_COLS = 9;

const ADMIN_FORBIDDEN_TEXT = "관리자 계정은 업무 콘텐츠에서 분리되어 이 화면을 볼 수 없습니다(ADR-0146).";

interface Filters {
  window: "24h" | "7d" | "30d";
  agentKey: string;
  entityType: "" | "opportunity" | "project";
  entityId: string;
  ok: "all" | "1" | "0";
  source: "" | "llm" | "synthesis";
  excludeDryRun: boolean;
}

function readFilters(sp: URLSearchParams): Filters {
  const win = sp.get("window");
  const et = sp.get("etype");
  const ok = sp.get("ok");
  const src = sp.get("src");
  return {
    window: win === "24h" || win === "30d" ? win : "7d",
    agentKey: sp.get("agent") ?? "",
    entityType: et === "opportunity" || et === "project" ? et : "",
    entityId: sp.get("eid") ?? "",
    ok: ok === "1" || ok === "0" ? ok : "all",
    source: src === "llm" || src === "synthesis" ? src : "",
    excludeDryRun: sp.get("dry") !== "0", // 기본 ON(§5.1) — "dry=0"일 때만 해제
  };
}

/** 필터 객체 → API 쿼리 (Row 3 계약: entityType+entityId는 짝 필수, ok는 0/1). */
function buildParams(f: Filters, before: string | null): string {
  const p = new URLSearchParams();
  p.set("window", f.window);
  p.set("limit", "100");
  if (f.agentKey) p.set("agentKey", f.agentKey);
  if (f.entityType && f.entityId.trim()) {
    p.set("entityType", f.entityType);
    p.set("entityId", f.entityId.trim());
  }
  if (f.ok !== "all") p.set("ok", f.ok);
  if (f.source) p.set("source", f.source);
  if (!f.excludeDryRun) p.set("includeDryRun", "1"); // Row 5까지 no-op — meta.includeDryRunNote로 명시됨
  if (before) p.set("before", before);
  return p.toString();
}

export function LedgerView({ agents }: { agents: BlueprintAgent[] }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams));

  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [forbidden, setForbidden] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [llmConfigured, setLlmConfigured] = useState(true);
  const [dryRunNote, setDryRunNote] = useState<string | null>(null);

  const [runs, setRuns] = useState<ProcessRunRow[] | null>(null);
  const [llmRows, setLlmRows] = useState<LlmCallRow[] | null>(null);
  const [summary, setSummary] = useState<RunsSummary | null>(null);
  const [nextBefore, setNextBefore] = useState<{ processRuns: string | null; llmCalls: string | null }>({ processRuns: null, llmCalls: null });
  const [busyRuns, setBusyRuns] = useState(false);
  const [busyLlm, setBusyLlm] = useState(false);

  /** 필터 변경 → URL 동기(§11) + 상태 갱신. useEffect가 재조회를 담당한다. */
  const applyFilters = useCallback(
    (patch: Partial<Filters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        const sp = new URLSearchParams(window.location.search);
        sp.set("tab", "ledger");
        sp.set("window", next.window);
        if (next.agentKey) sp.set("agent", next.agentKey); else sp.delete("agent");
        if (next.entityType) sp.set("etype", next.entityType); else sp.delete("etype");
        if (next.entityId) sp.set("eid", next.entityId); else sp.delete("eid");
        if (next.ok !== "all") sp.set("ok", next.ok); else sp.delete("ok");
        if (next.source) sp.set("src", next.source); else sp.delete("src");
        if (!next.excludeDryRun) sp.set("dry", "0"); else sp.delete("dry");
        router.replace(`/flows?${sp.toString()}`, { scroll: false });
        return next;
      });
    },
    [router],
  );

  // 필터 변화 → 전체 재조회 (커서 누적도 리셋).
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setForbidden(false);
    setErrorText(null);
    api
      .get<RunsPayload>(`/api/flows/runs?${buildParams(filters, null)}`)
      .then((r) => {
        if (!alive) return;
        setRuns(r.data.processRuns ?? []);
        setLlmRows(r.data.llmCalls ?? []);
        setSummary(r.data.summary ?? null);
        setLlmConfigured(r.data.llmConfigured);
        const meta = r.meta as RunsMeta;
        setDryRunNote(typeof meta.includeDryRunNote === "string" ? meta.includeDryRunNote : null);
        setNextBefore({
          processRuns: meta.nextBefore?.processRuns ?? null,
          llmCalls: meta.nextBefore?.llmCalls ?? null,
        });
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setErrorText(err instanceof Error ? err.message : "런 장부를 불러오지 못했습니다");
        setStatus("error");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey 직렬화가 의존성 대신 안정성을 보장
  }, [filterKey]);

  /** 커서 페이지네이션 — "이전 기록 불러오기"(§5.3, 버튼 1개씩). 두 섹션이 같은
   *  before 파라미터를 공유하므로 각각 자기 섹션만 소비한다. */
  const loadMore = useCallback(
    async (section: "processRuns" | "llmCalls") => {
      const before = nextBefore[section];
      if (!before) return;
      if (section === "processRuns") setBusyRuns(true);
      else setBusyLlm(true);
      try {
        const r = await api.get<RunsPayload>(`/api/flows/runs?${buildParams(filters, before)}`);
        const meta = r.meta as RunsMeta;
        if (section === "processRuns") {
          setRuns((prev) => [...(prev ?? []), ...(r.data.processRuns ?? [])]);
          setNextBefore((prev) => ({ ...prev, processRuns: meta.nextBefore?.processRuns ?? null }));
        } else {
          setLlmRows((prev) => [...(prev ?? []), ...(r.data.llmCalls ?? [])]);
          setNextBefore((prev) => ({ ...prev, llmCalls: meta.nextBefore?.llmCalls ?? null }));
        }
      } catch {
        // 커서 재조회 실패는 침묵 — 다음 클릭에서 재시도 가능.
      } finally {
        if (section === "processRuns") setBusyRuns(false);
        else setBusyLlm(false);
      }
    },
    [filters, nextBefore],
  );

  const buckets = useMemo(() => bucketLlmCallsByDay(llmRows ?? []), [llmRows]);
  const totalTokensSum = useMemo(() => (llmRows ?? []).reduce((acc, r) => acc + totalTokens(r), 0), [llmRows]);

  if (forbidden) {
    // §10 상태 매트릭스 — 403(ADMIN)은 재시도를 유도하지 않는다(설계된 상태).
    return <PageState state="error" errorText={ADMIN_FORBIDDEN_TEXT} />;
  }
  if (status === "loading") return <PageState state="loading" rows={5} />;
  if (status === "error") return <PageState state="error" errorText={errorText ?? undefined} onRetry={() => setFilters((f) => ({ ...f }))} />;

  const errorRate = summary?.errorRate ?? null;

  return (
    <>
      {/* 요약 카드 4장 (§5.2) — 선택 기간(window) 기준, 색 단독 금지(A5). */}
      <section aria-label="런 레저 요약" className="market-section">
        <SectionToolbar
          title="요약"
          filters={
            <span className="flex flex-wrap items-center gap-1" role="group" aria-label="기간 선택">
              <FilterChip selected={filters.window === "24h"} onClick={() => applyFilters({ window: "24h" })}>최근 24시간</FilterChip>
              <FilterChip selected={filters.window === "7d"} onClick={() => applyFilters({ window: "7d" })}>최근 7일</FilterChip>
              <FilterChip selected={filters.window === "30d"} onClick={() => applyFilters({ window: "30d" })}>최근 30일</FilterChip>
            </span>
          }
          summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">기준 창: {summary?.window ?? "—"}</span>}
        />
        <div className="flex flex-wrap gap-2">
          <SummaryCard label="호출 수" value={fmtInt(summary?.llmCalls ?? 0)} />
          <SummaryCard
            label="오류율"
            value={fmtPct(errorRate)}
            alert={(errorRate ?? 0) > 0}
            alertText="✕ 오류"
          />
          <SummaryCard
            label="토큰 합"
            value={fmtInt((summary?.inputTokens ?? 0) + (summary?.outputTokens ?? 0) + (summary?.cacheReadTokens ?? 0) + (summary?.cacheWriteTokens ?? 0))}
            sub={summary && summary.estimatedCalls > 0 ? `추정 ${fmtInt(summary.estimatedCalls)}건 포함` : undefined}
          />
          <SummaryCard
            label="비용 합"
            value={fmtUsd(summary?.costUsd ?? 0)}
            sub={summary && summary.unpricedCalls > 0 ? `미가격 ${fmtInt(summary.unpricedCalls)}건 제외` : undefined}
          />
        </div>

        {/* EChart 타임라인 + 데이터 테이블 대체(A4 — §6.5 요구). */}
        <div className="mt-3">
          <EChart
            option={chartOption(buckets)}
            height={260}
            ariaLabel={`기간별 호출 수와 비용 — 불러온 ${fmtInt(llmRows?.length ?? 0)}건 기준`}
          />
          <details className="mt-1">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">표로 보기 (차트 데이터)</summary>
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-40 mt-1" aria-label="기간별 호출 수와 비용 데이터">
                <caption className="sr-only">차트의 일 단위 호출 수·실패·비용 데이터</caption>
                <ColGroup widths={CHART_TABLE_COL_PCT} />
                <thead>
                  <tr><th scope="col">일자</th><th scope="col" className="col-num">성공</th><th scope="col" className="col-num">실패</th><th scope="col" className="col-num">비용</th></tr>
                </thead>
                <tbody>
                  {buckets.length === 0 ? (
                    <tr><td colSpan={4} className="text-[color:var(--muted-fg)]">데이터 없음</td></tr>
                  ) : (
                    buckets.map((b) => (
                      <tr key={b.day}>
                        <td className="tabular-nums">{b.day}</td>
                        <td className="col-num tabular-nums">{fmtInt(b.ok)}</td>
                        <td className="col-num tabular-nums">{fmtInt(b.failed)}</td>
                        <td className="col-num tabular-nums">{fmtUsd(b.costUsd)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              차트와 표는 이 화면이 불러온 {fmtInt(llmRows?.length ?? 0)}건(커서 페이지 한도)을 반영합니다 — 기간 전체 집계는 위 요약 카드를 사용하세요.
            </p>
          </details>
        </div>
      </section>

      {/* 필터 바 (§5.1 고정 세트). */}
      <section aria-label="런 목록" className="market-section">
        <SectionToolbar title="프로세스 런" count={runs?.length} filters={<FilterBar filters={filters} agents={agents} onChange={applyFilters} />} />
        {dryRunNote && !filters.excludeDryRun && (
          <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">참고: {dryRunNote}</p>
        )}
        {runs !== null && runs.length === 0 ? (
          !llmConfigured ? (
            <PageState state="empty" emptyText="LLM이 구성되지 않아 런 장부 기록이 없습니다. 시스템 모드에서 LLM 구성을 확인하세요." />
          ) : (
            <PageState state="empty" emptyText="기록된 런이 없습니다." />
          )
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label="프로세스 런 목록">
              <caption className="sr-only">프로세스 런 목록 — 행 확장으로 활동·에이전트 기록 확인</caption>
              <ColGroup widths={RUNS_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">런</th>
                  <th scope="col">에이전트</th>
                  <th scope="col">상태</th>
                  <th scope="col">spec 버전</th>
                  <th scope="col">런 ID</th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((r) => {
                  const chip = r.status === "failed"
                    ? { label: "✕ 실패", cls: "status-chip status-rejected" }
                    : { label: "✓ 성공", cls: "status-chip status-approved" };
                  const agentKeys = [...new Set(r.activities.flatMap((a) => a.agentRuns.map((ar) => ar.agent_key)))];
                  return (
                    <FragmentRow key={r.id}>
                      <tr>
                        <td className="tabular-nums">{fmtDateTime(r.started_at)}</td>
                        <td>
                          <span className="status-chip status-not-started">{r.stage}</span>{" "}
                          <span className="text-[length:var(--fs-caption)]">{r.entity_type} </span>
                          <code className="dd-item-id">{r.entity_id}</code>
                        </td>
                        <td className="text-[length:var(--fs-caption)]">{agentKeys.length > 0 ? agentKeys.map((k) => <code key={k} className="dd-item-id mr-1">{k}</code>) : "—"}</td>
                        <td><span className={chip.cls}>{chip.label}</span></td>
                        <td className="text-[length:var(--fs-caption)]">{r.spec_version}</td>
                        <td><code className="dd-item-id">{r.id.slice(0, 12)}</code></td>
                      </tr>
                      <RunExpansionRows run={r} colCount={RUNS_COLS} />
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {nextBefore.processRuns && (
          <button type="button" className="btn-ghost btn-sm mt-2" disabled={busyRuns} onClick={() => void loadMore("processRuns")}>
            {busyRuns ? "불러오는 중..." : "이전 런 불러오기"}
          </button>
        )}
      </section>

      {/* LLM 호출 평면 표 — 호출 단위 경제성(A5-5). 런 확장과의 정확한 연결 열이
          Row 3 계약에 없어 별도 섹션으로 둔다(구현 편차 #5). */}
      <section aria-label="LLM 호출 기록" className="market-section">
        <SectionToolbar title="LLM 호출" count={llmRows?.length} />
        {llmRows !== null && llmRows.length === 0 ? (
          !llmConfigured ? (
            <PageState state="empty" emptyText="LLM이 구성되지 않아 호출 기록이 없습니다. 시스템 모드에서 LLM 구성을 확인하세요." />
          ) : (
            <PageState state="empty" emptyText="기록된 LLM 호출이 없습니다." />
          )
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-64" aria-label="LLM 호출 기록">
              <caption className="sr-only">LLM 호출 기록 — 지연·토큰·비용·근거 칩</caption>
              <ColGroup widths={LLM_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">에이전트</th>
                  <th scope="col">목적</th>
                  <th scope="col">모델</th>
                  <th scope="col">근거</th>
                  <th scope="col">상태</th>
                  <th scope="col" className="col-num">지연</th>
                  <th scope="col" className="col-num">토큰 in/out</th>
                  <th scope="col" className="col-num">비용</th>
                </tr>
              </thead>
              <tbody>
                {(llmRows ?? []).map((row) => {
                  const cls = classifiedByChip(row);
                  const okChip = row.ok === 1
                    ? { label: "✓ 성공", cls: "status-chip status-approved" }
                    : { label: "✕ 실패", cls: "status-chip status-rejected" };
                  const dryRunGroup = dryRunGroupOf(row);
                  return (
                    <tr key={row.id}>
                      <td className="tabular-nums">{fmtDateTime(row.created_at)}</td>
                      <td>{row.agent_key ? <code className="dd-item-id">{row.agent_key}</code> : "—"}</td>
                      <td className="cell-truncate text-[length:var(--fs-caption)]">{row.purpose ?? "—"}</td>
                      <td className="text-[length:var(--fs-caption)]">{row.model ?? "—"}</td>
                      <td>
                        <span className={cls.cls}>{cls.label}</span>
                        {/* 드라이런 행(Row 5) — amber 칩 + 세션 딥링크(벤치 B1-2 그룹핑 변형).
                            기본 필터(드라이런 제외=ON)에서는 이 행 자체가 숨겨진다. */}
                        {dryRunGroup && (
                          <>
                            {" "}
                            <span className="status-chip status-amber">드라이런</span>{" "}
                            <Link href={`/flows/dry-run/${encodeURIComponent(dryRunGroup)}`} className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline">
                              세션 →
                            </Link>
                          </>
                        )}
                      </td>
                      <td><span className={okChip.cls}>{okChip.label}</span></td>
                      <td className="col-num tabular-nums">{fmtSeconds(row.latency_ms)}</td>
                      <td className="col-num tabular-nums text-[length:var(--fs-caption)]">{fmtInt(row.input_tokens)}/{fmtInt(row.output_tokens)}</td>
                      <td className="col-num tabular-nums">{fmtUsd(row.cost_usd)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          불러온 {fmtInt(llmRows?.length ?? 0)}건 중 이 화면 기준 토큰 합계 {fmtInt(totalTokensSum)} — 전체 기간 집계는 요약 카드를 사용하세요.
        </p>
        {nextBefore.llmCalls && (
          <button type="button" className="btn-ghost btn-sm mt-2" disabled={busyLlm} onClick={() => void loadMore("llmCalls")}>
            {busyLlm ? "불러오는 중..." : "이전 호출 불러오기"}
          </button>
        )}
      </section>
    </>
  );
}

/** 두 <tr>(데이터 행 + 확장 행)을 하나의 키로 묶는 런타임 프래그먼트. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SummaryCard({ label, value, sub, alert, alertText }: { label: string; value: string; sub?: string; alert?: boolean; alertText?: string }) {
  return (
    <div className="sizing-grade-card" style={{ flex: "1 1 10rem" }}>
      <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{label}</div>
      <div className={`text-xl font-bold tabular-nums${alert ? " text-[color:var(--red-fg)]" : ""}`}>{value}</div>
      {alert && alertText && <div className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--red-fg)]">{alertText}</div>}
      {sub && <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{sub}</div>}
    </div>
  );
}

function FilterBar({
  filters,
  agents,
  onChange,
}: {
  filters: Filters;
  agents: BlueprintAgent[];
  onChange: (patch: Partial<Filters>) => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="text-[length:var(--fs-caption)]">
        <span className="block mb-0.5">에이전트</span>
        <select className="sizing-new-input sizing-new-input-sm" value={filters.agentKey} onChange={(e) => onChange({ agentKey: e.target.value })}>
          <option value="">전체</option>
          {agents.map((a) => (
            <option key={a.key} value={a.key}>{a.key}</option>
          ))}
        </select>
      </label>
      <label className="text-[length:var(--fs-caption)]">
        <span className="block mb-0.5">엔터티</span>
        <span className="flex items-center gap-1">
          <select
            className="sizing-new-input sizing-new-input-sm"
            value={filters.entityType}
            onChange={(e) => onChange({ entityType: e.target.value as Filters["entityType"] })}
            aria-label="엔터티 유형"
          >
            <option value="">전체</option>
            <option value="opportunity">opportunity</option>
            <option value="project">project</option>
          </select>
          <input
            className="sizing-new-input sizing-new-input-sm"
            value={filters.entityId}
            placeholder="ID"
            aria-label="엔터티 ID"
            onChange={(e) => onChange({ entityId: e.target.value })}
          />
        </span>
      </label>
      <span role="group" aria-label="성공·실패 필터" className="flex items-center gap-1">
        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">상태</span>
        <FilterChip selected={filters.ok === "all"} onClick={() => onChange({ ok: "all" })}>전체</FilterChip>
        <FilterChip selected={filters.ok === "1"} onClick={() => onChange({ ok: "1" })}>성공만</FilterChip>
        <FilterChip selected={filters.ok === "0"} onClick={() => onChange({ ok: "0" })}>실패만</FilterChip>
      </span>
      <label className="text-[length:var(--fs-caption)]">
        <span className="block mb-0.5">출처</span>
        <select className="sizing-new-input sizing-new-input-sm" value={filters.source} onChange={(e) => onChange({ source: e.target.value as Filters["source"] })}>
          <option value="">전체</option>
          <option value="llm">llm (AI)</option>
          <option value="synthesis">synthesis (결정론)</option>
        </select>
      </label>
      <FilterChip selected={filters.excludeDryRun} onClick={() => onChange({ excludeDryRun: !filters.excludeDryRun })} title="해제 시 드라이런 런도 포함됩니다">
        드라이런 제외
      </FilterChip>
    </span>
  );
}

/** §5.2 — 호출 수(막대, 성공/실패 분해) + 비용(선, 보조축). */
function chartOption(buckets: Array<{ day: string; ok: number; failed: number; costUsd: number }>): EChartsOption {
  return {
    tooltip: { trigger: "axis" },
    legend: { data: ["성공 호출", "실패 호출", "비용"] },
    xAxis: { type: "category", data: buckets.map((b) => b.day) },
    yAxis: [
      { type: "value", name: "호출 수" },
      { type: "value", name: "비용 ($)" },
    ],
    series: [
      { name: "성공 호출", type: "bar", stack: "calls", data: buckets.map((b) => b.ok) },
      { name: "실패 호출", type: "bar", stack: "calls", data: buckets.map((b) => b.failed) },
      { name: "비용", type: "line", yAxisIndex: 1, data: buckets.map((b) => Number(b.costUsd.toFixed(4))) },
    ],
  };
}
