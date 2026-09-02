"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { api } from "../../lib/api.ts";
import { useConfirm } from "../../components/crud.tsx";
import { SectionToolbar } from "../../components/layout.tsx";
import { StageFrame } from "../../components/StageFrame.tsx";
import { EChart } from "../../components/EChart.tsx";
import { useChartTheme } from "../../lib/echarts-theme.ts";
import {
  AXES, HYD_BRK_MATRIX, REGISTRY, SIZING_SOURCE_DOC, SEGMENTS, segmentsOf, STEPS,
  VALIDATION_STATUS_META, bandFor, global2026, projection2030, regionTotal,
  type SizingMatrix, type SegmentCode,
} from "../../lib/market-sizing.ts";

// S1 시장분석 (/market) — systematic-market-sizing 스킬의 8단계 절차 리포트.
// 랜딩 = 산업 테이블(신규 분석 생성 포함) → 선택 시 8단계 리치 리포트.
// 동결 분석(HYD-BRK)은 연구문서 매트릭스, 신규 분석은 파이프라인이 LLM으로
// 생성한 매트릭스 — 어느 쪽이든 동일한 차트/테이블로 렌더링된다.

interface AnalysisInfo {
  id: string; status: "in_progress" | "completed" | "failed"; current_step: number; latest_version: number | null;
  created_at: string; completed_at: string | null; error_message?: string | null;
}
interface IndustryRow {
  id: string; name_ko: string; name_en: string | null;
  ksic_code: string | null; driver_count: number; analysis: AnalysisInfo | null;
}
interface DriverRow { id: string; code: string; label_ko: string; description: string; }
interface MarketOverview {
  industries: IndustryRow[]; drivers: DriverRow[];
  stats: { value_chain_links: number; proxy_links: number; series_count: number; observation_count: number };
}
interface DriverSensitivity { driver_label: string; sensitivity: number; lag_months: number | null; region_code: string | null; segment_code: string | null }
interface AssumptionRow {
  assumption_key: string; kind: string; value: number; rationale: string | null;
  anchor_ref: string | null; as_of: string; ttl_days: number | null;
}
interface VersionInfo { version_no: number; changelog: string | null; created_by: string; created_at: string }
interface ChainLink {
  hop_type: "engineering" | "statistical";
  coefficient: number | null;
  beta: number | null;
  r2: number | null;
  lag_months: number | null;
  evidence_ref: string;
  industry_id: string;
  name_ko: string;
  direction: "upstream" | "downstream";
}
interface IndustryDetail {
  industry: { id: string; name_ko: string; name_en: string | null; ksic_code: string | null };
  chain: { links: ChainLink[]; grade: { reliability_grade: string; grade_rationale: string } | null };
  driver_sensitivities: DriverSensitivity[];
  sizing: { run_id: string; run_label: string; assumptions: AssumptionRow[] } | null;
  versions: VersionInfo[];
}
interface AnalysisDetail {
  id: string; status: "in_progress" | "completed"; current_step: number; name_ko: string;
  versions: Array<{ version_no: number; payload: { matrix?: SizingMatrix; stepSummaries?: Array<{ step: number; summary: string; source: string; pendingInputs: string[] }> } | null; changelog: string | null; created_by: string; created_at: string }>;
}
interface LlmStatus { configured: boolean; provider: string | null; model: string | null }

const SEGMENT_COLORS = [0, 1, 2, 3, 4];
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const POSITION_LABELS: Record<string, string> = {
  upstream: "상류(원자재·부품)",
  midstream: "중류(조립·가공)",
  downstream: "하류(완제품·수요처)",
};

