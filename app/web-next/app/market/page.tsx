"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type ObservationRow } from "../../lib/api.ts";
import { EChart } from "../../components/EChart.tsx";
import { useChartTheme } from "../../lib/echarts-theme.ts";
import {
  ANCHOR_SOURCES, ANCHOR_TOTAL, AXES, BASELINE_2026, CAGR_BASE, CHAIN_GRADE,
  CONSISTENCY, CROSS_VALIDATION, GLOBAL_2026, GLOBAL_2030, LIMITATIONS,
  PROJECTION_2030, REGISTRY, REGIONS, SEGMENTS, SIZING_SOURCE_DOC,
  STEPS, VALIDATION_STATUS_META, band,
  type SegmentCode,
} from "../../lib/market-sizing.ts";

// S1 시장분석 (/market) — systematic-market-sizing 스킬의 8단계 절차를 그대로
// 따르는 분석 리포트. 산업 선택 → 8단계 세로 흐름(각 단계 = 방법론 한 단계 +
// 이해를 돕는 차트), 우측 래일로 단계 이동.

interface IndustryRow {
  id: string; name_ko: string; name_en: string | null;
  ksic_code: string | null; driver_count: number;
}
interface DriverRow { id: string; code: string; label_ko: string; description: string; }
interface MarketOverview {
  industries: IndustryRow[]; drivers: DriverRow[];
  stats: { value_chain_links: number; proxy_links: number; series_count: number; observation_count: number };
}
interface DriverSensitivity { driver_label: string; sensitivity: number; lag_months: number | null; region_code: string | null; segment_code: string | null }
interface AssumptionRow {
  assumption_key: string; kind: string; value: number; rationale: string | null;
  anchor_ref: string | null; as_of: string; ttl_days: number | null;
}
interface IndustryDetail {
  industry: { id: string; name_ko: string; name_en: string | null; ksic_code: string | null };
  driver_sensitivities: DriverSensitivity[];
  sizing: { run_id: string; run_label: string; assumptions: AssumptionRow[] } | null;
}
interface SeriesRow {
  series_id: string; unit_id: string; source_id: string; observation_count: number;
  min_period_id: string; max_period_id: string; last_fetched_at: string | null;
  days_since_fetch: number | null; stale: boolean;
}

const SEGMENT_COLORS = [0, 1, 2];

export function MarketView() {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [detail, setDetail] = useState<IndustryDetail | null>(null);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<MarketOverview>("/api/market-overview").then((r) => setOverview(r.data)).catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"));
  }, []);

  const loadDetail = useCallback((industryId: string) => {
    setSelectedIndustry(industryId);
    setDetail(null);
    api.get<IndustryDetail>(`/api/market-overview/industry/${encodeURIComponent(industryId)}`)
      .then((r) => setDetail(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : "상세 불러오기 실패"));
  }, []);

  // 이 분석(유압브레이커)의 8단계 리포트는 연구문서와 동결 매트릭스 기반 —
  // 선택한 산업이 그 분석 대상인지 KSIC 코드로 판별.
  const hasSizing = detail?.industry.ksic_code === "HYD-BRK";

  return (
    <main>
      <h1>시장분석</h1>
      <p className="mt-[0.15rem] mb-2 text-[color:var(--muted-fg)] text-[0.9rem]">
        프로세스 스테이지 S1 — <strong>systematic-market-sizing</strong> 스킬의 8단계 절차로 시장을 분석합니다.
        각 단계는 방법론 한 단계와 그 결과를 보여주는 차트로 구성됩니다.
        기회를 발굴하려면 <Link href="/opportunities" className="text-[color:var(--accent)] underline">기회 발굴(S2)</Link>으로 이어가세요.
      </p>

      {error && <p role="alert" className="text-[color:var(--red-fg)]">{error}</p>}

      {/* ── 산업 선택 (컴팩트 칩 리스트) ── */}
      <section aria-label="분석 대상 산업 선택" className="market-section">
        <div className="sizing-industry-row" role="listbox" aria-label="분석 대상 산업">
          {overview === null ? (
            <p>불러오는 중...</p>
          ) : overview.industries.length === 0 ? (
            <p className="text-[color:var(--muted-fg)] italic">등록된 산업이 없습니다.</p>
          ) : (
            overview.industries.map((ind) => (
              <button
                key={ind.id}
                type="button"
                role="option"
                aria-selected={selectedIndustry === ind.id}
                className={`sizing-industry-chip ${selectedIndustry === ind.id ? "sizing-industry-chip-active" : ""}`}
                onClick={() => loadDetail(ind.id)}
              >
                <span className="font-semibold">{ind.name_ko}</span>
                <span className="sizing-chip-meta">{ind.ksic_code ?? "—"} · 드라이버 {ind.driver_count}건</span>
              </button>
            ))
          )}
        </div>
      </section>

      {detail && (
        <>
          {/* ── 단계 래일 (sticky) ── */}
          {hasSizing && (
            <nav aria-label="분석 단계" className="sizing-step-rail" >
              {STEPS.map((s, i) => (
                <a key={s.id} href={`#${s.id}`} className="sizing-step-link">
                  <span className="sizing-step-num">{i + 1}</span>
                  <span>{s.short}</span>
                </a>
              ))}
            </nav>
          )}

          <div className="sizing-report-header">
            <h2>
              📊 {detail.industry.name_ko} 시장 분석 리포트
              {detail.industry.ksic_code && <code className="dd-item-id ml-2">{detail.industry.ksic_code}</code>}
            </h2>
            <p className="text-[color:var(--muted-fg)] text-[0.78rem]">
              방법론: systematic-market-sizing v1.0 · 소스 문서: <code className="text-[0.72rem]">{SIZING_SOURCE_DOC}</code>
            </p>
          </div>

          {hasSizing ? (
            <SizingReport detail={detail} />
          ) : (
            <section aria-label="분석 대기" className="market-section">
              <p className="text-[color:var(--muted-fg)] italic">
                이 산업에는 아직 8단계 정식 분석(sizing 리포트)이 등록되지 않았습니다.
                systematic-market-sizing 스킬의 절차(앵커 삼각검증 → 권역·세그먼트 배분 → 교차검증 → 레지스트리 등록)를
                수행하면 이 화면에 리포트가 표시됩니다. 아래는 현재 기록된 드라이버 구조입니다.
              </p>
              <StepSensitivityChart stepNumber={1} sensitivities={detail.driver_sensitivities} />
            </section>
          )}
        </>
      )}

      <TimeSeriesSection />
    </main>
  );
}

