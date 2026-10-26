"use client";

// 드라이런 세션 목록 (화면 설계 2026-10-24 §6.3 + 2026-10-26 UX 개편 §6 — NON_MENU 라우트,
// /flows 탭 행의 텍스트 링크와 블루프린트 "드라이런 시작"으로만 진입한다 §2.2).
// 표: 목적·단계(상세 링크) | 상태 | 작성자 | 최근 실행 | 짧은 ID+복사. 필터: 상태 칩(실제 상태값
// active/closed/expired + 건수)과 전체/내 세션 범위(API mine=1), 목적·ID 클라이언트 검색.
import { Suspense, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { SectionToolbar } from "../../../components/layout.tsx";
import { Button, ColGroup, FilterChip, PageState, PrimaryAction, useToast } from "../../../components/ui.tsx";
import { api, ApiError } from "../../../lib/api.ts";
import {
  expiryChip,
  fmtDateTime,
  fmtInt,
  sessionStatusChip,
  type DryRunSessionDetail,
  type FlowsBlueprint,
} from "../flows-view-lib.ts";
import { SESSION_STATUS_FILTERS, filterSessions, shortId, statusCounts, type SessionStatusFilter } from "./dry-run-ui-lib.ts";

const SESSION_COL_PCT = [38, 18, 14, 18, 12] as const;

const ADMIN_FORBIDDEN_KEY = "adminForbidden";

export function DryRunSessionsView() {
  const t = useTranslations("pages.flows.dryRunSession");
  const tc = useTranslations("common");
  const tr = useTranslations();
  const { toast } = useToast();
  const [mine, setMine] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SessionStatusFilter>("all");
  const [query, setQuery] = useState("");
  // 단계 표기용 — 프롬프트 키 → 단계 id. 실패는 침묵(단계 표기만 생략).
  const [stageByPrompt, setStageByPrompt] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    api
      .get<FlowsBlueprint>("/api/flows")
      .then((r) => {
        if (!alive) return;
        const m = new Map<string, string>();
        for (const p of r.data.prompts ?? []) if (p.stageId) m.set(p.key, p.stageId);
        setStageByPrompt(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
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

  const counts = statusCounts(sessions ?? []);
  const visible = filterSessions(sessions ?? [], statusFilter, query);
  const statusLabel = (f: SessionStatusFilter): string =>
    f === "all" ? t("allSessions") : f === "active" ? tr("pages.flows.chips.sessionEditing") : f === "closed" ? tr("pages.flows.chips.sessionDone") : tr("pages.flows.chips.expired");
  function clearFilters() {
    setStatusFilter("all");
    setQuery("");
  }
  function copyId(id: string) {
    void navigator.clipboard.writeText(id);
    toast(t("sessionIdCopiedToast"));
  }

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
            count={visible.length}
            filters={
              <span className="flex flex-wrap items-center gap-1" role="group" aria-label={t("scopeFilterGroup")}>
                <FilterChip selected={!mine} onClick={() => setMine(false)}>{t("allSessions")}</FilterChip>
                <FilterChip selected={mine} onClick={() => setMine(true)}>{t("mySessions")}</FilterChip>
              </span>
            }
            actions={<PrimaryAction inline href="/flows?tab=blueprint" label={t("newSessionCta")} />}
          />
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex flex-wrap items-center gap-1" role="group" aria-label={t("statusFilterGroup")}>
              {SESSION_STATUS_FILTERS.map((f) => (
                <FilterChip key={f} selected={statusFilter === f} onClick={() => setStatusFilter(f)}>
                  {statusLabel(f)} ({fmtInt(counts[f])})
                </FilterChip>
              ))}
            </span>
            <input
              type="search"
              className="sizing-new-input sizing-new-input-sm"
              style={{ flex: "1 1 14rem", maxWidth: "24rem" }}
              aria-label={t("searchLabel")}
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
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
          {status === "ok" && (sessions ?? []).length > 0 && visible.length === 0 && (
            <PageState
              state="empty"
              emptyText={t("emptyFiltered")}
              emptyAction={<Button size="sm" onClick={clearFilters}>{t("clearFilters")}</Button>}
            />
          )}
          {status === "ok" && visible.length > 0 && (
            <div className="table-scroll" role="region" aria-label={t("sessionsTableScroll")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-48" aria-label={t("sessionsTableAria")}>
                <caption className="sr-only">{t("sessionsTableCaption")}</caption>
                <ColGroup widths={SESSION_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">{t("colPurposeStage")}</th>
                    <th scope="col">{tc("status")}</th>
                    <th scope="col">{t("colOwner")}</th>
                    <th scope="col">{t("colLastRun")}</th>
                    <th scope="col">{t("colSessionId")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const st = sessionStatusChip(s.status);
                    const expiry = expiryChip(s.expires_at);
                    const stage = stageByPrompt.get(s.prompt_key);
                    return (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/flows/dry-run/${encodeURIComponent(s.id)}`} className="text-[color:var(--accent)] underline">
                            {s.purpose || s.prompt_key}
                          </Link>
                          <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            {stage ? <span className="status-chip status-not-started">{stage}</span> : null}{" "}
                            <code className="dd-item-id">{s.activity_id ?? s.prompt_key}</code>
                          </div>
                        </td>
                        <td>
                          <span className={st.cls}>{st.key ? tr(st.key) : st.label}</span>
                          {expiry && <> <span className={expiry.cls} title={tr(expiry.titleKey, expiry.titleParams)}>{tr(expiry.key)}</span></>}
                        </td>
                        <td className="text-[length:var(--fs-caption)]">{s.created_by}</td>
                        <td className="tabular-nums">{fmtDateTime(s.ledger.lastRunAt)}</td>
                        <td>
                          <span className="dry-run-id-cell">
                            <code className="dd-item-id" title={s.id}>{shortId(s.id)}</code>
                            <button type="button" className="btn-ghost btn-sm" aria-label={t("copySessionIdAria")} onClick={() => copyId(s.id)}>
                              {tc("copy")}
                            </button>
                          </span>
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
