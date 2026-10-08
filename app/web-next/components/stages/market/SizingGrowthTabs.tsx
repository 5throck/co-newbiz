"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { api } from "../../../lib/api.ts";
import { StepSection } from "./MarketReport.tsx";
import { CagrGroupedBar, ProjectionChart, ScenarioBandChart } from "./SizingCharts.tsx";
import { RegionScenarioChart, RegionScenarioTable, YearlyShareAreaChart, YearlySizeStackedBar, YearlyShareTable, ConsistencyChart } from "./SizingScenarioCharts.tsx";
import { CalibrationPanel } from "./CalibrationPanel.tsx";
import type { SizingReportState } from "./useSizingReport.ts";

export function SizingGrowthTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix, rerunStarted, canCurate, analysisId, setRerunError, setRerunStarted, rerunError, detail } = ctx;
  return (
    <>{tab === "growth" && (
      <>
      <StepSection n={4} id="step-4" title="셀별 CAGR·시나리오 밴드">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          권역×세그먼트 셀마다 개별 CAGR을 부여합니다(글로벌 단일 수준 아님). 시나리오 밴드는 기본값
          base×0.5 ~ base×1.55이며, <strong>소스 간 불일치가 문서화된 셀만</strong> 넓은 밴드로 대체합니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">기본 시나리오 CAGR (셀별 그룹 바)</h4>
            <CagrGroupedBar matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">2026 → 2030 전망 (권역 합계)</h4>
            <ProjectionChart matrix={matrix} />
          </div>
        </div>
        <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-4 mb-1">시나리오 밴드 (비관~낙관, 셀별 — 문서화된 오버라이드 강조)</h4>
        <ScenarioBandChart matrix={matrix} />
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">시나리오별 2030 전망 — 권역별 CAGR 적용 (그룹 바)</h4>
            <RegionScenarioChart matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">시나리오별 2030 전망 (권역 테이블, $B)</h4>
            <RegionScenarioTable matrix={matrix} />
          </div>
        </div>
        <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          시나리오는 글로벌 단일 CAGR이 아니라 각 권역×세그먼트 셀의 비관/기본/낙관 CAGR(4년 복리)을 그대로
          적용해 계산합니다 — 권역별 성격이 시나리오 결과에 그대로 반영됩니다.
        </p>
      </StepSection>

      {/* 4-A: 방법론 8단계 번호는 유지하고 별도 영역으로 표시 */}
      <section id="yearly-share" aria-label="연도별 시장점유율 추이" className="market-section sizing-step sizing-step-deep">
        <h3 className="sizing-step-title text-[0.95rem]">
          <span className="sizing-step-badge sizing-step-badge-deep">4-A</span> 연도별 시장점유율 추이 (2026 → 2030, 기본 시나리오)
        </h3>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          각 권역×세그먼트 셀의 기본 CAGR을 연도별로 복리 적용해 권역별 시장 규모와 점유율이
          어떻게 이동하는지 연 단위로 추적합니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">권역별 점유율 추이 (적층 영역, %)</h4>
            <YearlyShareAreaChart matrix={matrix} />
          </div>
          <div className="chart-half">
            <h4 className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">권역별 시장 규모 추이 (적층 바, $B)</h4>
            <YearlySizeStackedBar matrix={matrix} />
          </div>
        </div>
        <YearlyShareTable matrix={matrix} />
      </section>

      <StepSection n={5} id="step-5" title="성장률 정합성 확인 (바텀업 vs 탑다운)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
          매트릭스를 롤업한 암시 글로벌 CAGR을 탑다운 컨센서스와 비교합니다. 허용 오차 내여도 이는
          <strong> 내부 정합성 확인</strong>일 뿐 — 양쪽 모두 같은 부류의 소스로 소급되므로 독립적 확인으로
          표현하지 않습니다.
        </p>
        <ConsistencyChart matrix={matrix} />
        <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{matrix.consistency.tolerance}</p>
        {matrix.externalForecast ? (
          <div className="chart-half sizing-grade-card mt-4">
            <h4 className="text-[length:var(--fs-body)] mb-2">
              외부 미래 전망 대비 격차 분석 ({matrix.externalForecast.targetYear}년) — 과거 성장률 연장 추정 vs 외부 전망

              {(() => {
                const gap = matrix.externalForecast.gapPct;
                if (gap === undefined || Math.abs(gap) < 20) return null;
                return (
                  <div className="sizing-grade-card mt-2" role="note">
                    <p className="m-0 text-[length:var(--fs-caption)]">
                      <span className="status-chip status-red mr-1">검토 필요</span>
                      우리 추정과 외부 전망의 격차가 <strong>{Math.abs(gap).toFixed(1)}%</strong>로 20%를 초과합니다 — 분석 전제(드라이버·세그먼트 정의·앵커 소스)가 현실과 어긋났을 수 있습니다. 재분석으로 최신 외부 전망·연계 산업 근거를 반영하세요.
                    </p>
                    {rerunStarted ? (
                      <p role="status" className="text-[length:var(--fs-caption)] text-[color:var(--green-fg)] mt-1 mb-0">재분석이 시작되었습니다 — 완료되면 목록의 분석일이 갱신됩니다.</p>
                    ) : canCurate ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm mt-1"
                        onClick={async () => {
                          if (!analysisId) { setRerunError("분석 id를 찾을 수 없습니다 — 목록에서 재분석하세요."); return; }
                          try {
                            await api.post(`/api/market-overview/analyses/${encodeURIComponent(analysisId)}/rerun`);
                            setRerunStarted(true);
                          } catch (e) {
                            setRerunError(e instanceof Error ? e.message : "재분석 시작 실패");
                          }
                        }}
                      >
                        지금 재분석 (최신 외부 전망·연계 근거 반영)
                      </button>
                    ) : null}
                    {rerunError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">{rerunError}</p>}
                  </div>
                );
              })()}
            </h4>
            <table className="data-table" aria-label="외부 전망 대비 격차">
              <caption className="sr-only">외부 전망 대비 격차</caption>
              <thead>
                <tr><th scope="col">구분</th><th scope="col">{matrix.externalForecast.targetYear}년 시장규모</th><th scope="col">비고</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-semibold">우리 추정 (성장률 연장)</td>
                  <td className="tabular-nums">${(matrix.externalForecast.ourMarketSize ?? 0).toFixed(2)}B</td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">바텀업 CAGR {(matrix.consistency.bottomUpCagr).toFixed(1)}% 적용</td>
                </tr>
                <tr>
                  <td className="font-semibold">외부 전망</td>
                  <td className="tabular-nums">${matrix.externalForecast.marketSize.toFixed(2)}B</td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{matrix.externalForecast.sourceLabel}{matrix.externalForecast.cagr ? ` · CAGR ${(matrix.externalForecast.cagr * 100).toFixed(1)}%` : ""}</td>
                </tr>
                <tr className="row-selected">
                  <td className="font-semibold">격차</td>
                  <td className="tabular-nums font-semibold">{matrix.externalForecast.gapPct !== undefined ? `${matrix.externalForecast.gapPct > 0 ? "+" : ""}${matrix.externalForecast.gapPct}%` : "—"}</td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">외부 전망이 우리 추정 대비 {matrix.externalForecast.gapPct !== undefined && matrix.externalForecast.gapPct > 0 ? "높음 — 추가/강화 드라이버 개연성" : matrix.externalForecast.gapPct !== undefined && matrix.externalForecast.gapPct < 0 ? "낮음 — 기존 드라이버 약화 개연성" : "동일"} </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 mb-0 text-[length:var(--fs-body)] whitespace-pre-line">{matrix.externalForecast.gapAnalysis}</p>
            {matrix.externalForecast.newDrivers && matrix.externalForecast.newDrivers.length > 0 && (
              <p className="mt-2 mb-0 text-[length:var(--fs-caption)]">
                <strong>과거 대비 신규·강화 드라이버:</strong>{" "}
                {matrix.externalForecast.newDrivers.map((d) => (
                  <span key={d} className="status-chip status-in-progress mr-1">{d}</span>
                ))}
              </p>
            )}
            <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{matrix.externalForecast.note}</p>
          </div>
        ) : (
          <p className="sizing-note-list mt-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            입수된 외부 미래 전망이 없습니다 — 기존 방식(과거 성장률 연장 추정)을 유지합니다. 재분석 시 최신 공개 전망을 반영해 격차 분석이 시도됩니다.
          </p>
        )}
        <CalibrationPanel industryId={detail.industry.id} matrix={matrix} />
      </StepSection>
      </>
      )}</>
  );
}

