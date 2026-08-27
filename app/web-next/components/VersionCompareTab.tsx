"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type ProvenanceMeta, type RunDiff, type RunSummary } from "../lib/api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";
import { EnginePendingPanel } from "./EnginePendingPanel.tsx";

// 버전 비교 (Version Comparison) tab — ui-spec §2 batch 3. Variable-level
// bridge between two runs of one project (GET /api/runs/:id/diff/:otherId):
// changed (A → B with signed delta), added (only in B), removed (only in A),
// plus both input hashes. This is the honest v1 — NPV-level decomposition
// arrives with the valuation engine, and the helper note says so in Korean.
// The waterfall-bridge visualization is deferred (no chart library in the
// SPA — noted in ui-spec §2); the table is the deliverable here.
//
// Delta direction is never color-only: ▲ 증가 / ▼ 감소 icon + Korean label
// + color together (ui-spec §1).

function num(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}

function DeltaFigure({ delta, provenance }: { delta: number; provenance: ProvenanceMeta }) {
  const up = delta > 0;
  return (
    <span className={`delta ${up ? "delta-up" : "delta-down"}`}>
      <SourceTooltip provenance={provenance}>
        <span aria-hidden="true">{up ? "▲" : "▼"}</span> {up ? "증가" : "감소"}{" "}
        {`${delta >= 0 ? "+" : ""}${num(delta)}`}
      </SourceTooltip>
    </span>
  );
}

export function VersionCompareTab({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runA, setRunA] = useState("");
  const [runB, setRunB] = useState("");
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [asOf, setAsOf] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRuns(null);
    setDiff(null);
    setError(null);
    api
      .get<RunSummary[]>(`/api/projects/${projectId}/runs`)
      .then((res) => {
        setRuns(res.data);
        // Default A vs B to the two most recent runs (list is newest-first).
        if (res.data.length >= 2) {
          setRunA(res.data[0].id);
          setRunB(res.data[1].id);
        } else if (res.data.length === 1) {
          setRunA(res.data[0].id);
        }
      })
      .catch(() => setRuns([]));
  }, [projectId]);

  useEffect(() => {
    if (!runA || !runB) {
      setDiff(null);
      return;
    }
    if (runA === runB) {
      setDiff(null);
      setError("서로 다른 두 실행을 선택하세요.");
      return;
    }
    setError(null);
    api
      .get<RunDiff>(`/api/runs/${encodeURIComponent(runA)}/diff/${encodeURIComponent(runB)}`)
      .then((res) => {
        setDiff(res.data);
        setAsOf(typeof res.meta.as_of === "string" ? res.meta.as_of : undefined);
      })
      .catch((err) => {
        setDiff(null);
        setError(err instanceof ApiError ? err.message : "비교를 불러올 수 없습니다.");
      });
  }, [runA, runB]);

  if (runs === null) {
    return (
      <div className="compare-tab">
        <p>불러오는 중...</p>
      </div>
    );
  }

  if (runs.length < 2) {
    return (
      <div className="compare-tab">
        <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 비교하려면 실행이 2개 이상 필요합니다. 모델 탭에서 실행을 생성하세요.</p>
      </div>
    );
  }

  const runLabel = (id: string) => runs.find((r) => r.id === id)?.label ?? id;

  return (
    <div className="compare-tab">
      <section aria-label="버전 비교">
        <h2>실행 비교 (A → B)</h2>
        <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
          변수 수준 브리지입니다. NPV 수준의 분해는 밸류에이션 엔진 도입과 함께 제공됩니다.
        </p>
        <div className="compare-selectors">
          <div className="run-form-row">
            <label htmlFor="runA">실행 A</label>
            <select id="runA" value={runA} onChange={(e) => setRunA(e.target.value)}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label ?? r.id}
                </option>
              ))}
            </select>
          </div>
          <div className="run-form-row">
            <label htmlFor="runB">실행 B</label>
            <select id="runB" value={runB} onChange={(e) => setRunB(e.target.value)}>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label ?? r.id}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-[color:var(--red-fg)]">
            {error}
          </p>
        )}

        {diff && (
          <>
            <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
              {runLabel(diff.run_a)} ({diff.input_hash_a.slice(0, 12)}…) → {runLabel(diff.run_b)} (
              {diff.input_hash_b.slice(0, 12)}…)
            </p>

            <h3>변경 ({diff.changed.length}건)</h3>
            {diff.changed.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">변경된 변수가 없습니다.</p>
            ) : (
              <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
                <caption className="sr-only">변경된 변수</caption>
                <thead>
                  <tr>
                    <th scope="col">가정 키</th>
                    <th scope="col">A 값</th>
                    <th scope="col">B 값</th>
                    <th scope="col">변화</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.changed.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>
                        <SourceTooltip provenance={{ assumption_key: row.key, as_of: asOf }}>{num(row.from)}</SourceTooltip>
                      </td>
                      <td>
                        <SourceTooltip provenance={{ assumption_key: row.key, as_of: asOf }}>{num(row.to)}</SourceTooltip>
                      </td>
                      <td>
                        <DeltaFigure delta={row.delta} provenance={{ assumption_key: row.key, as_of: asOf }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3>B에 신규 ({diff.added.length}건)</h3>
            {diff.added.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">신규 추가된 변수가 없습니다.</p>
            ) : (
              <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
                <caption className="sr-only">B에 신규 추가된 변수</caption>
                <thead>
                  <tr>
                    <th scope="col">가정 키</th>
                    <th scope="col">값</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.added.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>
                        <SourceTooltip provenance={{ assumption_key: row.key, as_of: asOf }}>{num(row.value)}</SourceTooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3>A에서 제거됨 ({diff.removed.length}건)</h3>
            {diff.removed.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">제거된 변수가 없습니다.</p>
            ) : (
              <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
                <caption className="sr-only">A에만 존재하고 B에서 제거된 변수</caption>
                <thead>
                  <tr>
                    <th scope="col">가정 키</th>
                    <th scope="col">값</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.removed.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>
                        <SourceTooltip provenance={{ assumption_key: row.key, as_of: asOf }}>{num(row.value)}</SourceTooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
      <EnginePendingPanel
        title="브리지 워터폴 (NPV 레벨 분해)"
        note="버전 비교 브리지 워터폴(NPV 레벨 분해)은 valuation 엔진의 출력이 필요합니다. 엔진이 아직 구현되지 않아 NPV 분해를 표시할 수 없습니다."
      />
    </div>
  );
}
