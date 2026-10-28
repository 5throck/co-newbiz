"use client";

// 포트폴리오 전체 뷰 (ADR-0122 #4) — 검토/안건 간 중복 노출(같은 산업)과
// 집중도를 그룹 관점에서 감시한다. 개별 판단은 그룹 투자심의위원회가 한다 (경계 #2).
// 중복 감지는 GET /api/portfolio/overlap (design
// 2026-10-11-portfolio-view-overlap §4)가 서버에서 수행한다 — 키는
// md_industry.id이며, name_prefix 계열은 별도 하위 등급으로만 표시된다.
// 클라이언트에서 자유 텍스트 시장 범위로 재그룹화하지 않는다.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { dealStageHref } from "../../lib/deal-links.ts";
import { dedupTermNames } from "../../lib/labels.ts";
import { PageState } from "../../components/ui.tsx";

interface OverlapIndustry {
  id: string;
  name_ko: string;
  name_en: string;
  ksic_code: string | null;
}
interface OverlapMember {
  kind: "opportunity" | "project";
  id: string;
  name: string;
  href: string;
  status?: string;
  industry_pinned: boolean;
  project_no?: string;
  track?: string | null;
}
interface OverlapGroup {
  tier: "exact" | "name_prefix";
  industry: OverlapIndustry | null;
  key_label?: string;
  members: OverlapMember[];
}
interface OverlapResult {
  groups: OverlapGroup[];
  na: {
    opportunities_without_industry: Array<{ id: string; name: string; reason: string }>;
    projects_without_industry: Array<{ id: string; project_no: string; reason: string }>;
    hidden_promoted?: { count: number };
  };
  counts: {
    active_opportunities: number;
    projects: number;
    exact_groups: number;
    name_prefix_groups: number;
    na_opportunities: number;
    na_projects: number;
    na_total?: number;
    hidden_promoted_opportunities?: number;
  };
}

// i18n: N/A reasons and tier badges resolve through pages.portfolioView.* keys at render time.
const NA_REASON_KEY: Record<string, string> = {
  no_pinned_industry: "naReasonNoPinned",
  no_live_binding: "naReasonNoBinding",
  industry_unresolved: "naReasonUnresolved",
};
const NA_REASON_FALLBACK_KEY: Record<string, string> = {
  no_pinned_industry: "naReasonNoPinned",
  no_live_binding: "naReasonNoBinding",
};
const TIER_LABEL_KEY: Record<OverlapGroup["tier"], string> = { exact: "tierExact", name_prefix: "tierNamePrefix" };
const TIER_CLASS: Record<OverlapGroup["tier"], string> = { exact: "status-chip status-unknown", name_prefix: "status-chip status-amber" };
const TIER_ICON: Record<OverlapGroup["tier"], string> = { exact: "✓", name_prefix: "≈" };

