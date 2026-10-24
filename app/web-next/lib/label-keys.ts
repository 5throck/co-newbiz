// i18n (design 2026-10-23-i18n-ui-adoption): catalog-key pins for the shared gate /
// decision vocabulary that lib/labels.ts used to carry as Korean strings. Every map
// here stores a `common.*` catalog key; render sites resolve it with the ROOT
// translator (`useTranslations()` / `getTranslations()`), the same pattern as
// lib/inbox.ts KIND_LABEL_KEY. Client-safe: no imports.
//
// ko wordings are byte-identical to the lib/labels.ts values they replace (glossary
// terms: Pre-FS = 예비타당성 검토, Entity/Group IC = 법인/그룹 투자심의위원회).

/** Gate display names — gate id -> `common.gate.*`. `transition` is the S12 review pseudo-gate (not a flow.spec gate). */
export const GATE_LABEL_KEY: Record<string, string> = {
  screening: "common.gate.screening",
  pre_fs: "common.gate.pre_fs",
  target_screening: "common.gate.target_screening",
  fs: "common.gate.fs",
  dd: "common.gate.dd",
  entity_ic: "common.gate.entity_ic",
  group_ic: "common.gate.group_ic",
  transition: "common.gate.transition",
};

/** Gate decision display names — decision id -> `common.decisionLabel.*`. */
export const DECISION_LABEL_KEY: Record<string, string> = {
  go: "common.decisionLabel.go",
  hold: "common.decisionLabel.hold",
  kill: "common.decisionLabel.kill",
  pending: "common.decisionLabel.pending",
};

/** Committee decision mode display names — mode id -> `common.decisionMode.*`. */
export const DECISION_MODE_LABEL_KEY: Record<string, string> = {
  agent_team: "common.decisionMode.agent_team",
  hybrid: "common.decisionMode.hybrid",
  human_only: "common.decisionMode.human_only",
};

/** Stage status display names — status id -> `common.*` (reuses common.done / common.inProgress where the wording matches). */
export const STAGE_STATUS_KEY: Record<string, string> = {
  complete: "common.done",
  completed: "common.done",
  current: "common.inProgress",
  in_progress: "common.inProgress",
  blocked: "common.stageStatus.blocked",
  locked: "common.stageStatus.waiting",
  pending: "common.stageStatus.waiting",
  skipped: "common.stageStatus.skipped",
  terminated: "common.stageStatus.terminated",
};

/** DD domain / DD finding category display names — domain id -> `common.ddDomain.*` (rbd is a finding-only category, db migration 0019). */
export const DD_DOMAIN_KEY: Record<string, string> = {
  commercial: "common.ddDomain.commercial",
  technical: "common.ddDomain.technical",
  legal: "common.ddDomain.legal",
  financial: "common.ddDomain.financial",
  hr: "common.ddDomain.hr",
  market: "common.ddDomain.market",
  financing: "common.ddDomain.financing",
  rbd: "common.ddDomain.rbd",
};

/** RAG dimension display names (packages/core-scoring canonical order) — dimension id -> `common.ragDimension.*`. */
export const RAG_DIMENSION_ORDER = [
  "financial",
  "market",
  "data_confidence",
  "regulatory_permit",
  "technical_execution",
  "risk",
] as const;
export const RAG_DIMENSION_KEY: Record<string, string> = {
  financial: "common.ragDimension.financial",
  market: "common.ragDimension.market",
  data_confidence: "common.ragDimension.data_confidence",
  regulatory_permit: "common.ragDimension.regulatory_permit",
  technical_execution: "common.ragDimension.technical_execution",
  risk: "common.ragDimension.risk",
};

/** S12 transition decisions (flow.spec v2.0.0 vocabulary of five) — decision id -> `common.transitionDecision.*`. */
export const TRANSITION_DECISION_KEY: Record<string, string> = {
  next_tranche_released: "common.transitionDecision.next_tranche_released",
  held_evidence_incomplete: "common.transitionDecision.held_evidence_incomplete",
  graduate_to_core: "common.transitionDecision.graduate_to_core",
  reduce_or_divest: "common.transitionDecision.reduce_or_divest",
  kill_with_learning_captured: "common.transitionDecision.kill_with_learning_captured",
};

/** Greenfield-facing help for the five transition terms — resolved next to the term name. */
export const TRANSITION_HELP_KEY: Record<string, string> = {
  next_tranche_released: "common.transitionHelp.next_tranche_released",
  held_evidence_incomplete: "common.transitionHelp.held_evidence_incomplete",
  graduate_to_core: "common.transitionHelp.graduate_to_core",
  reduce_or_divest: "common.transitionHelp.reduce_or_divest",
  kill_with_learning_captured: "common.transitionHelp.kill_with_learning_captured",
};

/** venture_scorecard.venture_class — class id -> `common.ventureClass.*`. */
export const VENTURE_CLASS_KEY: Record<string, string> = {
  driving: "common.ventureClass.driving",
  enabling: "common.ventureClass.enabling",
  emergent: "common.ventureClass.emergent",
};

