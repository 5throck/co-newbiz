"use client";

// WACC 산식 분해 표 (ADR-0115) — assembleDerivation이 산출한 스텝을
// "항목 | 산식 | 대입 | 결과" 4열로 렌더링한다. 승인된 UI 목업
// (docs/designs/mockups/2026-09-10-wacc-capm-ui-mockup_ko.html) 기준.

import type { WaccDerivation } from "../../../../db/lib/wacc-components.ts";
import { useTranslations } from "next-intl";

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export function DerivationTable({ derivation }: { derivation: WaccDerivation }) {const t = useTranslations("stages.s8.wacc.derivationTable"); const tc = useTranslations("common");
  if (derivation.steps.length === 0) {
    return <p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{t("componentsNeededForTheFormula")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="data-table" aria-label={t("waccFormulaBreakdown")}>
        <caption className="sr-only">{t("waccFormulaBreakdownItemsFormulas")}</caption>
        <thead>
          <tr className="text-left text-[color:var(--muted-fg)] text-[length:var(--fs-caption)] border-b border-[color:var(--border-bright)]">
            <th className="py-1.5 px-1.5 font-semibold whitespace-nowrap">{tc("items")}</th>
            <th className="py-1.5 px-1.5 font-semibold">{t("formula")}</th>
            <th className="py-1.5 px-1.5 font-semibold">{t("substitution")}</th>
            <th className="py-1.5 px-1.5 font-semibold text-right">{t("result")}</th>
          </tr>
        </thead>
        <tbody>
          {derivation.steps.map((s) => {
            const isWacc = s.item === "WACC";
            return (
              <tr
                key={`${s.item}-${s.formula}`}
                className={`border-b border-[color:var(--border-subtle)] ${isWacc ? "bg-[color:var(--primary-bg)] font-bold" : ""}`}
              >
                <td className="py-2 px-1.5 whitespace-nowrap">{s.item}</td>
                <td className="py-2 px-1.5">
                  <code className="font-mono text-[0.82em] bg-[color:var(--muted-bg)] rounded px-1 py-0.5">{s.formula}</code>
                </td>
                <td className="py-2 px-1.5 font-mono text-[0.8em]">{s.substitution}</td>
                <td className={`py-2 px-1.5 text-right font-bold tabular-nums whitespace-nowrap ${isWacc ? "text-[color:var(--accent)]" : ""}`}>
                  {s.resultLabel ?? pct(s.result)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
