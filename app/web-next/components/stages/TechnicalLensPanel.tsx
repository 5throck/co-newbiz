"use client";

// S8 `기술적 타당성` (ADR-0169, release 1 skeleton): the six items. T1 (required-capability
// attainability) is derived read-only from the ADR-0168 panel below; T2-T6 show `미판정`
// with a note that input opens in the next release. A person judges each item; AI only
// drafts. Warning only: nothing here caps a grade or blocks a gate.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { LENS_VIEW } from "../../lib/s8-lens-status.ts";
import type { S8LensSummary } from "../../lib/s8-lens-summary.ts";
import { CapabilityAttainabilityPanel } from "./CapabilityAttainabilityPanel.tsx";

export function TechnicalLensPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<S8LensSummary | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<S8LensSummary>(`/api/projects/${encodeURIComponent(projectId)}/s8-lens-summary`).then((r) => { if (alive) setData(r.data); }).catch(() => { /* the items list is additive */ });
    return () => { alive = false; };
  }, [projectId]);
  const items = data?.technical.items ?? [];
  return (
    <>
      <section className="market-section sizing-step mb-3" aria-label="기술적 타당성 항목">
        <h3 className="sizing-step-title">기술적 타당성 항목 <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">(6개)</span></h3>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">
          항목별 판정은 사람이 합니다. AI는 근거 초안만 제안하며, 판정하지 않은 항목은 미판정으로 남습니다. 수치나 등급에는 자동 반영되지 않습니다.
        </p>
        <ul className="grid gap-1" aria-label="기술적 타당성 항목 목록">
          {items.map((it) => {
            const v = LENS_VIEW[it.status];
            return (
              <li key={it.key} className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{it.key}</span>
                <span>{it.label}</span>
                <span className={`status-chip ${v.cls}`}><span aria-hidden="true">{v.icon}</span> {v.label}</span>
                {it.key === "T1" && <a href="#capability-attainability" className="text-[color:var(--accent)] font-bold text-[length:var(--fs-caption)]">달성 가능성 판정 보기</a>}
                {it.note && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{it.key === "T1" ? `사업 역량 판정에서 자동 도출 — ${it.note}` : it.note}</span>}
              </li>
            );
          })}
        </ul>
      </section>
      <div id="capability-attainability"><CapabilityAttainabilityPanel projectId={projectId} /></div>
    </>
  );
}
