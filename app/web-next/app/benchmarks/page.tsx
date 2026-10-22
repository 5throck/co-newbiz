"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { useModalFocus } from "../../lib/use-modal-focus.ts";

// 벤치마킹 사례 (/benchmarks) — 외부 유사 검토/안건 사례 라이브러리. 모든 로그인
// 사용자가 조회·검색할 수 있고 등록·수정은 관리자 콘솔에서 수행한다.
// 사례 데이터는 benchmark_case 테이블(마이그레이션 0041)에 영속 저장된다.

interface BenchmarkCase {
  id: string;
  title: string;
  industry: string | null;
  region: string | null;
  deal_type: string;
  deal_year: number | null;
  deal_size_krw_m: number | null;
  summary_ko: string;
  key_metrics_json: string | null;
  source_ref: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  greenfield: "그린필드",
  brownfield: "브라운필드(M&A)",
  "license-in": "라이선스",
  jv: "합작(JV)",
  partnership: "전략 제휴",
};

const nf = new Intl.NumberFormat("ko-KR");

export function BenchmarksView() {
  const [cases, setCases] = useState<BenchmarkCase[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dealType, setDealType] = useState<string>("");
  const [detailCase, setDetailCase] = useState<BenchmarkCase | null>(null);
  const closeModal = useCallback(() => setDetailCase(null), []);
  const { panelRef, onKeyDown } = useModalFocus(closeModal);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (dealType) params.set("deal_type", dealType);
    apiFetch(params.toString());
  }, [q, dealType]);

  function apiFetch(qs: string) {
    api
      .get<BenchmarkCase[]>(`/api/benchmarks${qs ? `?${qs}` : ""}`)
      .then((res) => setCases(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "불러오기 실패"));
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <main>
      <h1>벤치마킹 사례</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        공개된 신설·M&A·라이선스·합작 사례를 업종·지역·검토/안건 유형으로 조회합니다. 등록·수정은 관리자 콘솔에서 수행됩니다.
      </p>
      <div className="benchmark-filters">
        <input
          type="search"
          aria-label="사례 검색"
          placeholder="제목·요약 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="검토/안건 유형" value={dealType} onChange={(e) => setDealType(e.target.value)}>
          <option value="">전체 유형</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {cases === null ? (
        <p>불러오는 중...</p>
      ) : cases.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">일치하는 사례가 없습니다.</p>
      ) : (
        <>
          <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">총 {cases.length}건</p>
          <ul className="benchmark-grid">
            {cases.map((c) => {
              let metrics: Record<string, unknown> | null = null;
              try {
                metrics = c.key_metrics_json ? JSON.parse(c.key_metrics_json) : null;
              } catch {
                metrics = null;
              }
              return (
                <li key={c.id} className="benchmark-card">
                  <button
                    type="button"
                    className="benchmark-card-open"
                    onClick={() => setDetailCase(c)}
                    aria-label={`${c.title} 상세 보기`}
                  >
                  <div className="benchmark-card-head">
                    <strong>{c.title}</strong>
                    <span className="status-chip status-in-progress">{TYPE_LABELS[c.deal_type] ?? c.deal_type}</span>
                  </div>
                  <p className="mt-[0.15rem] mb-1 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                    {[c.industry, c.region, c.deal_year ? `${c.deal_year}년` : null].filter(Boolean).join(" · ") || "—"}
                    {c.deal_size_krw_m !== null && c.deal_size_krw_m !== undefined && (
                      <> · 규모 약 {nf.format(c.deal_size_krw_m)} KRM</>
                    )}
                  </p>
                  <p className="benchmark-summary">{c.summary_ko}</p>
                  {metrics && (
                    <ul className="benchmark-metrics">
                      {Object.entries(metrics).map(([k, v]) => (
                        <li key={k}>
                          <code>{k}</code>: {String(v)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.source_ref && <p className="mt-1 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">출처: {c.source_ref}</p>}
                  <span className="benchmark-more">상세 보기 →</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {detailCase && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${detailCase.title} 상세`} onClick={closeModal} onKeyDown={onKeyDown}>
          <div ref={panelRef} className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{detailCase.title}</h2>
              <button type="button" className="btn-ghost" onClick={() => setDetailCase(null)} aria-label="닫기">
                닫기
              </button>
            </div>
            <p className="benchmark-card-meta">
              {[detailCase.industry, detailCase.region, detailCase.deal_year ? `${detailCase.deal_year}년` : null].filter(Boolean).join(" · ") || "—"}
              {detailCase.deal_size_krw_m != null && <> · 규모 약 {nf.format(detailCase.deal_size_krw_m)} KRM</>}
              {" · "}
              {TYPE_LABELS[detailCase.deal_type] ?? detailCase.deal_type}
            </p>
            <p className="benchmark-summary">{detailCase.summary_ko}</p>
            {(() => {
              let metrics: Record<string, unknown> | null = null;
              try {
                metrics = detailCase.key_metrics_json ? JSON.parse(detailCase.key_metrics_json) : null;
              } catch {
                metrics = null;
              }
              return metrics ? (
                <table className="data-table" aria-label="주요 지표">
                  <caption className="sr-only">주요 지표</caption>
                  <tbody>
                    {Object.entries(metrics).map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">{k}</th>
                        <td>{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null;
            })()}
            {detailCase.source_ref && <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">출처: {detailCase.source_ref}</p>}
          </div>
        </div>
      )}
    </main>
  );
}

export default BenchmarksView;
