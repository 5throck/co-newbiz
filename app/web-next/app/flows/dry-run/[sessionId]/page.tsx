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
import { SectionToolbar } from "../../../../components/layout.tsx";
import { Button, ColGroup, FilterChip, PageState, PrimaryAction, useToast } from "../../../../components/ui.tsx";
import { ConfirmDialog, useConfirm } from "../../../../components/crud.tsx";
import { api, ApiError } from "../../../../lib/api.ts";
import { SuggestionPanel } from "../suggestion-panel.tsx";
import {
  DRY_RUN_DISCLOSURE,
  expiryChip,
  fmtDateTime,
  fmtInt,
  fmtSeconds,
  fmtUsd,
  gradeFromPreference,
  lineDiffSummary,
  preferenceLabel,
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

const ADMIN_FORBIDDEN_TEXT = "관리자 계정은 업무 콘텐츠에서 분리되어 이 화면을 볼 수 없습니다(ADR-0146). 이 상태는 오류가 아니라 설계된 접근 경계입니다.";

export function DryRunSessionView() {
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
        else setErrorText(err instanceof Error ? err.message : "세션을 불러오지 못했습니다");
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
      "드라이런 실행 — 비용 확인",
      () => void doExecute(),
      {
        tone: "neutral",
        confirmLabel: "실행",
        body: `${est.note}\n${DRY_RUN_DISCLOSURE}`,
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
      toast("드라이런 실행 완료 — 결과는 A/B 비교에 반영되었습니다.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "드라이런 실행에 실패했습니다", "alert");
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
      toast("변경 오버라이드로 새 세션을 만들었습니다 — 기존 세션은 그대로 남습니다.");
      router.replace(`/flows/dry-run/${r.data.session.id}`);
    } catch (err) {
      // 400 unknown_agent / 422 dynamic_prompt·empty_override_system — 서버 사유를 그대로 노출한다.
      setApplyError(err instanceof Error ? err.message : "오버라이드 적용에 실패했습니다");
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
      toast(`선호를 기록했습니다 — ${preferenceLabel(r.data.session.preference)}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "선호 기록에 실패했습니다", "alert");
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
      toast("제안 패키지를 내려받았습니다 — 착지 경로는 저장소 PR(Design Gate)뿐입니다.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "제안 패키지 내보내기에 실패했습니다", "alert");
    } finally {
      setBusyExport(false);
    }
  }

  if (forbidden) {
    return (
      <main>
        <BackLinks />
        <h1>드라이런 세션</h1>
        <PageState state="error" errorText={ADMIN_FORBIDDEN_TEXT} />
        {confirmDialog}
      </main>
    );
  }
  if (status === "loading") {
    return (
      <main>
        <BackLinks />
        <h1>드라이런 세션</h1>
        <PageState state="loading" rows={5} />
        {confirmDialog}
      </main>
    );
  }
  if (status === "error" || session === null) {
    return (
      <main>
        <BackLinks />
        <h1>드라이런 세션</h1>
        <PageState state="error" errorText={errorText ?? undefined} onRetry={() => setRetryTick((t) => t + 1)} />
        {confirmDialog}
      </main>
    );
  }

  const expiry = expiryChip(session.expires_at);
  const grade = gradeFromPreference(session.preference);
  const executeBlockedReason = !storedHasOverride
    ? "오버라이드가 없는 실행은 base와 동일합니다 — 프롬프트 또는 에이전트 축을 오버라이드한 뒤 적용·실행하세요."
    : !llmConfigured
      ? "LLM이 구성되지 않아 드라이런을 실행할 수 없습니다 — 시스템 모드에서 LLM 구성을 확인하세요."
      : undefined;

  return (
    <main>
      <BackLinks />
      <h1>드라이런 세션</h1>
      <p className="mt-[0.15rem] mb-3 text-[color:var(--muted-fg)] text-[length:var(--fs-body)]">
        SSOT을 건드리지 않는 세션 스코프 실험입니다 — 결과는 제안 전용이며, 영구 반영은 제안 패키지(저장소 PR) 경로뿐입니다.
      </p>

      {/* 세션 헤더 — id·상태·만료 칩 + 세션 비용·호출 누계 바(벤치 B3-3/A5-5) + PrimaryAction. */}
      <section aria-label="세션 요약" className="market-section">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div style={{ minWidth: "18rem" }}>
            <div className="flex flex-wrap items-center gap-1">
              <code className="dd-item-id">{session.id}</code>
              <span className={sessionStatusChip(session.status).cls}>{sessionStatusChip(session.status).label}</span>
              {expiry && <span className={expiry.cls} title={expiry.title}>{expiry.label}</span>}
            </div>
            <p className="mt-1 mb-0 text-[length:var(--fs-caption)]">
              대상: {session.activity_id ? <><code className="dd-item-id">{session.activity_id}</code> · </> : null}
              프롬프트 <code className="dd-item-id">{session.prompt_key}</code> · base{" "}
              <code className="dd-item-id">{session.base_agent_key}</code> → override{" "}
              {session.override_agent_key ? <code className="dd-item-id">{session.override_agent_key}</code> : "(미변경)"}
            </p>
            <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              목적: {session.purpose} · 생성 {fmtDateTime(session.created_at)} by {session.created_by} · TTL 만료 {fmtDateTime(session.expires_at)}
            </p>
          </div>
          <div className="text-right" style={{ minWidth: "14rem" }}>
            <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">세션 비용 누계</div>
            <div className="text-xl font-bold tabular-nums">{fmtUsd(session.ledger.costUsd)}</div>
            <div className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {fmtInt(session.ledger.llmCalls)} llm 호출 · {fmtInt(session.ledger.runs)} runs
              {session.ledger.lastRunAt ? ` · 최근 실행 ${fmtDateTime(session.ledger.lastRunAt)}` : ""}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PrimaryAction
            inline
            label={busyExecute ? "실행 중..." : "드라이런 실행 — 비용 확인"}
            onClick={askExecute}
            disabled={busyExecute || !storedHasOverride || !llmConfigured}
            disabledReason={executeBlockedReason}
          />
          <label className="text-[length:var(--fs-caption)]" style={{ flex: "1 1 14rem" }}>
            <span className="block mb-0.5">샘플 입력 (선택 — 미입력 시 활동 목적 문장 사용)</span>
            <input className="sizing-new-input sizing-new-input-sm w-full" value={sampleUser} maxLength={500} onChange={(e) => setSampleUser(e.target.value)} />
          </label>
        </div>
        <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
          <span className="status-chip status-amber">제안 전용</span> 이 세션의 모든 산출물과 수용은 세션 스코프에만 존재합니다 — SSOT(prompts.json·flow.spec.yaml)에는 반영되지 않으며, 드라이런 호출은 런 장부에 is_dry_run 플래그로 기록되어 운영 집계에서 제외됩니다.
        </p>
      </section>

      {/* 오버라이드 편집기(좌열) + A/B 비교(우열) — flex-wrap으로 48rem 미만 세로 스택(§11). */}
      <div className="flex flex-wrap items-start gap-3">
        <section aria-label="오버라이드 편집기" className="market-section" style={{ flex: "1 1 22rem" }}>
          <SectionToolbar title="오버라이드 편집기" summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">저장 = 세션 스코프만</span>} />
          <label className="text-[length:var(--fs-caption)] block mb-2">
            <span className="block mb-1">프롬프트 본문 (오버라이드)</span>
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
              <span className="status-chip status-in-progress">diff +{fmtInt(diff.added)} / −{fmtInt(diff.removed)} 줄</span>
            ) : (
              <span className="status-chip status-not-started">원본과 동일</span>
            )}{" "}
            base(카탈로그 원본) 대비 줄 수 기준 요약입니다.
          </p>
          <details className="mb-2">
            <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">base 시스템 프롬프트 참조 (카탈로그 원본)</summary>
            <pre className="mt-1 text-[length:var(--fs-caption)]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "14rem", overflowY: "auto" }}>{session.base_system}</pre>
          </details>
          <label className="text-[length:var(--fs-caption)] block mb-2">
            <span className="block mb-1">에이전트 재배정 (로스터 한정 — 존재하지 않는 키는 저장 불가, §6.6 (1))</span>
            <select className="sizing-new-input w-full" value={overrideAgentKey} onChange={(e) => setOverrideAgentKey(e.target.value)} disabled={roster.length === 0}>
              <option value="">미변경 ({session.base_agent_key})</option>
              {roster.map((a) => (
                <option key={a.key} value={a.key}>{a.key} — {a.name}</option>
              ))}
            </select>
          </label>
          {roster.length === 0 && (
            <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">에이전트 로스터를 불러오지 못했습니다 — 재배정은 로스터 로딩 후 가능합니다(프롬프트 축 편집은 가능).</p>
          )}
          {applyError && <p role="alert" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">✕ {applyError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!dirty || busyApply} onClick={() => void applyOverrideAsNewSession()}>
              {busyApply ? "적용 중..." : "오버라이드 적용(새 세션)"}
            </Button>
            <Button size="sm" disabled={!dirty || busyApply} onClick={() => { setOverrideSystem(session.override_system ?? ""); setOverrideAgentKey(session.override_agent_key ?? ""); }}>
              편집 되돌리기
            </Button>
          </div>
          {dirty && (
            <p role="status" className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              변경사항은 이 세션에 저장되지 않습니다 — 적용하면 변경된 오버라이드를 가진 새 세션이 만들어집니다(기존 세션은 증거로 남습니다).
            </p>
          )}
        </section>

        <section aria-label="A/B 비교" className="market-section" style={{ flex: "2 1 30rem" }}>
          <SectionToolbar
            title="A/B 비교"
            filters={<span className={grade.cls}>등급: {grade.label}</span>}
            summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">base 고정(카탈로그 원본) — 벤치 A1-6 변형</span>}
          />
          {!executed ? (
            <PageState state="empty" emptyText="아직 실행하지 않았습니다 — 상단의 드라이런 실행(비용 확인)을 먼저 수행하세요." />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <LegCard
                  title="base (카탈로그 원본 — 고정)"
                  text={session.base_output ?? ""}
                  source={session.base_output_source}
                  meta={session.base_run_call_id ? callMeta.get(session.base_run_call_id) : undefined}
                  callId={session.base_run_call_id}
                />
                <LegCard
                  title="override (이 세션)"
                  text={session.override_output ?? ""}
                  source={session.override_output_source}
                  meta={session.override_run_call_id ? callMeta.get(session.override_run_call_id) : undefined}
                  callId={session.override_run_call_id}
                  overrideNote={session.override_agent_key ? `에이전트 재배정: ${session.override_agent_key}` : undefined}
                />
              </div>

              {/* 선호 기록(벤치 A3-3 변형) — 3상(base|override|tie) + 비고 1줄, 골든셋
                  시드(§6.6 (3)). 한 번의 POST로 preference+note를 함께 기록한다. */}
              <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="선호 기록 (base/override/tie 3상 + 비고)">
                <span className="text-[length:var(--fs-caption)] font-semibold">선호 기록:</span>
                <FilterChip selected={prefChoice === "base"} onClick={() => setPrefChoice("base")}>base 선호</FilterChip>
                <FilterChip selected={prefChoice === "override"} onClick={() => setPrefChoice("override")}>override 선호</FilterChip>
                <FilterChip selected={prefChoice === "tie"} onClick={() => setPrefChoice("tie")}>동률</FilterChip>
                <input
                  className="sizing-new-input sizing-new-input-sm"
                  style={{ flex: "1 1 12rem" }}
                  maxLength={500}
                  placeholder="비고 (한 줄, 500자 이내 — 선택)"
                  aria-label="선호 비고"
                  value={prefNote}
                  onChange={(e) => setPrefNote(e.target.value)}
                />
                <Button size="sm" disabled={!executed || !prefChoice || busyPref} onClick={() => void recordPreference(prefChoice as DryRunPreference, prefNote)}>
                  {busyPref ? "기록 중..." : "선호 기록"}
                </Button>
              </div>
              {!executed && (
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  실행 전에는 선호를 기록할 수 없습니다 — 판정 대상이 없는 선호는 데이터가 아니라 소음입니다(§6.6 (3)).
                </p>
              )}
              {session.preference && (
                <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  기록됨: {preferenceLabel(session.preference)}{session.preference_note ? ` — ${session.preference_note}` : ""}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busyExport || !executed} onClick={() => void exportPackage()}>
                  {busyExport ? "내보내는 중..." : "제안 패키지 내보내기"}
                </Button>
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                  패키지는 제안 전용 markdown입니다 — 착지 경로는 Design Gate를 통과한 저장소 PR뿐입니다.
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
          toast("제안 초안을 오버라이드 편집기에 적용했습니다 — 세션에 저장하려면 '오버라이드 적용'을 누르세요.");
        }}
        onApplyAgent={(key) => {
          setOverrideAgentKey(key);
          toast(`재배정 후보 ${key}를 편집기 select에 적용했습니다 — 세션에 저장하려면 '오버라이드 적용'을 누르세요.`);
        }}
      />

      {/* 실행 기록 — dry_run_group_id 그룹핑(벤치 B1-2 변형). 재실행은 기존 결과를
          덮지 않고 새 런 장부 행으로 적재된다(벤치 A3-3u 변형). */}
      <section aria-label="실행 기록" className="market-section">
        <SectionToolbar
          title="실행 기록"
          count={runHistory.length}
          summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">dry_run_group_id = 세션 id · is_dry_run=1 (런 장부)</span>}
        />
        {runHistory.length === 0 ? (
          <PageState state="empty" emptyText="이 세션의 드라이런 호출 기록이 없습니다." />
        ) : (
          <div className="table-scroll" role="region" aria-label="데이터 표 (가로 스크롤)" tabIndex={0}>
            <table className="data-table table-fixed-pct tmin-40" aria-label="이 세션의 드라이런 런 장부 기록">
              <caption className="sr-only">세션 {session.id}의 드라이런 호출 기록 — 다리·모델·상태·지연·비용</caption>
              <ColGroup widths={RUN_HISTORY_COL_PCT} />
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">다리</th>
                  <th scope="col">모델</th>
                  <th scope="col">상태</th>
                  <th scope="col" className="col-num">지연</th>
                  <th scope="col" className="col-num">비용</th>
                </tr>
              </thead>
              <tbody>
                {runHistory.map((row) => {
                  const leg = row.id === session.base_run_call_id ? "base" : row.id === session.override_run_call_id ? "override" : "—";
                  const okChip = row.ok === 1
                    ? { label: "✓ 성공", cls: "status-chip status-approved" }
                    : { label: "✕ 실패", cls: "status-chip status-rejected" };
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
          이 표는 런 장부(llm_call_log)의 is_dry_run=1 행 중 dry_run_group_id가 이 세션인 것만 나열합니다 — 최근 30일 창 기준.
        </p>
      </section>

      {confirmDialog}
    </main>
  );
}

/** 화면 상단 복귀 링크 — NON_MENU 라우트라 사이드바가 없다(§2.3). */
function BackLinks() {
  return (
    <p className="mb-1 text-[length:var(--fs-caption)]">
      <Link href="/flows" className="text-[color:var(--accent)] underline">← 플로우 콘솔</Link>
      {" · "}
      <Link href="/flows?tab=blueprint" className="text-[color:var(--accent)] underline">블루프린트</Link>
      {" · "}
      <Link href="/flows/dry-run" className="text-[color:var(--accent)] underline">세션 목록</Link>
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
  const chip = sourceChip(source);
  return (
    <div className="sizing-grade-card" style={{ flex: "1 1 18rem" }}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-semibold text-[length:var(--fs-caption)]">{title}</span>
        <span className={chip.cls}>{chip.label}</span>
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
