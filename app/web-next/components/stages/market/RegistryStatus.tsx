"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useMemo } from "react";
import { REGISTRY } from "../../../lib/market-sizing.ts";
import type { IndustryDetail } from "./types.ts";

export function RegistryStatus({ sizing, referenceImplementation }: {
  sizing: IndustryDetail["sizing"];
  referenceImplementation: string;
}) {
  const counts = useMemo(() => {
    const byPrefix: { baseline_2026: number; cagr: number } = { baseline_2026: 0, cagr: 0 };
    for (const a of sizing?.assumptions ?? []) {
      if (a.assumption_key.includes(".baseline_2026.")) byPrefix.baseline_2026++;
      else if (a.assumption_key.includes(".cagr.")) byPrefix.cagr++;
    }
    return { ...byPrefix, total: sizing?.assumptions.length ?? 0 };
  }, [sizing]);

  // 레지스트리 패널은 가정이 실제 등록된 run(현재: 유압브레이커 시드 run)에만
  // 표시한다 — isFrozen 센티널이 아니라 run_label 데이터로 판별한다 (ADR-0112).
  if (!sizing || sizing.run_label !== REGISTRY.runLabel) {
    return (
      <p className="text-[color:var(--muted-fg)] italic text-[length:var(--fs-caption)]">
        아직 가정 레지스트리에 등록되지 않았습니다. 분석 확정 후 {referenceImplementation} 패턴으로
        recordAssumption 등록하면 이 화면에 등록 상태가 표시됩니다.
      </p>
    );
  }
  const ok = counts.baseline_2026 === REGISTRY.expectedRows.baseline && counts.cagr === REGISTRY.expectedRows.cagr;
  return (
    <div>
      <div className="driver-derivation mb-3">
        <div className="driver-derivation-step">
          <span className={`status-chip ${ok ? "status-green" : "status-amber"}`}>{ok ? "등록 완료" : "불일치"}</span>
          <span>run <code className="text-[length:var(--fs-caption)]">{sizing.run_label}</code></span>
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
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        총 {counts.total} row · 전부 kind='assumed' (rationale + anchor_ref 필수, FR-DATA-07) · TTL {REGISTRY.ttlDays}일 ·
        append-only (수정 = 새 row)
      </p>
      <details className="mt-2">
        <summary className="text-[length:var(--fs-caption)] cursor-pointer text-[color:var(--accent)]">등록 row 전체 보기 ({counts.total}개)</summary>
        <table className="data-table mt-2" aria-label="레지스트리 등록 row">
          <caption className="sr-only">레지스트리 등록 row 목록</caption>
          <thead>
            <tr><th scope="col">assumption_key</th><th scope="col">kind</th><th scope="col">value</th><th scope="col">anchor_ref</th><th scope="col">TTL</th></tr>
          </thead>
          <tbody>
            {sizing.assumptions.map((a) => (
              <tr key={a.assumption_key}>
                <td><code className="text-[length:var(--fs-caption)]">{a.assumption_key}</code></td>
                <td><span className="status-chip status-in-progress">{a.kind}</span></td>
                <td className="tabular-nums">{a.value}</td>
                <td className="text-[length:var(--fs-caption)]">{a.anchor_ref ?? "—"}</td>
                <td className="tabular-nums">{a.ttl_days ?? "—"}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}