"use client";

// 드라이런 세션 작업 화면 (화면 설계 2026-10-24 §6 + 2026-10-26 드라이런 UX 개편 §3).
// 구성: 고정 요약 줄(상태·비용·상태별 단일 주 동작·더보기) → 제안 전용 배너(1회) →
// 접힘 세션 정보 → 4개 탭(편집 | 실행·비교 | AI 제안 | 기록, URL 해시 동기화).
// 실행은 반드시 비용 확인 대화상자(ADR-0082)를 통과한다. 모든 변경은 세션 스코프뿐 —
// SSOT(prompts.json·flow.spec.yaml) 쓰기 경로는 없다. API 호출·핸들러는 개편 전과 동일하다.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionToolbar } from "../../../../components/layout.tsx";
import { Button, ColGroup, FilterChip, PageState, PrimaryAction, useToast } from "../../../../components/ui.tsx";
import { ConfirmDialog, useConfirm } from "../../../../components/crud.tsx";
import { api, ApiError } from "../../../../lib/api.ts";
import { ListBackButton } from "../../../../components/ListBackButton.tsx";
import { SuggestionPanel } from "../suggestion-panel.tsx";
import { AgentCombobox } from "../agent-combobox.tsx";
import { DRY_RUN_TABS, defaultTab, planActions, tabForAction, tabFromHash, type DryRunAction, type DryRunTab } from "../dry-run-ui-lib.ts";
import {
  DRY_RUN_DISCLOSURE_KEY,
  expiryChip,
  fmtDateTime,
  fmtInt,
  fmtSeconds,
  fmtUsd,
  gradeFromPreference,
  lineDiffSummary,
  preferenceLabelKey,
  sessionStatusChip,
  sourceChip,
  totalTokens,
  type BlueprintAgent,
  type DryRunExecutePayload,
  type DryRunPreference,
  type DryRunSessionDetail,
  type FlowsBlueprint,
  type LlmCallRow,
  estimateFromLedger,
} from "../../flows-view-lib.ts";

// 실행 기록 소형 표 열 비율 — 시각 | 다리 | 모델 | 토큰 | 상태 | 지연 | 비용.
const RUN_HISTORY_COL_PCT = [15, 10, 19, 13, 11, 12, 20] as const;

const ADMIN_FORBIDDEN_KEY = "adminForbidden";

