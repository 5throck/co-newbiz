"use client";

// 런 레저 확장 행 (화면 설계 2026-10-24 §5.3 — 벤치 B3-1 계층 드릴다운 채택,
// A1-1 변형: 사이드 패널 대신 행 인라인 확장). 네이티브 <details>라 키보드
// 접근(A1)이 내장된다. 계층은 run → activity → agent_run 3단까지 — Row 3 계약이
// llm_call을 별도 평면 섹션으로 돌려주고 런과의 ID 연결 열을 노출하지 않으므로,
// 호출 단위 경제성(지연·토큰·비용)은 아래 llmCalls 평면 표가 담당한다(구현 편차 #5).
import { useTranslations } from "next-intl";
import { ColGroup } from "../../components/ui.tsx";
import { fmtDateTime, fmtSeconds, type ProcessRunRow, runStatusChip } from "./flows-view-lib.ts";

const EXPANSION_AGENT_COL_PCT = [34, 18, 16, 16, 16] as const;

export function RunExpansionRows({ run, colCount }: { run: ProcessRunRow; colCount: number }) {
  const t = useTranslations("pages.flows.runExpansion");
  const tc = useTranslations("common");
  const started = run.started_at ? new Date(run.started_at).getTime() : null;
  const finished = run.finished_at ? new Date(run.finished_at).getTime() : null;
  const durMs = started !== null && finished !== null ? finished - started : null;
  return (
    <tr>
      <td colSpan={colCount}>
        <details className="mt-1 mb-1">
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">
            {t("detailsSummary", { p1: run.activities.length, p2: fmtDateTime(run.started_at) })}
            {durMs !== null ? t("durationSuffix", { p1: fmtSeconds(durMs) }) : ""}
          </summary>
          {run.activities.length === 0 ? (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noActivities")}</p>
          ) : (
            <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-40 mt-1" aria-label={t("tableAria", { p1: run.id })}>
                <caption className="sr-only">{t("tableCaption", { p1: run.id })}</caption>
                <ColGroup widths={EXPANSION_AGENT_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">{t("colActivity")}</th>
                    <th scope="col">{t("colAgent")}</th>
                    <th scope="col">{tc("status")}</th>
                    <th scope="col">{t("colStart")}</th>
                    <th scope="col">{t("colDuration")}</th>
                  </tr>
                </thead>
                <tbody>
                  {run.activities.map((a) => {
                    const aDur = a.started_at && a.finished_at ? new Date(a.finished_at).getTime() - new Date(a.started_at).getTime() : null;
                    return (
                      <ActivityRows key={a.id} activity={a} agentRuns={a.agentRuns} aDur={aDur} />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </td>
    </tr>
  );
}

function ActivityRows({
  activity,
  agentRuns,
  aDur,
}: {
  activity: ProcessRunRow["activities"][number];
  agentRuns: ProcessRunRow["activities"][number]["agentRuns"];
  aDur: number | null;
}) {
  const t = useTranslations("pages.flows.runExpansion");
  const tr = useTranslations();
  const aChip = runStatusChip(activity.status);
  if (agentRuns.length === 0) {
    return (
      <tr>
        <td>
          <code className="dd-item-id">{activity.activity_id}</code>
        </td>
        <td>—</td>
        <td><span className={aChip.cls}>{aChip.key ? tr(aChip.key) : aChip.label}</span></td>
        <td className="tabular-nums">{fmtDateTime(activity.started_at)}</td>
        <td className="col-num tabular-nums">{fmtSeconds(aDur)}</td>
      </tr>
    );
  }
  return (
    <>
      {agentRuns.map((ar, i) => {
        const arDur = ar.started_at && ar.finished_at ? new Date(ar.finished_at).getTime() - new Date(ar.started_at).getTime() : null;
        const arChip = runStatusChip(ar.status);
        return (
          <tr key={ar.id}>
            <td>
              {i === 0 && (
                <>
                  <code className="dd-item-id">{activity.activity_id}</code>
                  <span className="ml-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {t("activitySummary", { p1: aChip.key ? tr(aChip.key) : aChip.label, p2: fmtSeconds(aDur) })}
                  </span>
                </>
              )}
            </td>
            <td><code className="dd-item-id">{ar.agent_key}</code></td>
            <td><span className={arChip.cls}>{arChip.key ? tr(arChip.key) : arChip.label}</span></td>
            <td className="tabular-nums">{fmtDateTime(ar.started_at)}</td>
            <td className="col-num tabular-nums">{fmtSeconds(arDur)}</td>
          </tr>
        );
      })}
    </>
  );
}
