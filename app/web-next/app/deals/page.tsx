"use client";

// /deals — the deal board (ADR-0120): every deal as one funnel — opportunities
// (S1–S7) and projects (S8–S12), gate aging, and paused-pipeline widgets.
// Read-only overview; decisions stay on their stage surfaces (boundary #2).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { api } from "../../lib/api.ts";
import { useAuth } from "../../lib/auth-client.tsx";
import { ColGroup, FilterChip, PageState, PrimaryAction } from "../../components/ui.tsx";
import { DealIntakeModal, type DealIntakeSource } from "../../components/DealIntakeModal.tsx";
import { STAGE_TAB_GROUPS } from "../../lib/stage-tabs.ts";
import { SectionToolbar } from "../../components/layout.tsx";
import { GATE_LABEL_KEY } from "../../lib/label-keys.ts";
import { opportunityStatusHref } from "../../lib/deal-links.ts";
import { gateHoldHref } from "../../lib/inbox.ts";
import { buildCardChips } from "../../lib/deal-card-label.ts";

// 진행 에이징 표 열 비율(2026-10-11-table-column-sizing-system batch 2) —
// 안건명이 본문, 게이트·결정·KILL 평가·날짜·경과 열은 좁게. D6 (B-3)에서
// KILL 평가 열이 결정과 결정일 사이에 추가되어 재배분했다.
const AGING_COL_PCT = [28, 14, 12, 16, 14, 16] as const;

type KillEvalState = "triggered" | "false" | "unassessed";

// D6 (B-3) — kill-evaluation chip. Text-carried state (accessibility): the
// label carries the meaning, the class only reuses the existing status tokens.
// Honesty rule (DEC-mandated): "unassessed" is amber + explicit text, NEVER a
// green/pass class; null (no ledger / MNPI non-insider suppression) renders
// "—" — a non-claim, not a pass.
const KILL_EVAL_CHIP_CLASS: Record<KillEvalState, string> = {
  triggered: "status-red",
  false: "status-not-started",
  unassessed: "status-amber",
};
const KILL_EVAL_LABEL_KEY: Record<KillEvalState, string> = {
  triggered: "pages.deals.killEval.triggered",
  false: "pages.deals.killEval.evaluatedFalse",
  unassessed: "pages.deals.killEval.unassessed",
};

interface PipelineProject {
  projectId: string;
  projectNo: string;
  projectName: string | null;
  track: string | null;
  currentStage: string | null;
  nextStage: string | null;
  gates: Record<string, string>;
  blockers: string[];
}
interface AgingRow {
  entityType: "opportunity" | "project";
  entityId: string;
  label: string;
  gate: string;
  decision: string;
  decidedAt: string;
  ageDays: number;
  /** D6 (B-3): kill-criteria evaluation state (project rows only; null = no ledger row or MNPI-suppressed → "—"). */
  killEval?: KillEvalState | null;
}
interface PipelineView {
  projects: PipelineProject[];
  currentHolds: AgingRow[];
}
interface OpportunityRow {
  id: string;
  name: string;
  market_scope: string | null;
  attractiveness_score: number | null;
  synergy_score: number | null;
  status: "identified" | "assessed" | "selected" | "dropped";
  project_id: string | null;
  /** 1 when an S4 route decision is recorded (waiting label must not say S4 대기 then). */
  route_decided?: number | boolean | null;
}

type Track = "greenfield" | "brownfield";
// i18n: track chips resolve through common.track.* catalog keys at render
// time (/projects keeps its own Korean TRACK_LABEL until its extraction batch).
const TRACK_KEY: Record<Track, string> = {
  greenfield: "common.track.greenfield",
  brownfield: "common.track.brownfield",
};

// Module scope so the board's cards useMemo can hold a stable reference
// (component-scope closures would defeat the memo and trip
// useExhaustiveDependencies). Pure — no state or translator captured.
const stageOf = (o: OpportunityRow): string => {
  if (o.status === "identified") return "S2";
  if (o.status === "assessed") return "S3";
  if (o.status === "selected") return "S4";
  return "—";
};
const waitingKeyFor = (o: OpportunityRow): string =>
  o.project_id
    ? "pages.deals.waitingPromoted"
    : o.route_decided
      ? "pages.deals.waitingRouteDecided"
      : "pages.deals.waitingS4";

