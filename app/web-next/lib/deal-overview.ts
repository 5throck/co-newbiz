// Deal overview data model (design 2026-10-11-deal-overview-and-s3-deal-scope).
// Pure and client-safe: no DB. The page passes already-fetched process/opportunity data.
import { dealStageHref, OPPORTUNITY_STATUS_STAGE } from "./deal-links.ts";
import { ageInDays, gateHoldHref, type HoldSrc } from "./inbox.ts";
import { displayOrNotRecorded, GATE_LABEL, DECISION_LABEL, localizeRequirement, trackLabel } from "./labels.ts";
import { STAGE_META, type StageMetaId } from "./stage-meta.ts";

export interface OverviewOpportunity {
  /** Opportunity name (GET /api/opportunities/{id} returns it via SELECT *). */
  name?: string | null;
  status: string | null;
  attractiveness_score: number | null;
  synergy_score: number | null;
  synergy_score_confirmed_at?: string | null;
}

export interface OverviewProcess {
  currentStage: string | null;
  nextStage?: string | null;
  blockers: string[];
  requiredArtifacts: string[];
  gateStatus?: Record<string, string>;
  track: string | null;
  subTrack?: string | null;
  terminated?: boolean;
  /** Project carrier name (GET /api/projects/{id}/process `project.project_name`); wins over the opportunity name. */
  projectName?: string | null;
  /** Linked project id (opportunity process `projectId`), for the optional "project" fact. */
  projectId?: string | null;
  /** Engine marker (ADR-0095): the S1–S7 carrier scope is complete/skipped and the deal awaits promotion. */
  carrierScopeFinished?: boolean;
  /** Process response stages; `requiredArtifacts` feeds the previous/next flow artifact lists. */
  stages?: Array<{ id: string; requiredArtifacts?: string[] }>;
}

/** `decidedAt` (ISO) is the hold decision timestamp; the page takes it from the gate-decisions list. */
export type OverviewHold = Pick<HoldSrc, "entityType" | "entityId" | "gate"> & { decidedAt?: string | null };

export interface CompletionItem {
  label: string;
  done: boolean;
  /** True for the first not-done item only. */
  isNext: boolean;
}

export type FactState = "value" | "pending" | "missing" | "none";

export interface KeyFact {
  key: "attractiveness" | "synergy" | "track" | "gate" | "project";
  value: { text: string; empty: boolean };
  note: string | null;
  state: FactState;
  /** Where the value is recorded / decided (missing, none) or the target (project). */
  href?: string;
  /** For `pending`: the stage at which the value becomes applicable. */
  applicableFromStage?: StageMetaId;
}

export interface FlowEntry {
  id: string;
  name: string;
  /** Stage required artifacts; empty when the process response carried no metadata. */
  artifacts: string[];
}

export type NextActionType = "record_artifact" | "request_gate_decision" | "advance_stage" | "resolve_hold";
export type NextActionReason =
  | { type: "artifact_missing"; stageId: string; stageName: string; done: number; total: number }
  | { type: "gate_pending"; gate: string; gateLabel: string; stageId: string }
  | { type: "stage_complete"; stageId: string; stageName: string }
  | { type: "hold"; gate: string; gateLabel: string; heldSince: string | null; ageDays: number | null };

export interface NextAction {
  type: NextActionType;
  /** What the action is about: the artifact label, gate label or next stage name. */
  subject: string;
  reason: NextActionReason;
  href: string;
  /** Name of the stage or gate the button leads to. */
  buttonTarget: string;
}

