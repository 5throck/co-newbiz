"use client";

// 드라이런 세션 작업 화면 (화면 설계 2026-10-24 §6, J3 "안전한 실험" — 벤치 A3-5
// URL 공유 채택: 세션은 오래 사는 작업 대상이므로 전용 라우트로 딥링크를 제공한다).
// 구성: 세션 헤더(비용·토큰 누계 바, 만료 칩, 제안 전용 경계 문구) → 오버라이드 편집기
// (프롬프트 본문 + 에이전트 재배정, 로스터 한정 — §6.6 (1)) → A/B 비교(벤치 A3-2
// diff+등급 필, A3-3 선호 기록) → AI 제안 패널(§7) → 실행 기록(dry_run_group_id 그룹핑,
// 벤치 B1-2 변형). 실행은 반드시 비용 확인 대화상자(ADR-0082)를 통과한다(§6.2).
// 모든 변경은 세션 스코프뿐 — SSOT(prompts.json·flow.spec.yaml) 쓰기 경로는 없다(§12-4).
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionToolbar } from "../../../../components/layout.tsx";
import { Button, ColGroup, FilterChip, PageState, PrimaryAction, useToast } from "../../../../components/ui.tsx";
import { ConfirmDialog, useConfirm } from "../../../../components/crud.tsx";
import { api, ApiError } from "../../../../lib/api.ts";
import { SuggestionPanel } from "../suggestion-panel.tsx";
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
  type BlueprintAgent,
  type DryRunExecutePayload,
  type DryRunPreference,
  type DryRunSessionDetail,
  type FlowsBlueprint,
  type LlmCallRow,
  estimateFromLedger,
} from "../../flows-view-lib.ts";

