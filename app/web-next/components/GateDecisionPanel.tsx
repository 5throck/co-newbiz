"use client";

// GateDecisionPanel — 진행 상태 표시 + 인간 의사결정 기록 (ADR-0094).
// 경계 #2: 에이전트는 진행 출력을 '권고'할 뿐, GO/HOLD/KILL 기록은 사람의 행위다.
// 이 패널은 그 기록 행위의 표준 UI이며 /route-decision·/greenfield·/brownfield에
// 마운트된다. HOLD는 missing_artifacts 없이 기록할 수 없다(soft-pass 방지).
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth-client.tsx";
import { canWriteBusiness, canWriteProject } from "../lib/project-write-access.ts";
import { GATE_LABEL, type GateMetaId } from "../lib/stage-meta.ts";
import { ReviewBuckets } from "./ReviewBuckets.tsx";
import { PrimaryAction, useToast } from "./ui.tsx";
import { useConfirm } from "./crud.tsx";
import { useModalFocus } from "../lib/use-modal-focus.ts";
import { currentTurn, gateLockedReason, gateState, GATE_STATE_LABEL, IC_STEP_LABEL } from "../lib/gate-sequence-view.ts";
import { createPortal } from "react-dom";

const IC_GATES: readonly string[] = ["entity_ic", "group_ic"];

interface GateLatest {
  gate: string;
  decision: "go" | "hold" | "kill";
  rationale: string;
  missing_artifacts: string[] | null;
  /** R2-B item 3 - the typed rationale an IC GO carried despite missing artifacts. */
  gap_override?: { items: string[]; rationale: string } | null;
  /** ADR-0182 §5 — 판단 필요 claims confirmed with this decision. */
  judgement_confirmations?: string[];
}
interface GateHistoryRow extends GateLatest { id: string; decided_by: string; decided_at: string; /** ADR-0182 §5 — needs_judgement claims the human marked as reviewed. */ judgement_confirmations?: string[] }


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
export function GateDecisionJump({ gate, entityType = "project", beforeJump, inline }: { gate: string; entityType?: "opportunity" | "project"; beforeJump?: () => void; inline?: boolean }) {
  const { me } = useAuth();
  const can = entityType === "project" ? canWriteProject(me?.role) : canWriteBusiness(me?.role);
  return (
    <PrimaryAction
      inline={inline}
      label="결정 기록 (사람)"
      onClick={() => { beforeJump?.(); window.setTimeout(() => focusGateDecision(gate), 0); }}
      disabled={!can}
      disabledReason="결정 기록은 analyst 역할 이상만 가능합니다."
    />
  );
}

/** Warning dialog for an IC GO that lacks artifacts: lists each gap and requires a typed rationale.
    It never blocks the person (boundary #2) - it asks them to own the exception in writing. */