/* ═══════════════ 8단계 리포트 ═══════════════ */

function StepSection({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-label={`단계 ${n}: ${title}`} className="market-section sizing-step">
      <h3 className="sizing-step-title">
        <span className="sizing-step-badge">{n}</span> {title}
      </h3>
      {children}
    </section>
  );
}

function SizingReport({ detail }: { detail: IndustryDetail }) {
  return (
    <div className="sizing-report">
      <StepSection n={1} id="step-1" title="축·프록시 구조 정의">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          분석 축을 <strong>권역 × 최종수요 세그먼트 × 시나리오</strong> 3축으로 고정하고, 데이터가 실제로
          분해되는 방식에 맞춰 권역을 묶습니다(예: 중국 별도 분리). 프록시 체인의 통계 hop 수가 체인 등급을
          결정하고, 그 등급이 모든 후속 결론의 신뢰도 상한이 됩니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <table className="data-table" aria-label="분석 축 정의">
              <caption className="sr-only">분석 축 정의</caption>
              <thead><tr><th scope="col">축</th><th scope="col">값</th></tr></thead>
              <tbody>
                {AXES.map((a) => (
                  <tr key={a.axis}><td className="font-semibold">{a.axis}</td><td>{a.values}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="chart-half sizing-grade-card">
            <span className="status-chip status-amber">체인 등급 {CHAIN_GRADE.grade}</span>
            <p className="mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">{CHAIN_GRADE.note}</p>
            <p className="mt-1 text-[0.78rem]">통계 hop {CHAIN_GRADE.statisticalHops}개 · 분석 hop은 등급에 불가산</p>
          </div>
        </div>
        <StepSensitivityChart stepNumber={undefined} sensitivities={detail.driver_sensitivities} />
      </StepSection>

      <StepSection n={2} id="step-2" title="기준 시장규모 산정 (다중 소스 교차)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          독립 추정치 2–3개로 기준년 총시장(2026, $B)을 삼각검증하고 이상치를 명시적으로 제외합니다.
          이후 모든 배분이 이 앵커로 수렴해야 합니다.
        </p>
        <AnchorChart />
        <ul className="sizing-note-list mt-2">
          {ANCHOR_SOURCES.map((s) => (
            <li key={s.label} className={s.status === "excluded" ? "text-[color:var(--muted-fg)] line-through" : ""}>
              <strong>{s.label}</strong> — ${s.estimate.toFixed(2)}B · {s.note}
            </li>
          ))}
        </ul>
      </StepSection>

      <StepSection n={3} id="step-3" title="권역·세그먼트 배분">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          권역 가중치는 인접 공시시장 프록시에서, 세그먼트 믹스는 글로벌 교차검증치에 맞춘 보정 배분입니다.
          판단 조정은 셀별로 출처와 함께 기록됩니다(바텀업 합산이 아님).
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역 가중치 (도넛)</h4>
            <RegionWeightDonut />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 세그먼트 믹스 (100% 적층)</h4>
            <SegmentMixStack />
          </div>
        </div>
        <RegionTable />
      </StepSection>

      <StepSection n={4} id="step-4" title="셀별 CAGR·시나리오 밴드">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          권역×세그먼트 셀마다 개별 CAGR을 부여합니다(글로벌 단일 수준 아님). 시나리오 밴드는 기본값
          base×0.5 ~ base×1.55이며, <strong>소스 간 불일치가 문서화된 셀만</strong> 넓은 밴드로 대체합니다 —
          아래 차트에서 북미·광산(2–11%)이 그 사례입니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">기본 시나리오 CAGR (셀별 그룹 바)</h4>
            <CagrGroupedBar />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">2026 → 2030 전망 (권역 합계)</h4>
            <ProjectionChart />
          </div>
        </div>
        <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mt-4 mb-1">시나리오 밴드 (비관~낙관, 18개 셀 — 북미·광산 오버라이드 강조)</h4>
        <ScenarioBandChart />
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">시나리오별 2030 전망 — 권역별 CAGR 적용 (그룹 바)</h4>
            <RegionScenarioChart />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">시나리오별 2030 전망 (권역 테이블, $B)</h4>
            <RegionScenarioTable />
          </div>
        </div>
        <p className="sizing-note-list mt-2 text-[0.75rem] text-[color:var(--muted-fg)]">
          시나리오는 글로벌 단일 CAGR이 아니라 각 권역×세그먼트 셀의 비관/기본/낙관 CAGR(4년 복리)을 그대로 적용해
          계산합니다 — 권역별 성격(예: 광산 집중 권역의 비관 하락, 유럽 기타의 규제 상승)이 시나리오 결과에 그대로 반영됩니다.
          글로벌 롤업은 각 시나리오의 권역 합계입니다.
        </p>
      </StepSection>

      {/* 4단계와 5단계 사이의 심화 영역 — 방법론 8단계 번호는 유지 */}
      <section id="yearly-share" aria-label="연도별 시장점유율 추이" className="market-section sizing-step sizing-step-deep">
        <h3 className="sizing-step-title">
          <span className="sizing-step-badge sizing-step-badge-deep">4-A</span> 연도별 시장점유율 추이 (2026 → 2030, 기본 시나리오)
        </h3>
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          각 권역×세그먼트 셀의 기본 CAGR을 연도별로 복리 적용해 권역별 시장 규모와 점유율이
          어떻게 이동하는지 연 단위로 추적합니다. 4단계의 연간 성장률(원인)과 5단계의 정합성 체크(검증) 사이에서
          시장 구조의 시간에 따른 변화(결과)를 보여주는 별도 영역입니다.
        </p>
        <div className="chart-pair">
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 점유율 추이 (적층 영역, %)</h4>
            <YearlyShareAreaChart />
          </div>
          <div className="chart-half">
            <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">권역별 시장 규모 추이 (적층 바, $B)</h4>
            <YearlySizeStackedBar />
          </div>
        </div>
        <YearlyShareTable />
      </section>

      <StepSection n={5} id="step-5" title="성장률 정합성 확인 (바텀업 vs 탑다운)">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          매트릭스를 롤업한 암시 글로벌 CAGR을 탑다운 컨센서스와 비교합니다. 허용 오차 내여도 이는
          <strong> 내부 정합성 확인</strong>일 뿐 — 양쪽 모두 같은 부류의 소스로 소급되므로 독립적 확인으로
          표현하지 않습니다.
        </p>
        <ConsistencyChart />
        <p className="sizing-note-list mt-2 text-[0.78rem] text-[color:var(--muted-fg)]">{CONSISTENCY.tolerance}</p>
      </StepSection>

      <StepSection n={6} id="step-6" title="기업 공시 교차검증">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          카테고리 내 상장사의 연차보고서·중간보고서 원문으로 매트릭스의 각 주장을 검증합니다.
          구조적으로 검증 불가능한 항목은 <strong>검증 불가</strong>로 명시합니다(탐색 실패가 아닌 공시 구조의 한계).
        </p>
        <table className="data-table" aria-label="1차 소스 교차검증 결과">
          <caption className="sr-only">1차 소스 교차검증 결과</caption>
          <thead>
            <tr><th scope="col" className="w-[34%]">매트릭스 주장</th><th scope="col">판정</th><th scope="col">1차 소스 근거 (Epiroc FY2025)</th></tr>
          </thead>
          <tbody>
            {CROSS_VALIDATION.map((v) => {
              const meta = VALIDATION_STATUS_META[v.status];
              return (
                <tr key={v.claim}>
                  <td className="font-semibold">{v.claim}</td>
                  <td className="sizing-verdict-cell"><span className={`status-chip ${meta.chip}`}>{meta.label}</span></td>
                  <td className="text-[0.78rem]">{v.evidence}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </StepSection>

      <StepSection n={7} id="step-7" title="분석 한계 목록">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          판단적 보정·소스 불일치·외삽 불가 신호를 번호 붙여 고정합니다. 소비자는 이 목록 없이 매트릭스를
          인용할 수 없습니다.
        </p>
        <ol className="sizing-limitations">
          {LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}
        </ol>
      </StepSection>

      <StepSection n={8} id="step-8" title="가정 레지스트리 등록">
        <p className="mb-2 text-[color:var(--muted-fg)] text-[0.8rem]">
          동결된 매트릭스는 assumption 레지스트리에 조합당 1 row(kind='assumed', rationale + anchor_ref + TTL)로
          등록됩니다. 레지스트리는 append-only — 수정은 새 row로 기록됩니다. 아래는 실제 등록 상태(라이브 조회)입니다.
        </p>
        <RegistryStatus sizing={detail.sizing} />
      </StepSection>
    </div>
  );
}

/* ── 단계별 차트 ── */

function StepSensitivityChart({ stepNumber, sensitivities }: { stepNumber: number | undefined; sensitivities: DriverSensitivity[] }) {
  const ct = useChartTheme();
  const agg = new Map<string, number>();
  for (const ds of sensitivities) {
    if (!agg.has(ds.driver_label)) agg.set(ds.driver_label, 0);
    agg.set(ds.driver_label, Math.max(agg.get(ds.driver_label)!, Math.abs(ds.sensitivity)));
  }
  const labels = [...agg.keys()];
  const values = labels.map((l) => Math.round((agg.get(l) ?? 0) * 100) / 100);
  if (labels.length === 0) return <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">기록된 드라이버 민감도가 없습니다.</p>;
  const option = {
    grid: { left: 140, right: 40, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: labels, axisLabel: { color: ct.muted, width: 120, overflow: "truncate" as const } },
    series: [{ type: "bar" as const, data: values, itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] }, barMaxWidth: 22 }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return (
    <div className="mt-4">
      {stepNumber !== undefined && <h4 className="text-[0.82rem] text-[color:var(--muted-fg)] mb-1">주요 드라이버 민감도 (민감도 절댓값 ≥ 0.3 → 주요 드라이버)</h4>}
      <EChart option={option} height={Math.max(140, labels.length * 40 + 48)} />
    </div>
  );
}

function AnchorChart() {
  const ct = useChartTheme();
  const option = {
    grid: { left: 170, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: {
      type: "category" as const,
      data: ANCHOR_SOURCES.map((s) => s.label),
      axisLabel: { color: ct.muted, width: 150, overflow: "truncate" as const },
    },
    series: [
      {
        type: "bar" as const,
        data: ANCHOR_SOURCES.map((s) => ({
          value: s.estimate,
          itemStyle: { color: s.status === "excluded" ? ct.muted : ct.color[0], opacity: s.status === "excluded" ? 0.4 : 1, borderRadius: [0, 4, 4, 0] },
        })),
        barMaxWidth: 24,
        markLine: {
          symbol: "none",
          data: [{ xAxis: ANCHOR_TOTAL, label: { formatter: `앵커 $${ANCHOR_TOTAL.toFixed(2)}B`, color: ct.muted }, lineStyle: { color: ct.color[3], type: "dashed" as const, width: 2 } }],
        },
      },
    ],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={170} />;
}

function RegionWeightDonut() {
  const ct = useChartTheme();
  const option: Record<string, unknown> = {
    tooltip: { trigger: "item", formatter: (p: { name?: string; percent?: number }) => `${p.name}: ${p.percent}%` },
    legend: { bottom: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    series: [{
      type: "pie" as const,
      radius: ["42%", "70%"],
      center: ["50%", "44%"],
      label: { color: ct.muted, formatter: "{d}%", fontSize: 10 },
      data: REGIONS.map((r, i) => ({ name: r.label, value: r.weight, itemStyle: { color: ct.color[i % ct.color.length] } })),
    }],
  };
  return <EChart option={option as never} height={280} />;
}

function SegmentMixStack() {
  const ct = useChartTheme();
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, max: 100, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...REGIONS].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: SEGMENTS.map((seg, i) => ({
      name: seg.label,
      type: "bar" as const,
      stack: "mix",
      data: [...REGIONS].reverse().map((r) => r.mix[seg.code]),
      itemStyle: { color: ct.color[SEGMENT_COLORS[i]] },
      barMaxWidth: 22,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, valueFormatter: (v: unknown) => `${Number(v)}%` },
  };
  return <EChart option={option} height={280} />;
}

function RegionTable() {
  const regionTotal = (code: string) => {
    const m = BASELINE_2026[code];
    return m.construction + m.mining + m.other;
  };
  return (
    <table className="data-table mt-3" aria-label="권역×세그먼트 배분표">
      <caption className="sr-only">권역×세그먼트 배분 및 2026 기준선</caption>
      <thead>
        <tr>
          <th scope="col">권역</th><th scope="col">가중치</th><th scope="col">건설</th><th scope="col">광산</th><th scope="col">기타</th><th scope="col">2026 ($B)</th><th scope="col">주요 조정</th>
        </tr>
      </thead>
      <tbody>
        {REGIONS.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            <td className="tabular-nums">{r.weight}%</td>
            <td className="tabular-nums">{r.mix.construction}%</td>
            <td className="tabular-nums">{r.mix.mining}%</td>
            <td className="tabular-nums">{r.mix.other}%</td>
            <td className="tabular-nums">{regionTotal(r.code).toFixed(3)}</td>
            <td className="text-[0.75rem] text-[color:var(--muted-fg)]">{r.adjustment}</td>
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌</td>
          <td className="tabular-nums">100%</td>
          <td className="tabular-nums">{Math.round((GLOBAL_2026.construction / GLOBAL_2026.total) * 1000) / 10}%</td>
          <td className="tabular-nums">{Math.round((GLOBAL_2026.mining / GLOBAL_2026.total) * 1000) / 10}%</td>
          <td className="tabular-nums">{Math.round((GLOBAL_2026.other / GLOBAL_2026.total) * 1000) / 10}%</td>
          <td className="tabular-nums font-semibold">{GLOBAL_2026.total.toFixed(2)} (앵커 ${GLOBAL_2026.anchor.toFixed(2)})</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

function CagrGroupedBar() {
  const ct = useChartTheme();
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...REGIONS].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: SEGMENTS.map((seg, i) => ({
      name: seg.label,
      type: "bar" as const,
      data: [...REGIONS].reverse().map((r) => CAGR_BASE[r.code][seg.code]),
      itemStyle: { color: ct.color[SEGMENT_COLORS[i]], borderRadius: [0, 3, 3, 0] },
      barMaxWidth: 12,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const }, valueFormatter: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%` },
  };
  return <EChart option={option} height={280} />;
}

function ProjectionChart() {
  const ct = useChartTheme();
  const totals2026 = REGIONS.map((r) => {
    const m = BASELINE_2026[r.code];
    return Math.round((m.construction + m.mining + m.other) * 1000) / 1000;
  });
  const totals2030 = REGIONS.map((r) => {
    const m = PROJECTION_2030[r.code];
    return Math.round((m.construction + m.mining + m.other) * 1000) / 1000;
  });
  const option = {
    grid: { left: 110, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...REGIONS].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: [
      { name: "2026", type: "bar" as const, data: [...totals2026].reverse(), itemStyle: { color: ct.color[0], opacity: 0.55, borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
      { name: "2030 (기본)", type: "bar" as const, data: [...totals2030].reverse(), itemStyle: { color: ct.color[3], borderRadius: [0, 3, 3, 0] }, barMaxWidth: 12 },
    ],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={280} />;
}

function ScenarioBandChart() {
  const ct = useChartTheme();
  const rows = REGIONS.flatMap((r) => SEGMENTS.map((seg) => {
    const b = band(r.code, seg.code);
    const isOverride = r.code === "north_america" && seg.code === "mining";
    return { label: `${r.label} · ${seg.label}`, down: b.down, up: b.up, isOverride };
  }));
  // 투명 base(비관) + 가시 width(낙관−비관) 스택으로 레인지 바 구성
  const option = {
    grid: { left: 150, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: rows.map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 9.5 } },
    series: [
      { type: "bar" as const, stack: "band", data: rows.map((r) => r.down), itemStyle: { color: "transparent" }, barMaxWidth: 12, silent: true, tooltip: { show: false } },
      {
        type: "bar" as const,
        stack: "band",
        data: rows.map((r) => ({
          value: Math.round((r.up - r.down) * 10000) / 10000,
          itemStyle: { color: r.isOverride ? ct.color[3] : ct.color[1], opacity: r.isOverride ? 1 : 0.65, borderRadius: 3 },
        })),
        barMaxWidth: 12,
        tooltip: { show: true },
      },
    ],
    tooltip: {
      trigger: "item" as const,
      formatter: (p: unknown) => {
        const r = rows[(p as { dataIndex: number }).dataIndex];
        return `${r.label}<br/>비관 ${(r.down * 100).toFixed(1)}% ~ 낙관 ${(r.up * 100).toFixed(1)}%${r.isOverride ? "<br/><strong>문서화된 소스 불일치 → 넓은 밴드</strong>" : ""}`;
      },
    },
  };
  return <EChart option={option} height={Math.max(280, rows.length * 17 + 48)} />;
}

// 시나리오 적용: 글로벌 단일 CAGR이 아니라 각 권역×세그먼트 셀의
// 비관/기본/낙관 CAGR을 4년(2026→2030) 복리로 적용한 권역별 전망.
function regionScenario2030(code: string, scenario: "down" | "base" | "up"): number {
  return SEGMENTS.reduce((sum, seg) => {
    const cagr = band(code, seg.code)[scenario];
    return sum + BASELINE_2026[code][seg.code] * Math.pow(1 + cagr, 4);
  }, 0);
}

const SCENARIOS_META = [
  { key: "down" as const, label: "비관" },
  { key: "base" as const, label: "기본" },
  { key: "up" as const, label: "낙관" },
];

function RegionScenarioChart() {
  const ct = useChartTheme();
  const option = {
    grid: { left: 110, right: 40, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "value" as const, axisLabel: { formatter: (v: unknown) => `$${Number(v)}`, color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: [...REGIONS].reverse().map((r) => r.label), axisLabel: { color: ct.muted, fontSize: 10 } },
    series: SCENARIOS_META.map((s) => ({
      name: s.label,
      type: "bar" as const,
      data: [...REGIONS].reverse().map((r) => Math.round(regionScenario2030(r.code, s.key) * 1000) / 1000),
      itemStyle: {
        color: s.key === "base" ? ct.color[0] : s.key === "up" ? ct.color[3] : ct.color[1],
        opacity: s.key === "base" ? 1 : 0.6,
        borderRadius: [0, 3, 3, 0],
      },
      barMaxWidth: 12,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={280} />;
}

function RegionScenarioTable() {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const globals = SCENARIOS_META.map((s) => REGIONS.reduce((a, r) => a + regionScenario2030(r.code, s.key), 0));
  return (
    <table className="data-table" aria-label="시나리오별 권역 2030 전망">
      <caption className="sr-only">시나리오별 권역 2030 전망</caption>
      <thead><tr><th scope="col">권역</th><th scope="col">비관</th><th scope="col">기본</th><th scope="col">낙관</th></tr></thead>
      <tbody>
        {REGIONS.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            {SCENARIOS_META.map((s) => (
              <td key={s.key} className="tabular-nums">{r3(regionScenario2030(r.code, s.key)).toFixed(3)}</td>
            ))}
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌</td>
          {globals.map((g, i) => (
            <td key={i} className="tabular-nums font-semibold">{r3(g).toFixed(2)}</td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/* ── 4-A 연도별 시장점유율 (기본 시나리오, 셀 CAGR 연간 복리) ── */
const YEARS = [2026, 2027, 2028, 2029, 2030];

function regionTotalInYear(code: string, yearIndex: number, scenario: "down" | "base" | "up" = "base"): number {
  return SEGMENTS.reduce((sum, seg) => {
    const cagr = band(code, seg.code)[scenario];
    return sum + BASELINE_2026[code][seg.code] * Math.pow(1 + cagr, yearIndex);
  }, 0);
}

function yearlyShareMatrix(): { years: number[]; shares: Record<string, number[]>; totals: number[] } {
  const shares: Record<string, number[]> = {};
  const totals = YEARS.map(() => 0);
  for (const r of REGIONS) {
    shares[r.code] = YEARS.map((_, y) => regionTotalInYear(r.code, y));
    totals.forEach((_, y) => { totals[y] += shares[r.code][y]; });
  }
  for (const r of REGIONS) {
    shares[r.code] = shares[r.code].map((v, y) => Math.round((v / totals[y]) * 1000) / 10);
  }
  return { years: YEARS, shares, totals: totals.map((t) => Math.round(t * 100) / 100) };
}

function YearlyShareAreaChart() {
  const ct = useChartTheme();
  const { shares } = yearlyShareMatrix();
  const option = {
    grid: { left: 48, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: YEARS.map(String), boundaryGap: false, axisLabel: { color: ct.muted } },
    yAxis: { type: "value" as const, max: 100, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: REGIONS.map((r, i) => ({
      name: r.label,
      type: "line" as const,
      stack: "share",
      data: shares[r.code],
      areaStyle: { opacity: 0.75 },
      lineStyle: { width: 1 },
      itemStyle: { color: ct.color[i % ct.color.length] },
      symbol: "none" as const,
    })),
    tooltip: { trigger: "axis" as const, valueFormatter: (v: unknown) => `${Number(v)}%` },
  };
  return <EChart option={option} height={300} />;
}

function YearlySizeStackedBar() {
  const ct = useChartTheme();
  const option = {
    grid: { left: 48, right: 24, top: 30, bottom: 32 },
    legend: { top: 0, textStyle: { color: ct.muted, fontSize: 10 } },
    xAxis: { type: "category" as const, data: YEARS.map(String), axisLabel: { color: ct.muted } },
    yAxis: { type: "value" as const, name: "$B", nameTextStyle: { color: ct.muted }, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    series: REGIONS.map((r, i) => ({
      name: r.label,
      type: "bar" as const,
      stack: "size",
      data: YEARS.map((_, y) => Math.round(regionTotalInYear(r.code, y) * 100) / 100),
      itemStyle: { color: ct.color[i % ct.color.length] },
      barMaxWidth: 42,
    })),
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={300} />;
}

function YearlyShareTable() {
  const { years, shares, totals } = yearlyShareMatrix();
  return (
    <table className="data-table mt-3" aria-label="연도별 권역 점유율">
      <caption className="sr-only">연도별 권역 점유율 및 글로벌 총시장</caption>
      <thead>
        <tr>
          <th scope="col">권역</th>
          {years.map((y) => <th key={y} scope="col">{y} 점유율</th>)}
        </tr>
      </thead>
      <tbody>
        {REGIONS.map((r) => (
          <tr key={r.code}>
            <td className="font-semibold">{r.label}</td>
            {years.map((_, y) => (
              <td key={y} className="tabular-nums">{shares[r.code][y].toFixed(1)}%</td>
            ))}
          </tr>
        ))}
        <tr className="row-selected">
          <td className="font-semibold">글로벌 총시장 ($B)</td>
          {totals.map((t, y) => <td key={y} className="tabular-nums font-semibold">{t.toFixed(2)}</td>)}
        </tr>
      </tbody>
    </table>
  );
}

function ConsistencyChart() {
  const ct = useChartTheme();
  const option = {
    grid: { left: 130, right: 60, top: 16, bottom: 32 },
    xAxis: { type: "value" as const, min: 0, max: 8, axisLabel: { formatter: "{value}%", color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
    yAxis: { type: "category" as const, data: ["매트릭스 롤업 (바텀업)", "컨센서스 (탑다운)"], axisLabel: { color: ct.muted, fontSize: 10 } },
    series: [{
      type: "bar" as const,
      data: [
        { value: CONSISTENCY.bottomUpCagr, itemStyle: { color: ct.color[0], borderRadius: [0, 4, 4, 0] } },
        { value: CONSISTENCY.topDownCagr, itemStyle: { color: ct.color[2], opacity: 0.6, borderRadius: [0, 4, 4, 0] } },
      ],
      barMaxWidth: 26,
      label: { show: true, position: "right" as const, formatter: "{c}%", color: ct.muted, fontSize: 11 },
    }],
    tooltip: { trigger: "axis" as const, axisPointer: { type: "shadow" as const } },
  };
  return <EChart option={option} height={140} />;
}

function RegistryStatus({ sizing }: { sizing: IndustryDetail["sizing"] }) {
  const counts = useMemo(() => {
    const byPrefix: { baseline_2026: number; cagr: number } = { baseline_2026: 0, cagr: 0 };
    let assumed = 0;
    for (const a of sizing?.assumptions ?? []) {
      if (a.kind === "assumed") assumed++;
      if (a.assumption_key.includes(".baseline_2026.")) byPrefix.baseline_2026++;
      else if (a.assumption_key.includes(".cagr.")) byPrefix.cagr++;
    }
    return { ...byPrefix, assumed, total: sizing?.assumptions.length ?? 0 };
  }, [sizing]);

  if (!sizing) {
    return (
      <p className="text-[color:var(--muted-fg)] italic text-[0.8rem]">
        레지스트리에 이 분석의 등록 row가 없습니다. 등록은 {REGISTRY.referenceImplementation} 경로로 수행됩니다.
      </p>
    );
  }
  const ok = counts.baseline_2026 === REGISTRY.expectedRows.baseline && counts.cagr === REGISTRY.expectedRows.cagr;
  return (
    <div>
      <div className="driver-derivation mb-3">
        <div className="driver-derivation-step">
          <span className={`status-chip ${ok ? "status-green" : "status-amber"}`}>{ok ? "등록 완료" : "불일치"}</span>
          <span>run <code className="text-[0.72rem]">{sizing.run_label}</code></span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">baseline {counts.baseline_2026}/{REGISTRY.expectedRows.baseline}</span>
          <span>2026 기준선 ($B)</span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">cagr {counts.cagr}/{REGISTRY.expectedRows.cagr}</span>
          <span>비관/기본/낙관 밴드</span>
        </div>
      </div>
      <p className="text-[0.78rem] text-[color:var(--muted-fg)]">
        총 {counts.total} row · 전부 kind='assumed' (rationale + anchor_ref 필수, FR-DATA-07) · TTL {REGISTRY.ttlDays}일 ·
        append-only (수정 = 새 row)
      </p>
      <details className="mt-2">
        <summary className="text-[0.8rem] cursor-pointer text-[color:var(--accent)]">등록 row 전체 보기 ({counts.total}개)</summary>
        <table className="data-table mt-2" aria-label="레지스트리 등록 row">
          <caption className="sr-only">레지스트리 등록 row 목록</caption>
          <thead>
            <tr><th scope="col">assumption_key</th><th scope="col">kind</th><th scope="col">value</th><th scope="col">anchor_ref</th><th scope="col">TTL</th></tr>
          </thead>
          <tbody>
            {sizing.assumptions.map((a) => (
              <tr key={a.assumption_key}>
                <td><code className="text-[0.72rem]">{a.assumption_key}</code></td>
                <td><span className="status-chip status-in-progress">{a.kind}</span></td>
                <td className="tabular-nums">{a.value}</td>
                <td className="text-[0.72rem]">{a.anchor_ref ?? "—"}</td>
                <td className="tabular-nums">{a.ttl_days ?? "—"}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/* ── 시장 시계열 (부록 데이터 탐색) ── */
function TimeSeriesSection() {
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [observations, setObservations] = useState<ObservationRow[] | null>(null);
  const ct = useChartTheme();

  useEffect(() => {
    const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    api.get<SeriesRow[]>(`/api/series${qs}`).then((r) => setSeries(r.data)).catch(() => setSeries([]));
  }, [query]);

  useEffect(() => {
    if (!selected) { setObservations(null); return; }
    api.get<ObservationRow[]>(`/api/series/${encodeURIComponent(selected)}/observations`)
      .then((r) => setObservations(r.data))
      .catch(() => setObservations([]));
  }, [selected]);

  const chartOption = useMemo(() => {
    if (!observations || observations.length === 0) return null;
    const sorted = [...observations].sort((a, b) => a.period_id.localeCompare(b.period_id));
    return {
      grid: { left: 56, right: 24, top: 24, bottom: 32 },
      xAxis: { type: "category" as const, data: sorted.map((o) => o.period_id), axisLabel: { color: ct.muted } },
      yAxis: { type: "value" as const, axisLabel: { color: ct.muted }, splitLine: { lineStyle: { color: ct.split } } },
      series: [{
        type: "line" as const, smooth: true, data: sorted.map((o) => o.value),
        itemStyle: { color: ct.color[0] }, areaStyle: { color: ct.color[0], opacity: 0.12 },
      }],
    };
  }, [observations, ct]);

  return (
    <section aria-label="시장 시계열 (부록)" className="market-section">
      <h2>📈 부록 — 시장 시계열 데이터</h2>
      <input type="search" aria-label="시계열 검색" placeholder="시계열 ID 검색" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-3" />
      {series === null ? (
        <p>불러오는 중...</p>
      ) : series.length === 0 ? (
        <p className="text-[color:var(--muted-fg)] italic">등록된 시장 시계열이 없습니다.</p>
      ) : (
        <div className="market-layout">
          <div className="market-list-pane">
            <p className="mb-1 text-[color:var(--muted-fg)] text-[0.8rem]">총 {series.length}개 시계열</p>
            <ul className="market-series-list">
              {series.map((s) => (
                <li key={s.series_id}>
                  <button type="button" className={`library-doc-item ${selected === s.series_id ? "library-doc-item-active" : ""}`} onClick={() => setSelected(s.series_id)}>
                    <span className="library-doc-title">{s.series_id}</span>
                    <span className="library-doc-meta">
                      <span>{s.observation_count} 관측</span>
                      <span>{s.min_period_id}~{s.max_period_id}</span>
                      <span className="library-doc-lang">{s.unit_id}</span>
                      {s.stale && <span className="status-chip status-amber">stale</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="market-chart-pane">
            {!selected ? (
              <p className="text-[color:var(--muted-fg)] italic">왼쪽에서 시계열을 선택하면 추이가 표시됩니다.</p>
            ) : observations === null ? (
              <p>불러오는 중...</p>
            ) : observations.length === 0 ? (
              <p className="text-[color:var(--muted-fg)] italic">관측치가 없습니다.</p>
            ) : (
              <>
                <h3 className="text-[1rem] mb-2">{selected}</h3>
                {chartOption && <EChart option={chartOption} height={320} />}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default MarketView;
