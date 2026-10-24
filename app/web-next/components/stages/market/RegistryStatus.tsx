"use client";

// Split from components/stages/MarketAnalysisStage.tsx (Wave U-3 decomposition); behavior unchanged.
import { useMemo } from "react";
import { REGISTRY } from "../../../lib/market-sizing.ts";
import type { IndustryDetail } from "./types.ts";
import { useTranslations } from "next-intl";

export function RegistryStatus({ sizing, referenceImplementation }: {
  sizing: IndustryDetail["sizing"];
  referenceImplementation: string;
}) {const t = useTranslations("stages.s1.registryStatus"); const tc = useTranslations("common");
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
        {t("notYetRegisteredInThe")} {referenceImplementation} {t("patternTheRegistrationStatusAppears")}
      </p>
    );
  }
  const ok = counts.baseline_2026 === REGISTRY.expectedRows.baseline && counts.cagr === REGISTRY.expectedRows.cagr;
  return (
    <div>
      <div className="driver-derivation mb-3">
        <div className="driver-derivation-step">
          <span className={`status-chip ${ok ? "status-green" : "status-amber"}`}>{ok ? t("registered") : t("mismatch")}</span>
          <span>run <code className="text-[length:var(--fs-caption)]">{sizing.run_label}</code></span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">baseline {counts.baseline_2026}/{REGISTRY.expectedRows.baseline}</span>
          <span>{t("n2026Baseline")}</span>
        </div>
        <span className="driver-arrow">→</span>
        <div className="driver-derivation-step">
          <span className="status-chip status-in-progress">cagr {counts.cagr}/{REGISTRY.expectedRows.cagr}</span>
          <span>{t("pessimisticBaseOptimisticBand")}</span>
        </div>
      </div>
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
        {t("total")} {counts.total} {t("rowAllAssumedRationaleRequired")} {REGISTRY.ttlDays}{t("daysEditsNewRow")}
      </p>
      <details className="mt-2">
        <summary className="text-[length:var(--fs-caption)] cursor-pointer text-[color:var(--accent)]">{t("viewAllRegistryRows")}{counts.total}{tc("countSuffixParen")}</summary>
        <table className="data-table mt-2" aria-label={t("registryRow")}>
          <caption className="sr-only">{t("registryRowList")}</caption>
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