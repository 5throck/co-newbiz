"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { formatNumber } from "../../lib/format.ts";
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

// i18n: deal-type chips resolve through pages.benchmarks.type* keys at render time.
const TYPE_KEY: Record<string, string> = {
  greenfield: "typeGreenfield",
  brownfield: "typeBrownfield",
  "license-in": "typeLicenseIn",
  jv: "typeJv",
  partnership: "typePartnership",
};

const nf = (n: number, locale: string) => formatNumber(n, locale);

export function BenchmarksView() {
  const t = useTranslations("pages.benchmarks");
  const tc = useTranslations("common");
  const locale = useLocale();
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
      .catch((err) => setError(err instanceof Error ? err.message : tc("errors.loadFailed")));
  }

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <main>
      <h1>{t("heading")}</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        {t("intro")}
      </p>
      <div className="benchmark-filters">
        <input
          type="search"
          aria-label={t("searchAria")}
          placeholder={t("phSearch")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label={t("typeAria")} value={dealType} onChange={(e) => setDealType(e.target.value)}>
          <option value="">{t("optAllTypes")}</option>
          {Object.entries(TYPE_KEY).map(([k, key]) => (
            <option key={k} value={k}>
              {t(key)}
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
        <p>{tc("loading")}</p>
      ) : cases.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">{t("empty")}</p>
      ) : (
        <>
          <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">{t("totalCount", { count: cases.length })}</p>
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
                    aria-label={t("cardAria", { title: c.title })}
                  >
                  <div className="benchmark-card-head">
                    <strong>{c.title}</strong>
                    <span className="status-chip status-in-progress">{TYPE_KEY[c.deal_type] ? t(TYPE_KEY[c.deal_type]) : c.deal_type}</span>
                  </div>
                  <p className="mt-[0.15rem] mb-1 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                    {[c.industry, c.region, c.deal_year ? t("yearValue", { n: c.deal_year }) : null].filter(Boolean).join(" · ") || "—"}
                    {c.deal_size_krw_m !== null && c.deal_size_krw_m !== undefined && (
                      <> · {t("sizeNote", { n: nf(c.deal_size_krw_m, locale) })}</>
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
                  {c.source_ref && <p className="mt-1 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("sourceLine", { source: c.source_ref })}</p>}
                  <span className="benchmark-more">{t("moreLink")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {detailCase && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("modalAria", { title: detailCase.title })} onClick={closeModal} onKeyDown={onKeyDown}>
          <div ref={panelRef} className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{detailCase.title}</h2>
              <button type="button" className="btn-ghost" onClick={() => setDetailCase(null)} aria-label={tc("close")}>
                {tc("close")}
              </button>
            </div>
            <p className="benchmark-card-meta">
              {[detailCase.industry, detailCase.region, detailCase.deal_year ? t("yearValue", { n: detailCase.deal_year }) : null].filter(Boolean).join(" · ") || "—"}
              {detailCase.deal_size_krw_m != null && <> · {t("sizeNote", { n: nf(detailCase.deal_size_krw_m, locale) })}</>}
              {" · "}
              {TYPE_KEY[detailCase.deal_type] ? t(TYPE_KEY[detailCase.deal_type]) : detailCase.deal_type}
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
                <table className="data-table" aria-label={t("metricsTableAria")}>
                  <caption className="sr-only">{t("metricsTableAria")}</caption>
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
            {detailCase.source_ref && <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("sourceLine", { source: detailCase.source_ref })}</p>}
          </div>
        </div>
      )}
    </main>
  );
}

export default BenchmarksView;
