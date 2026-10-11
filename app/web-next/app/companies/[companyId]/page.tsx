"use client";

// /companies/[companyId] — the company financials dashboard (ADR-0116
// Phase 1; implements the approved mockup
// docs/designs/mockups/2026-09-11-company-financials-ui-mockup_ko.html).
// 한눈에 요약 → 재무실적 → 지표별 해설 → WACC 참조값 → 동기화. All numbers
// come from fact_financial via the API; missing entries render as explicit
// N/A — the screen never invents a value.
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../../../lib/api.ts";
import { formatAsOfLabel, formatWaccValue, mapSyncError, syncSuccessMessage } from "../../../lib/company-page-format.ts";
import { useAuth } from "../../../lib/auth-client.tsx";
import { canWriteBusiness } from "../../../lib/project-write-access.ts";
import { DART_CORP_CODE_LABEL } from "../../../lib/labels.ts";

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

const ACCOUNT_ORDER = ["매출액", "영업이익", "당기순이익", "자산총계", "부채총계", "자본총계"];
const toEok = (v: number): string => (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const fmtCard = (c: SummaryCard): string => (c.value === null ? "N/A" : c.format === "percent" ? pct(c.value) : `${(c.value * 100).toFixed(0)}%`);

export default function CompanyFinancialsPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    api.get<View>(`/api/companies/${encodeURIComponent(companyId)}/financials`)
      .then((r) => { setView(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "회사 재무정보를 불러오지 못했습니다."));
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
        회사 재무성과 분석 — {view?.company.name_ko ?? "…"}
      </h1>
      {view?.company.dart_corp_code && (
        <p className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] -mt-2 mb-3">
          {DART_CORP_CODE_LABEL} <span lang="en">{view.company.dart_corp_code}</span>
        </p>
      )}
      <p className="text-[color:var(--muted-fg)] text-[0.9rem] mb-3">인수 대상 · 분석 기준 회사의 과거 실적과 재무 건전성을 한 화면에서 확인합니다. 프로젝트 재무분석 탭은 이 화면의 요약에 연결됩니다.</p>

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {error}</p>}
      {message && <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--success)]">✓ {message}</p>}
      {!view ? (
        <p className="text-[color:var(--muted-fg)]">불러오는 중...</p>
      ) : (
        <>
          {/* ① 한눈에 요약 */}
          <section className="market-section sizing-step">
            <h3 className="sizing-step-title">한눈에 요약 <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">— {view.latest_sync_at ? `마지막 DART 동기화 ${new Date(view.latest_sync_at).toLocaleDateString("ko-KR")}` : "아직 DART 동기화 전"} · 출처 dart (A등급)</span></h3>
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
            <h3 className="sizing-step-title">재무실적 <span className="inline-block rounded-full px-2 py-0.5 text-[length:var(--fs-caption)] font-bold whitespace-nowrap bg-[color:var(--success-bg)] text-[color:var(--success)]">live · 인용</span> <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">— 단위 억원 · DART 연결재무제표</span></h3>
            {accounts.length === 0 ? (
              <div>
                <p className="text-[color:var(--muted-fg)]">{canAct ? "재무 fact가 없습니다 — 아래 동기화 버튼으로 DART에서 5개 회계연도 실적을 가져오세요." : "아직 수집된 재무 데이터가 없습니다."}</p>
                {canAct && <button className="bg-[color:var(--accent)] text-[color:var(--accent-fg)] rounded-lg px-4 py-2 text-[0.88rem] font-bold cursor-pointer mt-2" type="button" onClick={runSync} disabled={syncing}>{syncing ? "동기화 중..." : "DART에서 최신 실적 동기화"}</button>}
                {syncError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-2">✕ {syncError}</p>}
              </div>
            ) : (
              <table className="data-table">
                <thead><tr><th>계정</th>{years.map((y) => <th key={y} className="num">{y}</th>)}</tr></thead>
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
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">각 값의 출처는 <span className="mono">dart (A등급)</span> · <span className="mono">anchor: src:dart</span>. 과거 revision도 보존되어 이력 추적이 가능합니다.</p>
            )}
          </section>

          {/* ③ 지표별 해설 */}
          <section className="market-section sizing-step mt-3">
            <h3 className="sizing-step-title">지표별 해설 <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">— 복잡한 분석 결과를 문장으로 풀어서 설명합니다</span></h3>
            {view.commentary.metrics.map((m) => (
              <div key={m.key} className="grid md:grid-cols-[11rem_1fr] gap-2 py-2 border-t border-[color:var(--border-subtle)] first:border-t-0">
                <div className="font-bold text-[length:var(--fs-body)]">{m.name}<span className="block font-normal text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{m.sub}</span></div>
                <p className="text-[length:var(--fs-caption)]">{m.say}</p>
              </div>
            ))}
          </section>

          {/* ④ WACC 참조값 */}
          <section className="market-section sizing-step mt-3">
            <h3 className="sizing-step-title">WACC 참조값 — 이 회사 기준 <span className="inline-block rounded-full px-2 py-0.5 text-[length:var(--fs-caption)] font-bold whitespace-nowrap bg-[color:var(--primary-bg)] text-[color:var(--accent)]">밸류에이션 관점</span></h3>
            <div className="grid gap-2 md:grid-cols-4 mt-1">
              {view.wacc_reference.entries.map((e) => (
                <div key={e.key} className="border border-[color:var(--border)] rounded-lg p-3 bg-[color:var(--muted-bg)]">
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{e.label}</div>
                  <div className="font-extrabold text-[1.05rem] tabular-nums">{formatWaccValue(e.value, e.unit)}</div>
                  {e.value === null ? (
                    <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{e.reason ?? "산출 근거 없음"}</div>
                  ) : (
                    <>
                      <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{[formatAsOfLabel(e.as_of), e.source_label].filter(Boolean).join(" · ")}</div>
                      {e.note && <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-0.5">{e.note}</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">참조값은 <b>제안</b>입니다. 프로젝트 WACC 세션(사업성 분석 → WACC)에서 불러와 사람이 확인·수정한 뒤 확정합니다. 참조 주체가 다른 값(그룹 계열사 기준 — 투자 허들 관점)은 그룹/계열사 화면에서 별도 확인할 수 있습니다.</p>
          </section>

          {/* 동기화 */}
          {view.financials.length > 0 && (
            <section className="market-section sizing-step mt-3">
              <div className="flex gap-2 items-center flex-wrap">
                {canAct && <button className="bg-[color:var(--accent)] text-[color:var(--accent-fg)] rounded-lg px-4 py-2 text-[0.88rem] font-bold cursor-pointer" type="button" onClick={runSync} disabled={syncing}>{syncing ? "동기화 중..." : "DART에서 최신 실적 동기화"}</button>}
                <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">마지막 동기화 {view.latest_sync_at ? new Date(view.latest_sync_at).toLocaleString("ko-KR") : "—"}</span>
                {syncError && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)] mt-2">✕ {syncError}</p>}
              </div>
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">동기화는 DART 공시 원천을 다시 읽어 값을 갱신합니다. 같은 값이면 새 기록을 만들지 않고, 바뀐 값만 새 revision으로 남깁니다(덮어쓰기 없음).</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}