type CardTone = "gray" | "amber" | "green";
type Card = {
  kind: "opportunity" | "project";
  id: string;
  name: string;
  queryText: string;
  stage: string;
  stageLabel: string;
  holdLabelKeys: string[] | null;
  tone: CardTone;
  hold: boolean;
  track: Track | null;
  meta: string;
  href: string;
  /** Promoted projects: the opportunity they came from (S1-S4 live there). */
  sourceHref?: string;
};
type PausedInfo = { reason: string; link: string | null };

type FilterKey = "all" | "greenfield" | "brownfield" | "gate" | "paused";
// i18n: chip labels resolve through catalog keys at render (common.* reuse + pages.deals.filterPaused).
const FILTERS: Array<[FilterKey, string]> = [
  ["all", "common.all"],
  ["greenfield", "common.track.greenfield"],
  ["brownfield", "common.track.brownfield"],
  ["gate", "pages.deals.filterHold"],
  ["paused", "pages.deals.filterPaused"],
];

function DealsBoard() {
  const t = useTranslations();
  const { me } = useAuth();
  const isAdmin = me?.role === "admin";
  const [data, setData] = useState<PipelineView | null>(null);
  const [opps, setOpps] = useState<OpportunityRow[] | null>(null);
  const [paused, setPaused] = useState<Record<string, PausedInfo>>({});
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // ADR-0197 — both board CTAs record the client-request intake first (a
  // small modal, source derived from the CTA clicked); the modal then rides
  // the original destination's query-carrier exemption as &intake=<id>.
  const [intakeSource, setIntakeSource] = useState<DealIntakeSource | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch is keyed on the admin gate — t is only read in the error fallback; adding the translator would refetch on translator identity churn
  const load = useCallback(() => {
    api
      .get<PipelineView>("/api/portfolio/pipeline")
      .then((r) => setData(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : t("pages.deals.loadFailed")));
    // /api/opportunities is a business route (requireBusinessActor) that answers 403 for the
    // admin role (ADR-0091/0146); admin lands here via "/" but has no opportunity list to show.
    if (isAdmin) {
      setOpps([]);
      return;
    }
    api
      .get<OpportunityRow[]>("/api/opportunities")
      .then((r) => setOpps(r.data))
      .catch(() => setOpps([]));
  }, [isAdmin]);
  useEffect(() => {
    load();
  }, [load]);

  // Paused-pipeline banners (ADR-0102 deep links): fetched only for board-size
  // N once the list arrives. Keyed by the run's current carrier (entity_id) so
  // a project-segment pause lights up the project card, not the source opp.
  useEffect(() => {
    if (!opps) return;
    const targets = opps.filter((o) => o.status !== "dropped");
    for (const o of targets) {
      api
        .get<{ status: string; entity_id: string; paused_reason: string | null; deep_link: string | null }>(
          `/api/opportunities/${encodeURIComponent(o.id)}/pipeline/status`,
        )
        .then((r) => {
          // status "none" = 아직 파이프라인 실행 없음(정상 상태) — 배너 없이 무시
          if (r.data.status === "none") return;
          if (r.data.status === "paused_for_human" && r.data.paused_reason) {
            setPaused((prev) => ({
              ...prev,
              [r.data.entity_id]: { reason: r.data.paused_reason as string, link: r.data.deep_link },
            }));
          }
        })
        .catch(() => undefined);
    }
  }, [opps]);

  const stageNum = (s: string) => (s.startsWith("S") ? Number(s.slice(1)) : 99);

  // 검토/안건(기회) 단위 HOLD — /deals의 "HOLD" 필터와 같은 출처
  // (currentHolds, 나이 무관). 카드 자체의 HOLD 표시에도 그대로 쓴다. 단순히
  // 다음 단계를 기다리는 "대기" 상태(예: "S4 대기")와는 다른 개념이다 —
  // 필터 이름을 "진행 대기"로 두면 이 둘이 혼동된다(2026-09-15 사용자 리포트).
  const opportunityHolds = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of data?.currentHolds ?? []) {
      if (r.decision !== "hold" || r.entityType !== "opportunity") continue;
      m.set(r.entityId, [...(m.get(r.entityId) ?? []), r.gate]);
    }
    return m;
  }, [data]);

  const cards: Card[] = useMemo(() => {
    // 승격(project_id)됐지만 그 프로젝트가 실제로 보이는(열려있고 삭제 안 된)
    // 경우에만 기회 카드를 뺀다 — 프로젝트가 나중에 삭제돼 project_id가
    // 허상으로 남은 기회는 계속 기회 카드로 보여야, 카드가 통째로 사라지지
    // 않는다.
    const visibleProjectIds = new Set((data?.projects ?? []).map((p) => p.projectId));
    // 기회는 S4(진출방식 결정)에서 트랙이 정해지므로 S1~S4 기회 카드는 항상
    // 트랙 미결정 — 그린필드/브라운필드 필터는 프로젝트(S8+)에만 걸린다.
    const oppCards: Card[] = (opps ?? [])
      .filter((o) => o.status !== "dropped")
      .filter((o) => !(o.project_id && visibleProjectIds.has(o.project_id)))
      .map((o): Card => {
        const stage = stageOf(o);
        const holdGates = opportunityHolds.get(o.id) ?? [];
        const hold = holdGates.length > 0;
        const chips = buildCardChips(stage, holdGates, o.status === "selected" ? t(waitingKeyFor(o)) : undefined);
        return {
          kind: "opportunity",
          id: o.id,
          name: o.name,
          queryText: o.name,
          stage,
          // "대기"(자연스러운 다음 단계 대기)와 "HOLD"(게이트에서 명시적으로
          // 내린 보류 결정)는 서로 다른 개념이다 — 둘 다 amber로 칠하면
          // 구분이 안 된다(2026-09-15 사용자 리포트). HOLD만 amber, 단순
          // 대기는 gray.
          ...chips,
          tone: "gray",
          hold,
          track: null,
          meta: t("pages.deals.metaScores", { p1: o.attractiveness_score ?? "—", p2: o.synergy_score ?? "—" }),
          href: opportunityStatusHref(o.id, o.status),
        };
      });
    const oppByProject = new Map<string, string>();
    for (const o of opps ?? []) if (o.project_id) oppByProject.set(o.project_id, o.id);
    const projectCards: Card[] = (data?.projects ?? []).map((p): Card => {
      const stage = p.currentStage ?? "S8";
      const holdGates = Object.entries(p.gates)
        .filter(([, v]) => v === "hold")
        .map(([g]) => g);
      const hold = holdGates.length > 0;
      const chips = buildCardChips(stage, holdGates);
      const track: Track | null = p.track === "greenfield" || p.track === "brownfield" ? p.track : null;
      const sourceOppId = oppByProject.get(p.projectId);
      return {
        kind: "project",
        id: p.projectId,
        name: p.projectName ?? p.projectNo,
        queryText: `${p.projectName ?? ""} ${p.projectNo}`,
        stage,
        ...chips,
        tone: stage === "S12" ? "green" : "gray",
        hold,
        track,
        meta: p.projectNo,
        href: projectStageHref(p.projectId, stage),
        sourceHref: sourceOppId ? `/deals/${encodeURIComponent(sourceOppId)}/s4` : undefined,
      };
    });
    return [...oppCards, ...projectCards];
  }, [opps, data, opportunityHolds, t]);

  const pausedIds = useMemo(() => new Set(Object.keys(paused)), [paused]);

  const matches = useCallback(
    (c: Card, f: FilterKey) =>
      f === "all"
        ? true
        : f === "greenfield"
          ? c.track === "greenfield"
          : f === "brownfield"
            ? c.track === "brownfield"
            : f === "gate"
              ? c.hold
              : pausedIds.has(c.id),
    [pausedIds],
  );

  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const [k] of FILTERS) out[k] = cards.filter((c) => matches(c, k)).length;
    return out;
  }, [cards, matches]);

  const visible = cards
    .filter((c) => matches(c, filter))
    .filter((c) => !query || c.queryText.toLowerCase().includes(query.toLowerCase()));

  // i18n: column titles resolve through pages.deals.* keys at render.
  const columns = [
    { titleKey: "pages.deals.colDiscovery", test: (n: number) => n <= 3 },
    { titleKey: "pages.deals.colStrategy", test: (n: number) => n >= 4 && n <= 7 },
    { titleKey: "pages.deals.colBusinessDd", test: (n: number) => n >= 8 && n <= 10 },
    { titleKey: "pages.deals.colReviewPost", test: (n: number) => n >= 11 },
  ];

  const stageTone: Record<CardTone, string> = {
    gray: "status-not-started",
    amber: "status-amber",
    green: "status-green",
  };

  return (
    <main>
      {intakeSource && <DealIntakeModal source={intakeSource} onClose={() => setIntakeSource(null)} />}
      <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 8 }}>
        <h1>{t("pages.deals.h1")}</h1>
        <span className="ml-auto">
          <PrimaryAction inline onClick={() => setIntakeSource("board_new_deal")} label={t("pages.deals.newDealCta")} />
          <button type="button" className="btn-ghost ml-2" onClick={() => setIntakeSource("board_known_target")}>
            {t("pages.deals.knownTargetCta")}
          </button>
        </span>
      </div>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        {t("pages.deals.intro")}
      </p>
      {/* R2-A item 8: every screen that has no sidebar entry is reachable from here. */}
      <nav aria-label={t("pages.deals.shortcutsNav")} className="flex flex-wrap items-center gap-1 mb-3">
        <span className="section-meta">{t("pages.deals.shortcutsLabel")}</span>
        {SHORTCUTS.map(([href, labelKey]) => (
          <Link key={href} href={href} className="btn-ghost btn-sm">
            {t(labelKey)}
          </Link>
        ))}
      </nav>

      <SectionToolbar
        filters={
          // biome-ignore lint/a11y/useSemanticElements: filter chip group — a fieldset would change the toolbar DOM/styling shared across board sections
          <span role="group" aria-label={t("pages.deals.filterGroup")} className="flex flex-wrap items-center gap-1">
            <span className="section-meta">{t("pages.deals.filterLabel")}</span>
            {FILTERS.map(([k, labelKey]) => (
              <FilterChip key={k} selected={filter === k} onClick={() => setFilter(k)}>
                {t(labelKey)} <span className="tabular-nums">{counts[k]}</span>
              </FilterChip>
            ))}
          </span>
        }
        actions={
          <span className="flex items-center gap-1">
            <input
              ref={searchRef}
              aria-label={t("pages.deals.searchAria")}
              placeholder={t("pages.deals.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sizing-new-input sizing-new-input-sm"
              style={{ width: 160 }}
            />
            <button type="button" className="btn-ghost btn-sm" onClick={() => searchRef.current?.focus()}>
              <svg
                className="ic"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>{" "}
              {t("pages.deals.searchCta")}
            </button>
          </span>
        }
      />

      {error && (
        <p role="alert" className="text-[color:var(--red-fg)]">
          {error}
        </p>
      )}
      {!data && !error && <PageState state="loading" rows={4} />}

      {data && (opps ?? []).filter((o) => o.status !== "dropped").length === 0 && data.projects.length === 0 && (
        <div className="market-section mb-4" style={{ border: "1px dashed var(--border)" }}>
          <h2 className=" mb-1">{t("pages.deals.emptyTitle")}</h2>
          <p className="text-[length:var(--fs-caption)]" style={{ margin: "0 0 var(--space-2)" }}>
            {t("pages.deals.emptyBody")}
          </p>
          <Link
            href="/onboarding"
            className="btn-ghost btn-sm"
            style={{ textDecoration: "none", display: "inline-block" }}
          >
            {t("pages.deals.emptyCta")}
          </Link>
        </div>
      )}

      {data && (
        <>
          <div className="funnel-board" style={{ marginBottom: 16 }}>
            {columns.map((col) => {
              const colCards = visible.filter((c) => col.test(stageNum(c.stage)));
              const colTitle = t(col.titleKey);
              return (
                <section key={col.titleKey} className="funnel-col" aria-label={colTitle}>
                  <h3>
                    {colTitle} <span className="funnel-count tabular-nums">{colCards.length}</span>
                  </h3>
                  <div className="funnel-cards">
                    {colCards.map((c) => {
                      const p = paused[c.id];
                      return (
                        <div key={c.id}>
                          <Link
                            href={c.href}
                            className="funnel-card"
                            style={{ color: "inherit", textDecoration: "none" }}
                          >
                            <span className="funnel-card-name font-semibold">{c.name}</span>
                            <span className="funnel-card-meta">
                              <span className={`status-chip ${stageTone[c.tone]}`}>{c.stageLabel}</span>
                              {c.holdLabelKeys && (
                                <span className="status-chip status-amber">
                                  {c.holdLabelKeys.map((k) => t(k)).join("·")} HOLD
                                </span>
                              )}
                              {c.track ? (
                                <span
                                  className={`status-chip ${c.track === "greenfield" ? "status-green" : "status-amber"}`}
                                >
                                  {t(TRACK_KEY[c.track])}
                                </span>
                              ) : c.kind === "project" ? (
                                <span className="status-chip status-not-started">
                                  {t("pages.deals.trackUndecided")}
                                </span>
                              ) : null}
                              <span>{c.meta}</span>
                            </span>
                            {p && (
                              <span className="funnel-card-meta" style={{ color: "var(--amber-fg)" }}>
                                {t("pages.deals.pausedWarning", { p1: p.reason })}
                                {p.link && (
                                  <>
                                    {" "}
                                    · <span className="font-semibold">{t("pages.deals.resumeLink")}</span>
                                  </>
                                )}
                              </span>
                            )}
                          </Link>
                          {c.sourceHref && (
                            <Link href={c.sourceHref} className="btn-ghost btn-sm">
                              {t("pages.deals.viewOpportunity")}
                            </Link>
                          )}
                        </div>
                      );
                    })}
                    {colCards.length === 0 && <p className="funnel-empty">{t("pages.deals.emptyColumn")}</p>}
                  </div>
                </section>
              );
            })}
          </div>

          <section className="market-section" aria-label={t("pages.deals.agingSection")}>
            <h3 className="sizing-step-title text-[length:var(--fs-body)] mb-1">{t("pages.deals.agingHeading")}</h3>
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
              {t("pages.deals.agingNote", {
                p1: Object.values(GATE_LABEL_KEY)
                  .map((k) => t(k))
                  .join("·"),
              })}
            </p>
            {data.currentHolds.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
                {t("pages.deals.agingEmpty")}
              </p>
            ) : (
              <section
                className="table-scroll"
                aria-label={t("pages.deals.tableScrollRegion")}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-scrollable table region (WCAG 2.1.1) — dropping tabIndex would strand keyboard users inside the scroll
                tabIndex={0}
              >
                <table className="data-table table-fixed-pct tmin-48" aria-label={t("pages.deals.agingTableAria")}>
                  <caption className="sr-only">{t("pages.deals.agingTableCaption")}</caption>
                  <ColGroup widths={AGING_COL_PCT} />
                  <thead>
                    <tr>
                      <th scope="col">{t("pages.deals.colDeal")}</th>
                      <th scope="col">{t("pages.deals.colGate")}</th>
                      <th scope="col">{t("pages.deals.colDecision")}</th>
                      <th scope="col">{t("pages.deals.colKillEval")}</th>
                      <th scope="col">{t("pages.deals.colDecidedAt")}</th>
                      <th scope="col" className="col-num">
                        {t("pages.deals.colAge")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.currentHolds]
                      .sort((a, b) => b.ageDays - a.ageDays)
                      .map((r) => (
                        <tr key={`${r.entityType}:${r.entityId}:${r.gate}`}>
                          <td className="cell-truncate text-[length:var(--fs-caption)]">
                            <Link
                              href={r.entityType === "project" ? `/projects/${r.entityId}/process` : gateHoldHref(r)}
                            >
                              {r.label}
                            </Link>
                          </td>
                          <td className="tabular-nums text-[length:var(--fs-caption)]">
                            {t(GATE_LABEL_KEY[r.gate] ?? r.gate)}
                          </td>
                          <td>
                            <span className={`status-chip ${r.decision === "kill" ? "status-red" : "status-amber"}`}>
                              {r.decision.toUpperCase()}
                            </span>
                          </td>
                          <td className="text-[length:var(--fs-caption)]">
                            {/* D6 honesty rule: null is "—" (a non-claim, not a pass); unassessed is amber + text, never green. */}
                            {r.killEval ? (
                              <span className={`status-chip ${KILL_EVAL_CHIP_CLASS[r.killEval]}`}>
                                {t(KILL_EVAL_LABEL_KEY[r.killEval])}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="text-[length:var(--fs-caption)] tabular-nums">{r.decidedAt.slice(0, 10)}</td>
                          <td className="col-num tabular-nums text-[length:var(--fs-caption)]">
                            {t("pages.deals.ageDays", { p1: r.ageDays })}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            )}
          </section>
        </>
      )}
    </main>
  );
}

/** Opening a deal lands on the workspace of the stage it is currently in (design: "one thing to do next"). */
function projectStageHref(projectId: string, stage: string): string {
  const group = STAGE_TAB_GROUPS.find((g) => g.stage === stage);
  return `/projects/${projectId}${group?.tabs[0]?.seg ?? "/process"}`;
}

/** Entry points for routes that are not in the sidebar (orphan-route decision, design §3.6). */
// i18n: shortcut labels are catalog keys (pages.deals.shortcut*) resolved at render.
const SHORTCUTS: Array<[string, string]> = [
  ["/projects", "pages.deals.shortcutProjects"],
  ["/portfolio-view", "pages.deals.shortcutPortfolio"],
  ["/our-company", "pages.deals.shortcutOurCompany"],
  ["/companies", "pages.deals.shortcutCompanies"],
  ["/agents", "pages.deals.shortcutAgents"],
  ["/onboarding", "pages.deals.shortcutOnboarding"],
];

export default function DealsPage() {
  return (
    <Suspense fallback={null}>
      <DealsBoard />
    </Suspense>
  );
}