export interface DealOverview {
  identity: { name: string; statusLabel: string | null; stage: { id: string; name: string } | null; terminated: boolean };
  currentStage: { id: string; name: string; objective: string } | null;
  /** Input/Output strip around the current stage (null side = none). */
  flow: { previous: FlowEntry | null; current: string | null; next: FlowEntry | null };
  /** Exactly one primary action, or null with a status sentence in `statusText`. */
  nextAction: NextAction | null;
  statusText: string | null;
  completion: CompletionItem[];
  completionCounts: { done: number; total: number };
  /** Blockers that match no required artifact. */
  otherBlockers: string[];
  facts: KeyFact[];
  /** The next applicable gate without a GO yet (also shown as the "gate" fact). */
  nextGate: { gate: string; gateLabel: string; href: string } | null;
  gates: Array<{ gate: string; gateLabel: string; decision: string; decisionLabel: string }>;
  holds: Array<{ gate: string; gateLabel: string; href: string; heldSince: string | null; ageDays: number | null }>;
}

export const NEXT_ACTION_LABEL = "단계 화면으로 이동";
export const SYNERGY_UNCONFIRMED_NOTE = "추천값, 미확정";
// INTERIM-WORDING: new copy for pending/none fact states and the status chip; reuse existing vocabulary once product confirms (design O-1).
export const FACT_PENDING_NOTE = "단계 진행 후 결정";
export const FACT_NONE_NOTE = "결정 없음";
export const PROJECT_FACT_FALLBACK = "추진 프로젝트";
export const OPPORTUNITY_STATUS_LABEL: Record<string, string> = {
  identified: "발굴", // INTERIM-WORDING
  assessed: "평가", // INTERIM-WORDING
  selected: "선정", // INTERIM-WORDING
  dropped: "제외", // INTERIM-WORDING
};

const stageName = (id: string | null | undefined): string | null =>
  STAGE_META.find((s) => s.id === id)?.name ?? null;

/** Stage the deal sits at: process stage first, else the status convention (identified=S2 ...). */
function resolveStage(opp: OverviewOpportunity, proc: OverviewProcess): string | null {
  return proc.currentStage ?? (opp.status ? OPPORTUNITY_STATUS_STAGE[opp.status] ?? null : null);
}

/** An artifact is not done while a blocker names it (either text contains the other). */
export function isArtifactDone(artifact: string, blockers: readonly string[]): boolean {
  const a = localizeRequirement(artifact);
  return !blockers.some((b) => {
    const lb = localizeRequirement(b);
    return lb === a || lb.includes(a) || a.includes(lb);
  });
}

function flowEntry(proc: OverviewProcess, id: string | null | undefined): FlowEntry | null {
  const name = stageName(id);
  if (!id || !name) return null;
  const artifacts = proc.stages?.find((s) => s.id === id)?.requiredArtifacts ?? [];
  return { id, name, artifacts: artifacts.map(localizeRequirement) };
}

function heldAge(decidedAt: string | null | undefined, now: number): { heldSince: string | null; ageDays: number | null } {
  if (!decidedAt || Number.isNaN(Date.parse(decidedAt))) return { heldSince: null, ageDays: null };
  return { heldSince: decidedAt, ageDays: ageInDays(decidedAt, now) };
}

/** First gate from the current stage onward (track-filtered once the track is known) that has no GO yet. */
function findNextGate(stageId: string | null, track: string | null, gateStatus: Record<string, string>): string | null {
  const from = STAGE_META.find((s) => s.id === stageId)?.sequence ?? 1;
  for (const s of STAGE_META) {
    if (s.sequence < from) continue;
    if (track && !s.applicableTracks.includes(track as "greenfield" | "brownfield")) continue;
    for (const g of s.gateIds) if (gateStatus[g] !== "go") return g;
  }
  return null;
}