export function DryRunSessionView() {
  const t = useTranslations("pages.flows.dryRunSession");
  const tc = useTranslations("common");
  const tr = useTranslations();
  /** 선호 라벨 — flows-view-lib가 방출한 catalog 키를 풀어 쓴다(미기록 "—" 폴백). */
  const prefLabel = (p: DryRunPreference | null | undefined): string => {
    const k = preferenceLabelKey(p);
    return k ? tr(k) : "—";
  };
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [session, setSession] = useState<DryRunSessionDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [forbidden, setForbidden] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // 블루프린트: 에이전트 로스터(재배정 select)와 llmConfigured(실행 게이트) 소비.
  // 실패는 침묵 — 로스터 select만 비워지고 실행 게이트는 알 수 없음(차단 안 함).
  const [blueprint, setBlueprint] = useState<FlowsBlueprint | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<FlowsBlueprint>("/api/flows").then((r) => alive && setBlueprint(r.data)).catch(() => alive && setBlueprint(null));
    return () => { alive = false; };
  }, []);

  // 실행 기록 — dry_run_group_id(=세션 id)로 그룹핑된 런 장부 행(벤치 B1-2 변형).
  // includeDryRun=1 이어야 is_dry_run 행이 돌아온다(§5.1 기본 제외 규칙).
  const [runHistory, setRunHistory] = useState<LlmCallRow[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .get<{ llmCalls: LlmCallRow[] }>("/api/flows/runs?window=30d&limit=200&includeDryRun=1")
      .then((r) => alive && setRunHistory((r.data.llmCalls ?? []).filter((row) => row.dry_run_group_id === sessionId)))
      .catch(() => alive && setRunHistory([]));
    return () => { alive = false; };
  }, [sessionId, retryTick]);

  // 오버라이드 편집기 폼 — 세션 스코프 로컬 상태. Row 5 API에는 세션 PATCH가 없어
  // (구현 편차 #B) 변경 오버라이드는 "적용" 시 새 세션 생성(POST /sessions)으로
  // 착지한다 — 실행은 항상 저장된 세션 오버라이드만 수행한다(§6.6 계약 유지).
  const [overrideSystem, setOverrideSystem] = useState("");
  const [overrideAgentKey, setOverrideAgentKey] = useState("");
  const [sampleUser, setSampleUser] = useState("");
  const [busyApply, setBusyApply] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [busyExecute, setBusyExecute] = useState(false);
  const [busyExport, setBusyExport] = useState(false);
  // 선호 기록 폼 — 3상 + 비고 1줄(§13-5). 세션 로드 시 기록값으로 초기화된다.
  const [prefChoice, setPrefChoice] = useState<DryRunPreference | "">("");
  const [prefNote, setPrefNote] = useState("");
  const [busyPref, setBusyPref] = useState(false);

  // 탭 상태 — URL 해시(#edit|#run|#suggest|#history)와 동기화한다. null = 해시 없음(기본 탭 유도).
  const [tab, setTab] = useState<DryRunTab | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const panelFocusPending = useRef(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const tabBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    const read = () => setTab(tabFromHash(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setForbidden(false);
    setErrorText(null);
    setApplyError(null);
    api
      .get<DryRunSessionDetail>(`/api/flows/dry-run/sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => {
        if (!alive) return;
        setSession(r.data);
        setOverrideSystem(r.data.override_system ?? "");
        setOverrideAgentKey(r.data.override_agent_key ?? "");
        setPrefChoice(r.data.preference ?? "");
        setPrefNote(r.data.preference_note ?? "");
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        else setErrorText(err instanceof Error ? err.message : t("loadFailed"));
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [sessionId, retryTick]);

  const roster: BlueprintAgent[] = blueprint?.agents ?? [];
  const llmConfigured = blueprint ? blueprint.llmConfigured : true;

  const executed = session !== null && session.base_output !== null;
  const storedHasOverride = session !== null && (!!session.override_system || !!session.override_agent_key);
  const dirty = session !== null && (overrideSystem !== (session.override_system ?? "") || overrideAgentKey !== (session.override_agent_key ?? ""));

  // A/B 다리의 provider·비용은 런 장부(call id 조인)에서 유도 — 세션 행은 누계만 갖는다.
  const callMeta = useMemo(() => {
    const m = new Map<string, { provider: string | null; model: string | null; costUsd: number | null }>();
    for (const row of runHistory) m.set(row.id, { provider: row.provider, model: row.model, costUsd: row.cost_usd });
    return m;
  }, [runHistory]);

  const diff = useMemo(
    () => (session ? lineDiffSummary(session.base_system, overrideSystem.trim() || session.base_system) : { added: 0, removed: 0 }),
    [session, overrideSystem],
  );

  function askExecute() {
    if (!session) return;
    const est = estimateFromLedger(session.ledger);
    confirm(
      t("executeConfirmTitle"),
      () => void doExecute(),
      {
        tone: "neutral",
        confirmLabel: t("executeConfirmAction"),
        body: `${tr(est.noteKey, est.noteParams)}\n${tr(DRY_RUN_DISCLOSURE_KEY)}`,
      },
    );
  }

  async function doExecute() {
    if (!session || busyExecute) return;
    setBusyExecute(true);
    try {
      const r = await api.post<DryRunExecutePayload>(
        `/api/flows/dry-run/sessions/${encodeURIComponent(session.id)}/execute`,
        sampleUser.trim() ? { user: sampleUser.trim() } : {},
      );
      setSession(r.data.session);
      toast(t("executeDoneToast"));
    } catch (err) {
      toast(err instanceof Error ? err.message : t("executeFailedToast"), "alert");
    } finally {
      setBusyExecute(false);
    }
  }

  async function applyOverrideAsNewSession() {
    if (!session || busyApply) return;
    const body: { promptKey: string; overrideSystem?: string; overrideAgentKey?: string } = { promptKey: session.prompt_key };
    if (overrideSystem.trim()) body.overrideSystem = overrideSystem.trim();
    if (overrideAgentKey) body.overrideAgentKey = overrideAgentKey;
    setBusyApply(true);
    setApplyError(null);
    try {
      const r = await api.post<{ session: { id: string } }>("/api/flows/dry-run/sessions", body);
      toast(t("applyDoneToast"));
      router.replace(`/flows/dry-run/${r.data.session.id}`);
    } catch (err) {
      // 400 unknown_agent / 422 dynamic_prompt·empty_override_system — 서버 사유를 그대로 노출한다.
      setApplyError(err instanceof Error ? err.message : t("applyFailedToast"));
    } finally {
      setBusyApply(false);
    }
  }

  async function recordPreference(preference: DryRunPreference, note: string) {
    if (!session || busyPref) return;
    setBusyPref(true);
    try {
      const r = await api.post<{ session: DryRunSessionDetail }>(
        `/api/flows/dry-run/sessions/${encodeURIComponent(session.id)}/preference`,
        { preference, note: note.trim() || undefined },
      );
      setSession(r.data.session);
      setPrefChoice(r.data.session.preference ?? "");
      setPrefNote(r.data.session.preference_note ?? "");
      toast(t("prefRecordedToast", { p1: prefLabel(r.data.session.preference) }));
    } catch (err) {
      toast(err instanceof Error ? err.message : t("prefFailedToast"), "alert");
    } finally {
      setBusyPref(false);
    }
  }

  async function exportPackage() {
    if (!session || busyExport) return;
    setBusyExport(true);
    try {
      const r = await api.post<{ filename: string; contentType: string; markdown: string }>(
        `/api/flows/dry-run/sessions/${encodeURIComponent(session.id)}/export`,
      );
      // 다운로드 와이어링 — Blob + a[download] (제안 패키지 markdown 파일).
      const blob = new Blob([r.data.markdown], { type: r.data.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(t("exportDoneToast"));
    } catch (err) {
      toast(err instanceof Error ? err.message : t("exportFailedToast"), "alert");
    } finally {
      setBusyExport(false);
    }
  }

  function copySessionId() {
    if (!session) return;
    void navigator.clipboard.writeText(session.id);
    toast(t("sessionIdCopiedToast"));
  }

  const hasRuns = executed;
  const activeTab: DryRunTab = tab ?? defaultTab(hasRuns);
  const plan = planActions(hasRuns, dirty);

  const selectTab = useCallback((k: DryRunTab, moveFocusToPanel = true) => {
    panelFocusPending.current = moveFocusToPanel;
    setTab(k);
    if (window.location.hash !== `#${k}`) window.location.hash = k;
  }, []);

  // 탭 전환 후 패널 제목으로 포커스를 옮긴다(키보드·스크린리더 사용자가 새 내용을 바로 읽는다).
  useEffect(() => {
    if (!panelFocusPending.current) return;
    panelFocusPending.current = false;
    const h = document.querySelector<HTMLElement>(`#dry-run-panel-${activeTab} h2`);
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: false }); }
  }, [activeTab]);

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % DRY_RUN_TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + DRY_RUN_TABS.length) % DRY_RUN_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = DRY_RUN_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const k = DRY_RUN_TABS[next];
    selectTab(k, false);
    tabBtnRefs.current[k]?.focus();
  }

  // 더보기 메뉴 — 바깥 클릭/Esc로 닫고 Esc는 트리거로 포커스를 돌려준다(StageTabs 더보기 규약).
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!moreMenuRef.current?.contains(n) && !moreBtnRef.current?.contains(n)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [moreOpen]);

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(moreMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); setMoreOpen(false); moreBtnRef.current?.focus(); }
    else if (e.key === "Tab") setMoreOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
  }

  if (forbidden) {
    return (
      <main>
        <BackLinks />
        <h1>{t("h1")}</h1>
        <PageState state="error" errorText={t(ADMIN_FORBIDDEN_KEY)} />
        {confirmDialog}
      </main>
    );
  }
  if (status === "loading") {
    return (
      <main>
        <BackLinks />
        <h1>{t("h1")}</h1>
        <PageState state="loading" rows={5} />
        {confirmDialog}
      </main>
    );
  }
  if (status === "error" || session === null) {
    return (
      <main>
        <BackLinks />
        <h1>{t("h1")}</h1>
        <PageState state="error" errorText={errorText ?? undefined} onRetry={() => setRetryTick((t) => t + 1)} />
        {confirmDialog}
      </main>
    );
  }

  const expiry = expiryChip(session.expires_at);
  const grade = gradeFromPreference(session.preference);
  const statusChip = sessionStatusChip(session.status);
  const estimate = estimateFromLedger(session.ledger);
  const executeBlockedReason = !storedHasOverride
    ? t("blockedNoOverride")
    : !llmConfigured
      ? t("blockedNoLlm")
      : undefined;

  // 상태별 동작 메타 — 핸들러는 개편 전과 동일하다. 다른 탭에 사는 동작은 그 탭으로 이동한 뒤 실행한다.
  const actionMeta: Record<DryRunAction, { label: string; disabled: boolean; reason?: string; run: () => void }> = {
    run: {
      label: busyExecute ? t("executing") : hasRuns ? t("runAgain") : t("executeCta"),
      disabled: busyExecute || !storedHasOverride || !llmConfigured,
      reason: executeBlockedReason,
      run: askExecute,
    },
    apply: {
      label: busyApply ? t("applying") : t("applyCta"),
      disabled: !dirty || busyApply,
      reason: !dirty ? t("applyNeedsEdit") : undefined,
      run: () => void applyOverrideAsNewSession(),
    },
    export: {
      label: busyExport ? t("exporting") : t("exportCta"),
      disabled: busyExport || !executed,
      reason: !executed ? t("exportNeedsRun") : undefined,
      run: () => void exportPackage(),
    },
  };
  function runAction(a: DryRunAction) {
    selectTab(tabForAction(a), false);
    actionMeta[a].run();
  }
  const primaryMeta = actionMeta[plan.primary];
  const statusIcon = session.status === "closed" ? "✓" : session.status === "active" ? "✎" : "⌛";

  const tabLabels: Record<DryRunTab, string> = {
    edit: t("tabEdit"),
    run: t("tabRun"),
    suggest: t("tabSuggest"),
    history: t("tabHistory"),
  };

  return (
    <main className="dry-run-detail">
      {/* 고정 요약 줄 — 상태 배지(아이콘+텍스트), 비용, 상태별 단일 주 동작, 더보기. 좁은 폭에서는 줄바꿈. */}
      <div className="dry-run-summary-bar">
        <ListBackButton href="/flows/dry-run" label={t("sessionListLink")} />
        <h1>{session.purpose || t("h1")}</h1>
        <span className="dry-run-summary-meta">
          <span className={statusChip.cls}>
            <span aria-hidden="true">{statusIcon} </span>
            {statusChip.key ? tr(statusChip.key) : statusChip.label}
          </span>
          {expiry && <span className={expiry.cls} title={tr(expiry.titleKey, expiry.titleParams)}>{tr(expiry.key)}</span>}
          <Link href="/flows?tab=blueprint" className="text-[color:var(--accent)] underline text-[length:var(--fs-body)]">{t("blueprintLink")}</Link>
          <span className="text-[length:var(--fs-body)]">
            {t("costTotal")}: <strong className="tabular-nums">{fmtUsd(session.ledger.costUsd)}</strong>
          </span>
        </span>
        <span className="dry-run-summary-actions">
          <PrimaryAction
            inline
            label={primaryMeta.label}
            onClick={() => runAction(plan.primary)}
            disabled={primaryMeta.disabled}
            disabledReason={primaryMeta.reason}
          />
          <span className="stage-tab-more" role="presentation">
            <button
              ref={moreBtnRef}
              type="button"
              className="btn-ghost"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label={t("moreMenuAria")}
              onClick={() => setMoreOpen((v) => !v)}
            >
              {t("moreMenu")} <span aria-hidden="true">▾</span>
            </button>
            {moreOpen && (
              <div ref={moreMenuRef} role="menu" aria-label={t("moreMenuAria")} className="stage-tab-menu" onKeyDown={onMenuKeyDown}>
                {plan.secondary.map((a, idx) => {
                  const m = actionMeta[a];
                  return (
                    <button
                      key={a}
                      type="button"
                      role="menuitem"
                      className="stage-tab-menu-item row-menu-item"
                      aria-disabled={m.disabled || undefined}
                      autoFocus={idx === 0}
                      onClick={() => {
                        if (m.disabled) return;
                        setMoreOpen(false);
                        runAction(a);
                      }}
                    >
                      {m.label}
                      {m.disabled && m.reason ? <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{m.reason}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </span>
        </span>
      </div>

      {/* 제안 전용 배너 — 이 화면에서 단 한 번(설계 §4). */}
      <p role="note" className="dry-run-banner">{t("proposalOnlyBanner")}</p>

      {/* 세션 정보 — 기본 접힘. 긴 ID는 잘라 보이고 복사 버튼을 둔다. */}
      <details className="dry-run-info market-section">
        <summary>{t("sessionInfoSummary")}</summary>
        <dl className="m-0 mt-2 grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: "max-content minmax(0, 1fr)" }}>
          <MetaRow label={t("colSessionId")}>
            <span className="inline-flex flex-wrap items-center gap-1">
              <code className="dd-item-id cell-truncate" style={{ display: "inline-block", maxWidth: "16rem", verticalAlign: "bottom" }} title={session.id}>
                {session.id}
              </code>
              <button type="button" className="btn-ghost btn-sm" aria-label={t("copySessionIdAria")} onClick={copySessionId}>
                {tc("copy")}
              </button>
            </span>
          </MetaRow>
          <MetaRow label={t("labelPurpose")}>{session.purpose}</MetaRow>
          <MetaRow label={t("labelActivity")}>
            {session.activity_id ? <code className="dd-item-id">{session.activity_id}</code> : <span className="text-[color:var(--muted-fg)]">—</span>}
          </MetaRow>
          <MetaRow label={t("promptWord")}>
            <code className="dd-item-id">{session.prompt_key}</code>
          </MetaRow>
          <MetaRow label={t("labelBaseAgent")}>
            <code className="dd-item-id">{session.base_agent_key}</code>
          </MetaRow>
          <MetaRow label={t("labelOverrideAgent")}>
            {session.override_agent_key ? <code className="dd-item-id">{session.override_agent_key}</code> : <span className="text-[color:var(--muted-fg)]">{t("unchanged")}</span>}
          </MetaRow>
          <MetaRow label={t("labelCreated")}>
            <span className="tabular-nums">{t("createdValue", { p1: fmtDateTime(session.created_at), p2: session.created_by })}</span>
          </MetaRow>
          <MetaRow label={t("labelExpiry")}>
            <span className="tabular-nums">{fmtDateTime(session.expires_at)}</span>
          </MetaRow>
          <MetaRow label={t("costTotal")}>
            <span className="tabular-nums">
              {fmtUsd(session.ledger.costUsd)} · {t("ledgerLine", { p1: session.ledger.llmCalls, p2: session.ledger.runs })}
              {session.ledger.lastRunAt ? " " + t("lastRunSuffix", { p1: fmtDateTime(session.ledger.lastRunAt) }) : ""}
            </span>
          </MetaRow>
        </dl>
      </details>

      <div role="tablist" aria-label={t("tabsAria")} className="dry-run-tabs">
        {DRY_RUN_TABS.map((k, i) => (
          <button
            key={k}
            ref={(el) => { tabBtnRefs.current[k] = el; }}
            id={`dry-run-tab-${k}`}
            type="button"
            role="tab"
            className="dry-run-tab"
            aria-selected={activeTab === k}
            aria-controls={`dry-run-panel-${k}`}
            tabIndex={activeTab === k ? 0 : -1}
            onClick={() => selectTab(k)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
          >
            {tabLabels[k]}
          </button>
        ))}
      </div>

      {/* 1) 편집 — 오버라이드 편집기 + 에이전트 선택기 */}
      <div role="tabpanel" id="dry-run-panel-edit" aria-labelledby="dry-run-tab-edit" className="dry-run-panel" hidden={activeTab !== "edit"}>
        <section aria-label={t("overrideSection")} className="market-section" style={{ minWidth: 0 }}>
          <SectionToolbar
            title={t("overrideTitle")}
            filters={
              dirty ? (
                <span className="status-chip status-amber">{t("dirtyChip")}</span>
              ) : undefined
            }
            summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("overrideScopeNote")}</span>}
          />
          <label className="text-[length:var(--fs-caption)] block mb-1">
            <span className="block mb-1">{t("promptBodyLabel")}</span>
            <textarea
              className="sizing-new-input w-full"
              rows={12}
              style={{ display: "block", lineHeight: 1.5, fontSize: "var(--fs-body)" }}
              value={overrideSystem}
              onChange={(e) => setOverrideSystem(e.target.value)}
              aria-describedby="dry-run-override-note"
            />
          </label>
          <p id="dry-run-override-note" className="mt-1 mb-1 flex flex-wrap items-center gap-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {diff.added + diff.removed > 0 ? (
              <>
                {diff.added > 0 && <span className="status-chip status-approved">{t("diffAdded", { p1: fmtInt(diff.added) })}</span>}
                {diff.removed > 0 && <span className="status-chip status-rejected">{t("diffRemoved", { p1: fmtInt(diff.removed) })}</span>}
              </>
            ) : (
              <span className="status-chip status-not-started">{t("diffSame")}</span>
            )}
            <span>{t("diffNote")}</span>
          </p>
          {/* base 참조 — 편집 대상(textarea)과 참조 원본을 시각적으로 분리: 테두리 박스. */}
          <details className="mb-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("basePromptRef")}</summary>
            <pre
              className="mt-1 mb-0 text-[length:var(--fs-body)]"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "14rem", overflowY: "auto", border: "1px solid var(--border)", background: "var(--muted-bg)", borderRadius: "var(--radius-sm)", padding: "0.5rem 0.75rem" }}
            >
              {session.base_system}
            </pre>
          </details>
          <div className="text-[length:var(--fs-caption)] block mb-1">
            <span className="block mb-1">{t("reassignLabel")}</span>
            <AgentCombobox
              agents={roster}
              value={overrideAgentKey}
              onChange={setOverrideAgentKey}
              unchangedLabel={t("unchangedAgent", { p1: session.base_agent_key })}
              disabled={roster.length === 0}
            />
          </div>
          <p className="mt-1 mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("reassignContext")}
          </p>
          {roster.length === 0 && (
            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("rosterFailed")}</p>
          )}
          {applyError && <p role="alert" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">✕ {applyError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!dirty || busyApply} onClick={() => void applyOverrideAsNewSession()}>
              {busyApply ? t("applying") : t("applyCta")}
            </Button>
            <Button size="sm" disabled={!dirty || busyApply} onClick={() => { setOverrideSystem(session.override_system ?? ""); setOverrideAgentKey(session.override_agent_key ?? ""); }}>
              {t("revertEdits")}
            </Button>
          </div>
          {/* 적용 = 새 파생 세션 안내 — 적용 컨트롤 바로 아래 warning 콜아웃(경고 토큰만 사용). */}
          <div
            role="note"
            className="mt-2 mb-1 text-[length:var(--fs-caption)]"
            style={{ borderLeft: "var(--border-width-accent) solid var(--amber-border)", background: "var(--amber-bg)", borderRadius: "var(--radius-sm)", padding: "0.5rem 0.75rem" }}
          >
            <span className="font-semibold" style={{ color: "var(--amber-fg)" }}>⚠ {t("applyCalloutLabel")}</span>
            <p className="m-0 mt-0.5">{t("dirtyNote")}</p>
          </div>
        </section>
      </div>

      {/* 2) 실행·비교 — 비용 추정·샘플 입력, A/B 비교, 선호 기록, 내보내기 */}
      <div role="tabpanel" id="dry-run-panel-run" aria-labelledby="dry-run-tab-run" className="dry-run-panel" hidden={activeTab !== "run"}>
        <section aria-label={t("runCardTitle")} className="market-section">
          <SectionToolbar title={t("runCardTitle")} />
          <div className="flex flex-wrap items-end gap-2">
            <p className="m-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" style={{ flex: "1 1 12rem", minWidth: 0 }}>
              <span className="font-semibold">{t("costEstimateLabel")}:</span>{" "}
              <span className="tabular-nums">{tr(estimate.noteKey, estimate.noteParams)}</span>
            </p>
            <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 14rem" }}>
              <span className="block mb-0.5">{t("sampleInputLabel")}</span>
              <input className="sizing-new-input sizing-new-input-sm w-full" value={sampleUser} maxLength={500} onChange={(e) => setSampleUser(e.target.value)} />
            </label>
          </div>
          {executeBlockedReason && (
            <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{executeBlockedReason}</p>
          )}
        </section>

        <section aria-label={t("abSection")} className="market-section" style={{ minWidth: 0 }}>
          <SectionToolbar
            title={t("abTitle")}
            filters={<span className={grade.cls}>{t("gradeLabel", { p1: tr(grade.key) })}</span>}
            summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("abScopeNote")}</span>}
            actions={
              <Button size="sm" disabled={busyExport || !executed} onClick={() => void exportPackage()}>
                {busyExport ? t("exporting") : t("exportCta")}
              </Button>
            }
          />
          {!executed ? (
            <>
              {/* 실행 전 구조화된 빈 상태 — 두 다리 패널(제목+안내)로 미리 레이아웃을 보여 준다. */}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="sizing-grade-card">
                  <div className="text-[length:var(--fs-caption)] font-semibold">{t("legBaseTitle")}</div>
                  <p className="mt-1 mb-0 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("legBaseEmpty")}</p>
                </div>
                <div className="sizing-grade-card">
                  <div className="text-[length:var(--fs-caption)] font-semibold">{t("legOverrideTitle")}</div>
                  <p className="mt-1 mb-0 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("legOverrideEmpty")}</p>
                </div>
              </div>
              <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("notExecuted")}
              </p>
              <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                {t("prefBeforeExecute")}
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <LegCard
                  title={t("legBaseTitle")}
                  text={session.base_output ?? ""}
                  source={session.base_output_source}
                  meta={session.base_run_call_id ? callMeta.get(session.base_run_call_id) : undefined}
                  callId={session.base_run_call_id}
                />
                <LegCard
                  title={t("legOverrideTitle")}
                  text={session.override_output ?? ""}
                  source={session.override_output_source}
                  meta={session.override_run_call_id ? callMeta.get(session.override_run_call_id) : undefined}
                  callId={session.override_run_call_id}
                  overrideNote={session.override_agent_key ? t("reassignNote", { p1: session.override_agent_key }) : undefined}
                />
              </div>

              {/* 선호 기록 — 3상(base|override|tie) + 비고 1줄. 한 번의 POST로 preference+note를 함께 기록한다. */}
              <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("prefGroup")}>
                <span className="text-[length:var(--fs-caption)] font-semibold">{t("prefRecordLabel")}</span>
                <FilterChip selected={prefChoice === "base"} onClick={() => setPrefChoice("base")}>{t("prefBase")}</FilterChip>
                <FilterChip selected={prefChoice === "override"} onClick={() => setPrefChoice("override")}>{t("prefOverride")}</FilterChip>
                <FilterChip selected={prefChoice === "tie"} onClick={() => setPrefChoice("tie")}>{t("prefTie")}</FilterChip>
                <input
                  className="sizing-new-input sizing-new-input-sm"
                  style={{ flex: "1 1 12rem" }}
                  maxLength={500}
                  placeholder={t("prefNotePlaceholder")}
                  aria-label={t("prefNoteAria")}
                  value={prefNote}
                  onChange={(e) => setPrefNote(e.target.value)}
                />
                <Button size="sm" disabled={!executed || !prefChoice || busyPref} onClick={() => void recordPreference(prefChoice as DryRunPreference, prefNote)}>
                  {busyPref ? t("recording") : t("recordCta")}
                </Button>
              </div>
              {session.preference && (
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("prefRecordedLine", { p1: prefLabel(session.preference), p2: session.preference_note ? ` — ${session.preference_note}` : "" })}
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {/* 3) AI 제안 — 수용은 이 세션 오버라이드 폼에만 적용된다. */}
      <div role="tabpanel" id="dry-run-panel-suggest" aria-labelledby="dry-run-tab-suggest" className="dry-run-panel" hidden={activeTab !== "suggest"}>
        <SuggestionPanel
          promptKey={session.prompt_key}
          onApplyOverride={(improved) => {
            setOverrideSystem(improved);
            toast(t("suggestionAppliedToast"));
          }}
          onApplyAgent={(key) => {
            setOverrideAgentKey(key);
            toast(t("agentAppliedToast", { p1: key }));
          }}
        />
      </div>

      {/* 4) 기록 — 재실행은 기존 결과를 덮지 않고 새 행으로 적재된다. 토큰 열(totalTokens 합계). */}
      <div role="tabpanel" id="dry-run-panel-history" aria-labelledby="dry-run-tab-history" className="dry-run-panel" hidden={activeTab !== "history"}>
        <section aria-label={t("historySection")} className="market-section">
          <SectionToolbar
            title={t("historyTitle")}
            count={runHistory.length}
            summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("historyScopeNote")}</span>}
          />
          {runHistory.length === 0 ? (
            <PageState state="empty" emptyText={t("emptyHistory")} />
          ) : (
            <div className="table-scroll" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
              <table className="data-table table-fixed-pct tmin-40" aria-label={t("historyTableAria")}>
                <caption className="sr-only">{t("historyTableCaption", { p1: session.id })}</caption>
                <ColGroup widths={RUN_HISTORY_COL_PCT} />
                <thead>
                  <tr>
                    <th scope="col">{t("colTime")}</th>
                    <th scope="col">{t("colLeg")}</th>
                    <th scope="col">{t("colModel")}</th>
                    <th scope="col" className="col-num">{t("colTokens")}</th>
                    <th scope="col">{tc("status")}</th>
                    <th scope="col" className="col-num">{t("colLatency")}</th>
                    <th scope="col" className="col-num">{t("colCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runHistory.map((row) => {
                    const leg = row.id === session.base_run_call_id ? "base" : row.id === session.override_run_call_id ? "override" : "—";
                    const okChip = row.ok === 1
                      ? { label: t("chipSuccess"), cls: "status-chip status-approved" }
                      : { label: t("chipFailed"), cls: "status-chip status-rejected" };
                    return (
                      <tr key={row.id}>
                        <td className="tabular-nums">{fmtDateTime(row.created_at)}</td>
                        <td><span className="status-chip status-not-started">{leg}</span></td>
                        <td className="text-[length:var(--fs-caption)]">{row.model ?? "—"}</td>
                        <td className="col-num tabular-nums">{fmtInt(totalTokens(row))}</td>
                        <td><span className={okChip.cls}>{okChip.label}</span></td>
                        <td className="col-num tabular-nums">{fmtSeconds(row.latency_ms)}</td>
                        <td className="col-num tabular-nums">{fmtUsd(row.cost_usd)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("historyNote")}
          </p>
        </section>
      </div>

      {confirmDialog}
    </main>
  );
}

/** 세션 헤더 메타 행 — 라벨(dt):값(dd) 정의 그리드 한 쌍. 값 칸은 min-width 0으로
    둬서 긴 id가 dd 안에서 잘려 보이게 한다(truncation은 값 쪽 클래스가 담당). */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[length:var(--fs-caption)] font-semibold text-[color:var(--muted-fg)] whitespace-nowrap">{label}</dt>
      <dd className="m-0 text-[length:var(--fs-body)]" style={{ minWidth: 0 }}>{children}</dd>
    </>
  );
}

/** 화면 상단 복귀 링크 — NON_MENU 라우트라 사이드바가 없다(§2.3). */
function BackLinks() {
  const t = useTranslations("pages.flows.dryRunSession");
  return (
    <p className="mb-1 text-[length:var(--fs-caption)]">
      <Link href="/flows" className="text-[color:var(--accent)] underline">{t("backToFlows")}</Link>
      {" · "}
      <Link href="/flows?tab=blueprint" className="text-[color:var(--accent)] underline">{t("blueprintLink")}</Link>
      {" · "}
      <Link href="/flows/dry-run" className="text-[color:var(--accent)] underline">{t("sessionListLink")}</Link>
    </p>
  );
}

/** A/B 한 다리의 출력 카드 — 출처 칩(AI/결정론, A5) + provider·비용 라인(벤치 A5-5). */
function LegCard({
  title,
  text,
  source,
  meta,
  callId,
  overrideNote,
}: {
  title: string;
  text: string;
  source: string | null;
  meta?: { provider: string | null; model: string | null; costUsd: number | null };
  callId: string | null;
  overrideNote?: string;
}) {
  const tr = useTranslations();
  const chip = sourceChip(source);
  return (
    <div className="sizing-grade-card" style={{ minWidth: 0 }}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-semibold text-[length:var(--fs-caption)]">{title}</span>
        <span className={chip.cls}>{tr(chip.key)}</span>
      </div>
      {overrideNote && <div className="mt-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{overrideNote}</div>}
      <div className="mt-1 mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums">
        {meta?.provider ?? "—"} · {meta?.model ?? "—"} · {fmtUsd(meta?.costUsd ?? null)}
        {callId ? <> · call <code className="dd-item-id">{callId.slice(0, 12)}</code></> : null}
      </div>
      <pre className="mb-0 text-[length:var(--fs-caption)]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "20rem", overflowY: "auto" }}>{text}</pre>
    </div>
  );
}

export default function DryRunSessionPage() {
  return (
    <Suspense fallback={null}>
      <DryRunSessionView />
    </Suspense>
  );
}
