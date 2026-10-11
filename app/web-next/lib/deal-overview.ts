// Deal overview data model (design 2026-10-11-deal-overview-and-s3-deal-scope).
// Pure and client-safe: no DB. The page passes already-fetched process/opportunity data.
import { dealStageHref, OPPORTUNITY_STATUS_STAGE } from "./deal-links.ts";
import { gateHoldHref, type HoldSrc } from "./inbox.ts";
import { displayOrNotRecorded, GATE_LABEL, DECISION_LABEL, localizeRequirement, trackLabel } from "./labels.ts";
import { STAGE_META, type StageMetaId } from "./stage-meta.ts";

export interface OverviewOpportunity {
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
}

export type OverviewHold = Pick<HoldSrc, "entityType" | "entityId" | "gate">;

export interface CompletionItem {
  label: string;
  done: boolean;
}

export interface KeyFact {
  key: "attractiveness" | "synergy" | "track";
  value: { text: string; empty: boolean };
  note: string | null;
}

export interface DealOverview {
  currentStage: { id: string; name: string; objective: string } | null;
  /** Input/Output strip: previous -> current -> next stage names (null side = none). */
  flow: { previous: string | null; current: string | null; next: string | null };
  /** Exactly one primary action, or null with a status sentence in `statusText`. */
  nextAction: { labelKey: "go_to_stage"; href: string } | null;
  statusText: string | null;
  completion: CompletionItem[];
  /** Blockers that match no required artifact. */
  otherBlockers: string[];
  facts: KeyFact[];
  gates: Array<{ gate: string; gateLabel: string; decision: string; decisionLabel: string }>;
  holds: Array<{ gate: string; gateLabel: string; href: string }>;
}

export const NEXT_ACTION_LABEL = "단계 화면으로 이동";
export const SYNERGY_UNCONFIRMED_NOTE = "추천값, 미확정";

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

export function buildDealOverview(
  dealId: string,
  opp: OverviewOpportunity,
  proc: OverviewProcess,
  holds: readonly OverviewHold[] = [],
): DealOverview {
  const stageId = resolveStage(opp, proc);
  const meta = STAGE_META.find((s) => s.id === stageId) ?? null;
  const prev = meta && meta.sequence > 1 ? STAGE_META[meta.sequence - 2]!.name : null;
  const nextId: string | null = proc.nextStage ?? (meta && meta.onComplete !== "terminal" ? meta.onComplete : null);

  const completion = proc.requiredArtifacts.map((a) => ({ label: localizeRequirement(a), done: isArtifactDone(a, proc.blockers) }));
  const otherBlockers = proc.blockers
    .filter((b) => proc.requiredArtifacts.every((a) => isArtifactDone(a, [b])))
    .map(localizeRequirement);

  let nextAction: DealOverview["nextAction"] = null;
  let statusText: string | null = null;
  if (proc.terminated) statusText = "종료된 딜입니다";
  else if (!stageId) statusText = "진행할 단계가 없습니다";
  else nextAction = { labelKey: "go_to_stage", href: dealStageHref(dealId, stageId) };

  const synergyConfirmed = !!opp.synergy_score_confirmed_at;
  const facts: KeyFact[] = [
    { key: "attractiveness", value: displayOrNotRecorded(opp.attractiveness_score), note: null },
    { key: "synergy", value: displayOrNotRecorded(opp.synergy_score), note: opp.synergy_score != null && !synergyConfirmed ? SYNERGY_UNCONFIRMED_NOTE : null },
    { key: "track", value: displayOrNotRecorded(proc.track ? trackLabel(proc.track, proc.subTrack ?? null) : null), note: null },
  ];

  return {
    currentStage: meta ? { id: meta.id, name: meta.name, objective: meta.objective } : null,
    flow: { previous: prev, current: meta?.name ?? null, next: stageName(nextId) },
    nextAction,
    statusText,
    completion,
    otherBlockers,
    facts,
    gates: Object.entries(proc.gateStatus ?? {}).map(([gate, decision]) => ({
      gate,
      gateLabel: GATE_LABEL[gate] ?? gate,
      decision,
      decisionLabel: DECISION_LABEL[decision] ?? decision,
    })),
    holds: holds.map((h) => ({ gate: h.gate, gateLabel: GATE_LABEL[h.gate] ?? h.gate, href: gateHoldHref(h) })),
  };
}

export type { StageMetaId };
