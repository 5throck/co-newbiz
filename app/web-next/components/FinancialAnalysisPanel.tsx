"use client";

// S8 재무분석 — the bridge tab (ADR-0116 Phase 1; implements the approved
// mockup docs/designs/mockups/2026-09-11-project-fa-bridge-ui-mockup_ko.html).
// Extracted from the standalone financial-analysis/page.tsx so it can be
// embedded as a tab inside business-case/page.tsx (?tab=financial-analysis);
// the standalone route now renders this same panel for deep-link compatibility.
import { TranslatorFn } from "../i18n/config.ts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import TargetSelector, { type AnalysisTarget } from "./TargetSelector.tsx";
import { resolveTargetScope } from "../lib/target-default.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteProject } from "../lib/project-write-access.ts";
import { useTranslations } from "next-intl";

interface CompanySummary {
  id: string;
  name_ko: string;
  dart_corp_code: string | null;
  role: string;
  rationale: string;
  latest_sync_at: string | null;
  metrics: { revenue_latest: number | null; revenue_growth: number | null; operating_margin: number | null; debt_ratio: number | null; roe: number | null };
}
interface View { project: { id: string; project_no: string; track: string | null }; company: CompanySummary | null; target: { target_id: string; name: string; role: string } | null }
interface CompanyRow { id: string; name_ko: string; dart_corp_code: string | null; fact_years: number }

const pct = (v: number | null): string => (v === null ? "N/A" : `${(v * 100).toFixed(1)}%`);
const eok = (v: number | null, t: TranslatorFn): string => (v === null ? "N/A" : t("p1HundredMillions", { p1: (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) }));

