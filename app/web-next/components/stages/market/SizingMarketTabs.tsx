"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { segmentsOf } from "../../../lib/market-sizing.ts";
import { StepSection } from "./MarketReport.tsx";
import { competitiveColPct } from "./constants.ts";
import { ColGroup } from "../../ui.tsx";
import { CompetitiveInputForm } from "./CompetitiveInputForm.tsx";
import { AnchorChart, RegionWeightDonut, SegmentMixStack, RegionTable } from "./SizingCharts.tsx";
import type { SizingReportState } from "./useSizingReport.ts";
import { formatPctOrNa, formatUsdBOrNa, isSyntheticSizing, SYNTHETIC_BADGE_TEXT } from "../../../lib/synthetic-value.ts";

export function SizingOverviewTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix, proj2030Total, stepSummaries } = ctx;
  const synthetic = isSyntheticSizing(stepSummaries);
  const badge = synthetic ? <span className="status-chip status-amber">{SYNTHETIC_BADGE_TEXT}</span> : null;
  return (
    <>{tab === "overview" && (
        <section aria-label="개요" className="market-section sizing-step">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge"></span> 핵심 요약
          </h3>
          <div className="summary-cards">
            <div className="summary-card glass">
              <span className="summary-value mono-num">{formatUsdBOrNa(matrix.anchor.total)}</span>
              {badge}
              <span className="text-label">기준 시장규모 (2026)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{formatPctOrNa(matrix.consistency.bottomUpCagr)}</span>
              {badge}
              <span className="text-label">성장률 (연평균, 2026→2030)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{formatUsdBOrNa(proj2030Total)}</span>
              {badge}
              <span className="text-label">2030 전망 (기본 시나리오)</span>
            </div>
            <div className="summary-card glass">
              <span className="summary-value mono-num">{matrix.chainGrade.grade}</span>
              <span className="text-label">체인 등급 (통계 hop {matrix.chainGrade.statisticalHops}개)</span>
            </div>
          </div>
          <ul className="sizing-note-list mt-3">
            <li>분석 방법: systematic-market-sizing v1.1 — {matrix.provenance === "frozen-research" ? "연구문서 기반 수동 분석(분석가 확정)" : "8단계 파이프라인 산출(AI 추정 포함, 분석가 확정 전)"}</li>
            <li>세그먼트: {segmentsOf(matrix).map((x) => x.label).join(" / ")} — 권역 {matrix.regions.length}개</li>
            <li>시나리오: 비관/기본/낙관 CAGR 밴드 — 세부는 <strong>성장성</strong> 탭</li>
            <li>경쟁 구조 — 세부는 <strong>경쟁 구조</strong> 탭 · 기회/위험 요인 — <strong>정성 분석</strong> 탭</li>
          </ul>
        </section>
      )}</>
  );
}

