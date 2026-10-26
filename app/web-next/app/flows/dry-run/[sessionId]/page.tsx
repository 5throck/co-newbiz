"use client";

// Single-page dry-run session (design 2026-10-26b delta D2): summary bar -> Edit -> Run -> Result
// (A previous / B new) -> preference line -> collapsed run history. No tabs. Edits live in a local
// buffer; a clean buffer runs this session, a dirty buffer creates a derived session (POST) and runs there,
// both behind the cost confirm (ADR-0082). Sessions are never edited in place and nothing writes the SSOT
// (prompts.json / flow.spec.yaml).
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SectionToolbar } from "../../../../components/layout.tsx";
import { Button, FilterChip, PageState, PrimaryAction, useToast } from "../../../../components/ui.tsx";
import { useConfirm } from "../../../../components/crud.tsx";
import { api, ApiError } from "../../../../lib/api.ts";
import { ListBackButton } from "../../../../components/ListBackButton.tsx";
import { CandidateChips, SuggestionResult, SuggestionTrigger, useSuggestion } from "../suggestion-panel.tsx";
import { AgentCombobox } from "../agent-combobox.tsx";
import { effectiveOverrideSystem, isDirty, primaryAction } from "../dry-run-ui-lib.ts";
import {
  DRY_RUN_DISCLOSURE_KEY,
  expiryChip,
  fmtDateTime,
  fmtInt,
  fmtUsd,
  gradeFromPreference,
  lineDiffSummary,
  preferenceLabelKey,
  sessionStatusChip,
  sourceChip,
  estimateFromLedger,
  type BlueprintAgent,
  type DryRunExecutePayload,
  type DryRunPreference,
  type DryRunRunSnapshot,
  type DryRunSessionDetail,
  type FlowsBlueprint,
} from "../../flows-view-lib.ts";

const ADMIN_FORBIDDEN_KEY = "adminForbidden";
const SHORT_HASH_LEN = 8;
const shortHash = (h: string | null): string => (h ? h.slice(0, SHORT_HASH_LEN) : "—");
/** Hand-off from the session that created a derived session: run once on arrival (cost already confirmed). */
const AUTORUN_KEY = (id: string) => `dry-run-autorun:${id}`;

