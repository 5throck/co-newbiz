"use client";

// 플로우 콘솔 — 런 레저 탭 (화면 설계 2026-10-24 §5, J2 "수행 이력 추적").
// 요약 카드(A5-1) + 고정 필터(B1-1) + 인라인 계층 확장(B3-1/A1-1 변형) +
// EChart 타임라인(A2-1, 데이터 테이블 대체 필수) + 커서 페이지네이션
// (admin audit-log limit+before 패턴). 필터 상태는 URL 쿼리에 동기된다(§11 감사 화면 요건).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { EChartsOption } from "echarts";
import { useTranslations } from "next-intl";
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
  windowTokenKey,
} from "./flows-view-lib.ts";

const RUNS_COL_PCT = [14, 27, 20, 12, 13, 14] as const;
const LLM_COL_PCT = [13, 13, 20, 12, 10, 9, 9, 8, 6] as const;
const CHART_TABLE_COL_PCT = [25, 25, 25, 25] as const;

const RUNS_COLS = 6;
const LLM_COLS = 9;

const ADMIN_FORBIDDEN_KEY = "adminForbidden";

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
  const t = useTranslations("pages.flows.ledger");
  const tc = useTranslations("common");
  const tr = useTranslations();
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
        else setErrorText(err instanceof Error ? err.message : t("loadFailed"));
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
    return <PageState state="error" errorText={t(ADMIN_FORBIDDEN_KEY)} />;
  }
  if (status === "loading") return <PageState state="loading" rows={5} />;
  if (status === "error") return <PageState state="error" errorText={errorText ?? undefined} onRetry={() => setFilters((f) => ({ ...f }))} />;

  const errorRate = summary?.errorRate ?? null;
  // 기준 창 표기는 현지화된 라벨("최근 7일")로 풀어 쓴다 — 원문 토큰("7d") 노출 금지(2026-10-23 사용자 보고).
  const windowKey = windowTokenKey(summary?.window);

  return (
    <>
      {/* 요약 카드 4장 (§5.2) — 선택 기간(window) 기준, 색 단독 금지(A5). */}
      <section aria-label={t("summarySection")} className="market-section">
        <SectionToolbar
          title={t("summaryTitle")}
          filters={
            <span className="flex flex-wrap items-center gap-1" role="group" aria-label={t("windowGroup")}>
              <FilterChip selected={filters.window === "24h"} onClick={() => applyFilters({ window: "24h" })}>{t("window24h")}</FilterChip>
              <FilterChip selected={filters.window === "7d"} onClick={() => applyFilters({ window: "7d" })}>{t("window7d")}</FilterChip>
              <FilterChip selected={filters.window === "30d"} onClick={() => applyFilters({ window: "30d" })}>{t("window30d")}</FilterChip>
            </span>
          }
          summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("basisWindow", { p1: windowKey ? t(windowKey) : (summary?.window ?? "—") })}</span>}
        />
        <div className="flex flex-wrap gap-2">
          <SummaryCard label={t("callsCount")} value={fmtInt(summary?.llmCalls ?? 0)} />
          <SummaryCard
            label={t("errorRate")}
            value={fmtPct(errorRate)}
            alert={(errorRate ?? 0) > 0}
            alertText={t("errorAlert")}
          />
          <SummaryCard
            label={t("tokensSum")}
            value={fmtInt((summary?.inputTokens ?? 0) + (summary?.outputTokens ?? 0) + (summary?.cacheReadTokens ?? 0) + (summary?.cacheWriteTokens ?? 0))}
            sub={summary && summary.estimatedCalls > 0 ? t("estimatedIncluded", { p1: fmtInt(summary.estimatedCalls) }) : undefined}
          />
          <SummaryCard
            label={t("costSum")}
            value={fmtUsd(summary?.costUsd ?? 0)}
            sub={summary && summary.unpricedCalls > 0 ? t("unpricedExcluded", { p1: fmtInt(summary.unpricedCalls) }) : undefined}
          />
        </div>

        {/* EChart 타임라인 + 데이터 테이블 대체(A4 — §6.5 요구). */}
        <div className="mt-3">
          <EChart
            option={chartOption(buckets, t)}
            height={260}
            ariaLabel={t("chartAria", { p1: fmtInt(llmRows?.length ?? 0) })}
          />
          <details className="mt-1">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("viewAsTable")}</summary>
            <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-40 mt-1" aria-label={t("chartTableAria")}>
                <caption className="sr-only">{t("chartTableCaption")}</caption>
                <ColGroup widths={CHART_TABLE_COL_PCT} />
                <thead>
                  <tr><th scope="col">{t("colDay")}</th><th scope="col" className="col-num">{t("colSuccess")}</th><th scope="col" className="col-num">{t("colFailed")}</th><th scope="col" className="col-num">{t("colCost")}</th></tr>
                </thead>
                <tbody>
                  {buckets.length === 0 ? (
                    <tr><td colSpan={4} className="text-[color:var(--muted-fg)]">{t("emptyData")}</td></tr>
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
              {t("chartTableNote", { p1: fmtInt(llmRows?.length ?? 0) })}
            </p>
          </details>
        </div>
      </section>

      {/* 필터 바 (§5.1 고정 세트). */}
      <section aria-label={t("runsSection")} className="market-section">
        <SectionToolbar title={t("processRunsTitle")} count={runs?.length} filters={<FilterBar filters={filters} agents={agents} onChange={applyFilters} />} />
        {dryRunNote && !filters.excludeDryRun && (
          <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("dryRunNotePrefix", { p1: dryRunNote })}</p>
        )}
        {runs !== null && runs.length === 0 ? (
          !llmConfigured ? (
            <PageState state="empty" emptyText={t("emptyNoLlm")} />
          ) : (
            <PageState state="empty" emptyText={t("emptyRuns")} />
          )
        ) : (
          <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-48" aria-label={t("runsTableAria")}>
              <caption className="sr-only">{t("runsTableCaption")}</caption>
              <ColGroup widths={RUNS_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">{t("colTime")}</th>
                  <th scope="col">{t("colRun")}</th>
                  <th scope="col">{t("colAgent")}</th>
                  <th scope="col">{tc("status")}</th>
                  <th scope="col">{t("colSpecVersion")}</th>
                  <th scope="col">{t("colRunId")}</th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((r) => {
                  const chip = r.status === "failed"
                    ? { label: t("chipFailed"), cls: "status-chip status-rejected" }
                    : { label: t("chipSuccess"), cls: "status-chip status-approved" };
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
            {busyRuns ? tc("loading") : t("loadOlderRuns")}
          </button>
        )}
      </section>

      {/* LLM 호출 평면 표 — 호출 단위 경제성(A5-5). 런 확장과의 정확한 연결 열이
          Row 3 계약에 없어 별도 섹션으로 둔다(구현 편차 #5). */}
      <section aria-label={t("llmSection")} className="market-section">
        <SectionToolbar title={t("llmCallsTitle")} count={llmRows?.length} />
        {llmRows !== null && llmRows.length === 0 ? (
          !llmConfigured ? (
            <PageState state="empty" emptyText={t("emptyLlmNoLlm")} />
          ) : (
            <PageState state="empty" emptyText={t("emptyLlm")} />
          )
        ) : (
          <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-64" aria-label={t("llmTableAria")}>
              <caption className="sr-only">{t("llmTableCaption")}</caption>
              <ColGroup widths={LLM_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">{t("colTime")}</th>
                  <th scope="col">{t("colAgent")}</th>
                  <th scope="col">{t("llmColPurpose")}</th>
                  <th scope="col">{t("llmColModel")}</th>
                  <th scope="col">{t("llmColEvidence")}</th>
                  <th scope="col">{tc("status")}</th>
                  <th scope="col" className="col-num">{t("llmColLatency")}</th>
                  <th scope="col" className="col-num">{t("llmColTokens")}</th>
                  <th scope="col" className="col-num">{t("colCost")}</th>
                </tr>
              </thead>
              <tbody>
                {(llmRows ?? []).map((row) => {
                  const cls = classifiedByChip(row);
                  const okChip = row.ok === 1
                    ? { label: t("chipSuccess"), cls: "status-chip status-approved" }
                    : { label: t("chipFailed"), cls: "status-chip status-rejected" };
                  const dryRunGroup = dryRunGroupOf(row);
                  return (
                    <tr key={row.id}>
                      <td className="tabular-nums">{fmtDateTime(row.created_at)}</td>
                      <td>{row.agent_key ? <code className="dd-item-id">{row.agent_key}</code> : "—"}</td>
                      <td className="cell-truncate text-[length:var(--fs-caption)]">{row.purpose ?? "—"}</td>
                      <td className="text-[length:var(--fs-caption)]">{row.model ?? "—"}</td>
                      <td>
                        <span className={cls.cls}>{tr(cls.key)}</span>
                        {/* 드라이런 행(Row 5) — amber 칩 + 세션 딥링크(벤치 B1-2 그룹핑 변형).
                            기본 필터(드라이런 제외=ON)에서는 이 행 자체가 숨겨진다. */}
                        {dryRunGroup && (
                          <>
                            {" "}
                            <span className="status-chip status-amber">{t("dryRunChip")}</span>{" "}
                            <Link href={`/flows/dry-run/${encodeURIComponent(dryRunGroup)}`} className="text-[length:var(--fs-caption)] text-[color:var(--accent)] underline">
                              {t("sessionLink")}
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
          {t("llmTokensNote", { p1: fmtInt(llmRows?.length ?? 0), p2: fmtInt(totalTokensSum) })}
        </p>
        {nextBefore.llmCalls && (
          <button type="button" className="btn-ghost btn-sm mt-2" disabled={busyLlm} onClick={() => void loadMore("llmCalls")}>
            {busyLlm ? tc("loading") : t("loadOlderLlm")}
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
  const t = useTranslations("pages.flows.ledger");
  const tc = useTranslations("common");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="text-[length:var(--fs-caption)]">
        <span className="block mb-0.5">{t("colAgent")}</span>
        <select className="sizing-new-input sizing-new-input-sm" value={filters.agentKey} onChange={(e) => onChange({ agentKey: e.target.value })}>
          <option value="">{tc("all")}</option>
          {agents.map((a) => (
            <option key={a.key} value={a.key}>{a.key}</option>
          ))}
        </select>
      </label>
      <label className="text-[length:var(--fs-caption)]">
        <span className="block mb-0.5">{t("filterEntity")}</span>
        <span className="flex items-center gap-1">
          <select
            className="sizing-new-input sizing-new-input-sm"
            value={filters.entityType}
            onChange={(e) => onChange({ entityType: e.target.value as Filters["entityType"] })}
            aria-label={t("filterEntityType")}
          >
            <option value="">{tc("all")}</option>
            <option value="opportunity">opportunity</option>
            <option value="project">project</option>
          </select>
          <input
            className="sizing-new-input sizing-new-input-sm"
            value={filters.entityId}
            placeholder="ID"
            aria-label={t("filterEntityId")}
            onChange={(e) => onChange({ entityId: e.target.value })}
          />
        </span>
      </label>
      <span role="group" aria-label={t("okFilterGroup")} className="flex items-center gap-1">
        <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("status")}</span>
        <FilterChip selected={filters.ok === "all"} onClick={() => onChange({ ok: "all" })}>{tc("all")}</FilterChip>
        <FilterChip selected={filters.ok === "1"} onClick={() => onChange({ ok: "1" })}>{t("filterSuccessOnly")}</FilterChip>
        <FilterChip selected={filters.ok === "0"} onClick={() => onChange({ ok: "0" })}>{t("filterFailedOnly")}</FilterChip>
      </span>
      <label className="text-[length:var(--fs-caption)]">
        <span className="block mb-0.5">{t("filterSource")}</span>
        <select className="sizing-new-input sizing-new-input-sm" value={filters.source} onChange={(e) => onChange({ source: e.target.value as Filters["source"] })}>
          <option value="">{tc("all")}</option>
          <option value="llm">llm (AI)</option>
          <option value="synthesis">{t("filterSourceSynthesis")}</option>
        </select>
      </label>
      <FilterChip selected={filters.excludeDryRun} onClick={() => onChange({ excludeDryRun: !filters.excludeDryRun })} title={t("filterDryRunTitle")}>
        {t("filterExcludeDryRun")}
      </FilterChip>
    </span>
  );
}

/** §5.2 — 호출 수(막대, 성공/실패 분해) + 비용(선, 보조축). */
function chartOption(buckets: Array<{ day: string; ok: number; failed: number; costUsd: number }>, t: ReturnType<typeof useTranslations>): EChartsOption {
  return {
    tooltip: { trigger: "axis" },
    legend: { data: [t("chartLegendSuccess"), t("chartLegendFailed"), t("colCost")] },
    xAxis: { type: "category", data: buckets.map((b) => b.day) },
    yAxis: [
      { type: "value", name: t("callsCount") },
      { type: "value", name: t("chartAxisCost") },
    ],
    series: [
      { name: t("chartLegendSuccess"), type: "bar", stack: "calls", data: buckets.map((b) => b.ok) },
      { name: t("chartLegendFailed"), type: "bar", stack: "calls", data: buckets.map((b) => b.failed) },
      { name: t("colCost"), type: "line", yAxisIndex: 1, data: buckets.map((b) => Number(b.costUsd.toFixed(4))) },
    ],
  };
}
