"use client";

// S7 `target_screening` readiness: warning-only required-capability check (ADR-0171 D7). Per shortlisted
// target: confirmed / unconfirmed / stale / unjudged counts, with a link to each target's check. It never
// caps a grade or blocks the gate; the gate decision and promotion stay human.
import { useEffect, useState } from "react";
import { api } from "../../../lib/api.ts";

interface Readiness {
  targets: Array<{ target_id: string; company_name: string; total: number; confirmed: number; unconfirmed: number; stale: number; unjudged: number; unreconciled: number }>;
  warning: string | null;
}

export function CapabilityReadinessNotice({ opportunityId }: { opportunityId: string }) {
  const [data, setData] = useState<Readiness | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<Readiness>(`/api/brownfield/${encodeURIComponent(opportunityId)}/capability-readiness`).then((r) => { if (alive) setData(r.data); }).catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [opportunityId]);
  if (!data || data.targets.length === 0) return null;
  return (
    <section aria-label="필요 역량 점검 준비 상태" className="market-section" data-testid="capability-readiness">
      <h4 className="text-[0.9rem] mb-1">필요 역량 점검 (참고 · 게이트를 막지 않음)</h4>
      {data.warning && <div className="legacy-model-notice mb-2" role="status"><p className="legacy-model-notice-text">{data.warning}</p></div>}
      <ul className="m-0 pl-4 text-[length:var(--fs-caption)]">
        {data.targets.map((t) => (
          <li key={t.target_id}>
            <a href={`/brownfield/targets/${encodeURIComponent(t.target_id)}`} className="text-[color:var(--accent)] underline">{t.company_name}</a>
            {" "}— 확정 {t.confirmed}/{t.total} · 확정 전 {t.unconfirmed} · {t.stale > 0 ? <span className="status-chip status-amber"><span aria-hidden="true">!</span> 재판정 필요 {t.stale}</span> : "재판정 필요 0"} · 미판정 {t.unjudged}
            {t.unreconciled > 0 ? ` · 기준 미반영 ${t.unreconciled}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