function PortfolioView() {
  const t = useTranslations("pages.portfolioView");
  const tc = useTranslations("common");
  const [opps, setOpps] = useState<number | null>(null);
  const [projs, setProjs] = useState<number | null>(null);
  const [result, setResult] = useState<OverlapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<OverlapResult>("/api/portfolio/overlap")
      .then((r) => {
        setResult(r.data);
        setOpps(r.data.counts.active_opportunities);
        setProjs(r.data.counts.projects);
      })
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, []);

  const loading = result === null && error === null;
  const groups = result?.groups ?? [];
  const hiddenCount = result?.na.hidden_promoted?.count ?? result?.counts.hidden_promoted_opportunities ?? 0;
  const naTotal = result?.counts.na_total ?? ((result?.counts.na_opportunities ?? 0) + (result?.counts.na_projects ?? 0));
  const dupCount = (result?.counts.exact_groups ?? 0) + (result?.counts.name_prefix_groups ?? 0);

  const memberLabel = (m: OverlapMember): string =>
    m.kind === "project" ? t("memberProject", { name: m.name }) : t("memberOpportunity", { name: m.name });
  const naReason = (reason: string, fallbackKey: string): string => NA_REASON_KEY[reason] ? t(NA_REASON_KEY[reason]) : t(fallbackKey);

  return (
    <main>
      <h1>{t("heading")}</h1>
      <p className="objective">{t("objective")}</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <div className="summary-cards mb-4">
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{opps ?? 0}</span><span className="text-label">{t("statActiveOpps")}</span></div>
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{projs ?? 0}</span><span className="text-label">{t("statProjects")}</span></div>
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{dupCount}</span><span className="text-label">{t("statDup")}</span></div>
      </div>
      <section className="market-section" aria-label={t("sectionAria")}>
        <h2 className=" mb-2">{t("heading2")} <span className="note">{t("sectionNote")}</span></h2>
        {hiddenCount > 0 && (
          <p className="glass p-3 mb-3 status-amber" role="note">
            <span aria-hidden="true">⚠</span> {t("hiddenNote", { count: hiddenCount })}
          </p>
        )}
        {loading ? <PageState state="loading" /> : groups.length === 0 ? (
          naTotal > 0 || hiddenCount > 0 ? (
            <p className="glass p-3" role="note">
              <span aria-hidden="true">ℹ</span> {t("emptyPartialNote")}
              {naTotal > 0 && <> {t("emptyPartialNaHint")}</>}
            </p>
          ) : (
            <PageState state="empty" emptyText={t("empty")} />
          )
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g, gi) => {
              const tier = g.tier;
              return (
                <article key={`${tier}-${g.industry?.id ?? g.key_label ?? gi}`} className="glass p-3">
                  <h3 className="mb-1 font-semibold">
                    {g.industry ? (
                      <>
                        {(() => {
                          const n = dedupTermNames(g.industry.name_ko, g.industry.name_en);
                          return (
                            <>
                              {n.primary}
                              {n.secondary ? <span className="note ml-1">{n.secondary}</span> : null}
                            </>
                          );
                        })()}
                        <span className="note ml-2">
                          {g.industry.ksic_code ? <>KSIC {g.industry.ksic_code}</> : <>{t("ksicUnset")}</>}
                        </span>
                      </>
                    ) : (
                      <>{g.key_label} <span className="note">{t("noIndustrySuffix")}</span></>
                    )}
                  </h3>
                  <p className="mb-2">
                    <span className={TIER_CLASS[tier]} aria-label={t("precisionAria", { label: t(TIER_LABEL_KEY[tier]) })}>
                      <span aria-hidden="true">{TIER_ICON[tier]}</span> {t(TIER_LABEL_KEY[tier])}
                    </span>
                    {tier === "name_prefix" && <span className="note ml-2">{t("tierNamePrefixNote")}</span>}
                  </p>
                  <ul className="mb-2 pl-5" aria-label={t("membersAria", { count: g.members.length })}>
                    {g.members.map((m) => (
                      <li key={`${m.kind}-${m.id}`}>
                        <Link href={m.href} className="text-[length:var(--fs-caption)] underline">
                          {memberLabel(m)}
                          {m.track ? ` (${m.track})` : ""}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] m-0">
                    {t("groupFootnoteLead")}<strong>{t("groupFootnoteBold")}</strong>{t("groupFootnoteTail")}
                  </p>
                </article>
              );
            })}
          </div>
        )}
        {!loading && (
          <p className="note mt-2" data-testid="overlap-limits-note">
            <span aria-hidden="true">ℹ</span> {t("limitsNote")}
          </p>
        )}
      </section>
      {result && (naTotal > 0 || result.counts.na_opportunities > 0 || result.counts.na_projects > 0) && (
        <section className="market-section mt-4" aria-label={t("naSectionAria")}>
          <h2 className=" mb-2">{t("naHeading")} <span className="note">{t("naNote")}</span></h2>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("naExplainer")}
          </p>
          <ul className="pl-5 text-[length:var(--fs-caption)]">
            {result.na.opportunities_without_industry.map((o) => (
              <li key={o.id}><Link href={dealStageHref(o.id)} className="underline">{t("naOpportunityLink", { name: o.name })}</Link> <span className="note">({naReason(o.reason, "naReasonNoPinned")})</span></li>
            ))}
            {result.na.projects_without_industry.map((p) => (
              <li key={p.id}><Link href={`/projects/${p.id}/process`} className="underline">{t("naProjectLink", { no: p.project_no })}</Link> <span className="note">({naReason(p.reason, "naReasonNoBinding")})</span></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export default function PortfolioOverviewPage() {
  return <Suspense fallback={null}><PortfolioView /></Suspense>;
}
