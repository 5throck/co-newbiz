"use client";

// /companies/[companyId] — the company financials dashboard (ADR-0116
// Phase 1; implements the approved mockup
// docs/designs/mockups/2026-09-11-company-financials-ui-mockup_ko.html).
// 한눈에 요약 → 재무실적 → 지표별 해설 → WACC 참조값 → 동기화. All numbers
// come from fact_financial via the API; missing entries render as explicit
// N/A — the screen never invents a value.
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api, ApiError } from "../../../lib/api.ts";
import { formatAsOfLabel, formatWaccValue, mapSyncError, syncSuccessMessage } from "../../../lib/company-page-format.ts";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";

interface SummaryCard { key: string; label: string; value: number | null; format: "percent" | "ratio"; trend: "up" | "down" | "flat" | null; trendText: string | null; say: string }
interface Callout { tone: "warn" | "good" | "info"; text: string }
interface MetricCommentary { key: string; name: string; sub: string; say: string }
interface FactRow { id: string; value: number; account_name: string; ifrs_code: string; fiscal_year: number; source_code: string | null }
interface WaccEntry { key: string; label: string; value: number | null; unit: "ratio" | "multiple"; as_of: string | null; anchor_ref: string | null; source_label: string | null; reason: string | null; note: string | null }
interface View {
  company: { id: string; name_ko: string; dart_corp_code: string | null };
  latest_sync_at: string | null;
  financials: FactRow[];
  analysis: { years: string[]; ratios: Array<{ year: string; revenueGrowth?: number | null; operatingMargin?: number | null; debtRatio?: number | null; roe?: number | null }>; notes: string[] };
  commentary: { summary: SummaryCard[]; callouts: Callout[]; metrics: MetricCommentary[] };
  wacc_reference: { entries: WaccEntry[]; latest_year: string | null; disclaimer?: string };
}

