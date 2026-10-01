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
import { PageState } from "./ui.tsx";
import { SectionToolbar } from "./layout.tsx";

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
  const [rows, setRows] = useState<CarrierRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstRowRef = useRef<HTMLAnchorElement | null>(null);

  const redirectTarget = useCallback(
    (id: string) => {
      const extra = new URLSearchParams(searchParams.toString());
      extra.delete("opportunity");
      extra.delete("deal");
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
    if (rows !== null && rows.length === 1) router.replace(redirectTarget(rows[0].id));
  }, [rows, redirectTarget, router]);

  // Rule 4 — picker fallback: keyboard focus lands on the first row.
  useEffect(() => {
    if (rows !== null && rows.length > 1) firstRowRef.current?.focus();
  }, [rows]);

  if (carrierId || (rows !== null && rows.length === 1)) {
    return (
      <main>
        <PageState state="loading" />
      </main>
    );
  }

  return (
    <main>
      <SectionToolbar title={TITLE_BY_ROUTE[route]} summary={SUMMARY_BY_ROUTE[route]} />
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
          <p className="text-[0.8rem] text-[color:var(--muted-fg)] mb-3">
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
