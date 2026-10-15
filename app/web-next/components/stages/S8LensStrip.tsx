"use client";

// S8 summary strip (ADR-0169): the two lenses side by side plus a short goals line,
// shown on top of every S8 page. Status chips carry an icon and text (never colour
// alone). Decision support only: no grade cap, no gate block; a person decides.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { S8InvestUncertaintyBlock } from "./S8InvestUncertaintyBlock.tsx";
import type { S8LensSummary } from "../../lib/s8-lens-summary.ts";

export function S8LensStrip({ projectId }: { projectId: string }) {
  const [data, setData] = useState<S8LensSummary | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setError(false);
    api.get<S8LensSummary>(`/api/projects/${encodeURIComponent(projectId)}/s8-lens-summary`)
      .then((r) => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [projectId]);

  if (error) return null; // additive surface: a failed lookup never takes the S8 page down
  if (!data) return <section className="market-section sizing-step mb-3" aria-label="S8 타당성 요약" aria-busy="true"><p className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">타당성 요약을 불러오는 중…</p></section>;
  const { strip, financial, technical } = data;
  const irr = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  return (
    <section className="market-section sizing-step mb-3" aria-label="S8 타당성 요약">
      <div className="grid gap-2 md:grid-cols-2">
        <article className="grid gap-1" aria-label="기술적 타당성 요약">
          <h3 className="sizing-step-title">기술적 타당성 <span className={`status-chip ${strip.technical.cls}`}><span aria-hidden="true">{strip.technical.icon}</span> {strip.technical.label}</span></h3>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            판정 {strip.technical.judged}/{strip.technical.total}
            {strip.technical.cautionCount > 0 ? ` · 주의 ${strip.technical.cautionCount}` : ""}
            {strip.technical.worstItem ? ` · ${strip.technical.worstItem}` : ""}
            {strip.technical.mismatchCount > 0 ? ` · 실사와 다름 ${strip.technical.mismatchCount}` : ""}
            {strip.technical.staleCount > 0 ? ` · 재판정 필요 ${strip.technical.staleCount}` : ""}
          </p>
        </article>
        <article className="grid gap-1" aria-label="재무적 타당성 요약">
          <h3 className="sizing-step-title">재무적 타당성 <span className={`status-chip ${strip.financial.cls}`}><span aria-hidden="true">{strip.financial.icon}</span> {strip.financial.label}</span></h3>
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            기본 IRR {irr(financial.baseIrr)} / 목표 수익률 {irr(financial.hurdleIrr)}
            {strip.financial.reasons.length > 0 ? ` · ${strip.financial.reasons.join(" · ")}` : ""}
          </p>
        </article>
      </div>
      {data.invest_uncertainty && <S8InvestUncertaintyBlock view={data.invest_uncertainty} />}
      <p className="text-[length:var(--fs-caption)] mt-1">사업 목표: {strip.goalsText}</p>
      {/* TECHNICAL_CAUTION_WARNING is intentionally not rendered: the technical chip line
          above already carries "주의 N" — IA cleanup 2026-10-14 (one home per fact).
          The field stays in the view model for the gate-brief consumers and tests. */}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1">
        {strip.caption}
        {" "}
        <details className="inline">
          <summary className="cursor-pointer inline text-[color:var(--accent)] font-bold">판정 기준</summary>
          <span className="block mt-1">{strip.help}{technical.status === "undetermined" ? " 기존 프로젝트는 별도 입력이 없으면 미판정으로 표시됩니다." : ""}</span>
        </details>
      </p>
    </section>
  );
}