/** Closure type (ADR-0152 md_project.closure_type) — type id -> `common.closureType.*`. */
export const CLOSURE_TYPE_KEY: Record<string, string> = {
  killed_at_gate: "common.closureType.killed_at_gate",
  withdrawn: "common.closureType.withdrawn",
  graduated_to_core: "common.closureType.graduated_to_core",
  divested: "common.closureType.divested",
  killed_with_learning: "common.closureType.killed_with_learning",
  dropped: "common.closureType.dropped",
};

/** Record / field keys that leak into prose (PortfolioStage, DealStructureStage, process page). */
export const RECORD_KEY: Record<string, string> = {
  venture_transition_decision: "common.recordKey.venture_transition_decision",
  decided_by: "common.recordKey.decided_by",
  learning_capture: "common.recordKey.learning_capture",
  tranche_condition: "common.recordKey.tranche_condition",
  core_handoff: "common.recordKey.core_handoff",
  divest_plan: "common.recordKey.divest_plan",
  deal_structure: "common.recordKey.deal_structure",
  deal_structure_review: "common.recordKey.deal_structure_review",
};

/**
 * Closure precondition record keys (db/repositories/closure.repository.ts) shown in the closure
 * modal — slug -> `{ label, message }` catalog keys. Parameterized keys (e.g.
 * `venture_transition_decision(reduce_or_divest)`) fall back to their base record at lookup.
 */
export const CLOSURE_RECORD_KEY: Record<string, { label: string; message: string }> = {
  "gate_decision(kill)": {
    label: "common.closureRecord.gateDecisionKill.label",
    message: "common.closureRecord.gateDecisionKill.message",
  },
  "gate_decision.decided_by": {
    label: "common.closureRecord.gateDecisionDecidedBy.label",
    message: "common.closureRecord.gateDecisionDecidedBy.message",
  },
  "gate_decision.learning_capture": {
    label: "common.closureRecord.gateDecisionLearningCapture.label",
    message: "common.closureRecord.gateDecisionLearningCapture.message",
  },
  "gate_decision(hold)": {
    label: "common.closureRecord.gateDecisionHold.label",
    message: "common.closureRecord.gateDecisionHold.message",
  },
  "gate_decision(none)": {
    label: "common.closureRecord.gateDecisionNone.label",
    message: "common.closureRecord.gateDecisionNone.message",
  },
  "opportunity.project_id(null)": {
    label: "common.closureRecord.opportunityProjectIdNull.label",
    message: "common.closureRecord.opportunityProjectIdNull.message",
  },
  basisId: { label: "common.closureRecord.basisId.label", message: "common.closureRecord.basisId.message" },
  closure_type: {
    label: "common.closureRecord.closureType.label",
    message: "common.closureRecord.closureType.message",
  },
  venture_transition_decision: {
    label: "common.closureRecord.ventureTransitionDecision.label",
    message: "common.closureRecord.ventureTransitionDecision.message",
  },
};

/** Closure record key -> its catalog keys, with the parameterized-key base fallback. */
export function closureRecordKeyOf(record: string): { label: string; message: string } | null {
  return CLOSURE_RECORD_KEY[record] ?? CLOSURE_RECORD_KEY[record.replace(/\(.*\)$/, "")] ?? null;
}

/** Greenfield DD procedure step ids (procedure v1.1.0) — step number -> `common.gfDdStep.*`. */
export const GF_DD_STEP_KEY: Record<string, string> = {
  "1": "common.gfDdStep.1",
  "2": "common.gfDdStep.2",
  "3": "common.gfDdStep.3",
  "4": "common.gfDdStep.4",
  "5": "common.gfDdStep.5",
  "6": "common.gfDdStep.6",
  "7": "common.gfDdStep.7",
  "8": "common.gfDdStep.8",
};

/** Sub-track class shown on the S9 panel — class id -> `common.gfSubTrackClass.*`. */
export const GF_SUB_TRACK_CLASS_KEY: Record<string, string> = {
  none: "common.gfSubTrackClass.none",
  existing_business_rbd: "common.gfSubTrackClass.existing_business_rbd",
  intra_venture: "common.gfSubTrackClass.intra_venture",
  unknown: "common.gfSubTrackClass.unknown",
};

/** Greenfield S9/S10 heading + plan-readiness wording (ADR-0160) — `common.gf.*`. */
export const GF_HEADING_KEY = {
  s9Plan: "common.gf.s9HeadingPlan",
  s9Legacy: "common.gf.s9HeadingLegacy",
  planReadiness: "common.gf.planReadiness",
  s10Stage: "common.gf.s10StageLabel",
} as const;

