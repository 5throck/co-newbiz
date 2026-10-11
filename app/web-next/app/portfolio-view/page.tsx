"use client";

// 포트폴리오 전체 뷰 (ADR-0122 #4) — 검토/안건 간 중복 노출(같은 산업)과
// 집중도를 그룹 관점에서 감시한다. 개별 판단은 Group IC가 한다 (경계 #2).
// 중복 감지는 GET /api/portfolio/overlap (design
// 2026-10-11-portfolio-view-overlap §4)가 서버에서 수행한다 — 키는
// md_industry.id이며, name_prefix 계열은 별도 하위 등급으로만 표시된다.
// 클라이언트에서 자유 텍스트 시장 범위로 재그룹화하지 않는다.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
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

const NA_REASON_LABEL: Record<string, string> = {
  no_pinned_industry: "산업 미지정",
  no_live_binding: "산업 바인딩 없음",
  industry_unresolved: "산업 정보를 확인하지 못함",
};
function naReason(reason: string, fallback: string): string {
  return NA_REASON_LABEL[reason] ?? fallback;
}

const TIER_BADGE: Record<OverlapGroup["tier"], { label: string; className: string; icon: string; note?: string }> = {
  exact: { label: "산업 일치", className: "status-chip status-unknown", icon: "✓" },
  name_prefix: {
    label: "근사 매칭",
    className: "status-chip status-amber",
    icon: "≈",
    note: "시장 범위 문자열이 같은 경우의 근사 매칭(자유 텍스트 우연 일치)입니다 — 행동 전에 검증하세요.",
  },
};

function memberLabel(m: OverlapMember): string {
  return m.kind === "project" ? `프로젝트 — ${m.name}` : `기회 — ${m.name}`;
}

function PortfolioView() {
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
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const loading = result === null && error === null;
  const groups = result?.groups ?? [];
  const hiddenCount = result?.na.hidden_promoted?.count ?? result?.counts.hidden_promoted_opportunities ?? 0;
  const naTotal = result?.counts.na_total ?? ((result?.counts.na_opportunities ?? 0) + (result?.counts.na_projects ?? 0));
  const dupCount = (result?.counts.exact_groups ?? 0) + (result?.counts.name_prefix_groups ?? 0);

  return (
    <main>
      <h1>포트폴리오 전체 뷰</h1>
      <p className="objective">검토/안건 간 중복 노출과 집중도를 그룹 관점에서 감시합니다 (group-review-agent) — 개별 판단은 Group IC가 합니다.</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <div className="summary-cards mb-4">
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{opps ?? 0}</span><span className="text-label">활성 기회</span></div>
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{projs ?? 0}</span><span className="text-label">프로젝트 (S8~)</span></div>
        <div className="summary-card glass text-left"><span className="summary-value mono-num">{dupCount}</span><span className="text-label">시장 중복 후보</span></div>
      </div>
      <section className="market-section" aria-label="중복 감지">
        <h2 className="text-[0.9rem] mb-2">시장 중복 감지 <span className="note">— 같은 산업(또는 근사 시장 범위)에 활성 노출 2건 이상</span></h2>
        {hiddenCount > 0 && (
          <p className="glass p-3 mb-3 status-amber" role="note">
            <span aria-hidden="true">⚠</span> 승격된 안건 {hiddenCount}건은 해당 프로젝트를 볼 수 있는 권한이 없어 제외되었습니다 — 표시된 노출 규모가 실제보다 작을 수 있습니다.
          </p>
        )}
        {loading ? <PageState state="loading" /> : groups.length === 0 ? (
          naTotal > 0 || hiddenCount > 0 ? (
            <p className="glass p-3" role="note">
              <span aria-hidden="true">ℹ</span> 일부 항목은 중복 여부를 판단할 수 없었습니다 — 중복 후보가 없다는 뜻이 아닙니다.
              {naTotal > 0 && <> 아래 &lsquo;산업 미지정 (N/A)&rsquo; 항목을 확인하세요.</>}
            </p>
          ) : (
            <PageState state="empty" emptyText="중복 노출 후보가 없습니다." />
          )
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g, gi) => {
              const badge = TIER_BADGE[g.tier];
              return (
                <article key={`${g.tier}-${g.industry?.id ?? g.key_label ?? gi}`} className="glass p-3">
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
                          {g.industry.ksic_code ? <>KSIC {g.industry.ksic_code}</> : <>KSIC 미지정</>}
                        </span>
                      </>
                    ) : (
                      <>{g.key_label} <span className="note">(산업 미지정 — 시장 범위 문자열 일치)</span></>
                    )}
                  </h3>
                  <p className="mb-2">
                    <span className={badge.className} aria-label={`정밀도: ${badge.label}`}>
                      <span aria-hidden="true">{badge.icon}</span> {badge.label}
                    </span>
                    {badge.note && <span className="note ml-2">{badge.note}</span>}
                  </p>
                  <ul className="mb-2 pl-5" aria-label={`${g.members.length}건 노출`}>
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
                    이 그룹은 통합 시너지 검토 또는 시기 조정을 <strong>제안</strong>합니다 — 판단은 Group IC가 합니다.
                  </p>
                </article>
              );
            })}
          </div>
        )}
        {!loading && (
          <p className="note mt-2" data-testid="overlap-limits-note">
            <span aria-hidden="true">ℹ</span> 기회와 프로젝트 간 중복은 프로젝트에 산업 바인딩이 있고 기회에 산업이 지정(고정)된 경우에만 감지됩니다. 해당 정보가 없는 항목은 N/A로 따로 표시되며 비교하지 않습니다.
          </p>
        )}
      </section>
      {result && (naTotal > 0 || result.counts.na_opportunities > 0 || result.counts.na_projects > 0) && (
        <section className="market-section mt-4" aria-label="산업 미지정 항목">
          <h2 className="text-[0.9rem] mb-2">산업 미지정 (N/A) <span className="note">— 키가 없어 중복 감지 대상에서 제외된 항목</span></h2>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            산업이 지정(고정)되지 않은 항목은 중복 노출 후보로 묶이지 않습니다 — 임의로 그룹화하지 않습니다.
            기회는 S1 산업 지정에서, 프로젝트는 S8+ 산업 바인딩에서 지정할 수 있습니다.
          </p>
          <ul className="pl-5 text-[length:var(--fs-caption)]">
            {result.na.opportunities_without_industry.map((o) => (
              <li key={o.id}><Link href={dealStageHref(o.id)} className="underline">기회 — {o.name}</Link> <span className="note">({naReason(o.reason, "산업 미지정")})</span></li>
            ))}
            {result.na.projects_without_industry.map((p) => (
              <li key={p.id}><Link href={`/projects/${p.id}/process`} className="underline">프로젝트 — {p.project_no}</Link> <span className="note">({naReason(p.reason, "산업 바인딩 없음")})</span></li>
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
