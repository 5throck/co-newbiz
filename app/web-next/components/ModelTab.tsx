"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  ApiError,
  type CreateRunResult,
  type ProvenanceMeta,
  type RunDetail,
  type RunSummary,
} from "../lib/api.ts";
import { SourceTooltip } from "./SourceTooltip.tsx";
import { EnginePendingPanel } from "./EnginePendingPanel.tsx";

// 모델 (Model) tab — ui-spec §2 batch 3. Runs list + create-run form over
// the engine-1 versioning surface (ADR-0005): a run records a versioned
// INPUT snapshot (run_input copy + set overrides + input_hash), never a
// valuation result — the honest v1 note is rendered next to the form, and
// the model-engine output arrives with a later wave. Selecting a run shows
// its immutable input snapshot (GET /api/runs/:id); input values carry the
// row's assumption_key as their provenance. Run creation is analyst+ — a
// 403 renders a clear Korean permission message alongside the server's.

interface OverrideRow {
  key: string;
  value: string;
}

function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

export function ModelTab({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailAsOf, setDetailAsOf] = useState<ProvenanceMeta>({});
  const [label, setLabel] = useState("");
  const [fromRunId, setFromRunId] = useState("");
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refreshRuns(selectRunId?: string): Promise<RunSummary[]> {
    return api
      .get<RunSummary[]>(`/api/projects/${projectId}/runs`)
      .then((res) => {
        setRuns(res.data);
        if (selectRunId) setSelectedRunId(selectRunId);
        return res.data;
      })
      .catch(() => {
        setRuns([]);
        return [];
      });
  }

  useEffect(() => {
    setRuns(null);
    setSelectedRunId(null);
    setDetail(null);
    refreshRuns();
    // projectId is the only dependency; refreshRuns is a stable closure over it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }
    api
      .get<RunDetail>(`/api/runs/${encodeURIComponent(selectedRunId)}`)
      .then((res) => {
        setDetail(res.data);
        setDetailAsOf({ as_of: typeof res.meta.as_of === "string" ? res.meta.as_of : undefined });
      })
      .catch(() => setDetail(null));
  }, [selectedRunId]);

  async function createRun(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    if (!label.trim()) {
      setFormError("실행 이름(label)을 입력하세요.");
      return;
    }
    const set: Record<string, number> = {};
    for (const row of overrides) {
      const key = row.key.trim();
      if (!key) continue;
      if (row.value.trim() === "" || !Number.isFinite(Number(row.value))) {
        setFormError(`'${key}'의 값은 숫자여야 합니다.`);
        return;
      }
      set[key] = Number(row.value);
    }
    setSubmitting(true);
    try {
      const body: { label: string; from_run_id?: string; set?: Record<string, number> } = { label: label.trim() };
      if (fromRunId) body.from_run_id = fromRunId;
      if (Object.keys(set).length > 0) body.set = set;
      const res = await api.post<CreateRunResult>(`/api/projects/${projectId}/runs`, body);
      setLabel("");
      setOverrides([]);
      setNotice(`실행이 생성되었습니다 (${shortHash(res.data.input_hash)}).`);
      await refreshRuns(res.data.run_id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setFormError(`권한 없음 — 실행 생성은 분석가(analyst) 역할 이상만 가능합니다. (${err.message})`);
      } else if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("실행 생성에 실패했습니다.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="model-tab">
      <section aria-label="실행 생성">
        <h2>새 실행 생성</h2>
        <p className="mb-3 text-[color:var(--muted-fg)] text-[0.85rem]">
          실행(run)은 버전화된 입력 스냅샷을 기록합니다. 밸류에이션 결과값은 모델 엔진 도입과 함께 제공됩니다.
        </p>
        <form onSubmit={createRun} className="run-form">
          <div className="run-form-row">
            <label htmlFor="runLabel">실행 이름</label>
            <input id="runLabel" value={label} onChange={(e) => setLabel(e.target.value)} required />
          </div>
          <div className="run-form-row">
            <label htmlFor="runFrom">복제할 기존 실행</label>
            <select
              id="runFrom"
              value={fromRunId}
              onChange={(e) => setFromRunId(e.target.value)}
              disabled={!runs || runs.length === 0}
            >
              <option value="">최신 실행 (기본)</option>
              {runs?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label ?? r.id}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="override-fieldset">
            <legend>입력 재정의 (set)</legend>
            {overrides.map((row, i) => (
              <div key={i} className="run-form-row override-row">
                <label htmlFor={`ov-key-${i}`} className="sr-only">
                  {i + 1}번째 재정의 키
                </label>
                <input
                  id={`ov-key-${i}`}
                  placeholder="assumption_key"
                  value={row.key}
                  onChange={(e) =>
                    setOverrides((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                  }
                />
                <label htmlFor={`ov-value-${i}`} className="sr-only">
                  {i + 1}번째 재정의 값
                </label>
                <input
                  id={`ov-value-${i}`}
                  placeholder="숫자 값"
                  inputMode="decimal"
                  value={row.value}
                  onChange={(e) =>
                    setOverrides((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                  }
                />
                <button
                  type="button"
                  onClick={() => setOverrides((rows) => rows.filter((_, j) => j !== i))}
                  aria-label={`${i + 1}번째 재정의 삭제`}
                >
                  삭제
                </button>
              </div>
            ))}
            <button type="button" className="chip-like" onClick={() => setOverrides((rows) => [...rows, { key: "", value: "" }])}>
              + 재정의 추가
            </button>
          </fieldset>
          <button type="submit" disabled={submitting}>
            {submitting ? "생성 중..." : "실행 생성"}
          </button>
        </form>
        {formError && (
          <p role="alert" className="text-[color:var(--red-fg)]">
            {formError}
          </p>
        )}
        {notice && <p className="text-[color:var(--green-fg)]">{notice}</p>}
      </section>

      <section aria-label="실행 목록">
        <h2>실행 목록</h2>
        {runs === null ? (
          <p>불러오는 중...</p>
        ) : runs.length === 0 ? (
          <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 생성된 실행이 없습니다.</p>
        ) : (
          <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
            <caption className="sr-only">분석 실행 목록 (최신순)</caption>
            <thead>
              <tr>
                <th scope="col">이름</th>
                <th scope="col">입력 해시</th>
                <th scope="col">입력 수</th>
                <th scope="col">생성일</th>
                <th scope="col">생성자</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className={selectedRunId === r.id ? "row-selected" : undefined}>
                  <td>
                    <button type="button" className="border-0 bg-transparent p-0 text-[color:var(--accent)] underline cursor-pointer" onClick={() => setSelectedRunId(r.id)}>
                      {r.label ?? r.id}
                    </button>
                  </td>
                  <td>
                    <span className="font-mono text-[0.85rem]" title={r.input_hash}>
                      {shortHash(r.input_hash)}
                    </span>
                  </td>
                  <td>{r.input_count}</td>
                  <td>{new Date(r.created_at).toLocaleString("ko-KR")}</td>
                  <td>{r.created_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedRunId && detail && (
        <section aria-label="실행 입력 스냅샷">
          <h2>입력 스냅샷 — {detail.run.label ?? detail.run.id}</h2>
          <p className="mt-[0.15rem] mb-0 text-[color:var(--muted-fg)] text-[0.85rem]">
            입력 해시: <span className="font-mono text-[0.85rem]">{detail.run.input_hash}</span> (스냅샷은 불변입니다)
          </p>
          {detail.inputs.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">데이터 없음 — 이 실행에 입력이 없습니다.</p>
          ) : (
            <table className="w-full border-collapse mt-2 mb-6 [&_th]:border-b [&_th]:border-[color:var(--border)] [&_th]:p-2 [&_th]:text-left [&_td]:border-b [&_td]:border-[color:var(--border)] [&_td]:p-2 [&_td]:text-left">
              <caption className="sr-only">실행 입력 스냅샷</caption>
              <thead>
                <tr>
                  <th scope="col">가정 키</th>
                  <th scope="col">값</th>
                </tr>
              </thead>
              <tbody>
                {detail.inputs.map((input) => (
                  <tr key={input.assumption_key}>
                    <td>{input.assumption_key}</td>
                    <td>
                      <SourceTooltip
                        provenance={{ assumption_key: input.assumption_key, as_of: detailAsOf.as_of }}
                      >
                        {input.value.toLocaleString("ko-KR")}
                      </SourceTooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <EnginePendingPanel
        title="워터폴 차트 (Waterfall)"
        note="워터폴 차트는 valuation 엔진 출력(매출 → 운영비용 → 세금 → NOPAT → ROIC 브리지)이 생성되어야 표시됩니다. 모델 엔진이 아직 구현되지 않아 표시할 출력이 없습니다."
      />
      <EnginePendingPanel
        title="토네이도 차트 (Tornado)"
        note="토네이도 차트는 각 입력 가정에 대한 출력 민감도를 요구합니다. 민감도 분석은 모델 엔진의 산출물이라 현재 사용할 수 없습니다."
      />
    </div>
  );
}
