"use client";

// CarrierGate — flat S1~S7 route → deal-carrier redirect (route-cleanup
// follow-up design §4.2, docs/designs/2026-10-02-route-cleanup-followup-design.md).
// Reuses the pattern proven in /route-decision/page.tsx: redirect when a deal
// carrier is known, show a picker when it is not. Resolution rule:
//   1. Query-string carrier — ?opportunity=<id> (or ?deal=<id> alias)
//      redirects straight to /deals/<id>/sN, preserving all other query params.
//   2. Auto-resolution — otherwise fetch in-progress opportunities per track:
//      /greenfield → greenfield-track only, /brownfield → brownfield-track
//      only, /market /opportunities /synergy → any track (S1~S3 precede track
//      branching). status=selected or later (includePromoted=1, promoted
//      projects included), deleted_at null, newest first.
//   3. Exactly one carrier → router.replace to /deals/<id>/sN.
//   4. Zero or multiple → picker in the /route-decision style
//      (deal-pick-grid rows, real links, keyboard focus on the first row).
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../lib/api.ts";
import { PageState, PrimaryAction } from "./ui.tsx";
import { MarketAnalysisStage } from "./stages/MarketAnalysisStage.tsx";
import { OpportunityFunnelStage } from "./stages/OpportunityFunnelStage.tsx";
import { Breadcrumb } from "./Breadcrumb.tsx";
import { StageFrame } from "./StageFrame.tsx";

export type FlatRouteKey = "market" | "opportunities" | "synergy" | "greenfield" | "brownfield";

/** Flat route → deal-carrier stage tab (design §4.2 table). */
export const FLAT_ROUTE_STAGE: Record<FlatRouteKey, string> = {
  market: "s1",
  opportunities: "s2",
  synergy: "s3",
  greenfield: "s5",
  brownfield: "s6",
};

/** Track filter per flat route — undefined means any track (S1~S3). */
const TRACK_BY_ROUTE: Partial<Record<FlatRouteKey, "greenfield" | "brownfield">> = {
  greenfield: "greenfield",
  brownfield: "brownfield",
};

const TITLE_BY_ROUTE: Record<FlatRouteKey, string> = {
  market: "S1 시장분석",
  opportunities: "S2 기회 발굴",
  synergy: "S3 시너지·전략적 적합성",
  greenfield: "S5 자체 진출",
  brownfield: "S6/S7 대상발굴·선정",
};

const SUMMARY_BY_ROUTE: Record<FlatRouteKey, string> = {
  market: "어느 시장을 볼 것인가? — 산업을 정하고 수요를 추정한다.",
  opportunities: "시장분석(S1) 산출물에서 기회를 발굴하고 매력도를 평가합니다.",
  synergy: "그룹/계열사 역량과의 시너지와 전략적 적합성을 평가해 기회를 선별합니다.",
  greenfield: "Greenfield 경로 — 자체 역량으로 진입할 수 있는지 평가합니다.",
  brownfield: "Brownfield 경로 — 대상 후보를 발굴하고(S6) 선정합니다(S7).",
};

/** Create action of each picker page (R2-A page contract: pickers are list + create + breadcrumb).
    S3-S7 pages need a deal that already passed S1/S2, so their create action starts a new review. */
const CREATE_BY_ROUTE: Record<FlatRouteKey, { label: string; href: string; hint: string }> = {
  market: { label: "새 시장분석 시작", href: "/market?new=1", hint: "산업을 새로 정해 분석을 시작합니다 — 아래 목록은 이미 진행 중인 검토/안건의 S1 화면입니다." },
  opportunities: { label: "새 기회 등록", href: "/opportunities?new=1", hint: "기회를 직접 등록합니다 — 아래 목록은 진행 중인 검토/안건의 S2 화면입니다." },
  synergy: { label: "그룹·계열사 프로파일 등록", href: "/our-company", hint: "시너지 평가는 그룹/계열사 프로파일이 먼저 필요합니다. 새 검토는 시장분석부터 시작합니다." },
  greenfield: { label: "새 검토 시작 (시장분석부터)", href: "/market?new=1", hint: "새 검토는 시장분석(S1)부터 시작합니다." },
  brownfield: { label: "새 검토 시작 (시장분석부터)", href: "/market?new=1", hint: "새 검토는 시장분석(S1)부터 시작합니다." },
};

