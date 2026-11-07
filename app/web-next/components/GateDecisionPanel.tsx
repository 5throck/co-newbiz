"use client";

// GateDecisionPanel — 진행 상태 표시 + 인간 의사결정 기록 (ADR-0094).
// 경계 #2: 에이전트는 진행 출력을 '권고'할 뿐, GO/HOLD/KILL 기록은 사람의 행위다.
// 이 패널은 그 기록 행위의 표준 UI이며 /route-decision·/greenfield·/brownfield에
// 마운트된다. HOLD는 missing_artifacts 없이 기록할 수 없다(soft-pass 방지).
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { reconfirmErrorText } from "../lib/reconfirm-view.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteBusiness, canWriteProject } from "../lib/project-write-access.ts";
import { GATE_LABEL_KEY } from "../lib/label-keys.ts";
import type { GateMetaId } from "../lib/stage-meta.ts";
import { ReviewBuckets } from "./ReviewBuckets.tsx";
import { PrimaryAction, useToast } from "./ui.tsx";
import { useConfirm } from "./crud.tsx";
import { useModalFocus } from "../lib/use-modal-focus.ts";
import { currentTurn, gateSequenceBlocker, gateState } from "../lib/gate-sequence-view.ts";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ConditionsEditor, GateCountersign, KillOverridePanel } from "./GateIntegrity.tsx";
import { KNOWN_HARD_BLOCKS, conditionsPayload, integrityErrorList, isAwaitingCountersign, recordedDecisionOf, type ConditionDraft } from "../lib/gate-integrity-view.ts";
import { WaccStatusBadge, type WaccStatusLike } from "./WaccStatusBadge.tsx";
import { GateAckBlock, GateSnapshotSummary, useGateSnapshot } from "./GateSnapshotAck.tsx";
import { ACK_NOT_REACHED_CODE, EMPTY_ACK_STATE, ackNotReachedKeys, ackProblemsFromError, buildAckPayload, dropAckKeys, reconcileAckState, type AckProblems, type AckState, type GateSnapshotEnvelope } from "../lib/gate-ack-view.ts";

const IC_GATES: readonly string[] = ["entity_ic", "group_ic"];

interface GateLatest {
  gate: string;
  /** EFFECTIVE verdict: an IC GO awaiting its second review is not yet a GO. */
  decision: "go" | "hold" | "kill" | "pending" | null;
  /** What was recorded (use this wherever the recorded decision is shown). */
  recorded_decision?: "go" | "hold" | "kill" | null;
  decision_id?: string;
  decided_by?: string;
  countersign_state?: string | null;
  awaiting_countersign?: boolean;
  rationale: string;
  missing_artifacts: string[] | null;
  /** R2-B item 3 - the typed rationale an IC GO carried despite missing artifacts. */
  gap_override?: { items: string[]; rationale: string } | null;
  /** ADR-0182 §5 — 판단 필요 claims confirmed with this decision. */
  judgement_confirmations?: string[];
}
interface GateHistoryRow extends Omit<GateLatest, "decision"> { decision: "go" | "hold" | "kill"; countersign_state?: string | null; countersign?: { status: string; by: string | null; at: string | null; conditions: string | null } | null; legacy?: boolean; snapshot_hash?: string | null; acknowledgements?: Array<{ key: string; kind: string; reason: string }>; ai_recommended_decision?: string | null; divergence_reason?: string | null; id: string; decided_by: string; decided_at: string; /** ADR-0182 §5 — needs_judgement claims the human marked as reviewed. */ judgement_confirmations?: string[] }


/** Scroll to a gate decision panel and focus its first field (the "결정 기록" primary of gate stages). */
export function focusGateDecision(gate?: string, attempts = 12): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(gate ? `[data-gate-form~="${gate}"]` : "[data-gate-form]");
  if (!el) {
    if (attempts > 0) window.setTimeout(() => focusGateDecision(gate, attempts - 1), 50);
    return;
  }
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  const field = el.querySelector<HTMLElement>("form select, form input, form textarea");
  (field ?? el).focus({ preventScroll: true });
}

/** The gate stages' Primary Action: jump to (and focus) the decision form, which sits at the end of the page. */
export function GateDecisionJump({ gate, entityType = "project", beforeJump, inline }: { gate: string; entityType?: "opportunity" | "project"; beforeJump?: () => void; inline?: boolean }) {const t = useTranslations("components.gateDecision.panel");
  const { me } = useAuth();
  const can = entityType === "project" ? canWriteProject(me?.role) : canWriteBusiness(me?.role);
  return (
    <PrimaryAction
      inline={inline}
      label={t("decisionRecordHuman")}
      onClick={() => { beforeJump?.(); window.setTimeout(() => focusGateDecision(gate), 0); }}
      disabled={!can}
      disabledReason={t("recordingDecisionsRequiresTheAnalyst")}
    />
  );
}

/** Warning dialog for an IC GO that lacks artifacts: lists each gap and requires a typed rationale.
    It never blocks the person (boundary #2) - it asks them to own the exception in writing. */
