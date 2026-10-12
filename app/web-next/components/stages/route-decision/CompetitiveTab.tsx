"use client";

// Split from components/stages/RouteDecisionStage.tsx (Wave U-3 decomposition); behavior unchanged.
import Link from "next/link";
import { ColGroup } from "../../ui.tsx";
import { S4_COMPETITIVE_COL_PCT } from "./constants.ts";
import type { RouteDecisionStageState } from "./useRouteDecision.ts";
import type { OpportunityRow } from "./types.ts";

export function CompetitiveTab({ ctx, selected }: { ctx: RouteDecisionStageState; selected: OpportunityRow }) {
  const { tab, advisory } = ctx;
  return (
    <>{tab === "competitive" && (
        <div className="card">
          <h2>{selected.name} — 경쟁 구조</h2>
          {advisory === null ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
              근거를 불러오지 못했습니다 — 새로고침하거나 S1 시장분석을 먼저 완료하세요.
            </p>
          ) : advisory.s1Evidence?.competitive ? (
            <>
              <h4 className="text-[length:var(--fs-body)] mb-1">
                경쟁 구조 (S1 v{advisory.s1Evidence.versionNo ?? "?"} — {advisory.s1Evidence.industryName})
              </h4>
              <p className="text-[length:var(--fs-caption)] mb-1">{advisory.s1Evidence.competitive.structure}</p>
              {advisory.s1Evidence.competitive.players.length > 0 && (
                <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
                  <table className="data-table mb-0 table-fixed-pct tmin-40" aria-label="경쟁 구조 — 주요 기업">
                    <caption className="sr-only">경쟁 구조 — 주요 기업</caption>
                    <ColGroup widths={S4_COMPETITIVE_COL_PCT} />
                    <thead>
                      <tr><th scope="col">기업</th><th scope="col">티어</th><th scope="col">비고</th></tr>
                    </thead>
                    <tbody>
                      {advisory.s1Evidence.competitive.players.map((p) => (
                        <tr key={p.name}>
                          <td className="cell-primary">{p.name}</td>
                          <td>
                            <span className={`status-chip ${p.tier === "leader" ? "status-green" : p.tier === "challenger" ? "status-amber" : "status-not-started"}`}>
                              {p.tier === "leader" ? "리더" : p.tier === "challenger" ? "도전자" : "니치"}
                            </span>
                          </td>
                          <td className="cell-truncate text-[length:var(--fs-caption)]">{p.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-0">
              경쟁 구조 미기록 —{" "}
              {selected.market_scope ? (
                <Link href={`/market?industry=${encodeURIComponent(selected.market_scope)}`} className="text-[color:var(--accent)] underline">S1 리포트</Link>
              ) : (
                <span>S1 리포트</span>
              )}
              {" "}에서 재분석으로 집중도·주요 플레이어를 보강하세요.
            </p>
          )}
        </div>
      )}</>
  );
}
