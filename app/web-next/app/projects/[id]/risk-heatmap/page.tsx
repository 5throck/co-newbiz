"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { api } from "../../../../lib/api.ts";
import { PageState, useToast } from "../../../../components/ui.tsx";
import { useAuth } from "../../../../lib/auth-client.tsx";
import { canWriteProject } from "../../../../lib/project-write-access.ts";

// 검토/안건 리스크 히트맵 (ADR-0122 #2) — DD 발견사항·고객 집중·인센티브 클로백·
// 커버넌트 여력을 하나의 발생가능성 × 영향 그리드로 통합한다. 2026-10-21부터
// 집계는 서버(lib/risk-heatmap.ts, GET /risk-heatmap)가 수행하고 같은 스냅샷이
// 투자심의 자료·모니터링 브리프에 첨부된다. 기존 테이블의 실재 데이터만
// 플로팅한다 (값 발명 금지).
type Level = 1 | 2 | 3;
interface Item {
  key: string; source: "dd" | "coc" | "inc" | "cov"; label: string; category: string | null;
  likelihood: Level; impact: Level; severity: "high" | "mid" | "low";
  auto: { likelihood: Level; impact: Level }; assessed: boolean; assessed_at: string | null; mitigation: string | null;
}
interface SourceStatus { source: "dd" | "coc" | "inc" | "cov"; label: string; recorded: number; plotted: number; href: string; hint: string | null }
interface Heatmap {
  items: Item[]; grid: number[][]; counts: { high: number; mid: number; low: number };
  sources: { dd: number; coc: number; inc: number; cov: number }; sources_status: SourceStatus[]; assessed_at: string | null;
  covenant_status: "computed" | "insufficient_evidence"; snapshot_hash: string;
}

// i18n: source chips resolve through pages.projects.riskHeatmap.source* keys at render time.
const SOURCE_KEY: Record<Item["source"], string> = { dd: "sourceDd", coc: "sourceCoc", inc: "sourceInc", cov: "sourceCov" };
// 데이터 프로토콜 값(저장 카테고리) — UI 문자열이 아니므로 카탈로그로 옮기지 않는다.
const RISK_CATEGORY = "리스크";

