"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StageTabs } from "../../../../components/StageTabs.tsx";
import { useTranslations } from "next-intl";
import { api } from "../../../../lib/api.ts";
import { PageState } from "../../../../components/ui.tsx";

// 프로세스 타임라인·SLA (ADR-0122 #1) — 단계별 마일스톤 산출일과 SLA 정책
// 목표를 대비해 경과·위반을 표시한다. 경과는 계산값(저장 안 함), SLA는 운영
// 정책 테이블(stage_sla)에서 온다.
interface StageRow { stage_id: string; milestone_at: string | null; elapsed_days: number | null; sla_target_days: number | null; sla_breach: boolean | null; sla_set: boolean; in_progress: boolean; status?: string | null; not_applicable?: boolean }

function TimelineView() {
  const t = useTranslations("pages.projects.timeline");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const [stages, setStages] = useState<StageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ stages: StageRow[] }>(`/api/projects/${encodeURIComponent(id)}/timeline`)
      .then((r) => setStages(r.data.stages))
      .catch((e) => setError(e instanceof Error ? e.message : tc("errors.loadFailed")));
  }, [id]);

  const maxElapsed = Math.max(1, ...(stages ?? []).map((s) => s.elapsed_days ?? 0));

  return (
    <main>
      <StageTabs projectId={id} />
      <h1>{t("heading")}</h1>
      <p className="objective">{t("objective")}</p>
      {error && <PageState state="error" errorText={error} onRetry={() => window.location.reload()} />}
      <section className="market-section" aria-label={t("sectionAria")}>
        {stages === null ? <PageState state="loading" /> : (
          <table className="data-table" aria-label={t("tableAria")}>
            <caption className="sr-only">{t("caption")}</caption>
            <thead><tr><th>{tc("stage")}</th><th>{t("thSlaTarget")}</th><th style={{ width: "38%" }}>{t("thElapsed")}</th><th className="col-num">{t("thElapsedVsTarget")}</th><th>{tc("status")}</th></tr></thead>
            <tbody>{stages.map((s) => (
              <tr key={s.stage_id} className={s.sla_breach ? "row-selected" : undefined}>
                <td className="font-semibold">{s.stage_id}</td>
                <td className="tabular-nums">{s.not_applicable ? "—" : s.sla_set ? t("daysValue", { n: s.sla_target_days ?? 0 }) : <span className="note">{t("notSet")}</span>}</td>
                <td>
                  <div style={{ position: "relative", height: 12, background: "var(--bg)", borderRadius: 6 }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0,
                      width: `${Math.min(100, ((s.elapsed_days ?? 0) / maxElapsed) * 100)}%`,
                      background: s.sla_breach ? "var(--red-fg)" : s.in_progress ? "var(--accent)" : "var(--green-fg)",
                      opacity: 0.75, borderRadius: 6 }} />
                  </div>
                </td>
                <td className="col-num tabular-nums">{s.elapsed_days != null ? t("elapsedCell", { days: s.elapsed_days, target: s.sla_set ? ` / ${t("daysValue", { n: s.sla_target_days ?? 0 })}` : "" }) : "—"}</td>
                <td>{s.not_applicable ? <span className="chip gray">{t("chipNA")}</span> : s.sla_breach ? <span className="status-chip status-red">{t("chipBreach")}</span>
                  : s.in_progress ? <span className="status-chip status-amber">{t("chipInProgress")}</span>
                  : s.status === "complete" || s.elapsed_days != null ? <span className="status-chip status-green">{t("chipComplete")}</span>
                  : <span className="chip gray">{t("chipWaiting")}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
          {t("footnoteLead")}<a href="#" className="text-[color:var(--accent)] underline">{t("footnoteLink")}</a>{t("footnoteTail")}
        </p>
      </section>
    </main>
  );
}

export default function TimelinePage() {
  return <Suspense fallback={null}><TimelineView /></Suspense>;
}