function GapDialog({ gateLabel, gaps, onCancel, onSubmit }: { gateLabel: string; gaps: string[]; onCancel: () => void; onSubmit: (rationale: string) => void }) {const t = useTranslations("components.gateDecision.panel"); const tc = useTranslations("common");
  const [text, setText] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onCancel);
  const reasonId = useId();
  if (!mounted) return null;
  const blocked = !text.trim();
  return createPortal(
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onCancel}>
      <div ref={panelRef} className="modal-panel" role="alertdialog" aria-modal="true" aria-label={t("missingArtifactWarning")} style={{ maxWidth: "32rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{gateLabel} {t("goSomeArtifactsAreMissing")}</h2></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-2">
          {t("youAreRecordingAGo")}
        </p>
        <ul className="sizing-note-list mb-2" aria-label={t("missingItems")}>
          {gaps.map((g) => <li key={g}>{g}</li>)}
        </ul>
        <label className="block text-[length:var(--fs-caption)]">
          <span className="block mb-1">{t("exceptionEvidenceRequired")}</span>
          <textarea className="sizing-new-input w-full" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={blocked ? reasonId : undefined} />
        </label>
        {blocked && <p id={reasonId} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">{t("recordingTheGoUnlocksOnce")}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>{tc("cancel")}</button>
          <button type="button" className="btn-danger btn-sm" disabled={blocked} onClick={() => onSubmit(text.trim())}>{t("recordGoAnyway")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface GateBriefData {
  /** Stored brief record id (gate_brief_record); sent with the decision. */
  brief_id?: string;
  source: "llm" | "synthesis";
  provider: string | null;
  note: string | null;
  manifest: string[];
  gate: string;
  wacc_status?: WaccStatusLike;
  brief: { recommendation: "go" | "hold" | "kill" | null; confidence: string | null; rationale_draft: string; key_evidence: string[]; cautions: string[] };
}

/** ADR-0118 gate brief content (proposal only). Shared by the standalone brief and the S8 "AI 판단 지원" section. */
export function GateBriefBody({ briefData, currentGate, onApply, projectId }: { briefData: GateBriefData; currentGate: string; onApply: (text: string) => void; projectId?: string }) {const t = useTranslations("components.gateDecision.panel"); const tc = useTranslations("common");
  return (
    <>
      {briefData.gate !== currentGate && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mt-1 mb-0">{t("theBrief")} {briefData.gate} {t("isTheBasisRegenerateAfter")}</p>
      )}
      <p className="mt-2 mb-1 flex flex-wrap items-center gap-1">
        <span className={`status-chip ${briefData.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
          {briefData.source === "llm" ? t("llmProposalP1", { p1: briefData.provider ? ` · ${briefData.provider}` : "" }) : tc("deterministicFallback")}
        </span>
        {briefData.brief.recommendation && (
          <span className={`status-chip ${briefData.brief.recommendation === "go" ? "status-green" : briefData.brief.recommendation === "hold" ? "status-amber" : "status-red"}`}>
            {tc("recommendation")} {briefData.brief.recommendation.toUpperCase()}
          </span>
        )}
        {briefData.brief.confidence && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("confidence")} {briefData.brief.confidence}</span>}
      </p>
      <WaccStatusBadge status={briefData.wacc_status} projectId={projectId} className="mb-1" />
      {briefData.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{briefData.note}</p>}
      {briefData.brief.rationale_draft && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">{t("evidenceDraft")}</span> {briefData.brief.rationale_draft}</p>}
      {briefData.brief.key_evidence.length > 0 && (
        <ul className="sizing-note-list mb-1">
          {briefData.brief.key_evidence.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {briefData.brief.cautions.length > 0 && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-1">⚠ {briefData.brief.cautions.join(" / ")}</p>
      )}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{tc("proposalArtifactColon")} {briefData.manifest.join(" · ")}</p>
      <button type="button" className="btn-ghost btn-sm" onClick={() => onApply(briefData.brief.rationale_draft)} disabled={!briefData.brief.rationale_draft}>
        {t("reflectedInEvidence")}
      </button>
    </>
  );
}

/** Recorded decision chip; an IC GO awaiting its second review also says so (icon + label, never colour alone). */
function DecisionChip({ row }: { row: GateLatest }) {
  const ti = useTranslations("components.gateIntegrity");
  const rec = recordedDecisionOf(row);
  if (!rec) return null;
  return (
    <>
      <span className={`status-chip ${rec === "go" ? "status-green" : rec === "hold" ? "status-amber" : "status-red"}`}>{rec.toUpperCase()}</span>
      {isAwaitingCountersign(row) && <span className="status-chip status-amber ml-1" data-testid="awaiting-countersign"><span aria-hidden="true">◐</span> {ti("awaiting")}</span>}
    </>
  );
}

function condText(raw: string): string {
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return v.map((c) => (typeof c === "string" ? c : (c as { text?: string })?.text ?? "")).filter(Boolean).join("; ");
  } catch { /* plain text */ }
  return raw;
}

export function GateDecisionPanel({ opportunityId, gates, killHint, entityType = "opportunity", showReview = true, nextStage, goGaps, onRecorded, sequence = false, hideBrief = false, rationalePrefill = null, carrierStage }: {
  opportunityId: string;
  gates: GateMetaId[];
  killHint?: string | null;
  entityType?: "opportunity" | "project";
  /** Default true. Stage screens that already show the 3-stage review above pass false: one review block per gate. */
  showReview?: boolean;
  /** Where to go after a GO is recorded (link in the "recorded" summary). An href starting with "#" focuses that gate panel. */
  nextStage?: { label: string; href: string } | null;
  /** IC gates only: artifacts missing right now. A GO with gaps asks for a typed rationale first (never blocks). */
  goGaps?: string[];
  onRecorded?: (decision: "go" | "hold" | "kill", gate: GateMetaId) => void;
  /** Multi-gate only: gates are ordered committees. Shows a step indicator, defaults the form to the current turn, and opens a later gate only after the earlier ones are GO. */
  sequence?: boolean;
  /** The parent renders the AI brief itself (S8 "AI 판단 지원"): hide the standalone brief block. */
  hideBrief?: boolean;
  /** Parent-driven rationale prefill (proposal only; the person still records). A new nonce applies the text. */
  rationalePrefill?: { text: string; nonce: number } | null;
  /** The stage screen hosting this panel (e.g. "S3"); scopes later unfinished stages out of the embedded review. */
  carrierStage?: string;
}) {const tr = useTranslations(); const t = useTranslations("components.gateDecision.panel"); const tc = useTranslations("common"); const ts = useTranslations("components.gateSnapshot"); const te = useTranslations("errors.rationale");
  const { me } = useAuth();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [gapAsk, setGapAsk] = useState(false);
  const [recorded, setRecorded] = useState<{ gate: GateMetaId; decision: "go" | "hold" | "kill"; rationale: string; at: string; gap: string | null } | null>(null);
  const canRecord = entityType === "project" ? canWriteProject(me?.role) : canWriteBusiness(me?.role);
  const [latest, setLatest] = useState<GateLatest[] | null>(null);
  const [history, setHistory] = useState<GateHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = `gate-decision-${useId().replace(/:/g, "")}`;
  const seq = sequence && gates.length > 1;
  const gatePicked = useRef(false);
  const turn = seq ? currentTurn(gates, latest) : gates[0];
  const labelOf = (g: string) => tr(GATE_LABEL_KEY[g] ?? g);
  const [form, setForm] = useState<{ gate: GateMetaId; decision: "go" | "hold" | "kill"; rationale: string; missing: string; learning: string }>({
    gate: gates[0],
    decision: "go",
    rationale: "",
    missing: "",
    learning: "",
  });
  // ADR-0182 §5 — needs_judgement 항목의 "사람 확인" 체크. ReviewBuckets가
  // 렌더링하고, 여기서 상태를 소유해 결정 기록 POST에 함께 실린다(부속
  // 스냅샷). 2026-10-21(decider)부터 체크는 review_claim_ack 원장에도 즉시
  // 저장된다 — 페이지를 떠나도 검토 작업이 남는다(ADR-0182 §5 addendum).
  const [judgementChecks, setJudgementChecks] = useState<Record<string, boolean>>({});
  const [ackMeta, setAckMeta] = useState<Record<string, { by: string; at: string }>>({});
  const acksPath = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(opportunityId)}/review-acks`;
  useEffect(() => {
    let alive = true;
    for (const g of gates) {
      api.get<{ acks: Array<{ claim: string; acked: boolean; by: string; at: string }> }>(`${acksPath}?gate=${encodeURIComponent(g)}`)
        .then((r) => {
          if (!alive) return;
          setJudgementChecks((m) => {
            const next = { ...m };
            for (const a of r.data.acks) if (a.acked) next[a.claim] = true;
            return next;
          });
          setAckMeta((m) => {
            const next = { ...m };
            for (const a of r.data.acks) if (a.acked) next[a.claim] = { by: a.by, at: a.at };
            return next;
          });
        })
        .catch(() => { /* acks are optional review state — the decision flow never depends on them */ });
    }
    return () => { alive = false; };
  }, [acksPath, gates]);
  const toggleJudgement = useCallback((claim: string, checked: boolean, gate: string) => {
    setJudgementChecks((m) => ({ ...m, [claim]: checked }));
    if (checked) setAckMeta((m) => ({ ...m, [claim]: { by: me?.userId ?? "", at: new Date().toISOString() } }));
    api.post(acksPath, { gate, claim, acked: checked })
      .catch((e) => toast(e instanceof Error ? t("failedToSaveConfirmationP1", { p1: e.message }) : t("failedToSaveTheConfirmation")));
  }, [acksPath, toast]);
  // 판단 필요 항목 중 이미 결정과 함께 "사람 확인"으로 기록된 것들 — 버킷은
  // 미확인 항목에만 체크박스를 두고 확인된 항목은 기록 상태를 보여준다.
  const confirmedJudgements = useMemo(() => {
    const out = new Set<string>();
    for (const g of gates) {
      for (const claim of latest?.find((l) => l.gate === g)?.judgement_confirmations ?? []) out.add(claim);
    }
    return out;
  }, [gates, latest]);
  // ADR-0118 — LLM 진행 브리프(제안). 권고·근거 초안만 제공하며 결정 select는
  // 건드리지 않는다. "근거에 반영"은 rationale 프리필일 뿐, 기록은 사람이다.
  const [briefData, setBriefData] = useState<GateBriefData | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  // Acknowledged-GO state: snapshot, entered reasons, server problems, divergence reason.
  const [ackState, setAckState] = useState<AckState>(EMPTY_ACK_STATE);
  const [ackProblems, setAckProblems] = useState<AckProblems | null>(null);
  const [divergence, setDivergence] = useState("");
  const [divergenceProblem, setDivergenceProblem] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [condDrafts, setCondDrafts] = useState<ConditionDraft[]>([]);
  const ti = useTranslations("components.gateIntegrity");
  const [viewed, setViewed] = useState<{ id: string; data: { legacy: boolean; snapshot: unknown; acknowledgements?: Array<{ key: string; kind: string; reason: string }> } | null } | null>(null);

  // Project-entity carrier (S8+, ADR-0095/0098) records through the project
  // route; the default stays the S1~S7 opportunity route.
  const basePath = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(opportunityId)}/gate-decisions`;
  const entityBase = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(opportunityId)}`;
  const briefPath = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(opportunityId)}/gate-brief`;

  const snap = useGateSnapshot(entityBase, form.gate, briefData?.brief_id ?? null, canRecord);
  const snapshot = snap.env?.snapshot ?? null;
  const aiRec = snapshot?.ai?.recommended ?? null;
  const divergent = !!aiRec && aiRec !== form.decision;
  // A different gate or entity starts a fresh acknowledgement list.
  useEffect(() => { setAckState(EMPTY_ACK_STATE); setAckProblems(null); setStaleNotice(null); setDivergenceProblem(null); setCondDrafts([]); }, [form.gate, opportunityId]);

  const load = useCallback(() => {
    api.get<{ latest: GateLatest[]; history: GateHistoryRow[] }>(basePath)
      .then((r) => { setLatest(r.data.latest); setHistory(r.data.history); })
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadTheProgress")));
  }, [basePath]);

  useEffect(() => { load(); }, [load]);

  // Sequence mode: until the person picks a committee, the form targets the current turn.
  useEffect(() => {
    if (seq && latest && !gatePicked.current) setForm((f) => (f.gate === turn ? f : { ...f, gate: turn as GateMetaId }));
  }, [seq, latest, turn]);

  useEffect(() => { setBriefData(null); setBriefError(null); }, [opportunityId, entityType]);

  const applyBriefRationale = (text: string) => setForm((f) => ({ ...f, rationale: text || f.rationale }));
  const prefillNonce = rationalePrefill?.nonce;
  useEffect(() => {
    if (rationalePrefill && rationalePrefill.text) applyBriefRationale(rationalePrefill.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  async function generateBrief() {
    if (briefLoading) return;
    setBriefLoading(true); setBriefError(null);
    try {
      const r = await api.post<GateBriefData>(briefPath, { gate: form.gate });
      setBriefData(r.data);
      setStaleNotice(null);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : t("failedToGenerateBrief"));
    } finally {
      setBriefLoading(false);
    }
  }

  const killNeedsLearning = form.decision === "kill" && !form.learning.trim();

  const decisionOf = (gate: string): GateLatest | undefined => latest?.find((g) => g.gate === gate);

  const holdNeedsMissing = form.decision === "hold" && !form.missing.split(/[\n,]/).some((x) => x.trim());
  const gateBlocker = seq ? gateSequenceBlocker(gates, form.gate, latest) : null;
  const submitReason = saving ? t("recording")
    : gateBlocker ? tr("common.gate.lockedReason", { p1: tr(GATE_LABEL_KEY[gateBlocker] ?? gateBlocker), p2: tr(GATE_LABEL_KEY[form.gate] ?? form.gate) })
    : !form.rationale.trim() ? t("theDecisionCanBeRecorded")
    : killNeedsLearning ? t("aKillRequiresCapturingThe")
    : holdNeedsMissing ? t("aHoldRequiresTheList")
    : null;
  const lockedReason = gateBlocker ? tr("common.gate.lockedReason", { p1: tr(GATE_LABEL_KEY[gateBlocker] ?? gateBlocker), p2: tr(GATE_LABEL_KEY[form.gate] ?? form.gate) }) : null;
  const icGo = entityType === "project" && form.decision === "go" && IC_GATES.includes(form.gate);
  const gapsForGo = form.decision === "go" && IC_GATES.includes(form.gate) ? (goGaps ?? []) : [];

  /** Step 1 of the shared flow: confirm (or, for an IC GO with gaps, the warning dialog). Nothing is sent before this. */
  function requestRecord() {
    if (saving || submitReason) return;
    if (gapsForGo.length > 0) { setGapAsk(true); return; }
    const verb = form.decision.toUpperCase();
    confirm(t("recordTheP1P2Decision", { p1: tr(GATE_LABEL_KEY[form.gate] ?? form.gate), p2: verb }), () => void record(), {
      body: t("evidenceP1TheDecisionIs", { p1: form.rationale.trim() }),
      confirmLabel: tc("record"),
      tone: form.decision === "kill" ? "danger" : "neutral",
    });
  }

  async function record(gapRationale?: string) {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const judgementConfirmations = Object.entries(judgementChecks).filter(([, v]) => v).map(([k]) => k);
      await api.post(basePath, {
        gate: form.gate,
        decision: form.decision,
        rationale: form.rationale.trim(),
        gap_rationale: gapRationale,
        missing_artifacts: form.decision === "hold" ? form.missing.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : undefined,
        // ADR-0152: every KILL carries learning capture (the route answers 422 without it).
        learning_capture: form.decision === "kill" ? form.learning.trim() : undefined,
        // ADR-0182 §5: checked 판단 필요 claims ride with the decision.
        judgement_confirmations: judgementConfirmations.length > 0 ? judgementConfirmations : undefined,
        // Conditions ride with an IC GO (the server creates the rows).
        conditions: icGo && conditionsPayload(condDrafts).length > 0 ? conditionsPayload(condDrafts) : undefined,
        // Gate integrity: the snapshot the person reviewed, their acknowledgements and the AI-divergence reason.
        ...(snap.env ? {
          snapshot_hash: snap.env.snapshot_hash,
          acknowledgements: form.decision === "go" ? buildAckPayload(snap.env.snapshot.required_acks, ackState) : undefined,
          brief_id: briefData?.brief_id ?? snap.env.snapshot.ai?.brief_id,
          divergence_reason: divergent && divergence.trim() ? divergence.trim() : undefined,
        } : {}),
      });
      // Step 2-4: toast, the form collapses into a "recorded" summary (no resubmission), next-stage prompt.
      setRecorded({ gate: form.gate, decision: form.decision, rationale: form.rationale.trim(), at: new Date().toISOString(), gap: gapRationale ?? null });
      toast(t("recordedTheP1P2Decision", { p1: tr(GATE_LABEL_KEY[form.gate] ?? form.gate), p2: form.decision.toUpperCase() }));
      setForm((f) => ({ ...f, rationale: "", missing: "", learning: "" }));
      setJudgementChecks({});
      setAckState(EMPTY_ACK_STATE); setAckProblems(null); setDivergence(""); setStaleNotice(null); setCondDrafts([]);
      void snap.reload();
      load();
      onRecorded?.(form.decision, form.gate);
    } catch (err) {
      handleRecordError(err);
    } finally {
      setSaving(false);
    }
  }

  /** 409 snapshot_stale swaps in the fresh snapshot (entered reasons kept for keys that still exist); 422s land next to their fields. */
  function handleRecordError(err: unknown) {
    if (!(err instanceof ApiError)) { setError(err instanceof Error ? err.message : t("failedToRecordTheDecision")); return; }
    setAckProblems(null); setDivergenceProblem(null); setStaleNotice(null);
    const d = err.details as Record<string, unknown>;
    if (err.code === "snapshot_stale" && d.snapshot && typeof d.snapshot_hash === "string") {
      const fresh: GateSnapshotEnvelope = { gate: form.gate, snapshot_hash: d.snapshot_hash, snapshot: d.snapshot as GateSnapshotEnvelope["snapshot"] };
      const r = reconcileAckState(ackState, snap.env?.snapshot.required_acks ?? [], fresh.snapshot.required_acks);
      setAckState(r.state);
      snap.replace(fresh);
      setStaleNotice(ts("staleChanged", { added: r.added.length, dropped: r.dropped.length }));
      setError(null);
      return;
    }
    if (err.code === "ack_required" || (err.code === "rationale_insufficient" && d.field === "acknowledgements")) {
      setAckProblems(ackProblemsFromError(err.code, d));
      setError(err.message);
      return;
    }
    // ADR-0193: the client asked to acknowledge a criterion the server classifies not reached - a stale view. Reload and say so plainly.
    if (err.code === ACK_NOT_REACHED_CODE) {
      const keys = ackNotReachedKeys(d);
      setAckState((s) => dropAckKeys(s, keys));
      void snap.reload();
      setError(ts("ackNotReached", { count: keys.length }));
      return;
    }
    if (err.code === "divergence_reason_required") { setDivergenceProblem(err.message); setError(null); return; }
    if (err.code === "rationale_insufficient" && d.field === "divergence_reason") {
      setDivergenceProblem(typeof d.reason === "string" ? te(d.reason as never) : err.message); setError(null); return;
    }
    if ((KNOWN_HARD_BLOCKS as readonly string[]).includes(err.code)) {
      void snap.reload();
      const list = integrityErrorList(err.code, d);
      // The ADR-0193 blocks have catalog text (the lineage one names its repair); the server text stays the fallback for the older ones.
      const text = err.code.startsWith("kill_carry_") || err.code === "kill_lineage_missing" || err.code === "kill_enforce_unsafe"
        ? `${ti(`hardBlock.${err.code}.title` as never)} ${ti(`hardBlock.${err.code}.body` as never)}`
        : err.message;
      setError(list.length > 0 ? `${text} (${list.join(", ")})` : text);
      return;
    }
    if (err.code === "reconfirmation_required") {
      setError(reconfirmErrorText(err.message, d, (k) => tr(`components.reconfirm.item.${k}` as never)));
      return;
    }
    if (err.code === "gate_prerequisites_incomplete" && d.awaiting_countersign) {
      void load();
      setError(`${err.message} ${ti("priorAwaiting")}`);
      return;
    }
    setError(err.message);
  }

  async function viewSnapshot(id: string) {
    if (viewed?.id === id) { setViewed(null); return; }
    try {
      const r = await api.get<{ legacy: boolean; snapshot: unknown; acknowledgements?: Array<{ key: string; kind: string; reason: string }> }>(`${basePath}/${encodeURIComponent(id)}/snapshot`);
      setViewed({ id, data: r.data });
    } catch (e) {
      setViewed({ id, data: null });
      setError(e instanceof Error ? e.message : t("failedToLoadTheProgress"));
    }
  }

  /** History cell: legacy label, or acknowledgement count with a way to open the stored snapshot. */
  function snapshotCell(h: GateHistoryRow) {
    return (
      <span className="block">
        {h.legacy ? <span className="status-chip status-not-started">{ts("legacy")}</span> : (
          <button type="button" className="btn-ghost btn-sm" aria-expanded={viewed?.id === h.id} onClick={() => void viewSnapshot(h.id)}>
            {ts("viewSnapshot", { count: h.acknowledgements?.length ?? 0 })}
          </button>
        )}
        {h.countersign_state && h.countersign_state !== "not_applicable" && (
          <span className="block" data-testid="history-countersign">
            <span className={`status-chip ${h.countersign_state === "countersigned" ? "status-green" : h.countersign_state === "countersign_rejected" ? "status-red" : "status-amber"}`}>
              <span aria-hidden="true">{h.countersign_state === "countersigned" ? "●" : h.countersign_state === "countersign_rejected" ? "✕" : "◐"}</span> {ti(`state.${h.countersign_state}` as never)}
            </span>
            {h.countersign?.status && h.countersign.by && <span className="block">{ti("countersign.resultBy", { by: h.countersign.by, date: (h.countersign.at ?? "").slice(0, 10), state: ti(`countersign.choice.${h.countersign.status}` as never) })}</span>}
            {h.countersign?.conditions && <span className="block">{condText(h.countersign.conditions)}</span>}
          </span>
        )}
        {h.divergence_reason && <span className="block">{ts("divergenceRecorded", { ai: (h.ai_recommended_decision ?? "").toUpperCase(), reason: h.divergence_reason })}</span>}
        {viewed?.id === h.id && viewed.data && (
          <span className="block" role="region" aria-label={ts("storedSnapshot")}>
            {(viewed.data.acknowledgements ?? []).length === 0 ? ts("noAcks") : (
              <ul className="sizing-note-list">{viewed.data.acknowledgements!.map((a) => <li key={a.key}><strong>{a.key}</strong>: {a.reason}</li>)}</ul>
            )}
            <details><summary className="cursor-pointer text-[color:var(--accent)]">{ts("rawSnapshot")}</summary><pre className="pre-wrap text-[length:var(--fs-caption)]">{JSON.stringify(viewed.data.snapshot, null, 2)}</pre></details>
          </span>
        )}
      </span>
    );
  }

  const panelKey = gates.length === 1 ? gates[0] : gates.join(",");
  const nextGate = seq && recorded ? gates[gates.indexOf(recorded.gate) + 1] : undefined;
  // Sequence mode: an entity-level GO keeps the form open (now targeting the next committee) instead of collapsing it.
  const summaryOnly = !!recorded && recorded.decision !== "hold" && !(seq && recorded.decision === "go" && nextGate);
  return (
    <section aria-label={tc("decisionMaking")} className="market-section sizing-step" data-gate-form={panelKey.replace(/,/g, " ")} id={`gate-decision-${panelKey.replace(/,/g, "-")}`} tabIndex={-1}>
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">
        <span className="sizing-step-badge">🚦</span> {t("approvalRecordBoundary")}
      </h3>
      <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
        {t("regardlessOfTheAgentRecommendation")}
      </p>
      {killHint && (
        <p className="sizing-note-list mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]" role="note">⛔ {killHint}</p>
      )}
      {seq && (
        <ol className="mb-3 flex flex-wrap items-center gap-2 list-none p-0 text-[length:var(--fs-caption)]" aria-label={t("icProgressOrder")}>
          {gates.map((g, i) => {
            const st = gateState(latest, g);
            return (
              <li key={g} className="flex items-center gap-2" aria-current={g === turn && st !== "go" ? "step" : undefined}>
                {i > 0 && <span aria-hidden="true">→</span>}
                <span className="font-semibold">{"①②③④"[i]} {tr(GATE_LABEL_KEY[g] ?? g)}</span>
                {isAwaitingCountersign(decisionOf(g)) ? <DecisionChip row={decisionOf(g)!} /> : (
                <span className={`status-chip ${st === "go" ? "status-green" : st === "hold" ? "status-amber" : st === "kill" ? "status-red" : "status-not-started"}`}>{st === "pending" ? tr("common.stageStatus.waiting") : st.toUpperCase()}</span>)}
                {g === turn && st !== "go" && <span className="text-[color:var(--muted-fg)]">{t("nowDue")}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {gates.length === 1 ? (
        // 진행이 하나뿐이면 표 대신 한 줄 상태로 보여준다 — 바로 아래 기록
        // 폼과 진행/결정/근거 레이블이 겹쳐 보이는 걸 피하기 위함.
        (() => {
          const g = gates[0];
          const d = decisionOf(g);
          return (
            <p className="mb-2 text-[length:var(--fs-caption)] flex flex-wrap items-center gap-1">
              <span className="font-semibold">{tr(GATE_LABEL_KEY[g] ?? g)} {t("currentDecision")}</span>
              {d ? (
                recordedDecisionOf(d) ? <DecisionChip row={d} /> : <span className="status-chip status-not-started">{t("undecided")}</span>
              ) : (
                <span className="status-chip status-not-started">{t("undecided")}</span>
              )}
              {d?.missing_artifacts && d.missing_artifacts.length > 0 && (
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={d.missing_artifacts.join(", ")}>
                  {t("incomplete")} {d.missing_artifacts.length}{tc("countUnit")}
                </span>
              )}
              {d?.rationale && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">— {d.rationale}</span>}
            </p>
          );
        })()
      ) : (
        <table className="data-table" aria-label={t("currentDecisionByStage")}>
          <caption className="sr-only">{t("currentDecisionByStage2")}</caption>
          <thead>
            <tr><th scope="col" className="w-[9rem]">{tc("inProgress")}</th><th scope="col" className="w-[7rem]">{tc("decision")}</th><th scope="col">{tc("evidence")}</th></tr>
          </thead>
          <tbody>
            {gates.map((g) => {
              const d = decisionOf(g);
              return (
                <tr key={g}>
                  <td className="font-semibold">{labelOf(g)}</td>
                  <td>
                    {d && recordedDecisionOf(d) ? (
                      <DecisionChip row={d} />
                    ) : (
                      <span className="status-chip status-not-started">{t("undecided2")}</span>
                    )}
                    {d?.missing_artifacts && d.missing_artifacts.length > 0 && (
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={d.missing_artifacts.join(", ")}>
                        {t("incomplete2")} {d.missing_artifacts.length}{tc("countUnit")}
                      </span>
                    )}
                  </td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{d?.rationale ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {entityType === "project" && gates.map((g) => {
        const d = decisionOf(g);
        if (!d || !isAwaitingCountersign(d) || !d.decision_id) return null;
        return (
          <div key={`cs-${g}`} data-testid="awaiting-countersign-block">
            <p className="text-[length:var(--fs-caption)] mt-2 mb-0" role="status">
              <span className="status-chip status-amber"><span aria-hidden="true">◐</span> {ti("awaiting")}</span> {ti("awaitingNote", { gate: labelOf(g) })}
            </p>
            {canRecord && <GateCountersign projectId={opportunityId} decisionId={d.decision_id} gate={g} gateLabel={labelOf(g)} recordedBy={d.decided_by} onDone={() => { load(); void snap.reload(); onRecorded?.("go", g as GateMetaId); }} />}
          </div>
        );
      })}

      {/* ADR-0153 — 3단계 검토(확인됨 / 확인하지 못함 / 판단 필요). PASS 표시 없음.
          ADR-0182 §5 — 판단 필요 항목에 "사람 확인" 체크(결정 POST에 동봉)와
          결정 폼으로의 이동 링크를 심는다. */}
      {showReview && (
        <ReviewBuckets
          entityType={entityType}
          entityId={opportunityId}
          gates={gates}
          carrierStage={carrierStage}
          variant="expanded"
          judgementChecks={judgementChecks}
          onToggleJudgement={canRecord ? toggleJudgement : undefined}
          ackMeta={ackMeta}
          onDecisionJump={canRecord ? () => focusGateDecision(gates[0]) : undefined}
          confirmedJudgements={confirmedJudgements}
        />
      )}

      {/* ADR-0118 — LLM 진행 브리프(제안): 권고·근거 초안 제공, 기록은 사람 */}
      {canRecord && !hideBrief && (
        <div className="mt-3 border border-[color:var(--border)] rounded-lg px-3 py-2" aria-label={t("aiProgressBrief")}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost btn-sm" disabled={briefLoading} onClick={() => void generateBrief()}>
              {briefLoading ? tc("creating") : briefData ? tc("regenerate") : t("generateAiBrief")}
            </button>
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {tr(GATE_LABEL_KEY[form.gate] ?? form.gate)} {t("progressBasisProposalsDoNot")}
            </span>
          </div>
          {briefError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">{briefError}</p>}
          {briefData && <GateBriefBody briefData={briefData} currentGate={form.gate} onApply={applyBriefRationale} projectId={entityType === "project" ? opportunityId : undefined} />}
          {!briefData && !briefLoading && !briefError && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">{t("theAiDraftsTheRecommendation")}</p>
          )}
        </div>
      )}

      {canRecord && recorded && recorded.decision !== "hold" && (!summaryOnly && !!nextGate) && (
        <div className="gate-recorded" role="status" aria-label={tc("recordedDecision")}>
          <p className="mb-1">
            <span className="status-chip status-green">● {labelOf(recorded.gate)} {t("goRecorded")}</span>
            <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums">{recorded.at.slice(0, 16).replace("T", " ")}</span>
          </p>
          <p className="text-[length:var(--fs-caption)] mb-1">{tc("evidenceColon")} {recorded.rationale}</p>
          {recorded.gap && <p className="text-[length:var(--fs-caption)] mb-1">{tc("missingArtifactExceptionColon")} {recorded.gap}</p>}
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">{t("nextDue")} {labelOf(nextGate!)} {t("recordTheDecisionBelow")}</p>
        </div>
      )}
      {canRecord && summaryOnly ? (
        <div className="gate-recorded" role="status" aria-label={tc("recordedDecision")}>
          <p className="mb-1">
            <span className={`status-chip ${recorded.decision === "go" ? "status-green" : "status-red"}`}>● {labelOf(recorded.gate)} {recorded.decision.toUpperCase()} {t("recorded")}</span>
            <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums">{recorded.at.slice(0, 16).replace("T", " ")}</span>
          </p>
          <p className="text-[length:var(--fs-caption)] mb-1">{tc("evidenceColon")} {recorded.rationale}</p>
          {recorded.gap && <p className="text-[length:var(--fs-caption)] mb-1">{tc("missingArtifactExceptionColon")} {recorded.gap}</p>}
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{t("theSameDecisionCannotBe")}</p>
          {recorded.decision === "go" && nextStage && !nextGate && (nextStage.href.startsWith("#") ? (
            <a className="btn-ghost btn-sm" href={nextStage.href} onClick={(e) => { e.preventDefault(); focusGateDecision(nextStage.href.slice(1).replace("gate-decision-", "")); }}>{t("next")} {nextStage.label} →</a>
          ) : (
            <Link className="btn-ghost btn-sm" href={nextStage.href}>{t("next2")} {nextStage.label} →</Link>
          ))}
          {recorded.decision === "kill" && <p className="text-[length:var(--fs-caption)] mb-0">{t("theProjectClosureProcedureContinues")}</p>}
        </div>
      ) : canRecord ? (
        <form
          id={formId}
          className="sizing-new-form"
          aria-label={t("decisionRecord")}
          onSubmit={(e) => { e.preventDefault(); requestRecord(); }}
        >
          {seq && (
            <p className="mb-2 text-[length:var(--fs-body)]" data-testid="gate-target">
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mr-2">{t("recordSubject")}</span>
              <strong>{"①②③④"[gates.indexOf(form.gate)]} {labelOf(form.gate)}</strong>
              {form.gate === turn && gateState(latest, form.gate) !== "go" && <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("nowDue2")}</span>}
            </p>
          )}
          {lockedReason && <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="note">{lockedReason}</p>}
          <div className="flex flex-wrap items-end gap-2">
            {gates.length > 1 && (
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{seq ? t("changeToAnotherCommittee") : tc("inProgress")}</span>
                <select
                  value={form.gate}
                  onChange={(e) => { gatePicked.current = true; setForm({ ...form, gate: e.target.value as GateMetaId }); }}
                  className="sizing-new-input sizing-new-input-sm"
                >
                  {gates.map((g) => <option key={g} value={g} disabled={seq && !!gateSequenceBlocker(gates, g, latest)}>{labelOf(g)}</option>)}
                </select>
              </label>
            )}
            <label className="text-[length:var(--fs-caption)]">
              <span className="block mb-1">{tc("decision")}</span>
              <select
                value={form.decision}
                onChange={(e) => setForm({ ...form, decision: e.target.value as "go" | "hold" | "kill" })}
                className="sizing-new-input sizing-new-input-sm"
              >
                <option value="go">GO</option>
                <option value="hold">HOLD</option>
                <option value="kill">KILL</option>
              </select>
            </label>
            <label className="text-[length:var(--fs-caption)] flex-1 min-w-[14rem]">
              <span className="block mb-1">{tc("evidenceAsterisk")}</span>
              <input
                value={form.rationale}
                onChange={(e) => setForm({ ...form, rationale: e.target.value })}
                className="sizing-new-input w-full"
                required
              />
            </label>
          </div>
          {form.decision === "hold" && (
            <label className="block mt-2 text-[length:var(--fs-caption)]">
              <span className="block mb-1">{t("incompleteArtifactsRequiredForHold")}</span>
              <textarea
                value={form.missing}
                onChange={(e) => setForm({ ...form, missing: e.target.value })}
                className="sizing-new-input w-full"
                rows={2}
                placeholder={t("eGScoreCheck")}
              />
            </label>
          )}
          {form.decision === "kill" && (
            <label className="block mt-2 text-[length:var(--fs-caption)]">
              <span className="block mb-1">{t("learningCaptureRequiredForKill")}</span>
              <textarea
                value={form.learning}
                onChange={(e) => setForm({ ...form, learning: e.target.value })}
                className="sizing-new-input w-full"
                rows={2}
                required
              />
            </label>
          )}
          {icGo && <ConditionsEditor gate={form.gate} value={condDrafts} onChange={setCondDrafts} />}
          {snapshot && (
            <div className="mt-3" aria-label={ts("summaryHeading")} role="group">
              <h4 className="text-[length:var(--fs-body)] mb-1">{ts("summaryHeading")}</h4>
              <GateSnapshotSummary snapshot={snapshot} gateLabel={labelOf} />
              <GateAckBlock
                snapshot={snapshot}
                state={ackState}
                onChange={setAckState}
                problems={ackProblems}
                decision={form.decision}
                notice={staleNotice}
                projectId={entityType === "project" ? opportunityId : undefined}
                divergence={divergent && aiRec ? { aiRecommended: aiRec, value: divergence, onChange: setDivergence, required: form.decision === "go", problem: divergenceProblem } : null}
              />
            </div>
          )}
          {snap.loading && !snapshot && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2" role="status">{ts("loading")}</p>}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button type="submit" className="btn-ghost btn-sm" disabled={saving || !!submitReason} aria-describedby={submitReason ? `${formId}-reason` : undefined}>
              {saving ? tc("recording") : tc("decision")}
            </button>
            {submitReason && <span id={`${formId}-reason`} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{submitReason}</span>}
          </div>
          {recorded && recorded.decision === "hold" && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0" role="status">
              ● {tr(GATE_LABEL_KEY[recorded.gate] ?? recorded.gate)} {t("holdRecordedAfterCompletingThe")}
            </p>
          )}
        </form>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("recordingDecisionsRequiresTheAnalyst2")}</p>
      )}
      {canRecord && snapshot && (snapshot.kill.triggered.length > 0) && (
        <KillOverridePanel entityType={entityType} entityId={opportunityId} triggered={snapshot.kill.triggered} canAct={canRecord} onChanged={() => void snap.reload()} />
      )}
      {confirmDialog}
      {gapAsk && (
        <GapDialog
          gateLabel={tr(GATE_LABEL_KEY[form.gate] ?? form.gate)}
          gaps={gapsForGo}
          onCancel={() => setGapAsk(false)}
          onSubmit={(text) => { setGapAsk(false); void record(text); }}
        />
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p>}

      {history.length > 0 && seq && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{tc("decisionHistoryOpen")}{history.length}{t("itemSPerCommittee")}</summary>
          {gates.map((g) => {
            const rows = history.filter((h) => h.gate === g);
            return (
              <div key={g} className="mt-2">
                <h4 className="text-[length:var(--fs-body)] mb-1">{labelOf(g)} ({rows.length}{tc("countSuffixParen")}</h4>
                {rows.length === 0 ? (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{t("noRecordedDecisions")}</p>
                ) : (
                  <table className="data-table" aria-label={t("p1DecisionHistory", { p1: labelOf(g) })}>
                    <caption className="sr-only">{labelOf(g)} {t("decisionHistory")}</caption>
                    <thead>
                      <tr><th scope="col">{tc("decision")}</th><th scope="col">{tc("evidence")}</th><th scope="col">{tc("recordedBy")}</th><th scope="col">{tc("timestamp")}</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((h) => (
                        <tr key={h.id}>
                          <td><span className={`status-chip ${h.decision === "go" ? "status-green" : h.decision === "hold" ? "status-amber" : "status-red"}`}>{h.decision.toUpperCase()}</span></td>
                          <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            {h.rationale}
                            {h.gap_override && <span className="block">{tc("missingArtifactExceptionColon")} {h.gap_override.rationale} {t("missing")} {h.gap_override.items.join("; ")})</span>}
                            {!!h.judgement_confirmations?.length && <span className="block"><span className="status-chip status-in-progress">{t("humanConfirmation")} {h.judgement_confirmations.length}{tc("countUnit")}</span></span>}
                            {snapshotCell(h)}
                          </td>
                          <td className="text-[length:var(--fs-caption)]">{h.decided_by}</td>
                          <td className="text-[length:var(--fs-caption)] tabular-nums">{h.decided_at.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </details>
      )}
      {history.length > 0 && !seq && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">{tc("decisionHistoryOpen")}{history.length}{t("itemS")}</summary>
          <table className="data-table mt-2" aria-label={t("decisionHistory2")}>
            <caption className="sr-only">{t("decisionHistory3")}</caption>
            <thead>
              <tr><th scope="col">{tc("inProgress")}</th><th scope="col">{tc("decision")}</th><th scope="col">{tc("evidence")}</th><th scope="col">{tc("recordedBy")}</th><th scope="col">{tc("timestamp")}</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{tr(GATE_LABEL_KEY[h.gate] ?? h.gate)}</td>
                  <td><span className={`status-chip ${h.decision === "go" ? "status-green" : h.decision === "hold" ? "status-amber" : "status-red"}`}>{h.decision.toUpperCase()}</span></td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {h.rationale}
                    {h.gap_override && <span className="block">{tc("missingArtifactExceptionColon")} {h.gap_override.rationale} {t("missing2")} {h.gap_override.items.join("; ")})</span>}
                    {!!h.judgement_confirmations?.length && <span className="block"><span className="status-chip status-in-progress">{t("humanConfirmation2")} {h.judgement_confirmations.length}{tc("countUnit")}</span></span>}
                    {snapshotCell(h)}
                  </td>
                  <td className="text-[length:var(--fs-caption)]">{h.decided_by}</td>
                  <td className="text-[length:var(--fs-caption)] tabular-nums">{h.decided_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