/** Establishment legal-entity form for greenfield routes — enum id -> `common.gfVehicle.*`. */
export const GF_VEHICLE_KEY: Record<string, string> = {
  direct: "common.gfVehicle.direct",
  spc: "common.gfVehicle.spc",
  holdco: "common.gfVehicle.holdco",
  internal_venture_spinoff: "common.gfVehicle.internal_venture_spinoff",
  jv: "common.gfVehicle.jv",
};

/** JV share wording for greenfield — share id -> `common.gfJvStake.*`. */
export const GF_JV_STAKE_KEY: Record<string, string> = {
  majority: "common.gfJvStake.majority",
  minority: "common.gfJvStake.minority",
  joint_control: "common.gfJvStake.joint_control",
};

/** Track display names — track id -> `common.track.*` (glossary Green/Brown Field). */
export const TRACK_KEY: Record<string, string> = {
  greenfield: "common.track.greenfield",
  brownfield: "common.track.brownfield",
};

/** Sub-track display names (route-decision GF/BF sub-tracks) — sub-track id -> `common.subTrack.*`. */
export const SUB_TRACK_KEY: Record<string, string> = {
  existing_business_rbd: "common.subTrack.existing_business_rbd",
  intra_venture: "common.subTrack.intra_venture",
  m_and_a: "common.subTrack.m_and_a",
  jv: "common.subTrack.jv",
  strategic_investment: "common.subTrack.strategic_investment",
  minority_investment: "common.subTrack.minority_investment",
  partnership: "common.subTrack.partnership",
  rbd: "common.subTrack.rbd",
  corporate_venture: "common.subTrack.corporate_venture",
};

/** Undecided track wording (process page / deal page). */
export const TRACK_UNDECIDED_KEY = "common.trackUndecided";

export interface TrackKeyPart {
  /** catalog key, or null when the id is unknown (raw passes through). */ key: string | null;
  raw: string;
}

/** Track (+ optional sub-track) as key parts; null track -> the undecided key. */
export function trackKeyParts(track: string | null | undefined, subTrack?: string | null): TrackKeyPart[] {
  if (!track) return [{ key: TRACK_UNDECIDED_KEY, raw: "" }];
  const parts: TrackKeyPart[] = [{ key: TRACK_KEY[track] ?? null, raw: track }];
  if (subTrack) parts.push({ key: SUB_TRACK_KEY[subTrack] ?? null, raw: subTrack });
  return parts;
}

/** Track (+ optional sub-track) as one " · "-joined token string — resolve with resolveLabelTokens at render. */
export const trackKeysText = (track: string | null | undefined, subTrack?: string | null): string =>
  trackKeyParts(track, subTrack)
    .map((p) => p.key ?? p.raw)
    .join(" · ");

/** pmi_key_talent.status — the DB CHECK allows exactly these three values — `common.keyTalentStatus.*`. */
export const KEY_TALENT_STATUS_KEY: Record<string, string> = {
  active: "common.keyTalentStatus.active",
  departed_regretted: "common.keyTalentStatus.departed_regretted",
  departed_planned: "common.keyTalentStatus.departed_planned",
};

/** Every catalog key this module can emit (membership set for render-side resolvers). */
export const LABEL_KEY_SET: ReadonlySet<string> = new Set([
  ...Object.values(GATE_LABEL_KEY),
  ...Object.values(DECISION_LABEL_KEY),
  ...Object.values(DECISION_MODE_LABEL_KEY),
  ...Object.values(STAGE_STATUS_KEY),
  ...Object.values(DD_DOMAIN_KEY),
  ...Object.values(RAG_DIMENSION_KEY),
  ...Object.values(TRANSITION_DECISION_KEY),
  ...Object.values(TRANSITION_HELP_KEY),
  ...Object.values(VENTURE_CLASS_KEY),
  ...Object.values(CLOSURE_TYPE_KEY),
  ...Object.values(RECORD_KEY),
  ...Object.values(CLOSURE_RECORD_KEY).flatMap((v) => [v.label, v.message]),
  ...Object.values(GF_DD_STEP_KEY),
  ...Object.values(GF_SUB_TRACK_CLASS_KEY),
  ...Object.values(GF_VEHICLE_KEY),
  ...Object.values(GF_JV_STAKE_KEY),
  ...Object.values(GF_HEADING_KEY),
  ...Object.values(TRACK_KEY),
  ...Object.values(SUB_TRACK_KEY),
  TRACK_UNDECIDED_KEY,
  ...Object.values(KEY_TALENT_STATUS_KEY),
  "common.viewerReadOnly",
]);

/**
 * Resolve " · "-separated label tokens in display text: any token that is one of this
 * module's catalog keys is translated with the root translator, everything else passes
 * through (server wording, stage names, artifact labels stay as emitted).
 */
export function resolveLabelTokens(text: string, tr: (key: string) => string): string {
  if (LABEL_KEY_SET.has(text)) return tr(text);
  if (!/ · |: /.test(text)) return text;
  return text
    .split(/( · |: )/)
    .map((t) => (LABEL_KEY_SET.has(t) ? tr(t) : t))
    .join("");
}