export function FinancialAnalysisPanel({ projectId }: { projectId: string }) {const t = useTranslations("components.financialAnalysis.panel"); const tc = useTranslations("common");
  const { me } = useAuth();
  const canAct = canWriteProject(me?.role);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // ADR-0156: per-target selector (read-only financial view per shortlisted target).
  const [targets, setTargets] = useState<AnalysisTarget[]>([]);
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  // Default = S8-selected (gate-bound) target, else the first shortlisted; the bound target uses the project-level view.
  const targetScope = resolveTargetScope(targets, chosenTarget);
  const selectedTarget = targetScope.scopeId;

  const [q, setQ] = useState("");
  const [results, setResults] = useState<CompanyRow[] | null>(null);
  const [rationale, setRationale] = useState("");
  const [linking, setLinking] = useState(false);

  const targetQuery = selectedTarget ? `?target_id=${encodeURIComponent(selectedTarget)}` : "";
  const load = useCallback(() => {
    api.get<View>(`/api/projects/${encodeURIComponent(projectId)}/financial-analysis${targetQuery}`)
      .then((r) => { setView(r.data); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheFinancial")));
  }, [projectId, targetQuery]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get<{ targets: AnalysisTarget[] }>(`/api/projects/${encodeURIComponent(projectId)}/targets`)
      .then((r) => setTargets(r.data.targets ?? []))
      .catch(() => setTargets([]));
  }, [projectId]);

  async function search() {
    try {
      const r = await api.get<{ companies: CompanyRow[] }>(`/api/companies?q=${encodeURIComponent(q.trim())}`);
      setResults(r.data.companies);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("companySearchFailed"));
    }
  }

  async function connect(companyId: string) {
    if (!rationale.trim()) {
      setMessage(t("enterTheLinkingRationale"));
      return;
    }
    setLinking(true);
    setMessage(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(projectId)}/financial-analysis/company`, { company_id: companyId, rationale: rationale.trim() });
      setResults(null);
      setRationale("");
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("failedToLinkTheCompany"));
    } finally {
      setLinking(false);
    }
  }

  const company = view?.company ?? null;
  const roleChip = company?.role === "target" ? t("brownfieldAcquisitionTarget") : t("greenfieldBenchmarkCompany");

  return (
    <>
      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">✕ {error}</p>}
      {message && <p className="text-[length:var(--fs-caption)] text-[color:var(--accent)]">{message}</p>}
      {!view ? (
        <p>{tc("loading")}</p>
      ) : (
        <>
          {targets.length > 1 && (
            <section className="market-section sizing-step">
              <h3 className="sizing-step-title">{t("analysisScope")}</h3>
              <TargetSelector targets={targets} selected={targetScope.activeId} onSelect={setChosenTarget} />
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-1">
                {t("theIndividualTargetViewIs")}
              </p>
              {targetScope.noGateBasis && <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]" data-testid="no-gate-basis-note">{t("s8TargetSelectionIsPending")}</p>}
              {view.target && <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("view")} {view.target.name} {t("individualTarget")}</p>}
            </section>
          )}
          {company ? (
            <section className="market-section sizing-step">
              <h3 className="sizing-step-title">{t("linkedTargetCompany")} <span className="text-[color:var(--muted-fg)] font-normal text-[length:var(--fs-caption)]">{roleChip}</span></h3>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[1.05rem] font-extrabold">{company.name_ko}</span>
                {company.dart_corp_code && <span className="font-mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{tc("dartId")} <span lang="en">{company.dart_corp_code}</span></span>}
                <span className={company.latest_sync_at ? "inline-block rounded-full px-2 py-0.5 text-[length:var(--fs-caption)] font-bold whitespace-nowrap bg-[color:var(--success-bg)] text-[color:var(--success)]" : "inline-block rounded-full px-2 py-0.5 text-[length:var(--fs-caption)] font-bold whitespace-nowrap bg-[color:var(--warning-bg)] text-[color:var(--amber-fg)]"}>{company.latest_sync_at ? t("syncedP1", { p1: new Date(company.latest_sync_at).toLocaleDateString("ko-KR") }) : t("notSyncedSyncOnThe")}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-4 mt-2">
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]"><div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("revenueLatestYear")}</div><div className="font-extrabold text-[1.1rem] tabular-nums">{eok(company.metrics.revenue_latest, t)}</div><div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("priorYear")} {company.metrics.revenue_growth === null ? "—" : pct(company.metrics.revenue_growth)}</div></div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]"><div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("operatingMargin")}</div><div className="font-extrabold text-[1.1rem] tabular-nums">{pct(company.metrics.operating_margin)}</div></div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]"><div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("debtRatio")}</div><div className="font-extrabold text-[1.1rem] tabular-nums">{pct(company.metrics.debt_ratio)}</div></div>
                <div className="border border-[color:var(--border)] rounded-lg p-2 bg-[color:var(--muted-bg)]"><div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">ROE</div><div className="font-extrabold text-[1.1rem] tabular-nums">{pct(company.metrics.roe)}</div></div>
              </div>
              <div className="mt-3 flex gap-3 items-center flex-wrap">
                <Link className="text-[color:var(--accent)] font-bold text-[length:var(--fs-body)] whitespace-nowrap" href={`/companies/${company.id}`}>{t("openTheFullFinancialPerformance")}</Link>
                <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("actualsTablesMetricExplanationsAnd")}</span>
              </div>
              {company.rationale && <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">{t("linkingRationale")}{company.rationale}&quot;</p>}
            </section>
          ) : (
            <section className="market-section sizing-step">
              <div className="border border-dashed border-[color:var(--border-bright)] rounded-lg p-6 text-center text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
                {canAct ? (
                  <>
                    {t("noLinkedTargetCompanySearching")}<br />
                    <b>{t("keyMetricsSummaryFullFinancial")}</b>{t("canBeUsed")}
                  </>
                ) : t("noLinkedTargetCompany")}
              </div>
            </section>
          )}

          {canAct && !selectedTarget && (
            <section className="market-section sizing-step mt-3">
              <h3 className="sizing-step-title">{t("linkOrChangeTargetCompany")}</h3>
              <div className="grid gap-2 md:grid-cols-[1fr_auto] items-end">
                <div>
                  <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mb-1">{t("searchByCompanyNameOr")}</div>
                  <input
                    className="sizing-new-input w-full"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
                    placeholder={t("eGKebotic01234567")}
                    aria-label={t("companySearch")}
                  />
                </div>
                <button className="border border-[color:var(--border-bright)] bg-[color:var(--surface)] rounded-lg px-4 py-2 text-[length:var(--fs-body)] cursor-pointer" type="button" onClick={search}>{t("search")}</button>
              </div>
              {results !== null && (
                results.length === 0 ? (
                  <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">{t("noResultsIfTheCompany")}</p>
                ) : (
                  <div className="border border-[color:var(--border)] rounded-lg mt-2">
                    {results.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 border-b border-[color:var(--border-subtle)] last:border-b-0 text-[length:var(--fs-body)]">
                        <b>{c.name_ko}</b>
                        {c.dart_corp_code && <span className="mono text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{c.dart_corp_code}</span>}
                        <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{c.fact_years > 0 ? t("financialDataP1Yr", { p1: c.fact_years }) : t("noFinancialData")}</span>
                        <button className="border border-[color:var(--border-bright)] bg-[color:var(--surface)] rounded-lg px-4 py-2 text-[length:var(--fs-body)] cursor-pointer ml-auto" type="button" disabled={linking} onClick={() => connect(c.id)}>{t("linkThisCompany")}</button>
                      </div>
                    ))}
                  </div>
                )
              )}
              <div className="mt-2">
                <div className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mb-1">{t("linkingRationaleRequired")}</div>
                <input className="sizing-new-input w-full" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={t("eGTopS7Screening")} />
              </div>
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] mt-2">{t("theRoleIsDeterminedAutomatically")} <b>{t("acquisitionTarget")}</b>, greenfield → <b>{t("benchmarkCompanyCandidate")}</b>{t("linkingAndChangesAreRecorded")}</p>
              {view.project.track === "greenfield" && (
                <div className="mt-1 rounded-lg px-3 py-2 text-[length:var(--fs-caption)] bg-[color:var(--warning-bg)] text-[color:var(--amber-fg)] mt-1">
                  <b>{t("greenfieldNotes")}</b> {t("greenfieldEntryHasNoAcquisition")} <b>{t("benchmarkCompany")}</b>{t("linkingItWithoutALink")}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