function HeatmapView() {
  const t = useTranslations("pages.projects.riskHeatmap");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 사람 판정 (2026-10-19): likelihood 하드코딩을 보완 — 자동값은 기본값이고 사람이
  // 항목별 가능성·영향(+완화조치, 2026-10-21 원장)을 기록하면 그 값이 우선한다.
  const [drafts, setDrafts] = useState<Record<string, { likelihood: Level; impact: Level; mitigation: string }>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // 사람이 리스크를 직접 등록 — dd_finding(카테고리 "리스크")으로 저장되어 히트맵·
  // 조사내역·투자심의 자료에 같이 반영된다 (신규 테이블 없음).
  const [riskForm, setRiskForm] = useState({ description: "", value_impact: "", evidence_ref: "" });
  const [riskBusy, setRiskBusy] = useState(false);

  async function registerRisk(e: React.FormEvent) {
    e.preventDefault();
    if (riskBusy || !riskForm.description.trim()) return;
    setRiskBusy(true);
    try {
      await api.post(`/api/projects/${encodeURIComponent(id)}/dd/findings`, {
        category: RISK_CATEGORY, description: riskForm.description.trim(),
        value_impact: riskForm.value_impact === "" ? null : Number(riskForm.value_impact),
        evidence_ref: riskForm.evidence_ref.trim() || null,
      });
      toast(t("registered"));
      setRiskForm({ description: "", value_impact: "", evidence_ref: "" });
      load();
    } catch (e) {
      toast(e instanceof Error ? t("registerFailedWith", { message: e.message }) : tc("errors.createFailed"));
    } finally {
      setRiskBusy(false);
    }
  }

  const load = useCallback(() => {
    api.get<Heatmap>(`/api/projects/${encodeURIComponent(id)}/risk-heatmap`)
      .then((r) => setHeatmap(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const items = heatmap?.items ?? [];
  const cell = (likelihood: number, impact: number) => items.filter((i) => i.likelihood === likelihood && i.impact === impact);

  async function saveAssessment(it: Item) {
    const d = drafts[it.key];
    const likelihood = d?.likelihood ?? it.likelihood;
    const impact = d?.impact ?? it.impact;
    const mitigation = (d?.mitigation ?? it.mitigation ?? "").trim();
    setBusyKey(it.key);
    try {
      await api.put(`/api/projects/${encodeURIComponent(id)}/risk-assessment`, { key: it.key, likelihood, impact, mitigation: mitigation || null });
      toast(t("assessmentSaved"));
      setDrafts((cur) => { const next = { ...cur }; delete next[it.key]; return next; });
      load();
    } catch (e) {
      toast(e instanceof Error ? t("recordFailedWith", { message: e.message }) : t("recordFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  const draftOf = (it: Item) => drafts[it.key] ?? { likelihood: it.likelihood, impact: it.impact, mitigation: it.mitigation ?? "" };
  const color = (sev: string) => (sev === "high" ? "var(--red)" : sev === "mid" ? "var(--amber)" : "var(--green)");

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")}</h1>
      <p className="objective">{t("objective")}</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      {/* 판정 대기 스트립 — 무엇을 판정할 수 있는지와 기록 위치를 먼저 보여준다 (2026-10-21 decider). */}
      {heatmap && (
        <section className="market-section" aria-label={t("sourceStatusAria")} data-testid="risk-source-status">
          <h2 className="text-[length:var(--fs-body)] mb-2">{t("sourceStatusHeading")}</h2>
          <ul className="sizing-note-list">
            {heatmap.sources_status.map((s) => (
              <li key={s.source}>
                <span className={`status-chip ${s.plotted > 0 ? "status-green" : "status-amber"}`}>{s.plotted > 0 ? t("plottedChip", { count: s.plotted }) : t("noRecord")}</span>
                {" "}<Link href={`/projects/${encodeURIComponent(id)}${s.href}`} className="underline font-semibold">{s.label}</Link>
                <span className="note ml-1">{t("recordedCount", { count: s.recorded })}</span>
                {s.hint && <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">→ {s.hint}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid2e">
        <section className="market-section" aria-label={t("gridSectionAria")}>
          <h2 className="text-[length:var(--fs-body)] mb-2">{t("gridHeading")}</h2>
          {heatmap === null ? <PageState state="loading" /> : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {[...Array(9)].map((_, idx) => {
                  const likelihood = 3 - Math.floor(idx / 3);
                  const impact = (idx % 3) + 1;
                  const cellItems = cell(likelihood, impact);
                  return (
                    <div key={idx} style={{ minHeight: 74, border: "1px solid var(--border)", borderRadius: 8, position: "relative", background: "var(--surface)" }}>
                      <span className="note" style={{ position: "absolute", right: 5, bottom: 3, fontSize: "var(--fs-caption)" }}>
                        {impact === 1 ? t("impactLow") : impact === 2 ? t("impactMid") : t("impactHigh")}
                      </span>
                      {cellItems.map((it, i) => (
                        <span key={it.key} title={it.label}
                          style={{ position: "absolute", width: 24, height: 24, borderRadius: "50%",
                            background: color(it.severity), color: "var(--surface)", fontSize: "var(--fs-caption)", fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            left: `${10 + i * 30}%`, top: "18%" }}>{i + 1}</span>
                      ))}
                    </div>
                  );
                })}
              </div>
              <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2" data-testid="risk-heatmap-snapshot">
                {t("snapshotLabel")} <code className="dd-item-id">{heatmap.snapshot_hash}</code> · {t("countsLine", { high: heatmap.counts.high, mid: heatmap.counts.mid, low: heatmap.counts.low })}
                {" · "}{t("sourcesLine", { dd: heatmap.sources.dd, coc: heatmap.sources.coc, inc: heatmap.sources.inc, cov: heatmap.sources.cov })}
                {heatmap.covenant_status === "insufficient_evidence" && <> · <span title={t("covEvidenceMissingTitle")}>{t("covEvidenceMissing")}</span></>}
              </p>
            </>
          )}
        </section>
        <section className="market-section" aria-label={t("listSectionAria")}>
          <h2 className="text-[length:var(--fs-body)] mb-2">{t("listHeading")}</h2>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2" data-testid="risk-heatmap-caveat">
            {t("caveat")}
          </p>
          {heatmap === null ? <PageState state="loading" /> : items.length === 0 ? (
            <PageState state="empty" emptyText={t("empty")} />
          ) : (
            <ul className="sizing-note-list">
              {items.map((it) => {
                const d = draftOf(it);
                return (
                  <li key={it.key}>
                    <span className="status-chip" style={{ background: color(it.severity), color: "var(--surface)", marginRight: 6 }}>{it.severity === "high" ? t("sevHigh") : it.severity === "mid" ? t("sevMid") : t("sevLow")}</span>
                    <span className="status-chip status-gray mr-1">{t(SOURCE_KEY[it.source])}</span>
                    {it.source === "dd" && it.category && it.category !== RISK_CATEGORY && <span className="status-chip status-gray mr-1">{it.category}</span>}
                    {it.label}
                    {it.assessed && <span className="status-chip status-green ml-1" title={t("assessedTitle", { date: it.assessed_at ? ` (${it.assessed_at.slice(0, 10)})` : "", auto: `${it.auto.likelihood}×${it.auto.impact}` })}>{t("assessedChip")}</span>}
                    {it.mitigation && !canAct && <span className="note block ml-1">{t("mitigationLine", { value: it.mitigation })}</span>}
                    {canAct && (
                      <span className="actions-row ml-2 align-middle flex flex-wrap gap-1 items-center">
                        <select aria-label={t("likelihoodAria", { label: it.label })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6.5rem" }}
                          value={d.likelihood}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [it.key]: { ...draftOf(it), ...cur[it.key], likelihood: Number(e.target.value) as Level } }))}>
                          <option value={1}>{t("likelihoodLow")}</option><option value={2}>{t("likelihoodMid")}</option><option value={3}>{t("likelihoodHigh")}</option>
                        </select>
                        <select aria-label={t("impactAria", { label: it.label })} className="sizing-new-input sizing-new-input-sm" style={{ width: "6rem" }}
                          value={d.impact}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [it.key]: { ...draftOf(it), ...cur[it.key], impact: Number(e.target.value) as Level } }))}>
                          <option value={1}>{t("impactLow")}</option><option value={2}>{t("impactMid")}</option><option value={3}>{t("impactHigh")}</option>
                        </select>
                        <input aria-label={t("mitigationAria", { label: it.label })} className="sizing-new-input sizing-new-input-sm" style={{ minWidth: "12rem", flex: 1 }}
                          placeholder={t("mitigationPlaceholder")} maxLength={1000} value={d.mitigation}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [it.key]: { ...draftOf(it), ...cur[it.key], mitigation: e.target.value } }))} />
                        <button type="button" className="btn-ghost btn-sm" disabled={busyKey === it.key} onClick={() => void saveAssessment(it)}>
                          {busyKey === it.key ? tc("recording") : t("recordAssessment")}
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="note" style={{ marginBottom: 0 }}>{t("listFootnote")}</p>
          {canAct && (
            <form className="flex flex-wrap items-end gap-2 mt-2 text-[length:var(--fs-caption)]" aria-label={t("registerFormAria")} data-testid="risk-register-form" onSubmit={registerRisk}>
              <label className="flex-1 min-w-[16rem]"><span className="block mb-1">{t("registerLabel")}</span>
                <input className="sizing-new-input w-full" value={riskForm.description} onChange={(e) => setRiskForm({ ...riskForm, description: e.target.value })} placeholder={t("descPlaceholder")} required /></label>
              <label className="w-[9rem]"><span className="block mb-1">{t("valueImpactLabel")}</span>
                <input type="number" className="sizing-new-input sizing-new-input-sm w-full" value={riskForm.value_impact} onChange={(e) => setRiskForm({ ...riskForm, value_impact: e.target.value })} placeholder="-120" /></label>
              <label className="w-[12rem]"><span className="block mb-1">{t("evidenceLabel")}</span>
                <input className="sizing-new-input sizing-new-input-sm w-full" value={riskForm.evidence_ref} onChange={(e) => setRiskForm({ ...riskForm, evidence_ref: e.target.value })} placeholder={t("evidencePlaceholder")} /></label>
              <button type="submit" className="btn-ghost btn-sm" disabled={riskBusy}>{riskBusy ? tc("registering") : t("registerBtn")}</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

export default function RiskHeatmapPage() {
  return <Suspense fallback={null}><HeatmapView /></Suspense>;
}