export function buildDealOverview(
  dealId: string,
  opp: OverviewOpportunity,
  proc: OverviewProcess,
  holds: readonly OverviewHold[] = [],
  now: number = Date.now(),
): DealOverview {
  const stageId = resolveStage(opp, proc);
  const meta = STAGE_META.find((s) => s.id === stageId) ?? null;
  const prevId = meta && meta.sequence > 1 ? STAGE_META[meta.sequence - 2]!.id : null;
  const nextId: string | null = proc.nextStage ?? (meta && meta.onComplete !== "terminal" ? meta.onComplete : null);
  const gateStatus = proc.gateStatus ?? {};
  // Track-aware gate links (T-20261022-002): a brownfield pre_fs decision lives
  // on the S4 committee tab, greenfield on S5; unknown track keeps the S5 default.
  const gateHref = (gate: string) => gateHoldHref({ entityType: "opportunity", entityId: dealId, gate, track: proc.track });

  const base = proc.requiredArtifacts.map((a) => ({ label: localizeRequirement(a), done: isArtifactDone(a, proc.blockers) }));
  const firstOpen = base.findIndex((c) => !c.done);
  const completion: CompletionItem[] = base.map((c, i) => ({ ...c, isNext: i === firstOpen }));
  const completionCounts = { done: base.filter((c) => c.done).length, total: base.length };
  const otherBlockers = proc.blockers
    .filter((b) => proc.requiredArtifacts.every((a) => isArtifactDone(a, [b])))
    .map(localizeRequirement);

  const holdRows = holds.map((h) => ({
    gate: h.gate,
    gateLabel: GATE_LABEL[h.gate] ?? h.gate,
    href: gateHoldHref({ ...h, track: proc.track }),
    ...heldAge(h.decidedAt, now),
  }));

  const nextGateId = findNextGate(stageId, proc.track, gateStatus);
  const nextGate = nextGateId ? { gate: nextGateId, gateLabel: GATE_LABEL[nextGateId] ?? nextGateId, href: gateHref(nextGateId) } : null;

  let nextAction: NextAction | null = null;
  let statusText: string | null = null;
  if (proc.terminated) statusText = "종료된 딜입니다";
  else if (!stageId || !meta) statusText = "진행할 단계가 없습니다";
  else {
    const stageHref = dealStageHref(dealId, stageId);
    const hold = holdRows[0];
    const stageGate = meta.gateIds.find((g) => gateStatus[g] !== "go");
    if (hold) {
      nextAction = { type: "resolve_hold", subject: hold.gateLabel, reason: { type: "hold", gate: hold.gate, gateLabel: hold.gateLabel, heldSince: hold.heldSince, ageDays: hold.ageDays }, href: hold.href, buttonTarget: hold.gateLabel };
    } else if (proc.carrierScopeFinished) {
      // Review 2026-10-22 (journey F2): the S1–S7 scope is done — the next action
      // is PROMOTION, not the S8 artifact checklist or the fs gate (both belong to
      // the project carrier, unreachable before promotion). The engine's
      // opportunity-branch currentStage reads S8 here; the CTA must lead to the
      // track-final stage page that hosts PromotionPanel. Checked before
      // firstOpen because the engine reports S8's own artifacts as missing for a
      // finished but un-promoted carrier.
      const handoffStage = proc.track === "brownfield" ? "S7" : "S5";
      nextAction = { type: "advance_stage", subject: "프로젝트로 추진", reason: { type: "stage_complete", stageId, stageName: meta.name }, href: dealStageHref(dealId, handoffStage), buttonTarget: "프로젝트로 추진 (승격)" };
    } else if (firstOpen >= 0) {
      nextAction = { type: "record_artifact", subject: base[firstOpen]!.label, reason: { type: "artifact_missing", stageId, stageName: meta.name, done: completionCounts.done, total: completionCounts.total }, href: stageHref, buttonTarget: `${meta.id} ${meta.name}` };
    } else if (stageGate) {
      const label = GATE_LABEL[stageGate] ?? stageGate;
      nextAction = { type: "request_gate_decision", subject: label, reason: { type: "gate_pending", gate: stageGate, gateLabel: label, stageId }, href: gateHref(stageGate), buttonTarget: label };
    } else {
      const target = flowEntry(proc, nextId);
      nextAction = { type: "advance_stage", subject: target?.name ?? meta.name, reason: { type: "stage_complete", stageId, stageName: meta.name }, href: target ? dealStageHref(dealId, target.id) : stageHref, buttonTarget: target ? `${target.id} ${target.name}` : `${meta.id} ${meta.name}` };
    }
  }

  // Facts. A value recorded in a later stage than the current one is "pending", not "missing".
  const seq = meta?.sequence ?? 0;
  const pendingBefore = (from: StageMetaId): StageMetaId | undefined => (seq > 0 && seq < STAGE_META.find((s) => s.id === from)!.sequence ? from : undefined);
  const scoreFact = (key: "attractiveness" | "synergy", v: number | null, recordedAt: StageMetaId, note: string | null): KeyFact => {
    const shown = displayOrNotRecorded(v);
    if (!shown.empty) return { key, value: shown, note, state: "value" };
    const from = pendingBefore(recordedAt);
    return from
      ? { key, value: { text: FACT_PENDING_NOTE, empty: true }, note: null, state: "pending", applicableFromStage: from }
      : { key, value: shown, note: null, state: "missing", href: dealStageHref(dealId, recordedAt) };
  };
  const synergyConfirmed = !!opp.synergy_score_confirmed_at;
  const trackShown = displayOrNotRecorded(proc.track ? trackLabel(proc.track, proc.subTrack ?? null) : null);
  const trackFromStage = pendingBefore("S4");
  const facts: KeyFact[] = [
    scoreFact("attractiveness", opp.attractiveness_score, "S2", null),
    scoreFact("synergy", opp.synergy_score, "S3", opp.synergy_score != null && !synergyConfirmed ? SYNERGY_UNCONFIRMED_NOTE : null),
    !trackShown.empty
      ? { key: "track", value: trackShown, note: null, state: "value" }
      : trackFromStage
        ? { key: "track", value: { text: FACT_PENDING_NOTE, empty: true }, note: null, state: "pending", applicableFromStage: trackFromStage }
        : { key: "track", value: trackShown, note: null, state: "missing", href: dealStageHref(dealId, "S4") },
  ];
  if (nextGate) {
    const decided = gateStatus[nextGate.gate];
    facts.push(decided
      ? { key: "gate", value: { text: `${nextGate.gateLabel} · ${DECISION_LABEL[decided] ?? decided}`, empty: false }, note: null, state: "value", href: nextGate.href }
      : { key: "gate", value: { text: nextGate.gateLabel, empty: false }, note: FACT_NONE_NOTE, state: "none", href: nextGate.href });
  }
  if (proc.projectId && proc.projectId !== dealId) {
    facts.push({ key: "project", value: { text: proc.projectName ?? PROJECT_FACT_FALLBACK, empty: false }, note: null, state: "value", href: `/deals/${encodeURIComponent(proc.projectId)}` });
  }

  const name = proc.projectName?.trim() || opp.name?.trim() || "";
  return {
    identity: {
      name: name || displayOrNotRecorded(null).text,
      statusLabel: opp.status ? OPPORTUNITY_STATUS_LABEL[opp.status] ?? null : null,
      stage: meta ? { id: meta.id, name: meta.name } : null,
      terminated: !!proc.terminated,
    },
    currentStage: meta ? { id: meta.id, name: meta.name, objective: meta.objective } : null,
    flow: { previous: flowEntry(proc, prevId), current: meta?.name ?? null, next: flowEntry(proc, nextId) },
    nextAction,
    statusText,
    completion,
    completionCounts,
    otherBlockers,
    facts,
    nextGate,
    gates: Object.entries(gateStatus).map(([gate, decision]) => ({
      gate,
      gateLabel: GATE_LABEL[gate] ?? gate,
      decision,
      decisionLabel: DECISION_LABEL[decision] ?? decision,
    })),
    holds: holdRows,
  };
}

export type { StageMetaId };
