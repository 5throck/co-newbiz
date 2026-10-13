"use client";

// ValuationMethodology — S8 기업가치 계산 방법의 사용자 공개 (사용자 요청,
// 2026-10-10). "기업가치가 어떻게 나오는지 알 수 있어야 한다" — 계산 사슬
// (앵커 → 성장/변동성 → 손익 → 인수가 → 할인/처분 → 몬테카를로 → 교차검증)을
// 현재 파라미터와 최신 케이스의 실측값으로 단계별 설명하고, 두 관점(시장/과거
// 기반) 값 차이의 원인(성장률 가정 + 인수가 레버리지)을 함께 공개한다.
// 모든 금액은 백만 원(KRW-M)으로 저장·계산된다(migration 0134 단위 계약).

import { fmtNpvEok } from "@/lib/npv-format";
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { KRW_MILLIONS_UNIT } from "../../lib/format.ts";
import { noteNumber, parseSimNote } from "../../lib/sim-note.ts";

interface MethodCase {
  id: string;
  variant: "market_forward" | "historical";
  created_at: string;
  lines: Array<{ category: string; name: string; annual_amount_krw_m: number }>;
  simulations: Array<{ percentile: string; npv_krw_m: number; irr: number | null; note: string | null }>;
}

interface ResolvedParams {
  opexRatio: number; opexSource: string;
  capexRatio: number; capexSource: string;
  initialInvestmentRatio: number; initialInvestmentSource: string;
  acquisitionEvRevenue: number | null; acquisitionEvRevenueSource: string;
  rampUp: number[]; rampSource: string;
  horizonYears: number; horizonSource: string;
  iterations: number; iterationsSource: string;
  fadeHorizonYears: number; fadeHorizonSource: string;
  growthTerminal: number | null; growthTerminalSource: string;
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const 억 = (krwM: number) => `${(krwM / 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;

export function ValuationMethodology({
  projectId,
  marketCase,
  historicalCase,
}: {
  projectId: string;
  marketCase: MethodCase | null;
  historicalCase: MethodCase | null;
}) {
  const [params, setParams] = useState<ResolvedParams | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ params: ResolvedParams }>(`/api/projects/${encodeURIComponent(projectId)}/business-case/params`)
      .then((r) => setParams(r.data.params))
      .catch(() => setError("파라미터를 불러오지 못했습니다."));
  }, [projectId]);

  if (error) return <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p>;

  const mf = marketCase?.simulations.find((s) => s.percentile === "p50");
  const n = parseSimNote(mf?.note);
  const hist = historicalCase?.simulations.find((s) => s.percentile === "p50");
  const hn = parseSimNote(hist?.note);
  const revLine = marketCase?.lines.find((l) => l.category === "revenue");
  const acqEv = noteNumber(n.acq_ev);
  const exitEv = noteNumber(n.exit_ev);
  const isAcquisition = acqEv !== null && revLine != null;
  const wacc = noteNumber(n.wacc);
  const sigma = noteNumber(n.sigma);
  const xTerminal = noteNumber(n.xcheck_terminal_growth);
  const xNpv = noteNumber(n.xcheck_fade_npv);
  const iterations = noteNumber(n.iterations) ?? params?.iterations ?? null;
  const horizon = params?.horizonYears ?? (noteNumber(n.horizon) || 5);

  // 두 관점 차이의 원인 수치 — 같은 앵커·인수가·마진에서 성장률만 다르다.
  const gMf = noteNumber(n.growth);
  const gHist = noteNumber(hn.growth);
  const terminalMultipleMf = gMf != null && horizon > 1 ? Math.pow(1 + gMf, horizon - 1) : null;
  const terminalMultipleHist = gHist != null && horizon > 1 ? Math.pow(1 + gHist, horizon - 1) : null;

  return (
    <section className="market-section sizing-step mb-3" aria-label="기업가치 계산 방법">
      <h3 className="sizing-step-title">기업가치 계산 방법 <span className="status-chip status-info">계산 사슬 공개</span></h3>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
        이 화면의 NPV·IRR은 아래 사슬로 계산됩니다. 모든 금액은 <b>백만 원(KRW-M)</b> 단위로 저장·계산되고
        각 행의 단위는 DB에 명시됩니다. 값 옆의 괄호는 근거 출처이며, 전체 근거는 시뮬레이션 노트와 파라미터·스냅샷 탭에서 추적할 수 있습니다.
      </p>
      {!marketCase ? (
        <p className="text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">아직 생성된 케이스가 없습니다 — 생성 후 이곳에 실제 값으로 계산 구조가 표시됩니다.</p>
      ) : (
        <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}><table className="data-table">
          <caption className="sr-only">기업가치 계산 사슬 — 단계와 현재 적용값</caption>
          <thead><tr><th scope="col">단계</th><th scope="col">내용</th><th scope="col">현재 값</th></tr></thead>
          <tbody>
            <tr>
              <td>① 매출 앵커</td>
              <td>{isAcquisition ? "인수 대상 회사의 최신 연매출 — 두 관점(시장·과거 기반)이 같은 앵커에서 출발" : "시장규모 × 포획률로 산정한 year-1 매출"}</td>
              <td className="num mono-num">{revLine ? 억(revLine.annual_amount_krw_m) : "—"}{isAcquisition ? ` (${n.revenue_anchor ?? ""})` : ""}</td>
            </tr>
            <tr>
              <td>② 성장 가정</td>
              <td>시장 기반 = 시장 성장률 / 과거 기반 = 대상 회사 자체 CAGR (DART) — 두 관점의 유일한 차이</td>
              <td className="num mono-num">
                {gMf != null ? `시장 ${pct1(gMf)}` : "—"} · {gHist != null ? `과거 ${pct1(gHist)}` : "—"}
              </td>
            </tr>
            <tr>
              <td>③ 변동성(σ)</td>
              <td>연도별 매출 성장 노이즈의 표준편차 — 몬테카를로 분포의 폭</td>
              <td className="num mono-num">{sigma != null ? pct1(sigma) : "—"} ({n.sigma_source ?? ""})</td>
            </tr>
            <tr>
              <td>④ 손익 구조</td>
              <td>FCF = 매출 × (1 − 운영비율 − 설비투자율) × 가동률(램프업)</td>
              <td className="num mono-num">
                운영비 {params ? pct1(params.opexRatio) : "—"} · 설비투자 {params ? pct1(params.capexRatio) : "—"} · 가동률 {params ? params.rampUp.map((v) => v.toFixed(1)).join("→") : "—"}
              </td>
            </tr>
            <tr>
              <td>⑤ year-0 투자</td>
              <td>{isAcquisition ? "인수 기업가치 = 매출 앵커 × EV/Revenue 배수 (시나리오와 무관 — 가격은 한 번 협상)" : "초기투자 = year-1 매출 × 비율 (ADR-0106)"}</td>
              <td className="num mono-num">
                {isAcquisition
                  ? `${acqEv!.toFixed(2)}배 = ${fmtNpvEok(revLine!.annual_amount_krw_m * acqEv!)}`
                  : params ? `매출의 ${(params.initialInvestmentRatio * 100).toFixed(0)}%` : "—"}
              </td>
            </tr>
            <tr>
              <td>⑥ 할인·처분</td>
              <td>{horizon}년 FCF를 WACC로 할인{isAcquisition ? " + 마지막 해에 동일 배수로 처분(멀티플 확대 없음)" : ""}</td>
              <td className="num mono-num">WACC {wacc != null ? pct1(wacc) : "—"} ({n.wacc_source ?? ""}){exitEv != null ? ` · 처분 ${exitEv.toFixed(2)}배` : ""}</td>
            </tr>
            <tr>
              <td>⑦ 분포 산출</td>
              <td>시드 기반 몬테카를로 — 동일 시드로 재현 가능 (ADR-0052 §D.4)</td>
              <td className="num mono-num">{iterations != null ? iterations.toLocaleString() + "회" : "—"} → 하위 5%/중앙값/상위 5%·IRR</td>
            </tr>
            <tr>
              <td>⑧ 구조 교차검증</td>
              <td>같은 케이스를 페이드 DCF(장기창구, 성장률 → 말기 성장률 수렴, 동일 배수 처분)로 재평가</td>
              <td className="num mono-num">
                {n.xcheck === "fade-dcf"
                  ? `${n.xcheck_horizon}년 · → ${xTerminal != null ? pct1(xTerminal) : "—"} · NPV ${xNpv != null ? fmtNpvEok(xNpv) : "—"}`
                  : "— (인수 가격 케이스에만)"}
              </td>
            </tr>
          </tbody>
        </table></div>
      )}

      {marketCase && historicalCase && mf && hist && gMf != null && gHist != null && (
        <div className="mt-2 p-3 border border-[color:var(--border)] rounded-[length:var(--radius)]" aria-label="두 관점 값 차이의 원인">
          <p className="text-[length:var(--fs-body)] font-semibold mb-1">두 관점의 값이 왜 다른가?</p>
          <p className="text-[length:var(--fs-caption)] mb-2">
            두 관점은 <b>같은 매출 앵커·같은 인수가·같은 마진·같은 WACC</b>를 쓰고 <b>성장률만 다릅니다</b>
            (시장 {pct1(gMf)} vs 과거 {pct1(gHist)}). {horizon}년 복리면 최종년 매출이{" "}
            {terminalMultipleMf ? terminalMultipleMf.toFixed(2) : "—"}배 vs {terminalMultipleHist ? terminalMultipleHist.toFixed(2) : "—"}배로 벌어지고,
            기업가치는 마지막 해 매출에 비례하며(처분가치) 인수가는 고정이라
            <b> 성장률 차이가 NPV에서 몇 배로 증폭</b>됩니다 — 현재 중앙값 {fmtNpvEok(mf.npv_krw_m)} vs {fmtNpvEok(hist.npv_krw_m)}.
            차이가 크다는 것은 곧 <b>성장 가정의 불확실성이 크다</b>는 신호입니다(ADR-0117): 로보티즈가 시장 성장률을 따라갈 수 있는가가
            이 딜 가치의 절반 이상을 결정합니다.
          </p>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            시장 기반의 {pct1(gMf)}는 &quot;{n.growth_source}&quot;에서, 과거 기반의 {pct1(gHist)}는 &quot;{hn.growth_source}&quot;에서 옵니다.
            성장 가정을 바꾸려면 파라미터 탭의 성장률 오버라이드(bc.growth_override)를 사용하세요.
          </p>
        </div>
      )}

      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2">
        단위 계약: DART 실적은 원 단위로 저장되고, 분석 계열은 억원으로 정규화된 뒤 백만 원(KRW-M)으로 변환되어
        라인·시뮬레이션·스냅샷에 저장됩니다({KRW_MILLIONS_UNIT}). 단위 사슬의 일관성은 자동 회귀 테스트로 점검됩니다.
      </p>
    </section>
  );
}