export function DryRunSessionView() {
  const t = useTranslations("pages.flows.dryRunSession");
  const tc = useTranslations("common");
  const tr = useTranslations();
  /** Preference label — resolves the catalog key emitted by flows-view-lib ("—" when unrecorded). */
  const prefLabel = (p: DryRunPreference | null | undefined): string => {
    const k = preferenceLabelKey(p);
    return k ? tr(k) : "—";
  };
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [session, setSession] = useState<DryRunSessionDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [forbidden, setForbidden] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // Blueprint: agent roster (picker) and llmConfigured (run gate). A failure is silent — the picker
  // is just empty and the run gate is unknown (not blocking).
  const [blueprint, setBlueprint] = useState<FlowsBlueprint | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<FlowsBlueprint>("/api/flows").then((r) => alive && setBlueprint(r.data)).catch(() => alive && setBlueprint(null));
    return () => { alive = false; };
  }, []);

  // Editor buffer (local, unsaved). Starts from the saved override, or from the base prompt text.
  const [bufferSystem, setBufferSystem] = useState("");
  const [bufferAgentKey, setBufferAgentKey] = useState("");
  const [sampleUser, setSampleUser] = useState("");
  const [busyRun, setBusyRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [busyExport, setBusyExport] = useState(false);
  // Preference line: 3 states + one-line note, initialised from the recorded value.
  const [prefChoice, setPrefChoice] = useState<DryRunPreference | "">("");
  const [prefNote, setPrefNote] = useState("");
  const [busyPref, setBusyPref] = useState(false);

  const suggestion = useSuggestion(session?.prompt_key ?? "");

  function syncBuffer(s: DryRunSessionDetail) {
    setBufferSystem(s.override_system ?? s.base_system);
    setBufferAgentKey(s.override_agent_key ?? "");
  }

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    setForbidden(false);
    setErrorText(null);
    setRunError(null);
    api
      .get<DryRunSessionDetail>(`/api/flows/dry-run/sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => {
        if (!alive) return;
        setSession(r.data);
        syncBuffer(r.data);
        setPrefChoice(r.data.preference ?? "");
        setPrefNote(r.data.preference_note ?? "");
        setStatus("ok");
        // Arrived from "Run as new session": execute once here (the cost confirm already happened).
        const handoff = window.sessionStorage.getItem(AUTORUN_KEY(sessionId));
        if (handoff !== null && r.data.status === "active" && r.data.base_output === null) {
          window.sessionStorage.removeItem(AUTORUN_KEY(sessionId));
          void executeOn(r.data, handoff);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, retryTick]);

  const roster: BlueprintAgent[] = blueprint?.agents ?? [];
  const llmConfigured = blueprint ? blueprint.llmConfigured : true;

  const runCount = session?.runCount ?? 0;
  const executed = session !== null && session.base_output !== null;
  const buffer = { system: bufferSystem, agentKey: bufferAgentKey };
  const dirty = session !== null && isDirty(buffer, session);
  const bufferOverrideSystem = session ? effectiveOverrideSystem(bufferSystem, session.base_system) : null;
  const bufferHasOverride = bufferOverrideSystem !== null || bufferAgentKey !== "";
  const latestRun: DryRunRunSnapshot | null = useMemo(
    () => (session && session.runs.length > 0 ? session.runs.reduce((a, b) => (b.index > a.index ? b : a)) : null),
    [session],
  );

  const diff = useMemo(
    () => (session ? lineDiffSummary(session.base_system, bufferSystem.trim() || session.base_system) : { added: 0, removed: 0 }),
    [session, bufferSystem],
  );

  function askRun() {
    if (!session) return;
    const est = estimateFromLedger(session.ledger);
    confirm(
      t("executeConfirmTitle"),
      () => void doRun(),
      {
        tone: "neutral",
        confirmLabel: t("executeConfirmAction"),
        body: `${tr(est.noteKey, est.noteParams)}\n${tr(DRY_RUN_DISCLOSURE_KEY)}`,
      },
    );
  }

  /** Execute an existing session (clean buffer, or the freshly derived one). A failure leaves the session unrun for retry. */
  async function executeOn(target: DryRunSessionDetail, user: string) {
    setBusyRun(true);
    setRunError(null);
    try {
      const r = await api.post<DryRunExecutePayload>(
        `/api/flows/dry-run/sessions/${encodeURIComponent(target.id)}/execute`,
        user.trim() ? { user: user.trim() } : {},
      );
      setSession(r.data.session);
      syncBuffer(r.data.session);
      toast(t("executeDoneToast"));
    } catch (err) {
      toast(err instanceof Error ? err.message : t("executeFailedToast"), "alert");
    } finally {
      setBusyRun(false);
    }
  }

  /** Run: clean buffer executes this session; dirty buffer creates a derived session, then runs it there. */
  async function doRun() {
    if (!session || busyRun) return;
    if (!dirty) {
      await executeOn(session, sampleUser);
      return;
    }
    const body: { promptKey: string; overrideSystem?: string; overrideAgentKey?: string } = { promptKey: session.prompt_key };
    if (bufferOverrideSystem !== null) body.overrideSystem = bufferOverrideSystem.trim();
    if (bufferAgentKey) body.overrideAgentKey = bufferAgentKey;
    setBusyRun(true);
    setRunError(null);
    try {
      const r = await api.post<{ session: { id: string } }>("/api/flows/dry-run/sessions", body);
      window.sessionStorage.setItem(AUTORUN_KEY(r.data.session.id), sampleUser);
      router.push(`/flows/dry-run/${r.data.session.id}`);
    } catch (err) {
      // Create failed: nothing runs, the buffer stays as typed.
      setRunError(err instanceof Error ? err.message : t("createFailed"));
      setBusyRun(false);
    }
  }

  function revertEdits() {
    if (session) syncBuffer(session);
    setRunError(null);
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
      // Download wiring — Blob + a[download] (proposal package markdown file).
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
        <PageState state="error" errorText={errorText ?? undefined} onRetry={() => setRetryTick((n) => n + 1)} />
        {confirmDialog}
      </main>
    );
  }

  const expiry = expiryChip(session.expires_at);
  const grade = gradeFromPreference(session.preference);
  const editing = session.status === "active";
  const statusChip = (() => { const c = sessionStatusChip(session.status); return { cls: c.cls, text: c.key ? tr(c.key) : c.label }; })();
  const statusIcon = session.status === "closed" ? "✓" : editing ? "✎" : "⌛";
  const estimate = estimateFromLedger(session.ledger);
  const sessionExpired = session.status === "expired";
  const runBlockedReason = !llmConfigured
    ? t("blockedNoLlm")
    : dirty
      ? (bufferHasOverride ? undefined : t("blockedNoOverride"))
      : sessionExpired
        ? t("blockedExpired")
        : session.status === "closed"
          ? t("blockedClosed")
          : !bufferHasOverride
            ? t("blockedNoOverride")
            : undefined;
  const runDisabled = busyRun || runBlockedReason !== undefined;
  const runLabel = busyRun ? t("executing") : dirty ? t("runAsNewCta") : t("executeCta");
  const primary = primaryAction(runCount, dirty);

  return (
    <main className="dry-run-detail">
      {/* Sticky summary bar — status badge (icon + text), cost, one primary action. Wraps at narrow widths. */}
      <div className="dry-run-summary-bar">
        <ListBackButton href="/flows/dry-run" label={t("sessionListLink")} />
        <h1>{session.purpose || t("h1")}</h1>
        <span className="dry-run-summary-meta">
          <span className={statusChip.cls}>
            <span aria-hidden="true">{statusIcon} </span>
            {statusChip.text}
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
            label={primary === "run" ? runLabel : busyExport ? t("exporting") : t("exportCta")}
            onClick={primary === "run" ? askRun : () => void exportPackage()}
            disabled={primary === "run" ? runDisabled : busyExport}
            disabledReason={primary === "run" ? runBlockedReason : undefined}
          />
        </span>
      </div>

      {/* Proposal-only banner — once on this screen. */}
      <p role="note" className="dry-run-banner">{t("proposalOnlyBanner")}</p>

      {/* Session info — collapsed by default. */}
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
              {fmtUsd(session.ledger.costUsd)} · {t("ledgerLine", { p1: session.ledger.llmCalls, p2: runCount })}
              {session.ledger.lastRunAt ? " " + t("lastRunSuffix", { p1: fmtDateTime(session.ledger.lastRunAt) }) : ""}
            </span>
          </MetaRow>
        </dl>
      </details>

      {/* 1) Edit — prompt editor (+ inline AI improvement beside it) and agent picker with candidate chips. */}
      <section aria-label={t("overrideSection")} className="market-section" style={{ minWidth: 0 }}>
        <SectionToolbar
          title={t("overrideTitle")}
          filters={dirty ? <span className="status-chip status-amber"><span aria-hidden="true">● </span>{t("dirtyChip")}</span> : undefined}
          summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("overrideScopeNote")}</span>}
        />
        <div className="dry-run-edit-grid">
          <div style={{ minWidth: 0 }}>
            <label className="text-[length:var(--fs-caption)] block mb-1">
              <span className="block mb-1">{t("promptBodyLabel")}</span>
              <textarea
                className="sizing-new-input w-full"
                rows={14}
                style={{ display: "block", lineHeight: 1.5, fontSize: "var(--fs-body)" }}
                value={bufferSystem}
                onChange={(e) => setBufferSystem(e.target.value)}
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
            <div className="mb-2">
              <SuggestionTrigger state={suggestion} />
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <SuggestionResult
              state={suggestion}
              current={bufferSystem}
              onApplyPrompt={(improved) => {
                setBufferSystem(improved);
                suggestion.discard();
                toast(t("suggestionAppliedToast"));
              }}
            />
          </div>
        </div>

        <div className="text-[length:var(--fs-caption)] block mb-1 mt-2">
          <span className="block mb-1">{t("reassignLabel")}</span>
          <AgentCombobox
            agents={roster}
            value={bufferAgentKey}
            onChange={setBufferAgentKey}
            unchangedLabel={t("unchangedAgent", { p1: session.base_agent_key })}
            disabled={roster.length === 0}
          />
        </div>
        <CandidateChips state={suggestion} selectedKey={bufferAgentKey} onPick={(key) => { setBufferAgentKey(key); toast(t("agentAppliedToast", { p1: key })); }} />
        <p className="mt-1 mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("reassignContext")}</p>
        {roster.length === 0 && (
          <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("rosterFailed")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!dirty || busyRun} onClick={revertEdits}>{t("revertEdits")}</Button>
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{t("basePromptRef")}</summary>
          <pre
            className="mt-1 mb-0 text-[length:var(--fs-body)]"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "14rem", overflowY: "auto", border: "1px solid var(--border)", background: "var(--muted-bg)", borderRadius: "var(--radius-sm)", padding: "0.5rem 0.75rem" }}
          >
            {session.base_system}
          </pre>
        </details>
      </section>

      {/* 2) Run — sample input + Run (save-and-run). */}
      <section aria-label={t("runCardTitle")} className="market-section">
        <SectionToolbar
          title={t("runCardTitle")}
        />
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
        {dirty && <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("dirtyNote")}</p>}
        {runBlockedReason && (
          <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{runBlockedReason}</p>
        )}
        {runError && <p role="alert" className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]">✕ {runError}</p>}
      </section>

      {/* 3) Result — A (previous = base) and B (new = this session's override) side by side, then one preference line. */}
      <section aria-label={t("abSection")} className="market-section" style={{ minWidth: 0 }}>
        <SectionToolbar
          title={t("abTitle")}
          filters={<span className={grade.cls}>{t("gradeLabel", { p1: tr(grade.key) })}</span>}
          summary={<span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("abScopeNote")}</span>}
        />
        {!executed ? (
          <>
            <div className="dry-run-ab-grid">
              <div className="sizing-grade-card">
                <div className="text-[length:var(--fs-caption)] font-semibold">{t("legBaseTitle")}</div>
                <p className="mt-1 mb-0 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("legBaseEmpty")}</p>
              </div>
              <div className="sizing-grade-card">
                <div className="text-[length:var(--fs-caption)] font-semibold">{t("legOverrideTitle")}</div>
                <p className="mt-1 mb-0 text-[length:var(--fs-body)] text-[color:var(--muted-fg)]">{t("legOverrideEmpty")}</p>
              </div>
            </div>
            <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("notExecuted")}</p>
          </>
        ) : (
          <div className="dry-run-ab-grid">
            <LegCard
              title={t("legBaseTitle")}
              text={session.base_output ?? ""}
              source={session.base_output_source}
              costUsd={latestRun?.baseCostUsd ?? null}
              snapshot={latestRun ? t("snapshotLabel", { p1: latestRun.baseAgentKey ?? session.base_agent_key, p2: shortHash(latestRun.basePromptHash) }) : undefined}
            />
            <LegCard
              title={t("legOverrideTitle")}
              text={session.override_output ?? ""}
              source={session.override_output_source}
              costUsd={latestRun?.overrideCostUsd ?? null}
              snapshot={latestRun ? t("snapshotLabel", { p1: latestRun.overrideAgentKey ?? session.base_agent_key, p2: shortHash(latestRun.overridePromptHash) }) : undefined}
            />
          </div>
        )}

        {/* Preference line — base | override | tie chips + inline optional note; unavailable until a run exists. */}
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("prefGroup")}>
          <span className="text-[length:var(--fs-caption)] font-semibold">{t("prefRecordLabel")}</span>
          <FilterChip disabled={!executed} selected={prefChoice === "base"} onClick={() => setPrefChoice("base")}>{t("prefBase")}</FilterChip>
          <FilterChip disabled={!executed} selected={prefChoice === "override"} onClick={() => setPrefChoice("override")}>{t("prefOverride")}</FilterChip>
          <FilterChip disabled={!executed} selected={prefChoice === "tie"} onClick={() => setPrefChoice("tie")}>{t("prefTie")}</FilterChip>
          <input
            className="sizing-new-input sizing-new-input-sm"
            style={{ flex: "1 1 12rem" }}
            maxLength={500}
            disabled={!executed}
            placeholder={t("prefNotePlaceholder")}
            aria-label={t("prefNoteAria")}
            value={prefNote}
            onChange={(e) => setPrefNote(e.target.value)}
          />
          <Button size="sm" disabled={!executed || !prefChoice || busyPref} onClick={() => void recordPreference(prefChoice as DryRunPreference, prefNote)}>
            {busyPref ? t("recording") : t("recordCta")}
          </Button>
        </div>
        {!executed && <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("prefBeforeExecute")}</p>}
        {session.preference && (
          <p className="mt-1 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
            {t("prefRecordedLine", { p1: prefLabel(session.preference), p2: session.preference_note ? ` — ${session.preference_note}` : "" })}
          </p>
        )}
      </section>

      {/* 4) Run history — collapsed. Snapshot per run; "current" marks the run equal to the saved override. */}
      <details className="dry-run-info market-section">
        <summary>{t("runHistorySummary", { p1: runCount })}</summary>
        {session.runs.length === 0 ? (
          <p className="mt-2 mb-0 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("emptyHistory")}</p>
        ) : (
          <div className="table-scroll mt-2" role="region" aria-label={t("tableScrollRegion")} tabIndex={0}>
            <table className="data-table tmin-40" aria-label={t("historyTableAria")}>
              <caption className="sr-only">{t("historyTableCaption", { p1: session.id })}</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-num">{t("colRun")}</th>
                  <th scope="col">{t("colTime")}</th>
                  <th scope="col">{t("colAgent")}</th>
                  <th scope="col">{t("colPromptHash")}</th>
                  <th scope="col" className="col-num">{t("colCost")}</th>
                  <th scope="col">{t("colSnapshot")}</th>
                </tr>
              </thead>
              <tbody>
                {session.runs.map((run) => (
                  <tr key={run.index}>
                    <td className="col-num tabular-nums">{run.index}</td>
                    <td className="tabular-nums">{fmtDateTime(run.at)}</td>
                    <td><code className="dd-item-id">{run.overrideAgentKey ?? run.baseAgentKey ?? "—"}</code></td>
                    <td><code className="dd-item-id" title={run.overridePromptHash ?? undefined}>{shortHash(run.overridePromptHash)}</code></td>
                    <td className="col-num tabular-nums">{fmtUsd(run.costUsd)}</td>
                    <td>
                      {run.matchesCurrent
                        ? <span className="status-chip status-approved"><span aria-hidden="true">✓ </span>{t("currentMarker")}</span>
                        : <span className="text-[color:var(--muted-fg)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

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

/** One A/B leg: source chip (AI / deterministic), cost, the snapshot it ran with, and the output text. */
function LegCard({
  title,
  text,
  source,
  costUsd,
  snapshot,
}: {
  title: string;
  text: string;
  source: string | null;
  costUsd: number | null;
  snapshot?: string;
}) {
  const tr = useTranslations();
  const chip = sourceChip(source);
  return (
    <div className="sizing-grade-card" style={{ minWidth: 0 }}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-semibold text-[length:var(--fs-caption)]">{title}</span>
        <span className={chip.cls}>{tr(chip.key)}</span>
      </div>
      <div className="mt-1 mb-1 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums">
        {fmtUsd(costUsd)}{snapshot ? ` · ${snapshot}` : ""}
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