interface CarrierRow {
  id: string;
  name: string;
  deleted_at: string | null;
  attractiveness_score?: number | null;
  synergy_score?: number | null;
  target_count?: number;
  shortlist_count?: number;
}

function dealHref(id: string, stage: string, extra: URLSearchParams): string {
  const qs = extra.toString();
  return `/deals/${encodeURIComponent(id)}/${stage}${qs ? `?${qs}` : ""}`;
}

function trackFiltered(track: "greenfield" | "brownfield"): Promise<CarrierRow[]> {
  return api
    .get<{ opportunities: CarrierRow[] }>(`/api/${track}`)
    .then((r) => r.data.opportunities.map((o) => ({ ...o, deleted_at: null })));
}

function anyTrack(): Promise<CarrierRow[]> {
  // includePromoted=1 — 승격(project_id)된 검토/안건도 캐리어 후보에 포함한다
  // (/route-decision 피커와 동일). deleted_at이 있는 행은 제외한다.
  return api
    .get<CarrierRow[]>("/api/opportunities?status=selected&includePromoted=1")
    .then((r) => r.data.filter((o) => !o.deleted_at));
}

function CarrierGateInner({ route }: { route: FlatRouteKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stage = FLAT_ROUTE_STAGE[route];
  const carrierId = searchParams.get("opportunity") ?? searchParams.get("deal");
  // Wave C-3 (D-5): "start from a known target" lands on the S2 funnel itself —
  // the carrier is created there, so it must not be redirected to an existing deal.
  const startsKnownTarget = route === "opportunities" && !carrierId && searchParams.get("known_target") === "1";
  // R2-A item 1: "새 시장분석 시작" / "새 기회 등록" land on the working form directly,
  // never on the deal picker and never auto-redirected into an unrelated deal.
  const startsNew = !carrierId && searchParams.get("new") === "1" && (route === "market" || route === "opportunities");
  const [rows, setRows] = useState<CarrierRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstRowRef = useRef<HTMLAnchorElement | null>(null);

  const redirectTarget = useCallback(
    (id: string, moved = false) => {
      const extra = new URLSearchParams(searchParams.toString());
      extra.delete("opportunity");
      extra.delete("deal");
      // R2-A item 8: an automatic redirect is announced on the destination (AppShell notice).
      if (moved) extra.set("moved", route);
      return dealHref(id, stage, extra);
    },
    [searchParams, stage],
  );

  // Rule 1 — query-string carrier: redirect straight through, other params preserved.
  useEffect(() => {
    if (carrierId) router.replace(redirectTarget(carrierId));
  }, [carrierId, redirectTarget, router]);

  // Rule 2 — auto-resolution: fetch in-progress carriers per track.
  const loadRows = useCallback(() => {
    const track = TRACK_BY_ROUTE[route];
    const p = track ? trackFiltered(track) : anyTrack();
    p.then(setRows).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, [route]);

  useEffect(() => {
    if (carrierId) return;
    loadRows();
  }, [carrierId, loadRows]);

  // Rule 3 — exactly one carrier: redirect (client-side router.replace).
  useEffect(() => {
    if (rows !== null && rows.length === 1 && !startsKnownTarget && !startsNew) router.replace(redirectTarget(rows[0].id, true));
  }, [rows, redirectTarget, router, startsKnownTarget, startsNew]);

  // Rule 4 — picker fallback: keyboard focus lands on the first row.
  useEffect(() => {
    if (rows !== null && rows.length > 1) firstRowRef.current?.focus();
  }, [rows]);

  // S1 precedes any deal carrier (a carrier is created in S2), so with zero
  // carriers /market renders the S1 screen itself. The empty state below would
  // send the person back to the board, whose "new review" action links here —
  // a dead loop found by the pilot-009 system re-run (Wave C-2).
  if (route === "market" && !error && rows !== null && (rows.length === 0 || startsNew)) {
    return (
      <main>
        <MarketAnalysisStage embedded startNew={startsNew} />
      </main>
    );
  }

  // Same dead loop for S2 (pilot-009 C-3 re-run): the funnel's registration form
  // is the only way to create the first carrier, so with no deal (or when the
  // person asked to start from a known target) render the funnel itself.
  if (route === "opportunities" && !carrierId && !error && rows !== null && (rows.length === 0 || startsKnownTarget || startsNew)) {
    return (
      <main>
        <StageFrame stageId="S2">{SUMMARY_BY_ROUTE.opportunities}</StageFrame>
        <OpportunityFunnelStage startRegister={startsKnownTarget || startsNew ? (startsKnownTarget ? "known_target" : "name") : undefined} />
      </main>
    );
  }

  if (carrierId || (rows !== null && rows.length === 1 && !startsKnownTarget && !startsNew)) {
    return (
      <main>
        <PageState state="loading" />
      </main>
    );
  }

  return (
    <main>
      <Breadcrumb items={[{ label: "홈", href: "/" }, { label: "검토/안건", href: "/deals" }, { label: TITLE_BY_ROUTE[route] }]} />
      <div className="stage-head">
        <h1>{TITLE_BY_ROUTE[route]}</h1>
        <PrimaryAction inline href={CREATE_BY_ROUTE[route].href} label={CREATE_BY_ROUTE[route].label} />
      </div>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[0.9rem]">
        {SUMMARY_BY_ROUTE[route]} {CREATE_BY_ROUTE[route].hint}
      </p>
      {error && <PageState state="error" errorText={error} onRetry={loadRows} />}
      {!error && rows === null && <PageState state="loading" />}
      {!error && rows !== null && rows.length === 0 && (
        <PageState
          state="empty"
          emptyText="진행 중인 검토/안건이 없습니다 — 검토/안건 보드에서 새 검토를 시작하세요."
          // empty state는 대화형 막다른 길이 없어야 한다(설계 §6) — 안내 링크만.
          emptyAction={
            <Link href="/deals" className="btn-ghost btn-sm">
              검토/안건 보드로 이동 →
            </Link>
          }
        />
      )}
      {!error && rows !== null && rows.length > 1 && (
        <div className="card">
          <h2>검토/안건 선택</h2>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-3">
            여러 진행 중인 검토/안건이 있어 어느 곳으로 갈지 자동으로 정할 수 없습니다 — 열 화면({TITLE_BY_ROUTE[route]})을 열 검토/안건을 선택하세요.
          </p>
          <div className="deal-pick-grid">
            {rows.map((o, i) => (
              <Link
                key={o.id}
                ref={i === 0 ? firstRowRef : undefined}
                href={dealHref(o.id, stage, new URLSearchParams())}
                className="deal-pick-card"
              >
                <span className="deal-pick-card-title">{o.name}</span>
                <span className="deal-pick-card-stats">
                  <span className="status-chip status-not-started">
                    매력도 <strong className="ml-1">{o.attractiveness_score ?? "—"}</strong>
                  </span>
                  <span className="status-chip status-not-started">
                    시너지 <strong className="ml-1">{o.synergy_score ?? "—"}</strong>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

/** Suspense wrapper — useSearchParams requires one (same as /route-decision). */
export function CarrierGate({ route }: { route: FlatRouteKey }) {
  return (
    <Suspense fallback={null}>
      <CarrierGateInner route={route} />
    </Suspense>
  );
}
