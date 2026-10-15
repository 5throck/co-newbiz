"use client";

// ADR-0176 slice 4: S8 `투자 불확실성` block. Read-only view of the latest CONFIRMED S5 investment
// simulation run - S5 owns editing, confirming and re-running (link only). Simulation output /
// proposal: no gate block, no grade cap, no adoption trigger; a missing or stale run is informational.
import Link from "next/link";
import type { InvestUncertaintyView } from "../../lib/investment-uncertainty-s8.ts";

const CAP = "text-[length:var(--fs-caption)]";
const fmt = (n: number): string => Math.round(n).toLocaleString("ko-KR");
const STALE_REASON: Record<string, string> = {
  run_confirmed_after_generation: "사례 생성 후 S5 투자 시뮬레이션이 확정되었습니다",
  run_changed: "확정된 S5 시뮬레이션 실행이 사례 생성 이후 바뀌었습니다",
  s5_lines_changed: "S5 투자 계획 또는 가정 범위가 확정 실행 이후 바뀌었습니다",
  run_missing: "사례가 참조한 S5 시뮬레이션 확정 실행을 찾을 수 없습니다",
};

export function S8InvestUncertaintyBlock({ view }: { view: InvestUncertaintyView }) {
  const s5Link = view.opportunityId ? (
    <Link href={`/deals/${encodeURIComponent(view.opportunityId)}/s5?tab=simulation`} className="text-[color:var(--accent)] font-bold" data-testid="s8-invest-uncertainty-s5-link">S5 투자 시뮬레이션 탭에서 확인·수정</Link>
  ) : null;
  const npv = view.npv;
  const chip = npv.state === "not_applicable" ? null : (
    <span className={`status-chip ${npv.stale ? "status-amber" : npv.includes ? "status-green" : "status-gray"}`} data-testid="s8-invest-uncertainty-npv-chip">
      {npv.stale && <span aria-hidden="true">⏱ </span>}
      {npv.stale ? npv.label : npv.includes ? "NPV 분포에 투자 불확실성 반영" : "NPV 분포에 투자 불확실성 미반영"}
    </span>
  );
  return (
    <section className="mt-2 grid gap-1" aria-label="투자 불확실성" data-testid="s8-invest-uncertainty-block">
      <h3 className="sizing-step-title">투자 불확실성 {chip}</h3>
      {!view.hasRun || !view.total || !view.run ? (
        <p className={`${CAP} text-[color:var(--muted-fg)]`} role="status" data-testid="s8-invest-uncertainty-none">
          확정된 S5 투자 시뮬레이션이 없습니다 (참고 정보, 차단 아님). {s5Link}
        </p>
      ) : (
        <>
          <p className={CAP} data-testid="s8-invest-uncertainty-total">
            총 투자비 p50 <strong>{fmt(view.total.p50)}</strong> / p95 <strong>{fmt(view.total.p95)}</strong> 백만원
            {view.exceed && <span data-testid="s8-invest-uncertainty-exceed"> · 예산 상한 {fmt(view.exceed.envelopeKrwM)} 백만원 초과 확률 {(view.exceed.probability * 100).toFixed(1)}%</span>}
          </p>
          {view.topSensitivities.length > 0 && (
            <p className={CAP} data-testid="s8-invest-uncertainty-tornado">
              주요 민감도: {view.topSensitivities.map((t) => `${t.label} ${(t.share * 100).toFixed(0)}%`).join(" · ")}
            </p>
          )}
          {npv.stale && <p className={CAP} role="status" data-testid="s8-invest-uncertainty-stale">{STALE_REASON[npv.reason ?? ""] ?? ""} - 사례를 다시 생성하면 해소됩니다 (자동 재계산 없음).</p>}
          <p className={`${CAP} text-[color:var(--muted-fg)]`} data-testid="s8-invest-uncertainty-provenance">
            S5 확정 실행 {view.run.hash.slice(0, 12)} · 확정 {view.run.confirmedBy ?? "-"} @ {(view.run.confirmedAt ?? "").slice(0, 10)} · {view.run.drawCount.toLocaleString("ko-KR")}회 · {s5Link}
          </p>
        </>
      )}
      <p className={`${CAP} text-[color:var(--muted-fg)]`} data-testid="s8-invest-uncertainty-label">{view.disclaimer}</p>
    </section>
  );
}