export function MarketView() {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [detail, setDetail] = useState<IndustryDetail | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedIndustry = searchParams.get("industry");
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "in_progress" | "completed" | "stale" | "pending" | "failed">("all");
  const [editing, setEditing] = useState<{ id: string; name: string; code: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [savingEdit, setSavingEdit] = useState(false);

  const refreshOverview = useCallback(() => {
    return api.get<MarketOverview>("/api/market-overview")
      .then((r) => { setOverview(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  useEffect(() => {
    void refreshOverview();
    api.get<LlmStatus>("/api/llm-status").then((r) => setLlmStatus(r.data)).catch(() => setLlmStatus({ configured: false, provider: null, model: null }));
  }, [refreshOverview]);

  // 분석 중인 산업이 있으면 3초 간격으로 상태 폴링 → 완료 시 목록이 자동 갱신
  const hasInProgress = overview?.industries.some((i) => i.analysis?.status === "in_progress") ?? false;
  useEffect(() => {
    if (!hasInProgress) return;
    const t = setInterval(() => { void refreshOverview(); }, 3000);
    return () => clearInterval(t);
  }, [hasInProgress, refreshOverview]);

  // 상세 진입은 URL(?industry=)기반 — 상단 바의 뒤로 가기가 동작하도록 한다.
  const loadDetail = useCallback((industryId: string) => {
    router.replace(`/market?industry=${encodeURIComponent(industryId)}`);
  }, [router]);

  useEffect(() => {
    if (!selectedIndustry) { setDetail(null); return; }
    if (detail?.industry.id === selectedIndustry) return;
    setDetail(null);
    api.get<IndustryDetail>(`/api/market-overview/industry/${encodeURIComponent(selectedIndustry)}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "상세 불러오기 실패"));
  }, [selectedIndustry]);

  async function createAnalysis(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await api.post("/api/market-overview/analyses", { name_ko: newName.trim(), ksic_code: newCode.trim() || undefined });
      setNewName(""); setNewCode(""); setShowNewForm(false);
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 생성 실패");
    } finally {
      setCreating(false);
    }
  }

  const backToList = useCallback(() => {
    router.replace("/market");
    setDetail(null);
  }, [router]);

  // 재분석: 실패 재시작 또는 분석일 경과에 따른 데이터 갱신. 새 버전으로 쌓임.
  const STALE_DAYS = 90;
  const relDate = (d: string | null) => {
    if (!d) return null;
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (days <= 0) return "오늘";
    if (days < 30) return `${days}일 전`;
    if (days < 365) return `${Math.floor(days / 30)}개월 전`;
    return `${Math.floor(days / 365)}년 전`;
  };
  async function rerunAnalysis(analysisId: string) {
    try {
      await api.post(`/api/market-overview/analyses/${encodeURIComponent(analysisId)}/rerun`);
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "재분석 시작 실패");
    }
  }

  // 산업 삭제 — market-sizing 분석(버전 행 포함)과 함께 삭제한다.
  function deleteIndustry(ind: IndustryRow) {
    confirm(
      `산업 "${ind.name_ko}" 삭제`,
      async () => {
        setError(null);
        try {
          await api.delete(`/api/market-overview/industry/${encodeURIComponent(ind.id)}`);
          if (selectedIndustry === ind.id) backToList();
          await refreshOverview();
        } catch (err) {
          setError(err instanceof Error ? err.message : "산업 삭제 실패");
        }
      },
      { body: "이 산업의 시장분석 기록(버전 전체)도 함께 삭제되며 되돌릴 수 없습니다." },
    );
  }

  // 산업 정보 수정(이름·KSIC 코드) — 목록에서 인라인으로 편집한다.
  async function saveEdit() {
    if (!editing || savingEdit) return;
    if (!editing.name.trim()) { setError("산업명은 필수입니다."); return; }
    setSavingEdit(true);
    setError(null);
    try {
      await api.patch(`/api/market-overview/industry/${encodeURIComponent(editing.id)}`, {
        name_ko: editing.name.trim(),
        ksic_code: editing.code.trim() || null,
      });
      setEditing(null);
      await refreshOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "산업 정보 수정 실패");
    } finally {
      setSavingEdit(false);
    }
  }

  // 목록 파생: 검색 + 상태 필터 + 우선순위 정렬(분석 중 → 업데이트 권장 → 최근 분석 → 대기)
  const buckets = useMemo(() => {
    const of = (ind: IndustryRow): IndustryRow["analysis"] & { bucket: "in_progress" | "stale" | "completed" | "pending" | "failed" } | null => {
      const a = ind.analysis;
      if (!a) return null;
      const d = (a.completed_at ?? a.created_at).slice(0, 10);
      const stale = a.status === "completed" && d && (Date.now() - new Date(d).getTime()) / 86400000 > STALE_DAYS;
      return { ...a, bucket: a.status === "in_progress" ? "in_progress" : a.status === "failed" ? "failed" : stale ? "stale" : "completed" };
    };
    return { of };
  }, []);
  const visibleIndustries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = (overview?.industries ?? [])
      .filter((ind) => {
        if (q && !(ind.name_ko.toLowerCase().includes(q) || (ind.name_en ?? "").toLowerCase().includes(q) || (ind.ksic_code ?? "").toLowerCase().includes(q))) return false;
        if (statusFilter === "all") return true;
        const b = buckets.of(ind)?.bucket ?? "pending";
        return b === statusFilter;
      });
    const rank = { failed: 0, in_progress: 1, stale: 2, completed: 3, pending: 4 } as const;
    return [...rows].sort((x, y) => {
      const bx = buckets.of(x)?.bucket ?? "pending";
      const by = buckets.of(y)?.bucket ?? "pending";
      if (rank[bx] !== rank[by]) return rank[bx] - rank[by];
      const dx = x.analysis ? (x.analysis.completed_at ?? x.analysis.created_at) : "";
      const dy = y.analysis ? (y.analysis.completed_at ?? y.analysis.created_at) : "";
      return dy.localeCompare(dx);
    });
  }, [overview, query, statusFilter, buckets]);

  const statusCounts = useMemo(() => {
    const counts = { all: 0, in_progress: 0, completed: 0, stale: 0, pending: 0, failed: 0 };
    for (const ind of overview?.industries ?? []) {
      counts.all++;
      counts[buckets.of(ind)?.bucket ?? "pending"]++;
    }
    return counts;
  }, [overview, buckets]);

  if (detail && selectedIndustry) {
    const row = overview?.industries.find((i) => i.id === selectedIndustry);
    const analysisId = row?.analysis?.id ?? null;
    const analysisDate = row?.analysis ? (row.analysis.completed_at ?? row.analysis.created_at).slice(0, 10) : null;
    return (
      <main>
        <MarketReport detail={detail} analysisId={analysisId} analysisDate={analysisDate} />
      </main>
    );
  }

  return (
    <main>
      {confirmDialog}
      <StageFrame stageId="S1" />
      <p className="mt-[0.15rem] mb-2 text-[color:var(--muted-fg)] text-[0.9rem]">
        프로세스 스테이지 S1 — 산업을 선택하면 <strong>systematic-market-sizing</strong> 8단계 절차로 분석된
        리포트가 차트로 표시됩니다.
      </p>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 분석 대상 산업 (테이블) ── */}
      <section aria-label="분석 대상 산업" className="market-section">
        <SectionToolbar
          title="분석 대상 산업"
          icon="🏭"
          count={statusCounts.all}
          filters={
            <input
              type="search"
              aria-label="산업 검색"
              placeholder="산업명·코드 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sizing-new-input sizing-new-input-sm"
              style={{ width: "12rem", minWidth: "8rem" }}
            />
          }
          summary={
            <span role="group" aria-label="상태 필터" className="flex items-center gap-1">
              {([
                ["all", "전체"], ["in_progress", "분석 중"], ["completed", "완료"], ["stale", "업데이트 권장"], ["pending", "대기"], ["failed", "실패"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={statusFilter === key}
                  className={`status-chip ${statusFilter === key ? "status-green" : "status-not-started"}`}
                  onClick={() => setStatusFilter(key)}
                >
                  {label} {statusCounts[key]}
                </button>
              ))}
            </span>
          }
          actions={
            <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setShowNewForm((v) => !v)} aria-expanded={showNewForm}>
              ＋ 신규 산업 분석
            </button>
          }
        />

        {showNewForm && (
          <form onSubmit={createAnalysis} aria-label="신규 산업 분석 생성" className="sizing-new-form mb-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[0.78rem]">
                <span className="block mb-1">산업명 *</span>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="예: 산업용 로봇" required className="sizing-new-input" />
              </label>
              <label className="text-[0.78rem]">
                <span className="block mb-1">KSIC 코드 (선택)</span>
                <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="예: 28121" className="sizing-new-input sizing-new-input-sm" />
              </label>
              <button type="submit" className="btn-ghost" disabled={creating || !newName.trim()}>
                {creating ? "생성 중..." : "분석 시작"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowNewForm(false)}>
                취소
              </button>
            </div>
            <p className="mt-2 mb-0 text-[0.72rem] text-[color:var(--muted-fg)]">
              systematic-market-sizing 8단계 파이프라인이 순서대로 실행되며, 완료 전까지는 목록에 "분석 중"으로 표시됩니다.
              {llmStatus && (llmStatus.configured
                ? <> LLM 요약 사용: <strong>{llmStatus.provider} / {llmStatus.model}</strong></>
                : <> LLM 미구성(CO_NEWBIZ_LLM_* 환경변수) — <strong>결정론 합성</strong>으로 분석됩니다.</>)}
            </p>
          </form>
        )}

        {overview === null ? (
          <p>불러오는 중...</p>
        ) : overview.industries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">등록된 산업이 없습니다. "신규 산업 분석"으로 시작하세요.</p>
        ) : visibleIndustries.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">검색·필터 조건에 맞는 산업이 없습니다.</p>
        ) : (
          <table className="data-table" aria-label="분석 대상 산업 목록">
            <caption className="sr-only">분석 대상 산업 목록</caption>
            <thead>
              <tr>
                <th scope="col">산업명</th>
                <th scope="col">KSIC 코드</th>
                <th scope="col">연결 드라이버</th>
                <th scope="col">분석 상태</th>
                <th scope="col">분석일</th>
              </tr>
            </thead>
            <tbody>
              {visibleIndustries.map((ind) => {
                const a = ind.analysis;
                const inProgress = a?.status === "in_progress";
                const analysisDate = a ? (a.completed_at ?? a.created_at).slice(0, 10) : null;
                const stale = a?.status === "completed" && analysisDate
                  ? (Date.now() - new Date(analysisDate).getTime()) / 86400000 > STALE_DAYS
                  : false;
                const isEditing = editing?.id === ind.id;
                return (
                  <tr key={ind.id} className={selectedIndustry === ind.id ? "row-selected" : undefined}>
                    <td className="cell-primary">
                      {isEditing ? (
                        <input
                          aria-label="산업명 수정"
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          className="sizing-new-input"
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          className="font-semibold text-left underline-offset-2 hover:underline"
                          title="분석 리포트 열기"
                          onClick={() => loadDetail(ind.id)}
                        >
                          {ind.name_ko}
                        </button>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <input
                          aria-label="KSIC 코드 수정"
                          value={editing.code}
                          onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                          placeholder="예: 28121"
                          className="sizing-new-input sizing-new-input-sm"
                        />
                      ) : (
                        <code className="dd-item-id">{ind.ksic_code ?? "—"}</code>
                      )}
                    </td>
                    <td className="tabular-nums">{ind.driver_count}건</td>
                    <td>
                      {inProgress ? (
                        <span className="status-chip status-amber">분석 중 ({a?.current_step ?? 0}/8단계)</span>
                      ) : stale ? (
                        <span className="status-chip status-amber" title="분석일이 90일을 지났습니다 — 재분석로 최신화하세요.">업데이트 권장 (v{a?.latest_version ?? 1})</span>
                      ) : a?.status === "completed" ? (
                        <span className="status-chip status-green">분석 완료 (v{a.latest_version ?? 1})</span>
                      ) : a?.status === "failed" ? (
                        <span className="status-chip status-red" title={a.error_message ?? "파이프라인 실행 중 오류가 발생했습니다."}>분석 실패</span>
                      ) : (
                        <span className="status-chip status-not-started">분석 대기</span>
                      )}
                    </td>
                    <td>
                      {a ? (
                        <span className="tabular-nums" title={analysisDate ?? ""}>{relDate(analysisDate)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="sizing-actions-cell"><span className="actions-row">
                      {isEditing ? (
                        <>
                          <button type="button" className="btn-ghost btn-sm" disabled={savingEdit || !editing.name.trim()} onClick={saveEdit}>
                            {savingEdit ? "저장 중..." : "저장"}
                          </button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            disabled={inProgress}
                            onClick={() => loadDetail(ind.id)}
                          >
                            {inProgress ? "분석 중" : "열기"}
                          </button>
                          {a && !inProgress && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm sizing-rerun-btn"
                              title={stale ? "분석일이 90일 지났습니다" : "분석 실패 또는 갱신 필요 시 새 버전으로 재실행"}
                              onClick={() => rerunAnalysis(a.id)}
                            >
                              재분석
                            </button>
                          )}
                          {!inProgress && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm"
                              title="산업명·KSIC 코드 수정"
                              onClick={() => setEditing({ id: ind.id, name: ind.name_ko, code: ind.ksic_code ?? "" })}
                            >
                              수정
                            </button>
                          )}
                          {!inProgress && (
                            <button
                              type="button"
                              className="btn-danger btn-sm"
                              title="이 산업과 시장분석 기록을 삭제합니다"
                              onClick={() => deleteIndustry(ind)}
                            >
                              삭제
                            </button>
                          )}
                        </>
                      )}
                    </span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {hasInProgress && (
          <p className="mt-2 mb-0 text-[0.75rem] text-[color:var(--muted-fg)]" role="status">
            분석이 진행 중입니다 — 완료되면 목록이 자동으로 갱신됩니다.
          </p>
        )}
      </section>
    </main>
  );
}

/* ── 산업 리포트: 동결 매트릭스(HYD-BRK) 또는 파이프라인 생성 매트릭스 ── */

function MarketReport({ detail, analysisId, analysisDate }: { detail: IndustryDetail; analysisId: string | null; analysisDate: string | null }) {
  const isFrozen = detail.industry.ksic_code === "HYD-BRK";
  const [analysis, setAnalysis] = useState<AnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isFrozen || !analysisId) return;
    api.get<AnalysisDetail>(`/api/market-overview/analyses/${encodeURIComponent(analysisId)}`)
      .then((r) => setAnalysis(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "분석 결과 불러오기 실패"));
  }, [isFrozen, analysisId]);

  const matrix: SizingMatrix | null = isFrozen ? HYD_BRK_MATRIX : (analysis?.versions[0]?.payload?.matrix ?? null);
  const stepSummaries = analysis?.versions[0]?.payload?.stepSummaries ?? null;
  const llmUsed = !isFrozen && (stepSummaries?.every((s) => s.source === "llm") ?? false);

  return (
    <>
      <div className="sizing-report-header">
        <h2>
          📊 {detail.industry.name_ko} 시장 분석 리포트
          {detail.industry.ksic_code && <code className="dd-item-id ml-2">{detail.industry.ksic_code}</code>}
        </h2>
        <p className="text-[color:var(--muted-fg)] text-[0.78rem]">
          방법론: systematic-market-sizing v1.1
          {isFrozen ? <> · 소스 문서: <code className="text-[0.72rem]">{SIZING_SOURCE_DOC}</code></> : " · 8단계 파이프라인 산출"}
          {analysisDate && <> · 분석일: <strong>{analysisDate}</strong></>}
        </p>
      </div>
      <VersionBar versions={detail.versions} />
      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}
      {!isFrozen && !analysis && (
        <p className="market-section">분석 결과를 불러오는 중...</p>
      )}
      {!isFrozen && analysis && !matrix && (
        <section aria-label="분석 없음" className="market-section sizing-step">
          <p className="text-[color:var(--muted-fg)] italic">
            이 산업의 정식 분석 기록(버전)이 없습니다. 목록에서 "신규 산업 분석"으로 8단계 파이프라인을 실행하세요.
          </p>
          <StepSensitivityChart stepNumber={1} sensitivities={detail.driver_sensitivities} />
        </section>
      )}
      {matrix && (
        <>
          {matrix.provenance === "llm-estimate" && (
            <p className="market-section sizing-note-list text-[0.78rem] text-[color:var(--amber-fg)]" role="note">
              ⚠ 이 매트릭스는 파이프라인 LLM이 생성한 추정치입니다 — 수치는 앵커 삼각검증(2단계)과
              기업 공시 교차검증(6단계)을 거친 동결 매트릭스가 아니며, 정식 인용 전 분석가 확정이 필요합니다.
              {llmUsed && <> (8단계 전체 LLM 요약 사용)</>}
            </p>
          )}
          <SizingReport
            detail={detail}
            matrix={matrix}
            analysisId={isFrozen ? detail.sizing?.run_id ?? null : analysisId}
            isFrozen={isFrozen}
            stepSummaries={stepSummaries}
          />
        </>
      )}
    </>
  );
}

/* ── 버전 관리 바 ── */
function VersionBar({ versions }: { versions: VersionInfo[] }) {
  if (!versions || versions.length === 0) return null;
  return (
    <details className="market-section sizing-version-bar">
      <summary className="cursor-pointer text-[0.82rem]">
        🕘 버전 이력 ({versions.length}개 버전) — 최신 v{versions[0].version_no}
      </summary>
      <table className="data-table mt-2" aria-label="분석 버전 이력">
        <caption className="sr-only">분석 버전 이력</caption>
        <thead>
          <tr><th scope="col">버전</th><th scope="col">변경 내용</th><th scope="col">작성</th><th scope="col">일시</th></tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version_no}>
              <td className="font-semibold tabular-nums">v{v.version_no}</td>
              <td className="text-[0.78rem]">{v.changelog ?? "—"}</td>
              <td className="text-[0.75rem]">{v.created_by}</td>
              <td className="text-[0.75rem] tabular-nums">{v.created_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/* ═══════════════ 8단계 리포트 ═══════════════ */

function StepSection({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={`단계 ${n}: ${title}`} className="market-section sizing-step">
      <h3 className="sizing-step-title text-[0.95rem]">
        <span className="sizing-step-badge">{n}</span> {title}
      </h3>
      {children}
    </section>
  );
}

function SizingReport({ detail, matrix, analysisId, isFrozen, stepSummaries }: {
  detail: IndustryDetail;
  matrix: SizingMatrix;
  analysisId: string | null;
  isFrozen: boolean;
  stepSummaries: Array<{ step: number; summary: string; source: string; pendingInputs: string[] }> | null;
}) {
  const [tab, setTab] = useState<"overview" | "structure" | "competitive" | "size" | "allocation" | "growth" | "pipeline" | "qualitative" | "regulation" | "risk" | "validate">("overview");
  const proj2030Total = matrix.regions.reduce((sum, r) => sum + regionTotal(matrix, r.code, 4), 0);
  const TABS = [
    ["overview", "개요"],
    ["structure", "시장 구조"],
    ["competitive", "경쟁 구조"],
    ["size", "시장 규모"],
    ["allocation", "권역·세그먼트"],
    ["growth", "성장성"],
    ["pipeline", "수요 파이프라인"],
    ["qualitative", "정성 분석"],
    ["regulation", "규제 환경"],
    ["risk", "신뢰도·리스크"],
    ["validate", "검증·한계"],
  ] as const;
  return (
    <div className="sizing-report text-[0.88rem]">
      <div className="library-tabs" role="tablist" aria-label="리포트 섹션">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`library-tab ${tab === key ? "library-tab-active" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section aria-label="개요" className="market-section sizing-step">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">★</span> 핵심 요약
          </h3>
          <div className="summary-cards">
            <div className="summary-card glass">
              <span className="summary-value mono-num">${matrix.anchor.total.toFixed(2)}B</span>
              <span className="text-label">기준 시장규모 (2026)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{(matrix.consistency.bottomUpCagr * 100).toFixed(1)}%</span>
              <span className="text-label">성장률 (연평균, 2026→2030)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">${proj2030Total.toFixed(2)}B</span>
              <span className="text-label">2030 전망 (기본 시나리오)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{matrix.chainGrade.grade}</span>
              <span className="text-label">체인 등급 (통계 hop {matrix.chainGrade.statisticalHops}개)</span>
            </div>
          </div>
          <ul className="sizing-note-list mt-3">
            <li>분석 방법: systematic-market-sizing v1.1 — {isFrozen ? `동결 연구문서 기반(${SIZING_SOURCE_DOC})` : "8단계 파이프라인 산출(LLM 추정 포함, 분석가 확정 전)"}</li>
            <li>세그먼트: {segmentsOf(matrix).map((x) => x.label).join(" / ")} — 권역 {matrix.regions.length}개</li>
            <li>시나리오: 비관/기본/낙관 CAGR 밴드 — 세부는 <strong>성장성</strong> 탭</li>
            <li>경쟁 구조 — 세부는 <strong>경쟁 구조</strong> 탭 · 기회/위험 요인 — <strong>정성 분석</strong> 탭</li>
          </ul>
        </section>
      )}

      {tab !== "overview" && (
      <>
      {tab === "structure" && (
      <>
      <StepSection n={1} id="step-1" title="시장 구조 정의 (분석 축·산업 사슬 방향)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          시장을 <strong>권역 × 최종수요 세그먼트 × 시나리오</strong> 3축으로 나누고, 산업이 가치사슬에서
          어디에 위치하는지(상류·중류·하류)에 따라 분석 방향을 정합니다 — 하류 산업은 전방/전전방(수요처)을,
          상류 산업은 후방/후후방(공급처)을 분석해야 수요·공급 구조가 온전히 파악됩니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <table className="data-table sizing-axes-table" aria-label="분석 축 정의">
              <caption className="sr-only">분석 축 정의</caption>
              <thead><tr><th scope="col">구분</th><th scope="col">값</th></tr></thead>
              <tbody>
                <tr><td className="font-semibold">권역 (Region)</td><td>{matrix.regions.map((r) => r.label).join(" / ")} ({matrix.regions.length}개)</td></tr>
                <tr><td className="font-semibold">최종수요 세그먼트</td><td>{segmentsOf(matrix).map((seg) => seg.label).join(" / ")} ({segmentsOf(matrix).length}개)</td></tr>
                <tr><td className="font-semibold">시나리오</td><td>비관 / 기본 / 낙관 (3개, CAGR 밴드)</td></tr>
              </tbody>
            </table>
          </div>
          <div className="chart-half sizing-grade-card">
            <span className="status-chip status-amber">체인 등급 {matrix.chainGrade.grade}</span>
            <p className="mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">{matrix.chainGrade.note}</p>
            <p className="mt-1 text-[0.78rem]">통계 hop {matrix.chainGrade.statisticalHops}개 · 분석 hop은 등급에 불가산</p>
          </div>
        </div>
        <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">
          산업 사슬 방향 — 위치: {POSITION_LABELS[matrix.chainDirection.position] ?? matrix.chainDirection.position}
        </h4>
        <table className="data-table" aria-label="산업 사슬 방향 분석">
          <caption className="sr-only">산업 사슬 방향 분석</caption>
          <thead>
            <tr><th scope="col" className="w-[8rem]">방향</th><th scope="col">인접 산업</th><th scope="col">분석 포인트</th></tr>
          </thead>
          <tbody>
            {matrix.chainDirection.relatedIndustries.map((r, i) => (
              <tr key={i}>
                <td className="font-semibold">{r.relation}</td>
                <td>{r.name}</td>
                <td className="text-[0.8rem] text-[color:var(--muted-fg)]">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sizing-note-list mt-2 text-[0.8rem] text-[color:var(--muted-fg)]">{matrix.chainDirection.note}</p>

        {/* 가치사슬 구조 — 프록시 체인 링크 + 등급 (S1 산출물) */}
        <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">가치사슬 구조 — 프록시 체인 링크</h4>
        {detail.chain.links.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
            이 산업에 연결된 프록시 체인 링크가 없습니다. 신규 분석 산업은 드라이버 민감도가 구조 증거를 대신합니다.
          </p>
        ) : (
          <div className="table-scroll">
          <table className="data-table report-table" aria-label="가치사슬 프록시 체인 링크">
            <caption className="sr-only">가치사슬 프록시 체인 링크</caption>
            <thead>
              <tr><th scope="col" className="w-[8rem]">방향</th><th scope="col">산업</th><th scope="col">hop</th><th scope="col">계수/β</th><th scope="col">시차(월)</th><th scope="col">근거</th></tr>
            </thead>
            <tbody>
              {detail.chain.links.map((l, i) => (
                <tr key={`${l.industry_id}-${l.direction}-${i}`}>
                  <td className="font-semibold">{l.direction === "upstream" ? "후방 (공급처)" : "전방 (수요처)"}</td>
                  <td>{l.name_ko}</td>
                  <td>{l.hop_type === "engineering" ? "engineering" : "statistical"}</td>
                  <td className="tabular-nums">{l.hop_type === "engineering" ? l.coefficient : l.beta !== null ? `β ${l.beta} (R² ${l.r2})` : "—"}</td>
                  <td className="tabular-nums">{l.lag_months ?? "—"}</td>
                  <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{l.evidence_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {detail.chain.grade && (
          <p className="mt-1 text-[0.8rem] text-[color:var(--muted-fg)]">
            <span className="status-chip status-green mr-1">체인 등급 {detail.chain.grade.reliability_grade}</span>
            {detail.chain.grade.grade_rationale}
          </p>
        )}

        <StepSensitivityChart sensitivities={detail.driver_sensitivities} />
      </StepSection>
      </>
      )}

      {tab === "competitive" && (
        <section aria-label="경쟁 구조" className="market-section sizing-step">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">2-A</span> 경쟁 구조 — 시장 집중도와 주요 기업
          </h3>
        {/* S1 competitive-intelligence 산출 — S1 competitive-intelligence 산출 (구형 매트릭스에는 없음) */}
        {matrix.competitive && (
          <>
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">경쟁 구조</h4>
            <p className="mb-1 text-[0.85rem]">{matrix.competitive.structure}</p>
            {matrix.competitive.players.length > 0 && (
              <div className="table-scroll">
              <table className="data-table report-table" aria-label="경쟁 구조 — 주요 기업">
                <caption className="sr-only">경쟁 구조 주요 기업</caption>
                <thead>
                  <tr><th scope="col" className="col-label">기업</th><th scope="col" className="col-type">포지션</th><th scope="col">기술 유형</th><th scope="col">용량 (MWe)</th><th scope="col">진행 상태</th><th scope="col" className="col-text">비고</th></tr>
                </thead>
                <tbody>
                  {matrix.competitive.players.map((pl) => (
                    <tr key={pl.name}>
                      <td className="font-semibold">{pl.name}</td>
                      <td>
                        <span className={`status-chip ${pl.tier === "leader" ? "status-green" : pl.tier === "challenger" ? "status-amber" : "status-not-started"}`}>
                          {pl.tier === "leader" ? "리더" : pl.tier === "challenger" ? "도전자" : "니치"}
                        </span>
                      </td>
                      <td>{pl.techType ?? "—"}</td>
                      <td className="tabular-nums">{pl.capacityMWe !== undefined ? pl.capacityMWe.toLocaleString() : "—"}</td>
                      <td>{pl.projectStatus ? <span className="status-chip status-in-progress">{pl.projectStatus}</span> : "—"}</td>
                      <td className="text-[0.8rem] text-[color:var(--muted-fg)]">{pl.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </>
        )}
          {!matrix.competitive && (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
              경쟁 구조 데이터가 없습니다 — 재분석 시 1단계에서 도출됩니다.
            </p>
          )}
          <p className="sizing-note-list mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">
            점유율·순위는 정성 추정(공시 대조 전) — 정밀 수치는 S2~S3 이후 공시 교차검증으로 보강됩니다.
          </p>
        </section>
      )}



      {tab === "size" && (
      <>
      <StepSection n={2} id="step-2" title="기준 시장규모 산정 (다중 소스 교차)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          독립 추정치 2–3개로 기준년 총시장(2026, $B)을 삼각검증하고 이상치를 명시적으로 제외합니다.
          이후 모든 배분이 이 앵커로 수렴해야 합니다.
        </p>
        <AnchorChart matrix={matrix} />
        <ul className="sizing-note-list mt-2">
          {matrix.anchor.sources.map((s) => (
            <li key={s.label} className={s.status === "excluded" ? "text-[color:var(--muted-fg)] line-through" : ""}>
              <strong>{s.label}</strong> — ${s.estimate.toFixed(2)}B · {s.note}
            </li>
          ))}
        </ul>
      </StepSection>
      </>
      )}


      {tab === "allocation" && (
      <>
      <StepSection n={3} id="step-3" title="권역·세그먼트 배분">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          권역 가중치는 인접 공시시장 프록시에서, 세그먼트 믹스는 글로벌 교차검증치에 맞춘 보정 배분입니다.
          판단 조정은 셀별로 출처와 함께 기록됩니다(바텀업 합산이 아님).
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역 가중치 (도넛)</h4>
            <RegionWeightDonut matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 세그먼트 믹스 (100% 적층)</h4>
            <SegmentMixStack matrix={matrix} />
          </div>
        </div>
        <RegionTable matrix={matrix} />
      </StepSection>
      </>
      )}


      {tab === "growth" && (
      <>
      <StepSection n={4} id="step-4" title="셀별 CAGR·시나리오 밴드">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          권역×세그먼트 셀마다 개별 CAGR을 부여합니다(글로벌 단일 수준 아님). 시나리오 밴드는 기본값
          base×0.5 ~ base×1.55이며, <strong>소스 간 불일치가 문서화된 셀만</strong> 넓은 밴드로 대체합니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">기본 시나리오 CAGR (셀별 그룹 바)</h4>
            <CagrGroupedBar matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">2026 → 2030 전망 (권역 합계)</h4>
            <ProjectionChart matrix={matrix} />
          </div>
        </div>
        <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">시나리오 밴드 (비관~낙관, 셀별 — 문서화된 오버라이드 강조)</h4>
        <ScenarioBandChart matrix={matrix} />
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">시나리오별 2030 전망 — 권역별 CAGR 적용 (그룹 바)</h4>
            <RegionScenarioChart matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">시나리오별 2030 전망 (권역 테이블, $B)</h4>
            <RegionScenarioTable matrix={matrix} />
          </div>
        </div>
        <p className="sizing-note-list mt-2 text-[0.8rem] text-[color:var(--muted-fg)]">
          시나리오는 글로벌 단일 CAGR이 아니라 각 권역×세그먼트 셀의 비관/기본/낙관 CAGR(4년 복리)을 그대로
          적용해 계산합니다 — 권역별 성격이 시나리오 결과에 그대로 반영됩니다.
        </p>
      </StepSection>

      {/* 4-A: 방법론 8단계 번호는 유지하고 별도 영역으로 표시 */}
      <section id="yearly-share" aria-label="연도별 시장점유율 추이" className="market-section sizing-step sizing-step-deep">
        <h3 className="sizing-step-title text-[0.95rem]">
          <span className="sizing-step-badge sizing-step-badge-deep">4-A</span> 연도별 시장점유율 추이 (2026 → 2030, 기본 시나리오)
        </h3>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          각 권역×세그먼트 셀의 기본 CAGR을 연도별로 복리 적용해 권역별 시장 규모와 점유율이
          어떻게 이동하는지 연 단위로 추적합니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 점유율 추이 (적층 영역, %)</h4>
            <YearlyShareAreaChart matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 시장 규모 추이 (적층 바, $B)</h4>
            <YearlySizeStackedBar matrix={matrix} />
          </div>
        </div>
        <YearlyShareTable matrix={matrix} />
      </section>

      <StepSection n={5} id="step-5" title="성장률 정합성 확인 (바텀업 vs 탑다운)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          매트릭스를 롤업한 암시 글로벌 CAGR을 탑다운 컨센서스와 비교합니다. 허용 오차 내여도 이는
          <strong> 내부 정합성 확인</strong>일 뿐 — 양쪽 모두 같은 부류의 소스로 소급되므로 독립적 확인으로
          표현하지 않습니다.
        </p>
        <ConsistencyChart matrix={matrix} />
        <p className="sizing-note-list mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">{matrix.consistency.tolerance}</p>
        {matrix.externalForecast ? (
          <div className="chart-half sizing-grade-card mt-4">
            <h4 className="text-[0.85rem] mb-2">
              🔭 외부 미래 전망 대비 격차 분석 ({matrix.externalForecast.targetYear}년) — 과거 성장률 연장 추정 vs 외부 전망
            </h4>
            <table className="data-table" aria-label="외부 전망 대비 격차">
              <caption className="sr-only">외부 전망 대비 격차</caption>
              <thead>
                <tr><th scope="col">구분</th><th scope="col">{matrix.externalForecast.targetYear}년 시장규모</th><th scope="col">비고</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-semibold">우리 추정 (성장률 연장)</td>
                  <td className="tabular-nums">${(matrix.externalForecast.ourMarketSize ?? 0).toFixed(2)}B</td>
                  <td className="text-[0.8rem] text-[color:var(--muted-fg)]">바텀업 CAGR {(matrix.consistency.bottomUpCagr).toFixed(1)}% 적용</td>
                </tr>
                <tr>
                  <td className="font-semibold">외부 전망</td>
                  <td className="tabular-nums">${matrix.externalForecast.marketSize.toFixed(2)}B</td>
                  <td className="text-[0.8rem] text-[color:var(--muted-fg)]">{matrix.externalForecast.sourceLabel}{matrix.externalForecast.cagr ? ` · CAGR ${(matrix.externalForecast.cagr * 100).toFixed(1)}%` : ""}</td>
                </tr>
                <tr className="row-selected">
                  <td className="font-semibold">격차</td>
                  <td className="tabular-nums font-semibold">{matrix.externalForecast.gapPct !== undefined ? `${matrix.externalForecast.gapPct > 0 ? "+" : ""}${matrix.externalForecast.gapPct}%` : "—"}</td>
                  <td className="text-[0.8rem] text-[color:var(--muted-fg)]">외부 전망이 우리 추정 대비 {matrix.externalForecast.gapPct !== undefined && matrix.externalForecast.gapPct > 0 ? "높음 — 추가/강화 드라이버 개연성" : matrix.externalForecast.gapPct !== undefined && matrix.externalForecast.gapPct < 0 ? "낮음 — 기존 드라이버 약화 개연성" : "동일"} </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 mb-0 text-[0.85rem] whitespace-pre-line">{matrix.externalForecast.gapAnalysis}</p>
            {matrix.externalForecast.newDrivers && matrix.externalForecast.newDrivers.length > 0 && (
              <p className="mt-2 mb-0 text-[0.78rem]">
                <strong>과거 대비 신규·강화 드라이버:</strong>{" "}
                {matrix.externalForecast.newDrivers.map((d) => (
                  <span key={d} className="status-chip status-in-progress mr-1">{d}</span>
                ))}
              </p>
            )}
            <p className="mt-2 mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">{matrix.externalForecast.note}</p>
          </div>
        ) : (
          <p className="sizing-note-list mt-2 text-[0.8rem] text-[color:var(--muted-fg)]">
            입수된 외부 미래 전망이 없습니다 — 기존 방식(과거 성장률 연장 추정)을 유지합니다. 재분석 시 최신 공개 전망을 반영해 격차 분석이 시도됩니다.
          </p>
        )}
      </StepSection>
      </>
      )}

      {tab === "qualitative" && (
        <section aria-label="정성 분석 — 기회·위험 요인" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">5-A</span> 정성 분석 — 기회 요인과 위험 요인
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            정량 매트릭스만으로는 시장의 질적 방향이 보이지 않습니다. 이 요인들은 기회발굴(S2)의
            기회 발굴·요인 자동 도출의 입력으로 직결됩니다.
          </p>
          <div className="chart-pair">
            <div className="chart-half sizing-grade-card">
              <h4 className="text-[0.9rem] mb-2">✅ 기회 요인</h4>
              <ul className="sizing-note-list">
                {matrix.qualitative.opportunityFactors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
            <div className="chart-half sizing-grade-card">
              <h4 className="text-[0.9rem] mb-2">⚠️ 위험 요인</h4>
              <ul className="sizing-note-list">
                {matrix.qualitative.riskFactors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>
          {matrix.externalForecast?.newDrivers && matrix.externalForecast.newDrivers.length > 0 && (
            <div className="sizing-grade-card mt-3">
              <h4 className="text-[0.9rem] mb-2">🚀 외부 전망 대비 신규·강화 드라이버</h4>
              <div className="flex flex-wrap gap-1 mb-2">
                {matrix.externalForecast.newDrivers.map((d) => (
                  <span key={d} className="status-chip status-in-progress">{d}</span>
                ))}
              </div>
              {matrix.externalForecast.gapAnalysis && (
                <p className="mb-0 text-[0.85rem] whitespace-pre-line">{matrix.externalForecast.gapAnalysis}</p>
              )}
            </div>
          )}
          {matrix.qualitative.sources && matrix.qualitative.sources.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[0.85rem] text-[color:var(--accent)]">📚 입수 출처 ({matrix.qualitative.sources.length}건 — 출처 명기 필수)</summary>
              <ul className="sizing-note-list mt-2">
                {matrix.qualitative.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                    {s.snippet && <span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {tab === "pipeline" && (
        <section aria-label="수요 파이프라인" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">4-B</span> 수요 파이프라인 — 프로젝트별 신뢰도 티어
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            향후 착공·발주가 예정된 개별 프로젝트를 신뢰도 티어로 구분합니다 — <strong>Tier 1</strong>(실착공·계약 확정)부터
            <strong> Tier 4</strong>(비구속 MOU·초기 검토)까지. 티어가 낮은(숫자가 큰) 항목일수록 수요 불확실성이 크며,
            시장 추정의 상방 근거로만 취급해야 합니다.
          </p>
          {matrix.demandPipeline && matrix.demandPipeline.length > 0 ? (
            <div className="table-scroll">
            <table className="data-table report-table" aria-label="수요 파이프라인 프로젝트">
              <caption className="sr-only">수요 파이프라인 프로젝트 목록</caption>
              <thead>
                <tr><th scope="col" className="w-[6rem]">티어</th><th scope="col">프로젝트</th><th scope="col">상태</th><th scope="col">COD 목표</th><th scope="col">출처</th></tr>
              </thead>
              <tbody>
                {[...matrix.demandPipeline].sort((a, b) => a.tier - b.tier).map((p, i) => (
                  <tr key={`${p.project}-${i}`} className={p.tier === 1 ? "row-selected" : undefined}>
                    <td>
                      <span className={`status-chip ${p.tier === 1 ? "status-green" : p.tier === 2 ? "status-amber" : "status-not-started"}`}>
                        Tier {p.tier}
                      </span>
                    </td>
                    <td className="font-semibold">{p.project}</td>
                    <td className="text-[0.8rem]">{p.status}</td>
                    <td className="tabular-nums">{p.codTarget ?? "—"}</td>
                    <td className="text-[0.75rem]">
                      {p.sourceUrl ? <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문</a> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
              수요 파이프라인 데이터가 없습니다 — 재분석 또는 시드 등록 시 프로젝트별 근거가 반영됩니다.
            </p>
          )}
        </section>
      )}

      {tab === "regulation" && (
        <section aria-label="규제 환경" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">5-B</span> 규제 환경 비교 — 관할권×항목
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            국가·관할권별 규제·인허가 상태를 비교합니다. <strong>1차 소스 직접 확인</strong> 여부가 표시되며,
            미확인(간접 추정) 항목은 법률 검토 전 인용할 수 없습니다.
          </p>
          {matrix.regulatoryComparison && matrix.regulatoryComparison.length > 0 ? (
            <div className="table-scroll">
            <table className="data-table report-table" aria-label="규제 환경 비교">
              <caption className="sr-only">관할권별 규제 비교</caption>
              <thead>
                <tr><th scope="col">관할권</th><th scope="col">항목</th><th scope="col">상태</th><th scope="col">1차 소스 확인</th><th scope="col">출처·시점</th></tr>
              </thead>
              <tbody>
                {matrix.regulatoryComparison.map((r, i) => (
                  <tr key={`${r.jurisdiction}-${r.item}-${i}`}>
                    <td className="font-semibold">{r.jurisdiction}</td>
                    <td>{r.item}</td>
                    <td className="text-[0.8rem]">{r.status}</td>
                    <td>
                      <span className={`status-chip ${r.confirmedDirectly ? "status-green" : "status-not-started"}`}>
                        {r.confirmedDirectly ? "직접 확인" : "간접·추정"}
                      </span>
                    </td>
                    <td className="text-[0.75rem]">
                      {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">원문</a> : "—"}
                      {r.asOf ? ` · ${r.asOf}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
              규제 비교 데이터가 없습니다 — 재분석 또는 시드 등록 시 관할권별 규제 조사가 반영됩니다.
            </p>
          )}
        </section>
      )}

      {tab === "risk" && (
        <section aria-label="신뢰도·리스크" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">7-A</span> 신뢰도·리스크 — RAG 상한 권고·Kill Criteria·검증 원장
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            데이터 신뢰도가 전체 판단 등급을 캡핑합니다(caps the grade). 아래 Kill Criteria 제안과
            "확인 불가" 선언은 분석가 검토 대상이며, 자동 판정이 아닙니다.
          </p>
          {matrix.ragCapRecommendation && (
            <div className="sizing-grade-card mt-3">
              <h4 className="text-[0.9rem] mb-2">🚦 RAG 상한 권고</h4>
              <span className={`status-chip ${matrix.ragCapRecommendation.grade === "green" ? "status-green" : matrix.ragCapRecommendation.grade === "amber" ? "status-amber" : "status-red"}`}>
                상한 {matrix.ragCapRecommendation.grade.toUpperCase()}
              </span>
              <p className="mt-2 mb-0 text-[0.85rem]">{matrix.ragCapRecommendation.rationale}</p>
            </div>
          )}
          {matrix.killCriteriaProposals && matrix.killCriteriaProposals.length > 0 && (
            <div className="mt-3">
              <h4 className="text-[0.85rem] text-[color:var(--muted-fg)] mb-2">⚠️ Kill Criteria 제안 ({matrix.killCriteriaProposals.length}건 — 분석가 검토 필요)</h4>
              <div className="grid gap-2">
                {matrix.killCriteriaProposals.map((k, i) => (
                  <div key={i} className="sizing-grade-card">
                    <div className="flex items-center gap-2">
                      <span className={`status-chip ${k.severity === "high" ? "status-red" : k.severity === "medium" ? "status-amber" : "status-not-started"}`}>
                        {k.severity === "high" ? "심각" : k.severity === "medium" ? "보통" : "낮음"}
                      </span>
                      <strong className="text-[0.85rem]">{k.name}</strong>
                    </div>
                    <p className="mt-1 mb-0 text-[0.8rem]"><strong>기준:</strong> {k.thresholdText}</p>
                    <p className="mt-1 mb-0 text-[0.78rem] text-[color:var(--muted-fg)]">{k.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {matrix.verificationLedger && matrix.verificationLedger.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[0.85rem] text-[color:var(--accent)]">
                🔍 검증 원장 ({matrix.verificationLedger.length}건 — 확인/확인불가/판단필요)
              </summary>
              <table className="data-table mt-2" aria-label="검증 원장">
                <caption className="sr-only">주장별 검증 상태</caption>
                <thead>
                  <tr><th scope="col" className="w-[34%]">주장</th><th scope="col">상태</th><th scope="col">비고</th></tr>
                </thead>
                <tbody>
                  {matrix.verificationLedger.map((v, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{v.claim}</td>
                      <td className="sizing-verdict-cell">
                        <span className={`status-chip ${v.status === "confirmed" ? "status-green" : v.status === "could_not_verify" ? "status-red" : "status-amber"}`}>
                          {v.status === "confirmed" ? "확인" : v.status === "could_not_verify" ? "확인 불가" : "판단 필요"}
                        </span>
                      </td>
                      <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{v.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          {!matrix.ragCapRecommendation && !matrix.killCriteriaProposals && !matrix.verificationLedger && (
            <p className="text-[color:var(--muted-fg)] italic text-[0.85rem]">
              신뢰도·리스크 데이터가 없습니다 — 재분석 또는 시드 등록 시 반영됩니다.
            </p>
          )}
        </section>
      )}


      {tab === "validate" && (
      <>
      <StepSection n={6} id="step-6" title="기업 공시 교차검증">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          카테고리 내 상장사의 연차보고서·중간보고서 원문으로 매트릭스의 각 주장을 검증합니다.
          구조적으로 검증 불가능한 항목은 <strong>검증 불가</strong>로 명시합니다(탐색 실패가 아닌 공시 구조의 한계).
        </p>
        <div className="table-scroll">
        <table className="data-table report-table" aria-label="기업 공시 교차검증 결과">
          <caption className="sr-only">기업 공시 교차검증 결과</caption>
          <thead>
            <tr><th scope="col" className="w-[34%]">매트릭스 주장</th><th scope="col">판정</th><th scope="col">1차 소스 근거</th></tr>
          </thead>
          <tbody>
            {matrix.crossValidation.map((v) => {
              const meta = VALIDATION_STATUS_META[v.status] ?? VALIDATION_STATUS_META.directional;
              return (
                <tr key={v.claim}>
                  <td className="font-semibold">{v.claim}</td>
                  <td className="sizing-verdict-cell"><span className={`status-chip ${meta.chip}`}>{meta.label}</span></td>
                  <td className="text-[0.78rem]">{v.evidence}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </StepSection>

      <StepSection n={7} id="step-7" title="분석 한계 목록">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          판단적 보정·소스 불일치·추정 불가 신호를 번호 붙여 고정합니다. 소비자는 이 목록 없이 매트릭스를
          인용할 수 없습니다.
        </p>
        <ol className="sizing-limitations">
          {matrix.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ol>
        {matrix.sectionConfidence && matrix.sectionConfidence.length > 0 && (
          <>
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">섹션별 데이터 신뢰도 등급 (A 확정 ~ D 추정 불가)</h4>
            <table className="data-table" aria-label="섹션별 신뢰도 등급">
              <caption className="sr-only">섹션별 데이터 신뢰도 등급</caption>
              <thead>
                <tr><th scope="col">섹션</th><th scope="col">등급</th><th scope="col">비고</th></tr>
              </thead>
              <tbody>
                {matrix.sectionConfidence.map((s, i) => (
                  <tr key={i}>
                    <td className="font-semibold">{s.section}</td>
                    <td>
                      <span className={`status-chip ${s.grade === "A" || s.grade === "B" ? "status-green" : s.grade === "B-" || s.grade === "C" ? "status-amber" : "status-red"}`}>
                        {s.grade}
                      </span>
                    </td>
                    <td className="text-[0.78rem] text-[color:var(--muted-fg)]">{s.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </StepSection>

      <StepSection n={8} id="step-8" title="가정 레지스트리 등록">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.85rem]">
          동결된 매트릭스는 assumption 레지스트리에 조합당 1 row(kind='assumed', rationale + anchor_ref + TTL)로
          등록됩니다. 레지스트리는 append-only — 수정은 새 row로 기록됩니다. 아래는 실제 등록 상태(라이브 조회)입니다.
        </p>
        <RegistryStatus
          sizing={isFrozen ? detail.sizing : null}
          isFrozen={isFrozen}
          referenceImplementation={REGISTRY.referenceImplementation}
        />
      </StepSection>

      {stepSummaries && stepSummaries.length > 0 && (
        <details className="market-section sizing-step">
          <summary className="cursor-pointer text-[0.85rem]">📝 파이프라인 단계별 분석 노트 ({stepSummaries.length}단계)</summary>
          <ol className="mt-3 space-y-2 text-[0.85rem]">
            {stepSummaries.map((s) => (
              <li key={s.step}>
                <strong>{s.step}. {STEPS[s.step - 1]?.title ?? s.step}</strong>{" "}
                <span className={`status-chip ${s.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
                  {s.source === "llm" ? "LLM 요약" : "결정론 요약"}
                </span>
                <br />{s.summary}
              </li>
            ))}
          </ol>
        </details>
      )}
      </>
      )}
      </>
      )}
    </div>
  );
}

/* ── 단계별 차트 ── */

function StepSensitivityChart({ stepNumber, sensitivities }: { stepNumber?: number; sensitivities: DriverSensitivity[] }) {
  const ct = useChartTheme();
  const agg = new Map<string, number>();
  for (const ds of sensitivities) {
    if (!agg.has(ds.driver_label)) agg.set(ds.driver_label, 0);
    agg.set(ds.driver_label, Math.max(agg.get(ds.driver_label)!, Math.abs(ds.sensitivity)));
  }
  const labels = [...agg.keys()];
  const values = labels.map((l) => Math.round((agg.get(l) ?? 0) * 100) / 100);
  if (labels.length === 0) return <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">기록된 드라이버 민감도가 없습니다.</p>;
  const option = {
    grid: { left: 140, right: 40, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: labels, axisLabel: { color: ct.muted, width: 120, overflow: "truncate" as const } },
    series: [{ type: "bar" as const, data: values, itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] }, barMaxWidth: 22 }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return (
    <div className="mt-4">
      {stepNumber !== undefined && <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">주요 드라이버 민감도 (민감도 절댓값 ≥ 0.3 → 주요 드라이버)</h4>}
      <EChart option={option} height={Math.max(140, labels.length * 40 + 48)} />
    </div>
  );
}

function AnchorChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option = {
    grid: { left: 170, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: {
      type: "category" as const,
      data: matrix.anchor.sources.map((s) => s.label),
      axisLabel: { color: ct.muted, width: 150, overflow: "truncate" as const },
    },
    series: [
      {
        type: "bar" as const,
        data: matrix.anchor.sources.map((s) => ({
          value: s.estimate,
          itemStyle: { color: s.status === "excluded" ? ct.muted : ct.color[0], opacity: s.status === "excluded" ? 0.4 : 1, borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 24,
        markLine: {
          symbol: "none",
          data: [{ xAxis: matrix.anchor.total, label: { formatter: `앵커 $${matrix.anchor.total.toFixed(2)}B`, color: ct.muted }, lineStyle: { color: ct.color[3], type: "dashed" as const, width: 2 } }],
        },
      },
    ],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={170} />;
}

function RegionWeightDonut({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option: Record<string, unknown> = {
    tooltip: { trigger: "item", formatter: (p: { name?: string; percent?: number }) => `${p.name}: ${p.percent}%` },
    legend: { bottom: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    series: [{
      type: "pie" as const,
      radius: ["42%", "70%"],
      center: ["50%", "44%"],
      label: { color: ct.muted, formatter: "{d}%", fontSize: 10 },
      data: matrix.regions.map((r, i) => ({ name: r.label, value: r.weight, itemStyle: { color: ct.color[i % ct.color.length] } })),
    }],
  };
  return <EChart option={option as never} height={280} />;
}

function SegmentMixStack({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const segs = segmentsOf(matrix);
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, max: 100, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: segs.map((seg, i) => ({
      name: seg.label,
      type: "bar" as const,
      stack: "mix",
      data: [...matrix.regions].reverse().map((r) => r.mix[seg.code]),
      itemStyle: { color: ct.color[SEGMENT_COLORS[i]] },
      barMaxWidth: 22,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, valueFormatter: (v: unknown) => `${Number(v)}%` },
  };
  return <EChart option={option} height={280} />;
}

function RegionTable({ matrix }: { matrix: SizingMatrix }) {
  const segs = segmentsOf(matrix);
  return (
    <table className="data-table mt-3" aria-label="권역×세그먼트 배분표">
      <caption className="sr-only">권역×세그먼트 배분 및 2026 기준선</caption>
      <thead>
        <tr>
          <th scope="col">권역</th><th scope="col">가중치</th>
          {segs.map((seg) => <th key={seg.code} scope="col">{seg.label}</th>)}
          <th scope="col">2026 ($B)</th><th scope="col">주요 조정</th>
        </tr>
      </thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            <td className="tabular-nums">{r.weight}%</td>
            {segs.map((seg) => <td key={seg.code} className="tabular-nums">{r.mix[seg.code] ?? 0}%</td>)}
            <td className="tabular-nums">{regionTotal(matrix, r.code, 0).toFixed(3)}</td>
            <td className="text-[0.75rem] text-[color:var(--muted-fg)]">{r.adjustment}</td>
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌</td>
          <td className="tabular-nums">100%</td>
          {(() => {
            const g = global2026(matrix);
            return (
              <>
                {segs.map((seg) => (
                  <td key={seg.code} className="tabular-nums">{Math.round(((g[seg.code] ?? 0) / g.total) * 1000) / 10}%</td>
                ))}
                <td className="tabular-nums font-semibold">{g.total.toFixed(2)} (앵커 ${matrix.anchor.total.toFixed(2)})</td>
              </>
            );
          })()}
          <td />
        </tr>
      </tbody>
    </table>
  );
}

function CagrGroupedBar({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const segs = segmentsOf(matrix);
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: segs.map((seg, i) => ({
      name: seg.label,
      type: "bar" as const,
      data: [...matrix.regions].reverse().map((r) => matrix.cagrBase[r.code]?.[seg.code] ?? 0),
      itemStyle: { color: ct.color[SEGMENT_COLORS[i]], borderRadius: [0, 3, 3, 0] },
      barMaxWidth: 12,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, valueFormatter: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%` },
  };
  return <EChart option={option} height={280} />;
}

function ProjectionChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const proj = projection2030(matrix);
  const totals2026 = matrix.regions.map((r) => r3(regionTotal(matrix, r.code, 0)));
  const totals2030 = matrix.regions.map((r) => {
    const m = proj[r.code];
    return r3(segmentsOf(matrix).reduce((sum, seg) => sum + (m[seg.code] ?? 0), 0));
  });
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: [
      { name: "2026", type: "bar" as const, data: [...totals2026].reverse(), itemStyle: { color: ct.color[0], opacity: 0.55, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
      { name: "2030 (기본)", type: "bar" as const, data: [...totals2030].reverse(), itemStyle: { color: ct.color[3], borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
    ],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={280} />;
}

function ScenarioBandChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const rows = matrix.regions.flatMap((r) => segmentsOf(matrix).map((seg) => {
    const b = bandFor(matrix, r.code, seg.code);
    const isOverride = !!matrix.bandOverrides?.[`${r.code}|${seg.code}`];
    return { label: `${r.label} · ${seg.label}`, down: b.down, up: b.up, isOverride };
  }));
  const option = {
    grid: { left: 150, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `${(Number(v) * 100).toFixed(0)}%`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: rows.map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 9.5 } },
    series: [
      { type: "bar" as const, stack: "band", data: rows.map((r) => r.down), itemStyle: { color: "transparent" }, barMaxWidth: 12, silent: true, tooltip: { show: false } },
      {
        type: "bar" as const,
        stack: "band",
        data: rows.map((r) => ({
          value: Math.round((r.up - r.down) * 10000) / 10000,
          itemStyle: { color: r.isOverride ? ct.color[3] : ct.color[1], opacity: r.isOverride ? 1 : 0.65, borderRadius: 3 },
        })),
        barMaxWidth: 12,
        tooltip: { show: true },
      },
    ],
    tooltip: {
      trigger: "item" as const,
      formatter: (p: unknown) => {
        const r = rows[(p as { dataIndex: number }).dataIndex];
        return `${r.label}<br/>비관 ${(r.down * 100).toFixed(1)}% ~ 낙관 ${(r.up * 100).toFixed(1)}%${r.isOverride ? "<br/><strong>문서화된 소스 불일치 → 넓은 밴드</strong>" : ""}`;
      },
    },
  };
  return <EChart option={option} height={Math.max(280, rows.length * 17 + 48)} />;
}

const SCENARIOS_META = [
  { key: "down" as const, label: "비관" },
  { key: "base" as const, label: "기본" },
  { key: "up" as const, label: "낙관" },
];

function RegionScenarioChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option = {
    grid: { left: 110, right: 40, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `$${Number(v)}`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...matrix.regions].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: SCENARIOS_META.map((s) => ({
      name: s.label,
      type: "bar" as const,
      data: [...matrix.regions].reverse().map((r) => r3(regionTotal(matrix, r.code, 4, s.key))),
      itemStyle: {
        color: s.key === "base" ? ct.color[0] : s.key === "up" ? ct.color[3] : ct.color[1],
        opacity: s.key === "base" ? 1 : 0.6,
        borderRadius: [0, 3, 3, 0],
      },
      barMaxWidth: 12,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={280} />;
}

function RegionScenarioTable({ matrix }: { matrix: SizingMatrix }) {
  const globals = SCENARIOS_META.map((s) => matrix.regions.reduce((a, r) => a + regionTotal(matrix, r.code, 4, s.key), 0));
  return (
    <table className="data-table" aria-label="시나리오별 권역 2030 전망">
      <caption className="sr-only">시나리오별 권역 2030 전망</caption>
      <thead><tr><th scope="col">권역</th><th scope="col">비관</th><th scope="col">기본</th><th scope="col">낙관</th></tr></thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            {SCENARIOS_META.map((s) => (
              <td key={s.key} className="tabular-nums">{r3(regionTotal(matrix, r.code, 4, s.key)).toFixed(3)}</td>
            ))}
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌</td>
          {globals.map((g, i) => (
            <td key={i} className="tabular-nums font-semibold">{r3(g).toFixed(2)}</td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/* ── 4-A 연도별 시장점유율 (기본 시나리오, 셀 CAGR 연간 복리) ── */
const YEARS = [2026, 2027, 2028, 2029, 2030];

function yearlyShareMatrix(matrix: SizingMatrix): { years: number[]; shares: Record<string, number[]>; totals: number[] } {
  const shares: Record<string, number[]> = {};
  const totals = YEARS.map(() => 0);
  for (const r of matrix.regions) {
    shares[r.code] = YEARS.map((_, y) => regionTotal(matrix, r.code, y));
    totals.forEach((_, y) => { totals[y] += shares[r.code][y]; });
  }
  for (const r of matrix.regions) {
    shares[r.code] = shares[r.code].map((v, y) => Math.round((v / totals[y]) * 1000) / 10);
  }
  return { years: YEARS, shares, totals: totals.map((t) => Math.round(t * 100) / 100) };
}

function YearlyShareAreaChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const { shares } = yearlyShareMatrix(matrix);
  const option = {
    grid: { left: 48, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: YEARS.map(String), boundaryGap: false, axisLabel: { color: ct.muted } },
    yAxis: { type: "value" as const, max: 100, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: matrix.regions.map((r, i) => ({
      name: r.label,
      type: "line" as const,
      stack: "share",
      data: shares[r.code],
      areaStyle: { opacity: 0.75 },
      lineStyle: { width: 1 },
      itemStyle: { color: ct.color[i % ct.color.length] },
      symbol: "none" as const,
    })),
    tooltip: { trigger: "axis" as const, valueFormatter: (v: unknown) => `${Number(v)}%` },
  };
  return <EChart option={option} height={300} />;
}

function YearlySizeStackedBar({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option = {
    grid: { left: 48, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: YEARS.map(String), axisLabel: { color: ct.muted } },
    yAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: matrix.regions.map((r, i) => ({
      name: r.label,
      type: "bar" as const,
      stack: "size",
      data: YEARS.map((_, y) => Math.round(regionTotal(matrix, r.code, y) * 100) / 100),
      itemStyle: { color: ct.color[i % ct.color.length] },
      barMaxWidth: 42,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={300} />;
}

function YearlyShareTable({ matrix }: { matrix: SizingMatrix }) {
  const { years, shares, totals } = yearlyShareMatrix(matrix);
  return (
    <table className="data-table mt-3" aria-label="연도별 권역 점유율">
      <caption className="sr-only">연도별 권역 점유율 및 글로벌 총시장</caption>
      <thead>
        <tr>
          <th scope="col">권역</th>
          {years.map((y) => <th key={y} scope="col">{y} 점유율</th>)}
        </tr>
      </thead>
      <tbody>
        {matrix.regions.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            {years.map((_, y) => (
              <td key={y} className="tabular-nums">{shares[r.code][y].toFixed(1)}%</td>
            ))}
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌 총시장 ($B)</td>
          {totals.map((t, y) => <td key={y} className="tabular-nums font-semibold">{t.toFixed(2)}</td>)}
        </tr>
      </tbody>
    </table>
  );
}

function ConsistencyChart({ matrix }: { matrix: SizingMatrix }) {
  const ct = useChartTheme();
  const option = {
    grid: { left: 130, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, min: 0, max: 8, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: ["매트릭스 롤업 (바텀업)", "컨센서스 (탑다운)"], axisLabel: { color: ct.muted, fontSize: 10 } },
    series: [{
      type: "bar" as const,
      data: [
        { value: matrix.consistency.bottomUpCagr, itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] } },
        { value: matrix.consistency.topDownCagr, itemStyle: { color: ct.color[2], opacity: 0.6, borderRadius: [0, 4, 4, 0] } },
      ],
      barMaxWidth: 26,
      label: { show: true, position: "right" as const, formatter: "{c}%", color: ct.muted, fontSize: 11 },
    }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={140} />;
}

function RegistryStatus({ sizing, isFrozen, referenceImplementation }: {
  sizing: IndustryDetail["sizing"];
  isFrozen: boolean;
  referenceImplementation: string;
}) {
  const counts = useMemo(() => {
    const byPrefix: { baseline_2026: number; cagr: number } = { baseline_2026: 0, cagr: 0 };
    for (const a of sizing?.assumptions ?? []) {
      if (a.assumption_key.includes(".baseline_2026.")) byPrefix.baseline_2026++;
      else if (a.assumption_key.includes(".cagr.")) byPrefix.cagr++;
    }
    return { ...byPrefix, total: sizing?.assumptions.length ?? 0 };
  }, [sizing]);

  if (!isFrozen || !sizing) {
    return (
      <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">
        아직 가정 레지스트리에 등록되지 않았습니다. 분석 확정 후 {referenceImplementation} 패턴으로
        recordAssumption 등록하면 이 화면에 등록 상태가 표시됩니다.
      </p>
    );
  }
  const ok = counts.baseline_2026 === REGISTRY.expectedRows.baseline && counts.cagr === REGISTRY.expectedRows.cagr;
  return (
    <div>
      <div className="driver-derivation mb-3">
        <div className="driver-derivation-step">
          <span className={`status-chip ${ok ? "status-green" : "status-amber"}`}>{ok ? "등록 완료" : "불일치"}</span>
          <span>run <code className="text-[0.72rem]">{sizing.run_label}</code></span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">baseline {counts.baseline_2026}/{REGISTRY.expectedRows.baseline}</span>
          <span>2026 기준선 ($B)</span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">cagr {counts.cagr}/{REGISTRY.expectedRows.cagr}</span>
          <span>비관/기본/낙관 밴드</span>
        </div>
      </div>
      <p className="text-[0.78rem] text-[color:var(--muted-fg)]">
        총 {counts.total} row · 전부 kind='assumed' (rationale + anchor_ref 필수, FR-DATA-07) · TTL {REGISTRY.ttlDays}일 ·
        append-only (수정 = 새 row)
      </p>
      <details className="mt-2">
        <summary className="text-[0.8rem] cursor-pointer text-[color:var(--accent)]">등록 row 전체 보기 ({counts.total}개)</summary>
        <table className="data-table mt-2" aria-label="레지스트리 등록 row">
          <caption className="sr-only">레지스트리 등록 row 목록</caption>
          <thead>
            <tr><th scope="col">assumption_key</th><th scope="col">kind</th><th scope="col">value</th><th scope="col">anchor_ref</th><th scope="col">TTL</th></tr>
          </thead>
          <tbody>
            {sizing.assumptions.map((a) => (
              <tr key={a.assumption_key}>
                <td><code className="text-[0.72rem]">{a.assumption_key}</code></td>
                <td><span className="status-chip status-in-progress">{a.kind}</span></td>
                <td className="tabular-nums">{a.value}</td>
                <td className="text-[0.72rem]">{a.anchor_ref ?? "—"}</td>
                <td className="tabular-nums">{a.ttl_days ?? "—"}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={null}>
      <MarketView />
    </Suspense>
  );
}
