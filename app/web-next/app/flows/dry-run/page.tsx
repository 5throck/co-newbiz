"use client";

// 드라이런 세션 목록 (화면 설계 2026-10-24 §6.3 — NON_MENU 라우트, /flows 탭 행의
// 텍스트 링크와 블루프린트 "드라이런 시작"으로만 진입한다 §2.2). 표: 세션 ID ·
// 프롬프트·활동 · 상태 · 선호 · 누적 비용 · 최근 실행 · 만료. mine 토글로 내 세션
// 필터(API mine=1, created_by 기준). 빈 상태는 블루프린트 진입 링크를 함께 제공한다.
import { Suspense, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { SectionToolbar } from "../../../components/layout.tsx";
import { ColGroup, FilterChip, PageState } from "../../../components/ui.tsx";
import { api, ApiError } from "../../../lib/api.ts";
import {
  expiryChip,
  fmtDateTime,
  fmtInt,
  fmtUsd,
  preferenceLabelKey,
  sessionStatusChip,
  type DryRunSessionDetail,
} from "../flows-view-lib.ts";

const SESSION_COL_PCT = [16, 24, 10, 12, 11, 13, 14] as const;

const ADMIN_FORBIDDEN_KEY = "adminForbidden";

export function DryRunSessionsView() {
  const t = useTranslations("pages.flows.dryRunSession");
  const tc = useTranslations("common");
  const tr = useTranslations();
  const [mine, setMine] = useState(false);
  const [sessions, setSessions] = useState<DryRunSessionDetail[] | null>(null);
  const [purged, setPurged] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [forbidden, setForbidden] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setForbidden(false);
    setErrorText(null);
    api
      .get<DryRunSessionDetail[]>(`/api/flows/dry-run/sessions${mine ? "?mine=1" : ""}`)
      .then((r) => {
        if (!alive) return;
        setSessions(r.data ?? []);
        setPurged(typeof r.meta.purgedExpired === "number" ? r.meta.purgedExpired : null);
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setErrorText(err instanceof Error ? err.message : t("sessionsListLoadFailed"));
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [mine, retryTick]);

  return (
    <main>
      <p className="mb-1 text-[length:var(--fs-caption)]">
        <Link href="/flows" className="text-[color:var(--accent)] underline">{t("backToFlowsList")}</Link>
      </p>
      <h1>{t("sessionsH1")}</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        {t("sessionsIntro")}
      </p>

      {forbidden ? (
        <PageState state="error" errorText={t(ADMIN_FORBIDDEN_KEY)} />
      ) : (
        <section aria-label={t("sessionsSection")} className="market-section">
          <SectionToolbar
            title={t("sessionsTitle")}
            count={sessions?.length}
            filters={
              <span className="flex flex-wrap items-center gap-1" role="group" aria-label={t("scopeFilterGroup")}>
                <FilterChip selected={!mine} onClick={() => setMine(false)}>{t("allSessions")}</FilterChip>
                <FilterChip selected={mine} onClick={() => setMine(true)}>{t("mySessions")}</FilterChip>
              </span>
            }
          />
          {purged !== null && purged > 0 && (
            <p role="status" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("purgedNote", { p1: fmtInt(purged) })}
            </p>
          )}
          {status === "loading" && <PageState state="loading" rows={5} />}
          {status === "error" && (
            <PageState state="error" errorText={errorText ?? undefined} onRetry={() => setRetryTick((t) => t + 1)} />
          )}
          {status === "ok" && (sessions ?? []).length === 0 && (
            <PageState
              state="empty"
              emptyText={t("emptySessions")}
              emptyAction={<Link href="/flows?tab=blueprint" className="text-[color:var(--accent)] underline">{t("emptySessionsAction")}</Link>}
            />
          )}
          {status === "ok" && (sessions ?? []).length > 0 && (
            <div className="table-scroll" role="region" aria-label={t("sessionsTableScroll")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-48" aria-label={t("sessionsTableAria")}>
                <caption className="sr-only">{t("sessionsTableCaption")}</caption>
                <ColGroup widths={SESSION_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">{t("colSessionId")}</th>
                    <th scope="col">{t("colPromptActivity")}</th>
                    <th scope="col">{tc("status")}</th>
                    <th scope="col">{t("colPreference")}</th>
                    <th scope="col" className="col-num">{t("colAccumCost")}</th>
                    <th scope="col">{t("colLastRun")}</th>
                    <th scope="col">{t("colExpiry")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(sessions ?? []).map((s) => {
                    const st = sessionStatusChip(s.status);
                    const expiry = expiryChip(s.expires_at);
                    const prefKey = preferenceLabelKey(s.preference);
                    return (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/flows/dry-run/${encodeURIComponent(s.id)}`} className="text-[color:var(--accent)] underline">
                            <code className="dd-item-id">{s.id}</code>
                          </Link>
                          <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{s.created_by}</div>
                        </td>
                        <td className="text-[length:var(--fs-caption)]">
                          <code className="dd-item-id">{s.prompt_key}</code>
                          {s.activity_id && <div className="text-[color:var(--muted-fg)]"><code className="dd-item-id">{s.activity_id}</code></div>}
                          <div className="text-[color:var(--muted-fg)]">base {s.base_agent_key}{s.override_agent_key ? ` → ${s.override_agent_key}` : ""}</div>
                        </td>
                        <td><span className={st.cls}>{st.key ? tr(st.key) : st.label}</span></td>
                        <td><span className="status-chip status-not-started">{prefKey ? tr(prefKey) : "—"}</span></td>
                        <td className="col-num tabular-nums">{fmtUsd(s.ledger.costUsd)}</td>
                        <td className="tabular-nums">{fmtDateTime(s.ledger.lastRunAt)}</td>
                        <td>
                          {expiry ? <span className={expiry.cls} title={tr(expiry.titleKey, expiry.titleParams)}>{tr(expiry.key)}</span> : <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{fmtDateTime(s.expires_at)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("shareNote")}
          </p>
        </section>
      )}
    </main>
  );
}

export default function DryRunSessionsPage() {
  return (
    <Suspense fallback={null}>
      <DryRunSessionsView />
    </Suspense>
  );
}