// 실행 기록 소형 표 열 비율 — 시각 | 다리 | 모델 | 상태 | 지연 | 비용.
const RUN_HISTORY_COL_PCT = [17, 11, 21, 12, 13, 26] as const;

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
  const executeBlockedReason = !storedHasOverride
    ? t("blockedNoOverride")
    : !llmConfigured
      ? t("blockedNoLlm")
      : undefined;

  return (
    <main>
      <BackLinks />
      <h1>{t("h1")}</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        {t("intro")}
      </p>

      {/* 세션 헤더 — id·상태·만료 칩 + 세션 비용·호출 누계 바(벤치 B3-3/A5-5) + PrimaryAction. */}
      <section aria-label={t("sessionSummarySection")} className="market-section">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: "18rem" }}>
            <div className="flex flex-wrap items-center gap-1">
              <code className="dd-item-id">{session.id}</code>
              <span className={statusChip.cls}>{statusChip.key ? tr(statusChip.key) : statusChip.label}</span>
              {expiry && <span className={expiry.cls} title={tr(expiry.titleKey, expiry.titleParams)}>{tr(expiry.key)}</span>}
            </div>
            <p className="mt-1 mb-0 text-[length:var(--fs-caption)]">
              {t("targetPrefix")} {session.activity_id ? <><code className="dd-item-id">{session.activity_id}</code> · </> : null}
              {t("promptWord")} <code className="dd-item-id">{session.prompt_key}</code> · base{" "}
              <code className="dd-item-id">{session.base_agent_key}</code> → override{" "}
              {session.override_agent_key ? <code className="dd-item-id">{session.override_agent_key}</code> : t("unchanged")}
            </p>
            <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("purposeLine", { p1: session.purpose, p2: fmtDateTime(session.created_at), p3: session.created_by, p4: fmtDateTime(session.expires_at) })}
            </p>
          </div>
          <div className="text-right" style={{ minWidth: "14rem" }}>
            <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("costTotal")}</div>
            <div className="text-xl font-bold tabular-nums">{fmtUsd(session.ledger.costUsd)}</div>
            <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("ledgerLine", { p1: fmtInt(session.ledger.llmCalls), p2: fmtInt(session.ledger.runs) })}
              {session.ledger.lastRunAt ? " " + t("lastRunSuffix", { p1: fmtDateTime(session.ledger.lastRunAt) }) : ""}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PrimaryAction
            inline
            label={busyExecute ? t("executing") : t("executeCta")}
            onClick={askExecute}
            disabled={busyExecute || !storedHasOverride || !llmConfigured}
            disabledReason={executeBlockedReason}
          />
          <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 14rem" }}>
            <span className="block mb-0.5">{t("sampleInputLabel")}</span>
            <input className="sizing-new-input sizing-new-input-sm w-full" value={sampleUser} maxLength={500} onChange={(e) => setSampleUser(e.target.value)} />
          </label>
        </div>
        <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          <span className="status-chip status-amber">{t("proposalOnlyChip")}</span> {t("boundaryNote")}
        </p>
      </section>

      {/* 오버라이드 편집기(좌열) + A/B 비교(우열) — flex-wrap으로 48rem 미만 세로 스택(§11). */}
      <div className="flex flex-wrap items-start gap-3">
        <section aria-label={t("overrideSection")} className="market-section" style={{ flex: "1 1 22rem" }}>
          <SectionToolbar title={t("overrideTitle")} summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("overrideScopeNote")}</span>} />
          <label className="text-[length:var(--fs-caption)] block mb-2">
            <span className="block mb-1">{t("promptBodyLabel")}</span>
            <textarea
              className="sizing-new-input w-full"
              rows={10}
              value={overrideSystem}
              onChange={(e) => setOverrideSystem(e.target.value)}
              aria-describedby="dry-run-override-note"
            />
          </label>
          <p id="dry-run-override-note" className="mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {diff.added + diff.removed > 0 ? (
              <span className="status-chip status-in-progress">{t("diffLines", { p1: fmtInt(diff.added), p2: fmtInt(diff.removed) })}</span>
            ) : (
              <span className="status-chip status-not-started">{t("diffSame")}</span>
            )}{" "}
            {t("diffNote")}
          </p>
          <details className="mb-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("basePromptRef")}</summary>
            <pre className="mt-1 text-[length:var(--fs-caption)]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "14rem", overflowY: "auto" }}>{session.base_system}</pre>
          </details>
          <label className="text-[length:var(--fs-caption)] block mb-2">
            <span className="block mb-1">{t("reassignLabel")}</span>
            <select className="sizing-new-input w-full" value={overrideAgentKey} onChange={(e) => setOverrideAgentKey(e.target.value)} disabled={roster.length === 0}>
              <option value="">{t("unchangedAgent", { p1: session.base_agent_key })}</option>
              {roster.map((a) => (
                <option key={a.key} value={a.key}>{a.key} — {a.name}</option>
              ))}
            </select>
          </label>
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
          {dirty && (
            <p role="status" className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {t("dirtyNote")}
            </p>
          )}
        </section>

        <section aria-label={t("abSection")} className="market-section" style={{ flex: "2 1 30rem" }}>
          <SectionToolbar
            title={t("abTitle")}
            filters={<span className={grade.cls}>{t("gradeLabel", { p1: tr(grade.key) })}</span>}
            summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("abScopeNote")}</span>}
          />
          {!executed ? (
            <PageState state="empty" emptyText={t("notExecuted")} />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
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

              {/* 선호 기록(벤치 A3-3 변형) — 3상(base|override|tie) + 비고 1줄, 골든셋
                  시드(§6.6 (3)). 한 번의 POST로 preference+note를 함께 기록한다. */}
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
              {!executed && (
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("prefBeforeExecute")}
                </p>
              )}
              {session.preference && (
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("prefRecordedLine", { p1: prefLabel(session.preference), p2: session.preference_note ? ` — ${session.preference_note}` : "" })}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busyExport || !executed} onClick={() => void exportPackage()}>
                  {busyExport ? t("exporting") : t("exportCta")}
                </Button>
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  {t("exportNote")}
                </span>
              </div>
            </>
          )}
        </section>
      </div>

      {/* AI 제안 패널(§7) — 수용은 이 세션 오버라이드 폼에만 적용된다. */}
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

      {/* 실행 기록 — dry_run_group_id 그룹핑(벤치 B1-2 변형). 재실행은 기존 결과를
          덮지 않고 새 런 장부 행으로 적재된다(벤치 A3-3u 변형). */}
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

      {confirmDialog}
    </main>
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
    <div className="sizing-grade-card" style={{ flex: "1 1 18rem" }}>
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