export function SizingCompetitiveTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix, canCurate, analysisId } = ctx;
  return (
    <>{tab === "competitive" && (
        <section aria-label="경쟁 구조" className="market-section sizing-step">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge">2-A</span> 경쟁 구조 — 시장 집중도와 주요 기업
          </h3>
        {/* S1 competitive-intelligence 산출 — 산업 적응형 컬럼: (1) 레거시/시드 매트릭스의
            techType·용량·진행상태는 데이터가 있을 때만, (2) 파이프라인 신규 산출은
            산업별 attributes(라벨 자유)를 동적 컬럼으로 렌더링한다 (ADR-0092 optional). */}
        {matrix.competitive && (
          <>
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-4 mb-1">경쟁 구조</h4>
            <p className="mb-1 text-[length:var(--fs-body)]">{matrix.competitive.structure}</p>
            {matrix.competitive.players.length > 0 && (() => {
              const players = matrix.competitive.players;
              const hasTechType = players.some((pl) => pl.techType);
              const hasCapacity = players.some((pl) => pl.capacityMWe !== undefined);
              const hasProjectStatus = players.some((pl) => pl.projectStatus);
              // 동적 속성 컬럼 — player들이 공유하는 라벨의 합집합(최대 4개)
              const attrLabels: string[] = [];
              for (const pl of players) {
                for (const a of pl.attributes ?? []) {
                  if (!attrLabels.includes(a.label)) attrLabels.push(a.label);
                }
              }
              const attrOf = (pl: (typeof players)[number], label: string) =>
                pl.attributes?.find((a) => a.label === label)?.value ?? "—";
              return (
              <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table report-table table-fixed-pct tmin-80" aria-label="경쟁 구조 — 주요 기업">
                <caption className="sr-only">경쟁 구조 주요 기업</caption>
                <ColGroup widths={competitiveColPct(1 + (hasTechType ? 1 : 0) + (hasCapacity ? 1 : 0) + (hasProjectStatus ? 1 : 0) + Math.min(attrLabels.length, 4))} />
                <thead>
                  <tr>
                    <th scope="col" className="col-label">기업</th>
                    <th scope="col" className="col-type">포지션</th>
                    {hasTechType && <th scope="col" className="col-type">기술 유형</th>}
                    {hasCapacity && <th scope="col" className="col-num">용량 (MWe)</th>}
                    {hasProjectStatus && <th scope="col" className="col-type">진행 상태</th>}
                    {attrLabels.slice(0, 4).map((label) => <th key={label} scope="col" className="col-type">{label}</th>)}
                    <th scope="col" className="col-text">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((pl) => (
                    <tr key={pl.name}>
                      <td className="col-label font-semibold">{pl.name}</td>
                      <td className="col-type">
                        <span className={`status-chip ${pl.tier === "leader" ? "status-green" : pl.tier === "challenger" ? "status-amber" : "status-not-started"}`}>
                          {pl.tier === "leader" ? "리더" : pl.tier === "challenger" ? "도전자" : "니치"}
                        </span>
                      </td>
                      {hasTechType && <td className="col-type">{pl.techType ?? "—"}</td>}
                      {hasCapacity && <td className="col-num tabular-nums">{pl.capacityMWe !== undefined ? pl.capacityMWe.toLocaleString() : "—"}</td>}
                      {hasProjectStatus && <td className="col-type">{pl.projectStatus ? <span className="status-chip status-in-progress">{pl.projectStatus}</span> : "—"}</td>}
                      {attrLabels.slice(0, 4).map((label) => <td key={label} className="col-type">{attrOf(pl, label)}</td>)}
                      <td className="col-text cell-truncate text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{pl.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              );
            })()}
          </>
        )}
          {!matrix.competitive && (
            <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-body)]">
              경쟁 구조 데이터가 없습니다 — 재분석 시 1단계에서 도출되며, 공시된 시장 구조는 아래에서 직접 입력할 수 있습니다.
            </p>
          )}
          {canCurate && analysisId && <CompetitiveInputForm analysisId={analysisId} />}
          <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            점유율·순위는 정성 추정(공시 대조 전) — 정밀 수치는 S2~S3 이후 공시 교차검증으로 보강됩니다.
          </p>
        </section>
      )}</>
  );
}

export function SizingSizeTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix } = ctx;
  return (
    <>{tab === "size" && (
      <>
      <StepSection n={2} id="step-2" title="기준 시장규모 산정 (다중 소스 교차)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          독립 추정치 2–3개로 기준년 총시장(2026, $B)을 삼각검증하고 이상치를 명시적으로 제외합니다.
          이후 모든 배분이 이 앵커로 수렴해야 합니다.
        </p>
        <AnchorChart matrix={matrix} />
        <ul className="sizing-note-list mt-2">
          {matrix.anchor.sources.map((s) => (
            <li key={s.label} className={s.status === "excluded" ? "text-[color:var(--muted-fg)] line-through" : ""}>
              <strong>{s.label}</strong> — ${s.estimate.toFixed(2)}B
              {s.sourceUrl && <> · <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">출처</a></>}
              {s.asOf && <> <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">({s.asOf})</span></>}
              {s.methodology && <span className="block pl-4 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">측정 방법론: {s.methodology}</span>}
              <span className="block pl-4 text-[length:var(--fs-caption)]">{s.note}</span>
            </li>
          ))}
        </ul>
      </StepSection>
      </>
      )}</>
  );
}

export function SizingAllocationTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix } = ctx;
  return (
    <>{tab === "allocation" && (
      <>
      <StepSection n={3} id="step-3" title="권역·세그먼트 배분">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          권역 가중치는 인접 공시시장 프록시에서, 세그먼트 믹스는 글로벌 교차검증치에 맞춘 보정 배분입니다.
          판단 조정은 셀별로 출처와 함께 기록됩니다(바텀업 합산이 아님).
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">권역 가중치 (도넛)</h4>
            <RegionWeightDonut matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">권역별 세그먼트 믹스 (100% 적층)</h4>
            <SegmentMixStack matrix={matrix} />
          </div>
        </div>
        <RegionTable matrix={matrix} />
      </StepSection>
      </>
      )}</>
  );
}