function GapDialog({ gateLabel, gaps, onCancel, onSubmit }: { gateLabel: string; gaps: string[]; onCancel: () => void; onSubmit: (rationale: string) => void }) {
  const [text, setText] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { panelRef, onKeyDown } = useModalFocus(onCancel);
  const reasonId = useId();
  if (!mounted) return null;
  const blocked = !text.trim();
  return createPortal(
    <div className="modal-backdrop" role="presentation" onKeyDown={onKeyDown} onClick={onCancel}>
      <div ref={panelRef} className="modal-panel" role="alertdialog" aria-modal="true" aria-label="누락 산출물 경고" style={{ maxWidth: "32rem", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2 style={{ fontSize: "0.95rem" }}>{gateLabel} GO - 누락된 산출물이 있습니다</h2></div>
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-2">
          아래 항목이 갖춰지지 않은 채로 GO를 기록하려 합니다. 시스템은 기록을 막지 않습니다 - 결정은 사람의 몫입니다(경계 #2). 다만 예외 근거를 직접 적어야 하며, 근거는 투자심의 자료에 함께 남습니다.
        </p>
        <ul className="sizing-note-list mb-2" aria-label="누락 항목">
          {gaps.map((g) => <li key={g}>{g}</li>)}
        </ul>
        <label className="block text-[length:var(--fs-caption)]">
          <span className="block mb-1">예외 근거 (필수)</span>
          <textarea className="sizing-new-input w-full" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-describedby={blocked ? reasonId : undefined} />
        </label>
        {blocked && <p id={reasonId} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">예외 근거를 입력하면 GO를 기록할 수 있습니다.</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>취소</button>
          <button type="button" className="btn-danger btn-sm" disabled={blocked} onClick={() => onSubmit(text.trim())}>그래도 GO 기록</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface GateBriefData {
  source: "llm" | "synthesis";
  provider: string | null;
  note: string | null;
  manifest: string[];
  gate: string;
  brief: { recommendation: "go" | "hold" | "kill" | null; confidence: string | null; rationale_draft: string; key_evidence: string[]; cautions: string[] };
}

/** ADR-0118 gate brief content (proposal only). Shared by the standalone brief and the S8 "AI 판단 지원" section. */
export function GateBriefBody({ briefData, currentGate, onApply }: { briefData: GateBriefData; currentGate: string; onApply: (text: string) => void }) {
  return (
    <>
      {briefData.gate !== currentGate && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mt-1 mb-0">브리프는 {briefData.gate} 기준입니다 — 진행을 바꾸면 재생성하세요.</p>
      )}
      <p className="mt-2 mb-1 flex flex-wrap items-center gap-1">
        <span className={`status-chip ${briefData.source === "llm" ? "status-in-progress" : "status-not-started"}`}>
          {briefData.source === "llm" ? `LLM 제안${briefData.provider ? ` · ${briefData.provider}` : ""}` : "결정론 폴백"}
        </span>
        {briefData.brief.recommendation && (
          <span className={`status-chip ${briefData.brief.recommendation === "go" ? "status-green" : briefData.brief.recommendation === "hold" ? "status-amber" : "status-red"}`}>
            권고 {briefData.brief.recommendation.toUpperCase()}
          </span>
        )}
        {briefData.brief.confidence && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">확신도 {briefData.brief.confidence}</span>}
      </p>
      {briefData.note && <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">{briefData.note}</p>}
      {briefData.brief.rationale_draft && <p className="text-[length:var(--fs-caption)] mb-1"><span className="font-semibold">근거 초안:</span> {briefData.brief.rationale_draft}</p>}
      {briefData.brief.key_evidence.length > 0 && (
        <ul className="sizing-note-list mb-1">
          {briefData.brief.key_evidence.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {briefData.brief.cautions.length > 0 && (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--amber-fg, var(--accent))] mb-1">⚠ {briefData.brief.cautions.join(" / ")}</p>
      )}
      <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">이 제안이 본 산출물: {briefData.manifest.join(" · ")}</p>
      <button type="button" className="btn-ghost btn-sm" onClick={() => onApply(briefData.brief.rationale_draft)} disabled={!briefData.brief.rationale_draft}>
        근거에 반영
      </button>
    </>
  );
}

export function GateDecisionPanel({ opportunityId, gates, killHint, entityType = "opportunity", showReview = true, nextStage, goGaps, onRecorded, sequence = false, hideBrief = false, rationalePrefill = null }: {
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
}) {
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
  const labelOf = (g: string) => (seq && IC_STEP_LABEL[g as keyof typeof IC_STEP_LABEL]) || GATE_LABEL[g as GateMetaId] || g;
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
      .catch((e) => toast(e instanceof Error ? `확인 저장 실패: ${e.message}` : "확인 저장 실패"));
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

  // Project-entity carrier (S8+, ADR-0095/0098) records through the project
  // route; the default stays the S1~S7 opportunity route.
  const basePath = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(opportunityId)}/gate-decisions`;
  const briefPath = `/api/${entityType === "project" ? "projects" : "opportunities"}/${encodeURIComponent(opportunityId)}/gate-brief`;

  const load = useCallback(() => {
    api.get<{ latest: GateLatest[]; history: GateHistoryRow[] }>(basePath)
      .then((r) => { setLatest(r.data.latest); setHistory(r.data.history); })
      .catch((e) => setError(e instanceof Error ? e.message : "진행 상태 불러오기 실패"));
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
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "브리프 생성 실패");
    } finally {
      setBriefLoading(false);
    }
  }

  const killNeedsLearning = form.decision === "kill" && !form.learning.trim();

  const decisionOf = (gate: string): GateLatest | undefined => latest?.find((g) => g.gate === gate);

  const holdNeedsMissing = form.decision === "hold" && !form.missing.split(/[\n,]/).some((x) => x.trim());
  const submitReason = saving ? "기록 중입니다."
    : seq && gateLockedReason(gates, form.gate, latest, IC_STEP_LABEL) ? gateLockedReason(gates, form.gate, latest, IC_STEP_LABEL)
    : !form.rationale.trim() ? "근거를 입력하면 결정을 기록할 수 있습니다."
    : killNeedsLearning ? "KILL에는 학습 포착이 필요합니다."
    : holdNeedsMissing ? "HOLD에는 미완료 산출물 목록이 필요합니다."
    : null;
  const lockedReason = seq ? gateLockedReason(gates, form.gate, latest, IC_STEP_LABEL) : null;
  const gapsForGo = form.decision === "go" && IC_GATES.includes(form.gate) ? (goGaps ?? []) : [];

  /** Step 1 of the shared flow: confirm (or, for an IC GO with gaps, the warning dialog). Nothing is sent before this. */
  function requestRecord() {
    if (saving || submitReason) return;
    if (gapsForGo.length > 0) { setGapAsk(true); return; }
    const verb = form.decision.toUpperCase();
    confirm(`${GATE_LABEL[form.gate]} ${verb} 결정을 기록할까요?`, () => void record(), {
      body: `근거: ${form.rationale.trim()} - 결정은 감사 로그에 append-only로 남으며 되돌릴 수 없습니다. 정정이 필요하면 새 결정을 추가로 기록합니다.`,
      confirmLabel: "기록",
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
      });
      // Step 2-4: toast, the form collapses into a "recorded" summary (no resubmission), next-stage prompt.
      setRecorded({ gate: form.gate, decision: form.decision, rationale: form.rationale.trim(), at: new Date().toISOString(), gap: gapRationale ?? null });
      toast(`${GATE_LABEL[form.gate]} ${form.decision.toUpperCase()} 결정을 기록했습니다.`);
      setForm((f) => ({ ...f, rationale: "", missing: "", learning: "" }));
      setJudgementChecks({});
      load();
      onRecorded?.(form.decision, form.gate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "의사결정 기록 실패");
    } finally {
      setSaving(false);
    }
  }

  const panelKey = gates.length === 1 ? gates[0] : gates.join(",");
  const nextGate = seq && recorded ? gates[gates.indexOf(recorded.gate) + 1] : undefined;
  // Sequence mode: an entity-level GO keeps the form open (now targeting the next committee) instead of collapsing it.
  const summaryOnly = !!recorded && recorded.decision !== "hold" && !(seq && recorded.decision === "go" && nextGate);
  return (
    <section aria-label="의사결정" className="market-section sizing-step" data-gate-form={panelKey.replace(/,/g, " ")} id={`gate-decision-${panelKey.replace(/,/g, "-")}`} tabIndex={-1}>
      <h3 className="sizing-step-title text-[length:var(--fs-body)]">
        <span className="sizing-step-badge">🚦</span> 의사결정 — 승인 기록 (경계 #2)
      </h3>
      <p className="mb-2 text-[color:var(--muted-fg)] text-[length:var(--fs-caption)]">
        에이전트 권고와 무관하게 GO·HOLD·KILL은 검토자가 기록합니다. HOLD는 미완료 산출물 목록 없이 기록할 수 없습니다.
      </p>
      {killHint && (
        <p className="sizing-note-list mb-2 text-[length:var(--fs-caption)] text-[color:var(--red-fg)]" role="note">⛔ {killHint}</p>
      )}
      {seq && (
        <ol className="mb-3 flex flex-wrap items-center gap-2 list-none p-0 text-[length:var(--fs-caption)]" aria-label="투자심의 진행 순서">
          {gates.map((g, i) => {
            const st = gateState(latest, g);
            return (
              <li key={g} className="flex items-center gap-2" aria-current={g === turn && st !== "go" ? "step" : undefined}>
                {i > 0 && <span aria-hidden="true">→</span>}
                <span className="font-semibold">{"①②③④"[i]} {IC_STEP_LABEL[g as keyof typeof IC_STEP_LABEL] ?? GATE_LABEL[g as GateMetaId]}</span>
                <span className={`status-chip ${st === "go" ? "status-green" : st === "hold" ? "status-amber" : st === "kill" ? "status-red" : "status-not-started"}`}>{GATE_STATE_LABEL[st]}</span>
                {g === turn && st !== "go" && <span className="text-[color:var(--muted-fg)]">지금 차례</span>}
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
              <span className="font-semibold">{GATE_LABEL[g]} 현재 결정:</span>
              {d ? (
                <span className={`status-chip ${d.decision === "go" ? "status-green" : d.decision === "hold" ? "status-amber" : "status-red"}`}>
                  {d.decision.toUpperCase()}
                </span>
              ) : (
                <span className="status-chip status-not-started">미결정</span>
              )}
              {d?.missing_artifacts && d.missing_artifacts.length > 0 && (
                <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={d.missing_artifacts.join(", ")}>
                  미완료 {d.missing_artifacts.length}건
                </span>
              )}
              {d?.rationale && <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">— {d.rationale}</span>}
            </p>
          );
        })()
      ) : (
        <table className="data-table" aria-label="진행별 현재 결정">
          <caption className="sr-only">진행별 현재 결정</caption>
          <thead>
            <tr><th scope="col" className="w-[9rem]">진행</th><th scope="col" className="w-[7rem]">결정</th><th scope="col">근거</th></tr>
          </thead>
          <tbody>
            {gates.map((g) => {
              const d = decisionOf(g);
              return (
                <tr key={g}>
                  <td className="font-semibold">{labelOf(g)}</td>
                  <td>
                    {d ? (
                      <span className={`status-chip ${d.decision === "go" ? "status-green" : d.decision === "hold" ? "status-amber" : "status-red"}`}>
                        {d.decision.toUpperCase()}
                      </span>
                    ) : (
                      <span className="status-chip status-not-started">미결정</span>
                    )}
                    {d?.missing_artifacts && d.missing_artifacts.length > 0 && (
                      <span className="block text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" title={d.missing_artifacts.join(", ")}>
                        미완료 {d.missing_artifacts.length}건
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

      {/* ADR-0153 — 3단계 검토(확인됨 / 확인하지 못함 / 판단 필요). PASS 표시 없음.
          ADR-0182 §5 — 판단 필요 항목에 "사람 확인" 체크(결정 POST에 동봉)와
          결정 폼으로의 이동 링크를 심는다. */}
      {showReview && (
        <ReviewBuckets
          entityType={entityType}
          entityId={opportunityId}
          gates={gates}
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
        <div className="mt-3 border border-[color:var(--border)] rounded-lg px-3 py-2" aria-label="AI 진행 브리프">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost btn-sm" disabled={briefLoading} onClick={() => void generateBrief()}>
              {briefLoading ? "생성 중..." : briefData ? "재생성" : "🤖 AI 브리프 생성"}
            </button>
            <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
              {GATE_LABEL[form.gate] ?? form.gate} 진행 기준 — 제안은 결정 선택을 바꾸지 않으며, 기록은 사람이 합니다 (경계 #2)
            </span>
          </div>
          {briefError && <p role="alert" className="text-[length:var(--fs-caption)] text-[color:var(--red-fg)] mt-1 mb-0">{briefError}</p>}
          {briefData && <GateBriefBody briefData={briefData} currentGate={form.gate} onApply={applyBriefRationale} />}
          {!briefData && !briefLoading && !briefError && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-1 mb-0">AI가 진행 산출물을 근거로 권고와 근거 초안을 작성해 줍니다 — 기록은 사람의 몫입니다.</p>
          )}
        </div>
      )}

      {canRecord && recorded && recorded.decision !== "hold" && (!summaryOnly && !!nextGate) && (
        <div className="gate-recorded" role="status" aria-label="기록된 결정">
          <p className="mb-1">
            <span className="status-chip status-green">● {labelOf(recorded.gate)} GO 기록됨</span>
            <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums">{recorded.at.slice(0, 16).replace("T", " ")}</span>
          </p>
          <p className="text-[length:var(--fs-caption)] mb-1">근거: {recorded.rationale}</p>
          {recorded.gap && <p className="text-[length:var(--fs-caption)] mb-1">누락 산출물 예외 근거: {recorded.gap}</p>}
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-2">다음 차례: {labelOf(nextGate!)} 결정을 아래에 기록하세요.</p>
        </div>
      )}
      {canRecord && summaryOnly ? (
        <div className="gate-recorded" role="status" aria-label="기록된 결정">
          <p className="mb-1">
            <span className={`status-chip ${recorded.decision === "go" ? "status-green" : "status-red"}`}>● {labelOf(recorded.gate)} {recorded.decision.toUpperCase()} 기록됨</span>
            <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] tabular-nums">{recorded.at.slice(0, 16).replace("T", " ")}</span>
          </p>
          <p className="text-[length:var(--fs-caption)] mb-1">근거: {recorded.rationale}</p>
          {recorded.gap && <p className="text-[length:var(--fs-caption)] mb-1">누락 산출물 예외 근거: {recorded.gap}</p>}
          <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mb-1">같은 결정을 다시 제출할 수 없습니다. 정정이 필요하면 페이지를 다시 열어 새 결정을 기록하세요(이력은 append-only).</p>
          {recorded.decision === "go" && nextStage && !nextGate && (nextStage.href.startsWith("#") ? (
            <a className="btn-ghost btn-sm" href={nextStage.href} onClick={(e) => { e.preventDefault(); focusGateDecision(nextStage.href.slice(1).replace("gate-decision-", "")); }}>다음: {nextStage.label} →</a>
          ) : (
            <Link className="btn-ghost btn-sm" href={nextStage.href}>다음: {nextStage.label} →</Link>
          ))}
          {recorded.decision === "kill" && <p className="text-[length:var(--fs-caption)] mb-0">프로젝트 종료 절차는 S12 사후 관리에서 이어집니다.</p>}
        </div>
      ) : canRecord ? (
        <form
          id={formId}
          className="sizing-new-form"
          aria-label="의사결정 기록"
          onSubmit={(e) => { e.preventDefault(); requestRecord(); }}
        >
          {seq && (
            <p className="mb-2 text-[length:var(--fs-body)]" data-testid="gate-target">
              <span className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mr-2">기록 대상</span>
              <strong>{"①②③④"[gates.indexOf(form.gate)]} {labelOf(form.gate)}</strong>
              {form.gate === turn && gateState(latest, form.gate) !== "go" && <span className="ml-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">지금 차례</span>}
            </p>
          )}
          {lockedReason && <p className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]" role="note">{lockedReason}</p>}
          <div className="flex flex-wrap items-end gap-2">
            {gates.length > 1 && (
              <label className="text-[length:var(--fs-caption)]">
                <span className="block mb-1">{seq ? "다른 위원회로 변경" : "진행"}</span>
                <select
                  value={form.gate}
                  onChange={(e) => { gatePicked.current = true; setForm({ ...form, gate: e.target.value as GateMetaId }); }}
                  className="sizing-new-input sizing-new-input-sm"
                >
                  {gates.map((g) => <option key={g} value={g} disabled={seq && !!gateLockedReason(gates, g, latest, IC_STEP_LABEL)}>{labelOf(g)}</option>)}
                </select>
              </label>
            )}
            <label className="text-[length:var(--fs-caption)]">
              <span className="block mb-1">결정</span>
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
              <span className="block mb-1">근거 *</span>
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
              <span className="block mb-1">미완료 산출물 (HOLD 필수 — 쉼표·줄바꿈 구분)</span>
              <textarea
                value={form.missing}
                onChange={(e) => setForm({ ...form, missing: e.target.value })}
                className="sizing-new-input w-full"
                rows={2}
                placeholder="예: 5-criteria 점수, 사전배제 확인"
              />
            </label>
          )}
          {form.decision === "kill" && (
            <label className="block mt-2 text-[length:var(--fs-caption)]">
              <span className="block mb-1">학습 포착 * (KILL 필수 — 이 중단에서 얻은 교훈)</span>
              <textarea
                value={form.learning}
                onChange={(e) => setForm({ ...form, learning: e.target.value })}
                className="sizing-new-input w-full"
                rows={2}
                required
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button type="submit" className="btn-ghost btn-sm" disabled={saving || !!submitReason} aria-describedby={submitReason ? `${formId}-reason` : undefined}>
              {saving ? "기록 중..." : "결정"}
            </button>
            {submitReason && <span id={`${formId}-reason`} className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">{submitReason}</span>}
          </div>
          {recorded && recorded.decision === "hold" && (
            <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)] mt-2 mb-0" role="status">
              ● {GATE_LABEL[recorded.gate]} HOLD 기록됨 - 미완료 산출물을 보완한 뒤 새 결정을 기록할 수 있습니다.
            </p>
          )}
        </form>
      ) : (
        <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">결정 기록은 analyst 역할 이상만 가능합니다.</p>
      )}
      {confirmDialog}
      {gapAsk && (
        <GapDialog
          gateLabel={GATE_LABEL[form.gate]}
          gaps={gapsForGo}
          onCancel={() => setGapAsk(false)}
          onSubmit={(text) => { setGapAsk(false); void record(text); }}
        />
      )}

      {error && <p role="alert" className="text-[color:var(--red-fg)] text-[length:var(--fs-caption)]">{error}</p>}

      {history.length > 0 && seq && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">결정 이력 ({history.length}건 — append-only, 위원회별)</summary>
          {gates.map((g) => {
            const rows = history.filter((h) => h.gate === g);
            return (
              <div key={g} className="mt-2">
                <h4 className="text-[length:var(--fs-body)] mb-1">{labelOf(g)} ({rows.length}건)</h4>
                {rows.length === 0 ? (
                  <p className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">기록된 결정이 없습니다.</p>
                ) : (
                  <table className="data-table" aria-label={`${labelOf(g)} 결정 이력`}>
                    <caption className="sr-only">{labelOf(g)} 결정 이력</caption>
                    <thead>
                      <tr><th scope="col">결정</th><th scope="col">근거</th><th scope="col">기록자</th><th scope="col">일시</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((h) => (
                        <tr key={h.id}>
                          <td><span className={`status-chip ${h.decision === "go" ? "status-green" : h.decision === "hold" ? "status-amber" : "status-red"}`}>{h.decision.toUpperCase()}</span></td>
                          <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                            {h.rationale}
                            {h.gap_override && <span className="block">누락 산출물 예외 근거: {h.gap_override.rationale} (누락: {h.gap_override.items.join("; ")})</span>}
                            {!!h.judgement_confirmations?.length && <span className="block"><span className="status-chip status-in-progress">사람 확인 {h.judgement_confirmations.length}건</span></span>}
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
          <summary className="cursor-pointer text-[length:var(--fs-caption)] text-[color:var(--accent)]">결정 이력 ({history.length}건 — append-only)</summary>
          <table className="data-table mt-2" aria-label="의사결정 이력">
            <caption className="sr-only">의사결정 이력</caption>
            <thead>
              <tr><th scope="col">진행</th><th scope="col">결정</th><th scope="col">근거</th><th scope="col">기록자</th><th scope="col">일시</th></tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{GATE_LABEL[h.gate as GateMetaId] ?? h.gate}</td>
                  <td><span className={`status-chip ${h.decision === "go" ? "status-green" : h.decision === "hold" ? "status-amber" : "status-red"}`}>{h.decision.toUpperCase()}</span></td>
                  <td className="text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
                    {h.rationale}
                    {h.gap_override && <span className="block">누락 산출물 예외 근거: {h.gap_override.rationale} (누락: {h.gap_override.items.join("; ")})</span>}
                    {!!h.judgement_confirmations?.length && <span className="block"><span className="status-chip status-in-progress">사람 확인 {h.judgement_confirmations.length}건</span></span>}
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