// DART 계정명(저장 데이터의 account_name 매칭 키) — UI 문자열이 아니므로 카탈로그로 옮기지 않는다.
const ACCOUNT_ORDER = ["매출액", "영업이익", "당기순이익", "자산총계", "부채총계", "자본총계"];
const toEok = (v: number): string => (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const fmtCard = (c: SummaryCard): string => (c.value === null ? "N/A" : c.format === "percent" ? pct(c.value) : `${(c.value * 100).toFixed(0)}%`);

export default function CompanyFinancialsPage() {
  const t = useTranslations("pages.companyFinancials");
  const tc = useTranslations("common");
  const { companyId } = useParams<{ companyId: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    api.get<View>(`/api/companies/${encodeURIComponent(companyId)}/financials`)
      .then((r) => { setView(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const { me } = useAuth();
  const canAct = canWriteBusiness(me?.role);

  async function runSync() {
    setSyncing(true);
    setMessage(null);
    setSyncError(null);
    try {
      const r = await api.post<{ sync: { inserted: number; unchanged: number; years: number[] } }>(`/api/companies/${encodeURIComponent(companyId)}/sync`, {});
      setMessage(syncSuccessMessage(r.data.sync));
      load();
    } catch (e) {
      setSyncError(e instanceof ApiError ? mapSyncError(e.status, e.code, e.message) : mapSyncError(null, null, e instanceof Error ? e.message : ""));
    } finally {
      setSyncing(false);
    }
  }

  // Pivot rows into an account × year table (values in 억원).
  const years = view?.analysis.years ?? [];
  const byAccountYear = new Map<string, Map<string, number>>();
  for (const r of view?.financials ?? []) {
    if (!byAccountYear.has(r.account_name)) byAccountYear.set(r.account_name, new Map());
    byAccountYear.get(r.account_name)!.set(String(r.fiscal_year), r.value);
  }
  const accounts = ACCOUNT_ORDER.filter((a) => byAccountYear.has(a));

  return (
    <main className="market-page">
      <h1 className="text-[1.35rem] font-extrabold tracking-tight mt-6">
        {t("heading", { name: view?.company.name_ko ?? "…" })}
      </h1>
      {view?.company.dart_corp_code && (
        <p className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] -mt-2 mb-3">
          {tc("dartId")} <span lang="en">{view.company.dart_corp_code}</span>
        </p>
      )}
      <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-body)] mb-3">{t("intro")}</p>

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {error}</p>}
      {message && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--success)]">✓ {message}</p>}
      {!view ? (
        <p className="text-[color:var(--muted-fg)]">{tc("loading")}</p>
      ) : (
        <>
          {/* ① 한눈에 요약 */}
          <section className="market-section sizing-step">
            <h3 className="sizing-step-title">{t("sumHeading")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">— {view.latest_sync_at ? t("lastDartSync", { date: new Date(view.latest_sync_at).toLocaleDateString("ko-KR") }) : t("notSyncedYet")} {t("sourceDart")}</span></h3>
            <div className="grid gap-2 md:grid-cols-4 mt-1">
              {view.commentary.summary.map((c) => (
                <div key={c.key} className="border border-[color:var(--border)] rounded-lg p-3 bg-[color:var(--muted-bg)]">
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{c.label}</div>
                  <div className="font-extrabold text-[1.3rem] tabular-nums tracking-tight">{fmtCard(c)}</div>
                  {c.trendText && (
                    <div className={`text-[length:var(--fs-caption)] font-bold ${c.trend === "up" ? "text-[color:var(--success)]" : c.trend === "down" ? "text-[color:var(--red-fg)]" : "text-[color:var(--muted-fg)]"}`}>{c.trendText}</div>
                  )}
                  <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-0.5">{c.say}</div>
                </div>
              ))}
            </div>
            {view.commentary.callouts.map((c, i) => (
              <p key={i} className={`mt-2 rounded-lg px-3 py-2 text-[length:var(--fs-caption)] ${c.tone === "warn" ? "bg-[color:var(--warning-bg)] text-[color:var(--amber-fg)]" : c.tone === "good" ? "bg-[color:var(--success-bg)] text-[color:var(--success)]" : "bg-[color:var(--primary-bg)] text-[color:var(--primary-dim)]"}`}>{c.text}</p>
            ))}
          </section>

          {/* ② 재무실적 */}
          <section className="market-section sizing-step mt-3">
            <h3 className="sizing-step-title">{t("finHeading")} <span className="inline-block rounded-full px-2 py-0.5 text-[length:var(--fs-caption)] font-bold whitespace-nowrap bg-[color:var(--success-bg)] text-[color:var(--success)]">{t("finBadge")}</span> <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("finUnit")}</span></h3>
            {accounts.length === 0 ? (
              <div>
                <p className="text-[color:var(--muted-fg)]">{canAct ? t("noFactCanWrite") : t("noFactViewer")}</p>
                {canAct && <button className="bg-[color:var(--accent)] text-[color:var(--accent-fg)] rounded-lg px-4 py-2 text-[length:var(--fs-body)] font-bold cursor-pointer mt-2" type="button" onClick={runSync} disabled={syncing}>{syncing ? t("syncing") : t("syncBtn")}</button>}
                {syncError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-2">✕ {syncError}</p>}
              </div>
            ) : (
              <table className="data-table">
                <caption className="sr-only">{t("finCaption")}</caption>
                <thead><tr><th>{t("thAccount")}</th>{years.map((y) => <th key={y} className="num">{y}</th>)}</tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a}>
                      <td>{a}</td>
                      {years.map((y) => {
                        const v = byAccountYear.get(a)?.get(y);
                        return <td key={y} className="num tabular-nums">{v !== undefined ? toEok(v) : "—"}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {view.analysis.notes.length > 0 && <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">{view.analysis.notes.join(" · ")}</p>}
            {view.financials.length > 0 && (
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">{t("sourceNotePre")} <span className="mono">{t("sourceGrade")}</span> · <span className="mono">anchor: src:dart</span>{t("sourceNotePost")}</p>
            )}
          </section>

          {/* ③ 지표별 해설 */}
          <section className="market-section sizing-step mt-3">
            <h3 className="sizing-step-title">{t("metricHeading")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{t("metricNote")}</span></h3>
            {view.commentary.metrics.map((m) => (
              <div key={m.key} className="grid md:grid-cols-[11rem_1fr] gap-2 py-2 border-t border-[color:var(--border-subtle)] first:border-t-0">
                <div className="font-bold text-[length:var(--fs-body)]">{m.name}<span className="block font-normal text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{m.sub}</span></div>
                <p className="text-[length:var(--fs-caption)]">{m.say}</p>
              </div>
            ))}
          </section>

          {/* ④ WACC 참조값 */}
          <section className="market-section sizing-step mt-3">
            <h3 className="sizing-step-title">{t("waccHeading")} <span className="inline-block rounded-full px-2 py-0.5 text-[length:var(--fs-caption)] font-bold whitespace-nowrap bg-[color:var(--primary-bg)] text-[color:var(--accent)]">{t("waccBadge")}</span></h3>
            <div className="grid gap-2 md:grid-cols-4 mt-1">
              {view.wacc_reference.entries.map((e) => (
                <div key={e.key} className="border border-[color:var(--border)] rounded-lg p-3 bg-[color:var(--muted-bg)]">
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{e.label}</div>
                  <div className="font-extrabold text-[1.05rem] tabular-nums">{formatWaccValue(e.value, e.unit)}</div>
                  {e.value === null ? (
                    <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{e.reason ?? t("noBasis")}</div>
                  ) : (
                    <>
                      <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{[formatAsOfLabel(e.as_of), e.source_label].filter(Boolean).join(" · ")}</div>
                      {e.note && <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-0.5">{e.note}</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">{t("waccNotePre")}<b>{t("waccNoteB")}</b>{t("waccNotePost")}</p>
          </section>

          {/* 동기화 */}
          {view.financials.length > 0 && (
            <section className="market-section sizing-step mt-3">
              <div className="flex gap-2 items-center flex-wrap">
                {canAct && <button className="bg-[color:var(--accent)] text-[color:var(--accent-fg)] rounded-lg px-4 py-2 text-[length:var(--fs-body)] font-bold cursor-pointer" type="button" onClick={runSync} disabled={syncing}>{syncing ? t("syncing") : t("syncBtn")}</button>}
                <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("lastSyncLabel", { date: view.latest_sync_at ? new Date(view.latest_sync_at).toLocaleString("ko-KR") : "—" })}</span>
                {syncError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-2">✕ {syncError}</p>}
              </div>
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">{t("syncNote")}</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
