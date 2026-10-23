"use client";

// 드라이런 세션 목록 (화면 설계 2026-10-24 §6.3 — NON_MENU 라우트, /flows 탭 행의
// 텍스트 링크와 블루프린트 "드라이런 시작"으로만 진입한다 §2.2). 표: 세션 ID ·
// 프롬프트·활동 · 상태 · 선호 · 누적 비용 · 최근 실행 · 만료. mine 토글로 내 세션
// 필터(API mine=1, created_by 기준). 빈 상태는 블루프린트 진입 링크를 함께 제공한다.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { SectionToolbar } from "../../../components/layout.tsx";
import { ColGroup, FilterChip, PageState } from "../../../components/ui.tsx";
import { api, ApiError } from "../../../lib/api.ts";
import {
  expiryChip,
  fmtDateTime,
  fmtInt,
  fmtUsd,
  preferenceLabel,
  sessionStatusChip,
  type DryRunSessionDetail,
} from "../flows-view-lib.ts";

const SESSION_COL_PCT = [16, 24, 10, 12, 11, 13, 14] as const;

const ADMIN_FORBIDDEN_TEXT = "관리자 계정은 업무 콘텐츠에서 분리되어 이 화면을 볼 수 없습니다(ADR-0146). 이 상태는 오류가 아니라 설계된 접근 경계입니다.";

export function DryRunSessionsView() {
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
        else setErrorText(err instanceof Error ? err.message : "세션 목록을 불러오지 못했습니다");
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [mine, retryTick]);

  return (
    <main>
      <p className="mb-1 text-[length:var(--fs-caption)]">
        <Link href="/flows" className="text-[color:var(--accent)] underline">← 플로우 콘솔</Link>
      </p>
      <h1>드라이런 세션</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        SSOT을 건드리지 않는 세션 스코프 실험의 목록입니다 — 세션 TTL은 14일이며 만료된 세션은 읽기·실행 경로에서 소거됩니다(런 장부의 is_dry_run 기록은 남습니다).
      </p>

      {forbidden ? (
        <PageState state="error" errorText={ADMIN_FORBIDDEN_TEXT} />
      ) : (
        <section aria-label="드라이런 세션 목록" className="market-section">
          <SectionToolbar
            title="세션"
            count={sessions?.length}
            filters={
              <span className="flex flex-wrap items-center gap-1" role="group" aria-label="세션 범위 필터">
                <FilterChip selected={!mine} onClick={() => setMine(false)}>전체</FilterChip>
                <FilterChip selected={mine} onClick={() => setMine(true)}>내 세션</FilterChip>
              </span>
            }
          />
          {purged !== null && purged > 0 && (
            <p role="status" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              만료된 세션 {fmtInt(purged)}건이 정리되었습니다(TTL 14일, §6.8).
            </p>
          )}
          {status === "loading" && <PageState state="loading" rows={5} />}
          {status === "error" && (
            <PageState state="error" errorText={errorText ?? undefined} onRetry={() => setRetryTick((t) => t + 1)} />
          )}
          {status === "ok" && (sessions ?? []).length === 0 && (
            <PageState
              state="empty"
              emptyText="드라이런 세션이 없습니다. 블루프린트에서 활동을 골라 시작하세요."
              emptyAction={<Link href="/flows?tab=blueprint" className="text-[color:var(--accent)] underline">플로우 콘솔 — 블루프린트 →</Link>}
            />
          )}
          {status === "ok" && (sessions ?? []).length > 0 && (
            <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-48" aria-label="드라이런 세션 목록">
                <caption className="sr-only">드라이런 세션 목록 — 상태·선호·비용·만료. 세션 ID 링크로 상세로 이동합니다.</caption>
                <ColGroup widths={SESSION_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">세션 ID</th>
                    <th scope="col">프롬프트·활동</th>
                    <th scope="col">상태</th>
                    <th scope="col">선호</th>
                    <th scope="col" className="col-num">누적 비용</th>
                    <th scope="col">최근 실행</th>
                    <th scope="col">만료</th>
                  </tr>
                </thead>
                <tbody>
                  {(sessions ?? []).map((s) => {
                    const st = sessionStatusChip(s.status);
                    const expiry = expiryChip(s.expires_at);
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
                        <td><span className={st.cls}>{st.label}</span></td>
                        <td><span className="status-chip status-not-started">{preferenceLabel(s.preference)}</span></td>
                        <td className="col-num tabular-nums">{fmtUsd(s.ledger.costUsd)}</td>
                        <td className="tabular-nums">{fmtDateTime(s.ledger.lastRunAt)}</td>
                        <td>
                          {expiry ? <span className={expiry.cls} title={expiry.title}>{expiry.label}</span> : <span className="text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">{fmtDateTime(s.expires_at)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            세션은 오래 사는 작업 대상이라 URL로 공유할 수 있습니다(벤치 A3-5) — 상세 화면은 /flows/dry-run/[sessionId].
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