export function SizingQualitativeTab({ ctx }: { ctx: SizingReportState }) {
  const { tab, matrix } = ctx;
  return (
    <>{tab === "qualitative" && (
        <section aria-label="정성 분석 — 기회·위험 요인" className="market-section sizing-step sizing-step-deep">
          <h3 className="sizing-step-title text-[0.95rem]">
            <span className="sizing-step-badge sizing-step-badge-deep">5-A</span> 정성 분석 — 기회 요인과 위험 요인
          </h3>
          <p className="mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
            정량 매트릭스만으로는 시장의 질적 방향이 보이지 않습니다. 이 요인들은 기회발굴(S2)의
            기회 발굴·요인 자동 도출의 입력으로 직결됩니다.
          </p>
          <div className="chart-pair">
            <div className="chart-half sizing-grade-card">
              <h4 className="text-[0.9rem] mb-2">✅ 기회 요인</h4>
              <ul className="sizing-note-list">
                {matrix.qualitative.opportunityFactors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
            <div className="chart-half sizing-grade-card">
              <h4 className="text-[0.9rem] mb-2">위험 요인</h4>
              <ul className="sizing-note-list">
                {matrix.qualitative.riskFactors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          </div>
          {matrix.externalForecast?.newDrivers && matrix.externalForecast.newDrivers.length > 0 && (
            <div className="sizing-grade-card mt-3">
              <h4 className="text-[0.9rem] mb-2">외부 전망 대비 신규·강화 드라이버</h4>
              <div className="flex flex-wrap gap-1 mb-2">
                {matrix.externalForecast.newDrivers.map((d) => (
                  <span key={d} className="status-chip status-in-progress">{d}</span>
                ))}
              </div>
              {matrix.externalForecast.gapAnalysis && (
                <p className="mb-0 text-[length:var(--fs-body)] whitespace-pre-line">{matrix.externalForecast.gapAnalysis}</p>
              )}
            </div>
          )}
          {matrix.qualitative.sources && matrix.qualitative.sources.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[length:var(--fs-body)] text-[color:var(--accent)]">입수 출처 ({matrix.qualitative.sources.length}건 — 출처 명기 필수)</summary>
              <ul className="sizing-note-list mt-2">
                {matrix.qualitative.sources.map((s, i) => (
                  <li key={i}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] underline">{s.title}</a>
                    {s.snippet && <span className="text-[color:var(--muted-fg)]"> — {s.snippet}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}</>
  );
}
