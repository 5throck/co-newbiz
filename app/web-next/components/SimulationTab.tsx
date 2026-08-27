"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  type ProvenanceMeta,
  type RunSummary,
  type SimulationResultsResponse,
  type SimulationRunResult,
} from "../lib/api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";
import { SimulationDistChart, type SimMetric } from "./SimulationDistChart.tsx";

// 시뮬레이션 (Simulation) tab — ui-spec §2 batch 3. Seeded Monte Carlo over
// a run's input snapshot (ADR-0026): POST /api/simulations composes the
// scenario from the run's sim.* inputs plus the project's contingent
// liabilities, then GET /api/simulations/:id/results renders the quantile
// summary — raw draws are never exposed (retention_policy archives them;
// the permanent record is the summary), and that honesty note renders in
// the results header along with seed/iterations read from the envelope
// meta. Omitted seed defaults to a value derived from the run's
// input_hash (identical inputs stay reproducible) — noted next to the
// form. 400 simulation_rejected is a caller-fixable input contract (e.g.
// missing sim.* keys), so the server's message is shown verbatim.

function num(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}

export function SimulationTab({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runId, setRunId] = useState("");
  const [iterations, setIterations] = useState("");
  const [seed, setSeed] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<SimulationResultsResponse | null>(null);
  const [meta, setMeta] = useState<ProvenanceMeta>({});
  // Seed/iterations shown in the results header come from the envelope meta
  // (the endpoint's documented contract), not from re-deriving them.
  const [metaSeed, setMetaSeed] = useState<number | null>(null);
  const [metaIterations, setMetaIterations] = useState<number | null>(null);

  useEffect(() => {
    setRuns(null);
    setResults(null);
    setRunId("");
    api
      .get<RunSummary[]>(`/api/projects/${projectId}/runs`)
      .then((res) => {
        setRuns(res.data);
        // Default to the newest run — the list is ordered newest-first.
        if (res.data.length > 0) setRunId(res.data[0].id);
      })
      .catch(() => setRuns([]));
  }, [projectId]);

  async function runSimulation(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setResults(null);
    if (!runId) {
      setFormError("실행을 선택하세요.");
      return;
    }
    const body: { run_id: string; iterations?: number; seed?: number } = { run_id: runId };
    if (iterations.trim() !== "") {
      const n = Number(iterations);
      if (!Number.isInteger(n) || n < 1) {
        setFormError("반복 횟수는 1 이상의 정수여야 합니다.");
        return;
      }
      body.iterations = n;
    }
    if (seed.trim() !== "") {
      const s = Number(seed);
      if (!Number.isInteger(s) || s < 0) {
        setFormError("시드는 0 이상의 정수여야 합니다.");
        return;
      }
      body.seed = s;
    }
    setSubmitting(true);
    try {
      const post = await api.post<SimulationRunResult>("/api/simulations", body);
      const res = await api.get<SimulationResultsResponse>(
        `/api/simulations/${encodeURIComponent(post.data.simulation_id)}/results`,
      );
      setResults(res.data);
      setMeta({
        as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined,
        run_id: res.data.simulation.run_id,
      });
      setMetaSeed(typeof res.meta.seed === "number" ? res.meta.seed : res.data.simulation.seed);
      setMetaIterations(typeof res.meta.iterations === "number" ? res.meta.iterations : res.data.simulation.iterations);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setFormError(`권한 없음 — 시뮬레이션 실행은 분석가(analyst) 역할 이상만 가능합니다. (${err.message})`);
      } else if (err instanceof ApiError && err.status === 400) {
        // simulation_rejected / invalid_request — caller-fixable input contract.
        setFormError(err.message);
      } else if (err instanceof ApiError && err.status >= 500) {
        setFormError(`시뮬레이션 엔진 오류 — ${err.message}`);
      } else {
        setFormError("시뮬레이션 실행에 실패했습니다.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (runs === null) {
    return (
      <div className="simulation-tab">
        <p>불러오는 중...</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="simulation-tab">
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 시뮬레이션할 실행이 없습니다. 모델 탭에서 실행을 먼저 생성하세요.</p>
      </div>
    );
  }

  return (
    <div className="simulation-tab">
      <section aria-label="시뮬레이션 실행">
        <h2>몬테카를로 시뮬레이션</h2>
        <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
          시나리오는 실행의 sim.* 입력과 프로젝트의 우발채무로 구성됩니다. 시드를 비우면 입력 해시에서 파생된 기본
          시드가 사용됩니다 — 동일한 입력은 항상 동일한 결과를 냅니다.
        </p>
        <form onSubmit={runSimulation} className="run-form">
          <div className="run-form-row">
            <label htmlFor="simRun">대상 실행</label>
            <select id="simRun" value={runId} onChange={(e) => setRunId(e.target.value)}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label ?? r.id}
                </option>
              ))}
            </select>
          </div>
          <div className="run-form-row">
            <label htmlFor="simIterations">반복 횟수 (선택)</label>
            <input
              id="simIterations"
              inputMode="numeric"
              placeholder="기본값 사용"
              value={iterations}
              onChange={(e) => setIterations(e.target.value)}
            />
          </div>
          <div className="run-form-row">
            <label htmlFor="simSeed">시드 (선택)</label>
            <input
              id="simSeed"
              inputMode="numeric"
              placeholder="입력 해시에서 파생"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "실행 중..." : "시뮬레이션 실행"}
          </button>
        </form>
        {formError && (
          <p role="alert" className="text-[color:var(--red-fg)]">
            {formError}
          </p>
        )}
      </section>

      {results && (
        <section aria-label="시뮬레이션 결과">
          <h2>결과 — 분위수 요약</h2>
          <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
            시드 {metaSeed ?? "—"} · 반복 {metaIterations ?? "—"}회 · 할인율{" "}
            {num(results.simulation.discount_rate)} · 생성{" "}
            {new Date(results.simulation.created_at).toLocaleString("ko-KR")}
          </p>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
            원시 드로우(raw draws)는 보존 정책에 따라 아카이브되며 화면에 제공되지 않습니다 — 영구 기록은 이 분위수
            요약입니다.
          </p>
          {results.results.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 이 시뮬레이션에 결과 행이 없습니다.</p>
          ) : (
            <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
              <caption className="sr-only">시뮬레이션 분위수 요약</caption>
              <thead>
                <tr>
                  <th scope="col">지표</th>
                  <th scope="col">P05</th>
                  <th scope="col">P50 (중앙값)</th>
                  <th scope="col">P95</th>
                  <th scope="col">평균</th>
                  <th scope="col">표준편차</th>
                </tr>
              </thead>
              <tbody>
                {results.results.map((r) => (
                  <tr key={r.metric}>
                    <td>{r.metric}</td>
                    <td>
                      <SourceTooltip provenance={meta}>{num(r.p05)}</SourceTooltip>
                    </td>
                    <td>
                      <SourceTooltip provenance={meta}>{num(r.p50)}</SourceTooltip>
                    </td>
                    <td>
                      <SourceTooltip provenance={meta}>{num(r.p95)}</SourceTooltip>
                    </td>
                    <td>
                      <SourceTooltip provenance={meta}>{num(r.mean)}</SourceTooltip>
                    </td>
                    <td>
                      <SourceTooltip provenance={meta}>{num(r.std)}</SourceTooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <SimulationDistChart
            results={results.results as unknown as SimMetric[]}
            seed={metaSeed ?? results.simulation.run_id}
          />
        </section>
      )}
    </div>
  );
}
