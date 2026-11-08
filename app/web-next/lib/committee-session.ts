// committee-session — the steering-committee session engine (ADR-0097 §5).
//
// A committee session IS a process_run row (ADR-0096 generalized addressing);
// the committee identity, decision mode, gate, and optional target reference
// ride process_run.meta_json (migration 0067 — no new table). Deliberation
// itself is the ONE engine from agent-orchestrator.ts (ADR-0096):
//
//   - agent_team  → runDeliberationRounds() end-to-end at convene time:
//                   all rounds + chair synthesis + the dissent rule. The
//                   session lands directly in the PROPOSED state and NO code
//                   path here can turn it into a decision — the confirming
//                   record (gate_decision / route_decision /
//                   brownfield_target) stays human-only (design boundary #2).
//   - hybrid      → the engine's round primitives (deliberationPrompt +
//                   the same agent_position rows); round 1 agent positions
//                   run at convene, human members submit positions per round
//                   (the 0065 member_type='human' seat), and advance() moves
//                   to the next round or triggers the chair synthesis.
//   - human_only  → today's behavior: agents never run; humans submit
//                   positions; advance() triggers the chair synthesis.
//
// The chair synthesis always goes through buildSynthesis() (ADR-0096 §6):
// veto-dissent positions are copied VERBATIM into gate_evaluation.dissent_json.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import {
  buildSynthesis,
  deliberationPrompt,
  runDeliberationRounds,
  type AgendaIssue,
  type AgendaPassResult,
  type DeliberationPosition,
  type MinutesPassResult,
} from "./deliberation.ts";
import {
  runChairAgenda,
  runChairMinutes,
  minutesInputHashFor,
  type ChairPositionRow,
  type AgendaMeta,
  type MinutesDraft,
} from "./committee-chair.ts";
import type { CallAgent, EntityRef, Recommendation } from "./agent-orchestrator.ts";
import { getCommitteeCallAgent } from "./committee-agents.ts";
import { COMMITTEE_REGISTRY } from "./committee-registry.generated.ts";
import { SPEC_VERSION } from "./spec-activities.generated.ts";

// ── Registry (procedures/_committees.yaml — governance data, ADR-0097 §3) ──

export type DecisionMode = "human_only" | "agent_team" | "hybrid";
export const DECISION_MODES: DecisionMode[] = ["human_only", "agent_team", "hybrid"];

export interface CommitteeMemberDef {
  type: "agent" | "human_role";
  key: string;
  seat?: string;
  applies_when?: string;
  veto_dissent?: boolean;
}
export interface CommitteeDef {
  applies_to: string;
  description?: string;
  chair: string;
  rounds: number;
  decision_modes_allowed: DecisionMode[];
  members: CommitteeMemberDef[];
}

export interface SessionMeta {
  committee_key: string;
  decision_mode: DecisionMode;
  gate: string;
  target_ref?: string;
  /** Track the session was convened under — resolves conditional seats (8). */
  track?: string;
  /** Extra judgement-basis text appended to every member's topic prompt
   * (e.g. S6/S7's t-01~t-09 screening verdicts) — persisted so round 2+
   * (advance()) rebuilds the same enriched topic, not just convene-time. */
  brief_md?: string;
  synthesized?: boolean;
  evaluation_id?: string;
  /** ADR-0196 phase B: the chair agenda (proposal; hybrid humans may edit it). */
  agenda?: AgendaIssue[];
  /** How the agenda was produced (llm / fallback / human_edited). */
  agenda_meta?: AgendaMeta;
  /** AI-drafted structured minutes (zod-validated, ref-resolved). */
  minutes_draft?: MinutesDraft;
  /** ADR-0104 chair sign-off — set once; freezes minutes_draft. */
  minutes_confirmed_by?: string;
  minutes_confirmed_at?: string;
}

let cachedRegistry: Record<string, CommitteeDef> | null = null;

/**
 * Load the committee registry statically (same file _validate.ts lints).
 * A committee not registered here cannot be convened — composition is
 * governance data, never a request parameter.
 */
export function loadCommitteeRegistry(): Record<string, CommitteeDef> {
  if (cachedRegistry) return cachedRegistry;
  const out: Record<string, CommitteeDef> = {};
  for (const [key, c] of Object.entries(COMMITTEE_REGISTRY)) {
    out[key] = {
      ...(c as CommitteeDef),
      decision_modes_allowed: (c.decision_modes_allowed ?? []) as DecisionMode[],
    };
  }
  cachedRegistry = out;
  return out;
}

export function getCommittee(key: string): CommitteeDef | null {
  return loadCommitteeRegistry()[key] ?? null;
}

/**
 * Seats active for a session. `applies_when: track == <track>` seats are
 * conditional: included when `track` is supplied and matches, included
 * conservatively when the caller cannot say yet (deliberation may precede
 * the track being settled).
 */
export function seatsForSession(committee: CommitteeDef, track?: string): CommitteeMemberDef[] {
  return committee.members.filter((m) => {
    const match = typeof m.applies_when === "string" ? m.applies_when.match(/track\s*==\s*(\w+)/) : null;
    if (!match) return true;
    return track !== undefined && m.applies_when?.includes(`track == ${track}`);
  });
}

// ── Session storage (process_run.meta_json, migration 0067) ────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A process_run is a committee session only when its stage is not a stage
 * ledger (s<N>_*, e.g. s11_execution_baseline) and its meta_json carries a
 * committee_key. Every reader/writer below goes through this, so a
 * request-supplied run id can never read or rewrite another ledger's meta_json.
 */
export function isCommitteeRun(stage: unknown, metaJson: unknown): boolean {
  // Stage ledgers (s8_case_adopt, s11_pmi_kickoff, s11_execution_baseline, ...) are never sessions.
  if (typeof stage !== "string" || /^s\d+_/.test(stage)) return false;
  if (typeof metaJson !== "string") return false;
  try {
    const m = JSON.parse(metaJson) as { committee_key?: unknown };
    return !!m && typeof m === "object" && typeof m.committee_key === "string" && m.committee_key.trim() !== "";
  } catch {
    return false;
  }
}

/**
 * Route binding for /api/opportunities/:id/committee-sessions/:sessionId/*:
 * the run must exist, address THIS opportunity, and be a committee stage.
 * When the opportunity was promoted, the caller must also see that project
 * (`canSeeProject`, the routes' visibleProject). Null = 404.
 */
export function committeeSessionForOpportunity(
  opportunityId: string,
  sessionId: string,
  canSeeProject: (projectId: string) => boolean,
): { id: string; stage: string } | null {
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(opportunityId)) return null;
  const run = db
    .query("SELECT id, entity_type, entity_id, stage, meta_json FROM process_run WHERE id = ?")
    .get(sessionId) as
    | { id: string; entity_type: string; entity_id: string; stage: string; meta_json: string | null }
    | undefined;
  if (
    run?.entity_type !== "opportunity" ||
    run.entity_id !== opportunityId ||
    !isCommitteeRun(run.stage, run.meta_json)
  )
    return null;
  const promoted = db.query("SELECT id FROM md_project WHERE source_opportunity_id = ?").all(opportunityId) as {
    id: string;
  }[];
  if (promoted.length > 0 && !promoted.some((p) => canSeeProject(p.id))) return null;
  return { id: run.id, stage: run.stage };
}

function readMeta(runId: string): { meta: SessionMeta; run: Record<string, unknown> } | null {
  const run = getDb().query("SELECT * FROM process_run WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  if (!run) return null;
  if (!isCommitteeRun(run.stage, run.meta_json)) return null; // not a committee session (e.g. another ledger's run)
  if (typeof run.meta_json !== "string") return null; // not a committee session
  try {
    return { meta: JSON.parse(run.meta_json) as SessionMeta, run };
  } catch {
    return null;
  }
}

function writeMeta(runId: string, meta: SessionMeta): void {
  const run = getDb().query("SELECT stage FROM process_run WHERE id = ?").get(runId) as { stage: string } | undefined;
  // The engine creates the run first, so writeMeta only refuses stage ledgers here.
  if (!run || /^s\d+_/.test(run.stage))
    throw new CommitteeError("not_found", `committee session '${runId}' does not exist`);
  getDb().run("UPDATE process_run SET meta_json = ? WHERE id = ?", [JSON.stringify(meta), runId]);
}

// ── Chair passes (ADR-0196 §2.2/§2.3, phase B) ─────────────────────────────

/** agent_position rows as the chair passes see them (id, seat, round, text). */
function loadChairRows(runId: string, maxRound?: number): ChairPositionRow[] {
  return loadPositions(runId)
    .filter((p) => maxRound === undefined || p.round <= maxRound)
    .map((p) => ({
      id: p.id,
      seat: p.agentKey ?? p.humanUserId ?? `round-${p.round}`,
      memberType: p.memberType,
      round: p.round,
      positionMd: p.positionMd,
    }));
}

function toAgendaMeta(r: {
  source: "llm" | "fallback";
  model?: string;
  promptVersion: string;
  inputHash: string;
  createdAt: string;
}): AgendaMeta {
  return {
    source: r.source,
    ...(r.model ? { model: r.model } : {}),
    prompt_version: r.promptVersion,
    input_hash: r.inputHash,
    created_at: r.createdAt,
  };
}

function toMinutesDraft(r: {
  json: unknown;
  fallback: boolean;
  model?: string;
  promptVersion: string;
  inputHash: string;
  createdAt: string;
}): MinutesDraft {
  return {
    json: r.json as MinutesDraft["json"],
    fallback: r.fallback,
    ...(r.model ? { model: r.model } : {}),
    prompt_version: r.promptVersion,
    input_hash: r.inputHash,
    created_at: r.createdAt,
  };
}

/**
 * Human agenda edit (ADR-0196 §2.2, decision 3): a hybrid/human_only convener
 * may replace the chair agenda before round 2. Ids are normalized to
 * I1..In (the agenda is framing, not data — but the minutes schema binds
 * discussion issue_ids to it, so the ids stay engine-owned). Bounded to
 * 1–5 single-line issues.
 */
function normalizeHumanAgenda(input: unknown): AgendaIssue[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 5) return null;
  const clean: AgendaIssue[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const title = (item as { title?: unknown }).title;
    if (typeof title !== "string" || title.trim() === "" || title.length > 200) return null;
    clean.push({ id: `I${clean.length + 1}`, title: title.trim() });
  }
  return clean;
}

async function runAgendaPassForRun(runId: string, topic: string, maxRound: number): Promise<AgendaPassResult> {
  return runChairAgenda({ topic, rows: loadChairRows(runId, maxRound) });
}

async function runMinutesPassForRun(runId: string, _topic: string, agenda: AgendaIssue[]): Promise<MinutesPassResult> {
  const rows = loadChairRows(runId);
  return runChairMinutes({ agenda, rows, seats: rows.map((r) => r.seat) });
}

interface SessionRow {
  id: string;
  positionMd: string;
  confidence: number | null;
  round: number;
  memberType: string;
  agentKey: string | null;
  humanUserId: string | null;
  createdAt: string;
}

function loadPositions(runId: string): SessionRow[] {
  return getDb()
    .query(
      `SELECT id, position_md AS positionMd, confidence, round, member_type AS memberType, agent_key AS agentKey, human_user_id AS humanUserId, created_at AS createdAt
       FROM agent_position WHERE process_run_id = ? ORDER BY round, created_at, id`,
    )
    .all(runId) as unknown as SessionRow[];
}

/**
 * Positions carry a machine-readable trailing marker so the incremental
 * (human_only / hybrid) path can recover each member's recommendation and
 * veto flag at synthesis time — agent_position has no dedicated columns and
 * ADR-0097 deliberately ships no migration for one. The marker is appended
 * by the deterministic member implementation and by the human-position
 * route; the verbatim position TEXT used in dissent_json includes it as a
 * footnote, never a paraphrase.
 */
// Non-greedy to the closing comment (not the first `}`) — the marker may
// contain nested JSON such as criteria_scores (ADR-0104).
const POSITION_META_RE = /<!--position-meta:([\s\S]*?)-->/;

export function parsePositionMeta(positionMd: string): {
  recommendation?: Recommendation;
  veto_dissent?: boolean;
  confidence?: number;
  /** ADR-0104 quantitative scorecard — 5 criteria, 1-3 each (optional). */
  criteria_scores?: Record<string, number>;
} {
  const m = positionMd.match(POSITION_META_RE);
  if (!m) return {};
  try {
    const parsed = JSON.parse(m[1]) as {
      recommendation?: Recommendation;
      veto_dissent?: boolean;
      confidence?: number;
      criteria_scores?: Record<string, number>;
    };
    return parsed;
  } catch {
    return {};
  }
}

function writeAgentPosition(runId: string, p: DeliberationPosition, round: number): void {
  const isHuman = p.memberType === "human";
  getDb().run(
    `INSERT INTO agent_position (id, process_run_id, member_type, agent_key, human_user_id, position_md, confidence, round, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      ulid(),
      runId,
      isHuman ? "human" : "agent",
      isHuman ? null : p.memberKey,
      isHuman ? (p.humanUserId ?? p.memberKey) : null,
      p.positionMd,
      p.confidence ?? null,
      round,
      nowIso(),
    ],
  );
}

// ── Convene ────────────────────────────────────────────────────────────────

export interface ConveneOpts {
  committeeKey: string;
  decisionMode: DecisionMode;
  /** gate_evaluation.gate (0111 CHECK enum — 'target_screening' added for the
   * S7 committee). Defaults per committee scope. */
  gate?: "screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic";
  /** S6/S7 sessions: the brownfield_target under deliberation. */
  targetRef?: string;
  /** Conditional-seat resolution (applies_when: track == ...). */
  track?: string;
  /** Extra judgement-basis text appended to every member's topic prompt
   * (e.g. S6/S7's t-01~t-09 screening verdicts, built client-side from
   * data the caller already has). */
  briefMd?: string;
  actor: string;
  callAgent?: CallAgent;
  source?: string;
}
export interface ConveneResult {
  sessionId: string;
  committeeKey: string;
  decisionMode: DecisionMode;
  /** agent_team only: the deliberation completes at convene time. */
  evaluation: { gateEvaluationId: string; gate: string; recommendation: string; dissentJson: string | null } | null;
}

export class CommitteeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function sessionTopic(committee: CommitteeDef, opts: ConveneOpts): string {
  const scope = opts.targetRef ? `대상 ${opts.targetRef}` : opts.gate ? `진행 ${opts.gate}` : committee.applies_to;
  const base = `${committee.applies_to} 심의 (${scope})`;
  return opts.briefMd ? `${base}\n\n## 판정 근거\n${opts.briefMd}` : base;
}

function createSessionRun(entity: EntityRef, committee: CommitteeDef, opts: ConveneOpts, meta: SessionMeta): string {
  const runId = ulid();
  getDb().run(
    `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, source, started_by, started_at, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      runId,
      entity.entityType,
      entity.entityId,
      entity.entityType === "project" ? entity.entityId : null,
      loadSpecVersion(),
      committee.applies_to,
      "running",
      opts.source ?? "web",
      opts.actor,
      nowIso(),
      JSON.stringify(meta),
    ],
  );
  return runId;
}

function loadSpecVersion(): string {
  return SPEC_VERSION;
}

/**
 * Convene a committee session. agent_team deliberates end-to-end now (the
 * engine's full runDeliberationRounds — all rounds, synthesis, dissent);
 * human_only/hybrid create the session shell and (hybrid) run round 1 agent
 * positions, then wait for human positions.
 */
export async function conveneCommitteeSession(entity: EntityRef, opts: ConveneOpts): Promise<ConveneResult> {
  const committee = getCommittee(opts.committeeKey);
  if (!committee) {
    throw new CommitteeError(
      "unknown_committee",
      `committees '${opts.committeeKey}' is not registered in procedures/_committees.yaml`,
    );
  }
  if (!committee.decision_modes_allowed.includes(opts.decisionMode)) {
    throw new CommitteeError(
      "mode_not_allowed",
      `committee '${opts.committeeKey}' allows [${committee.decision_modes_allowed.join(", ")}] — '${opts.decisionMode}' is not allowed`,
    );
  }
  // S7 committee (applies_to brownfield_target) convenes the target_screening
  // gate — the same key the human GateDecisionPanel below records (0111).
  const gate = opts.gate ?? (committee.applies_to === "brownfield_target" ? "target_screening" : "pre_fs");
  const meta: SessionMeta = {
    committee_key: opts.committeeKey,
    decision_mode: opts.decisionMode,
    gate,
    ...(opts.targetRef ? { target_ref: opts.targetRef } : {}),
    ...(opts.track ? { track: opts.track } : {}),
    ...(opts.briefMd ? { brief_md: opts.briefMd } : {}),
  };

  // agent_team: agents propose through the full engine — one call, all
  // rounds, chair synthesis included (never a confirming record).
  if (opts.decisionMode === "agent_team") {
    const agents = seatsForSession(committee, opts.track)
      .filter((m) => m.type === "agent")
      .map((m) => ({ agentKey: m.key }));
    if (agents.length === 0) {
      throw new CommitteeError(
        "no_agent_members",
        `committee '${opts.committeeKey}' has no agent members for agent_team mode`,
      );
    }
    const topic = sessionTopic(committee, opts);
    const result = await runDeliberationRounds(entity, {
      committeeKey: opts.committeeKey,
      agents,
      rounds: committee.rounds,
      topic,
      callAgent: opts.callAgent ?? getCommitteeCallAgent(),
      gate,
      actor: opts.actor,
      stage: opts.committeeKey,
      source: opts.source ?? "web",
      chair: committee.chair,
      // ADR-0196 phase B: the chair agenda pass after round 1 and the
      // minutes pass at synthesis. Both compute + return; persistence into
      // meta_json happens in the writeMeta below (one writer per meta key).
      chairAgendaPass:
        committee.rounds >= 2 ? async (ctx) => runAgendaPassForRun(ctx.processRunId, ctx.topic, 1) : undefined,
      chairMinutesPass: async (ctx) => runMinutesPassForRun(ctx.processRunId, ctx.topic, ctx.agenda),
    });
    // Mark the engine-created run as this session (meta_json, 0067) and
    // persist the chair-pass results with it.
    writeMeta(result.processRunId, {
      ...meta,
      synthesized: true,
      evaluation_id: result.evaluation?.gateEvaluationId,
      ...(result.agenda ? { agenda: result.agenda.agenda, agenda_meta: toAgendaMeta(result.agenda) } : {}),
      ...(result.minutesDraft ? { minutes_draft: toMinutesDraft(result.minutesDraft) } : {}),
    });
    return {
      sessionId: result.processRunId,
      committeeKey: opts.committeeKey,
      decisionMode: opts.decisionMode,
      evaluation: result.evaluation
        ? {
            gateEvaluationId: result.evaluation.gateEvaluationId,
            gate: result.evaluation.gate,
            recommendation: result.evaluation.recommendation,
            dissentJson: result.evaluation.dissentJson,
          }
        : null,
    };
  }

  const runId = createSessionRun(entity, committee, opts, meta);

  // hybrid: round 1 agent positions run at convene (engine round semantics:
  // independent positions); humans join via submitHumanPosition per round.
  if (opts.decisionMode === "hybrid") {
    const agentSeats = seatsForSession(committee, opts.track).filter((m) => m.type === "agent");
    const topic = sessionTopic(committee, opts);
    for (const seat of agentSeats) {
      const member = { agentKey: seat.key };
      const out = await (opts.callAgent ?? getCommitteeCallAgent())(seat.key, deliberationPrompt(member, topic, [], 1));
      writeAgentPosition(
        runId,
        {
          memberKey: seat.key,
          memberType: "agent",
          positionMd: out.positionMd,
          confidence: out.confidence,
          recommendation: out.recommendation,
          vetoDissent: out.vetoDissent,
        },
        1,
      );
    }
  }

  return { sessionId: runId, committeeKey: opts.committeeKey, decisionMode: opts.decisionMode, evaluation: null };
}

// ── Human positions (the 0065 human seat) ──────────────────────────────────

export interface HumanPositionOpts {
  sessionId: string;
  /** app_user.user_id of the submitting human member. */
  humanUserId: string;
  /** The committee seat the human speaks for (registry member key). */
  seat?: string;
  positionMd: string;
  confidence?: number;
  recommendation?: Recommendation;
  vetoDissent?: boolean;
  /** ADR-0104 quantitative scorecard — 5 criteria, integers 1-3 (optional). */
  criteriaScores?: Record<string, number>;
}

export function submitHumanPosition(opts: HumanPositionOpts): { positionId: string; round: number } {
  const session = readMeta(opts.sessionId);
  if (!session) throw new CommitteeError("not_found", `committee session '${opts.sessionId}' does not exist`);
  if (session.meta.decision_mode === "agent_team") {
    throw new CommitteeError(
      "human_seat_closed",
      "agent_team sessions have no human seats — humans confirm via the gate record, not deliberation",
    );
  }
  if (session.meta.synthesized) {
    throw new CommitteeError("session_closed", "this session is already synthesized");
  }
  const committee = getCommittee(session.meta.committee_key) as CommitteeDef;
  if (opts.seat) {
    const seat = committee.members.find((m) => m.key === opts.seat);
    if (!seat) {
      throw new CommitteeError(
        "unknown_seat",
        `'${opts.seat}' is not a member of committee '${session.meta.committee_key}'`,
      );
    }
    // Seat binding (integrity): a human speaks under their OWN app_user
    // identity (human_user_id, set from the authenticated session — never the
    // body). Claiming an AGENT seat would put a human voice under an agent's
    // name in the transcript, so only human_role seats are claimable.
    if (seat.type !== "human_role") {
      throw new CommitteeError(
        "seat_not_assignable",
        `'${opts.seat}' is an agent seat — human positions are recorded under the submitter's own user identity, never under another member's seat`,
      );
    }
  }
  const positions = loadPositions(opts.sessionId);
  const round = positions.length === 0 ? 1 : Math.max(...positions.map((p) => p.round));
  // One position per (round, human member): a repeat submission in the same
  // round would double-count that member's voice at synthesis.
  const alreadyThisRound = positions.some(
    (p) => p.round === round && p.memberType === "human" && (p.humanUserId ?? "") === opts.humanUserId,
  );
  if (alreadyThisRound) {
    throw new CommitteeError(
      "duplicate_position",
      `user '${opts.humanUserId}' already submitted a position for round ${round} of this session`,
    );
  }
  const marker = `<!--position-meta:${JSON.stringify({
    recommendation: opts.recommendation,
    veto_dissent: opts.vetoDissent === true,
    confidence: opts.confidence,
    seat: opts.seat,
    ...(opts.criteriaScores ? { criteria_scores: opts.criteriaScores } : {}),
  })}-->`;
  const positionId = ulid();
  const md = [opts.seat ? `[seat: ${opts.seat}] ${opts.positionMd}` : opts.positionMd, marker].join("\n");
  getDb().run(
    `INSERT INTO agent_position (id, process_run_id, member_type, agent_key, human_user_id, position_md, confidence, round, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [positionId, opts.sessionId, "human", null, opts.humanUserId, md, opts.confidence ?? null, round, nowIso()],
  );
  return { positionId, round };
}

// ── Advance / synthesis ────────────────────────────────────────────────────

export interface AdvanceResult {
  status: "round_started" | "synthesized";
  round?: number;
  evaluation: { gateEvaluationId: string; gate: string; recommendation: string; dissentJson: string | null } | null;
}

/**
 * Advance the session: start the next round's agent positions (hybrid), or
 * trigger the chair synthesis once the committee's rounds are complete.
 * The synthesis writes a gate_evaluation PROPOSAL — NEVER a gate_decision
 * (design boundary #2; ADR-0097 §8 is the regression test for this).
 */
export async function advanceCommitteeSession(
  sessionId: string,
  opts: { actor: string; callAgent?: CallAgent; agenda?: unknown },
): Promise<AdvanceResult> {
  const session = readMeta(sessionId);
  if (!session) throw new CommitteeError("not_found", `committee session '${sessionId}' does not exist`);
  const { meta } = session;
  if (meta.synthesized) throw new CommitteeError("session_closed", "this session is already synthesized");
  const committee = getCommittee(meta.committee_key) as CommitteeDef;
  const callAgent = opts.callAgent ?? getCommitteeCallAgent();
  const positions = loadPositions(sessionId);
  const currentRound = positions.length === 0 ? 0 : Math.max(...positions.map((p) => p.round));
  const hasHumanInCurrentRound = positions.some((p) => p.round === currentRound && p.memberType === "human");
  const topic = sessionTopic(committee, {
    committeeKey: meta.committee_key,
    decisionMode: meta.decision_mode,
    gate: meta.gate as ConveneOpts["gate"],
    targetRef: meta.target_ref,
    briefMd: meta.brief_md,
    actor: opts.actor,
  });

  // A malformed agenda body is refused up front (ADR-0196 decision 3) —
  // before the human-voice gate, so the caller learns the shape error first.
  const humanAgenda = opts.agenda === undefined ? undefined : normalizeHumanAgenda(opts.agenda);
  if (opts.agenda !== undefined && !humanAgenda) {
    throw new CommitteeError("invalid_agenda", "the agenda body must be 1-5 issues shaped [{title: string}]");
  }

  const needsHumanVoice = meta.decision_mode !== "agent_team"; // always true here (agent_team convenes complete)
  if (needsHumanVoice && currentRound >= 1 && !hasHumanInCurrentRound) {
    throw new CommitteeError(
      "human_position_required",
      `round ${currentRound} needs at least one human position before advancing (hybrid/human_only mode)`,
    );
  }

  if (currentRound < committee.rounds) {
    const nextRound = currentRound + 1;
    // Chair agenda (ADR-0196 §2.2): exactly once, before round 2, when the
    // committee runs 2+ rounds. A human override (decision 3) wins over the
    // chair pass; otherwise the pass reads the round-1 positions.
    if (nextRound === 2 && !meta.agenda && committee.rounds >= 2) {
      if (humanAgenda) {
        meta.agenda = humanAgenda;
        meta.agenda_meta = {
          source: "human_edited",
          prompt_version: "human-edit",
          input_hash: "n/a",
          created_at: nowIso(),
        };
      } else if (opts.agenda === undefined) {
        const pass = await runAgendaPassForRun(sessionId, topic, 1);
        meta.agenda = pass.agenda;
        meta.agenda_meta = toAgendaMeta(pass);
      }
      writeMeta(sessionId, meta);
    }
    if (meta.decision_mode === "hybrid") {
      // Rounds 2+: each agent member receives the FULL prior-round positions
      // of all OTHER members, verbatim — the engine's core requirement
      // (ADR-0096 §4), replayed from the recorded agent_position rows.
      const priorRounds: DeliberationPosition[][] = groupByRound(
        positions.slice(
          0,
          positions.findIndex((p) => p.round === nextRound) === -1
            ? positions.length
            : positions.findIndex((p) => p.round === nextRound),
        ),
      );
      for (const seat of seatsForSession(committee, meta.track).filter((m) => m.type === "agent")) {
        const member = { agentKey: seat.key };
        const out = await callAgent(
          seat.key,
          deliberationPrompt(member, topic, priorRounds, nextRound, { agenda: meta.agenda }),
        );
        writeAgentPosition(
          sessionId,
          {
            memberKey: seat.key,
            memberType: "agent",
            positionMd: out.positionMd,
            confidence: out.confidence,
            recommendation: out.recommendation,
            vetoDissent: out.vetoDissent,
          },
          nextRound,
        );
      }
    }
    return { status: "round_started", round: nextRound, evaluation: null };
  }

  return { status: "synthesized", ...(await synthesize(sessionId, meta, committee)), round: currentRound };
}

function groupByRound(rows: SessionRow[]): DeliberationPosition[][] {
  const rounds: DeliberationPosition[][] = [];
  for (const r of rows) {
    if (!rounds[r.round - 1]) rounds[r.round - 1] = [];
    rounds[r.round - 1].push({
      memberKey: r.memberType === "human" ? (r.humanUserId ?? "human") : (r.agentKey ?? "agent"),
      memberType: r.memberType === "human" ? "human" : "agent",
      humanUserId: r.humanUserId ?? undefined,
      positionMd: r.positionMd,
      confidence: r.confidence ?? undefined,
      ...parsePositionMeta(r.positionMd),
    });
  }
  return rounds.filter(Boolean);
}

/** Chair synthesis — buildSynthesis dissent rule, gate_evaluation PROPOSAL. */
async function synthesize(
  sessionId: string,
  meta: SessionMeta,
  committee: CommitteeDef,
): Promise<{ evaluation: AdvanceResult["evaluation"] }> {
  const finalRound = Math.max(...loadPositions(sessionId).map((p) => p.round));
  const finalPositions = groupByRound(loadPositions(sessionId))[finalRound - 1] ?? [];
  // The dissent rule is buildSynthesis's, always — never the chair model's.
  const { recommendation, dissent_json } = buildSynthesis(finalPositions);
  const evalId = ulid();
  getDb().run(
    `INSERT INTO gate_evaluation (id, process_run_id, gate, criteria_json, score, evidence_json, recommendation, evaluated_by, created_at, dissent_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      evalId,
      sessionId,
      meta.gate,
      JSON.stringify({
        committee: meta.committee_key,
        decision_mode: meta.decision_mode,
        target_ref: meta.target_ref ?? null,
      }),
      null,
      null,
      recommendation,
      committee.chair, // recorder-pattern synthesizer (ADR-0053) — votes nothing
      nowIso(),
      dissent_json,
    ],
  );
  // Chair minutes pass (ADR-0196 §2.3): once, at synthesis. Stored in meta
  // (S2); a GET later renders the STORED draft and never calls the LLM.
  let minutesDraft: MinutesDraft | undefined;
  try {
    minutesDraft = toMinutesDraft(
      await runMinutesPassForRun(
        sessionId,
        sessionTopic(committee, {
          committeeKey: meta.committee_key,
          decisionMode: meta.decision_mode,
          gate: meta.gate as ConveneOpts["gate"],
          targetRef: meta.target_ref,
          briefMd: meta.brief_md,
          actor: "chair",
        }),
        meta.agenda ?? [],
      ),
    );
  } catch {
    minutesDraft = undefined; // the run never fails because of the minutes
  }
  writeMeta(sessionId, {
    ...meta,
    synthesized: true,
    evaluation_id: evalId,
    ...(minutesDraft ? { minutes_draft: minutesDraft } : {}),
  });
  getDb().run("UPDATE process_run SET status = 'done', finished_at = ? WHERE id = ?", [nowIso(), sessionId]);
  return {
    evaluation: { gateEvaluationId: evalId, gate: meta.gate, recommendation, dissentJson: dissent_json },
  };
}

// ── Transcript ─────────────────────────────────────────────────────────────

export interface CommitteeTranscript {
  sessionId: string;
  status: string;
  meta: SessionMeta;
  /** ADR-0196 phase B: the stored chair agenda (proposal), if generated. */
  agenda: AgendaIssue[] | null;
  /** How the agenda was produced. */
  agendaMeta: AgendaMeta | null;
  /** The stored AI-drafted minutes draft (S2), if generated. */
  minutesDraft: MinutesDraft | null;
  committee: CommitteeDef | null;
  rounds: Array<{
    round: number;
    positions: Array<{
      positionId: string;
      memberType: string;
      agentKey: string | null;
      humanUserId: string | null;
      positionMd: string;
      confidence: number | null;
      createdAt: string;
    }>;
  }>;
  evaluation: {
    gateEvaluationId: string;
    gate: string;
    recommendation: string;
    dissentJson: string | null;
    evaluatedBy: string;
    createdAt: string;
  } | null;
}

export function getCommitteeSession(sessionId: string): CommitteeTranscript | null {
  const session = readMeta(sessionId);
  if (!session) return null;
  const rounds: CommitteeTranscript["rounds"] = [];
  for (const p of loadPositions(sessionId)) {
    if (!rounds[p.round - 1]) rounds[p.round - 1] = { round: p.round, positions: [] };
    rounds[p.round - 1].positions.push({
      positionId: p.id,
      memberType: p.memberType,
      agentKey: p.agentKey,
      humanUserId: p.humanUserId,
      positionMd: p.positionMd,
      confidence: p.confidence,
      createdAt: p.createdAt,
    });
  }
  let evaluation: CommitteeTranscript["evaluation"] = null;
  if (session.meta.evaluation_id) {
    const ev = getDb()
      .query(
        "SELECT id, gate, recommendation, dissent_json, evaluated_by, created_at FROM gate_evaluation WHERE id = ?",
      )
      .get(session.meta.evaluation_id) as
      | {
          id: string;
          gate: string;
          recommendation: string;
          dissent_json: string | null;
          evaluated_by: string;
          created_at: string;
        }
      | undefined;
    if (ev) {
      evaluation = {
        gateEvaluationId: ev.id,
        gate: ev.gate,
        recommendation: ev.recommendation,
        dissentJson: ev.dissent_json,
        evaluatedBy: ev.evaluated_by,
        createdAt: ev.created_at,
      };
    }
  }
  return {
    sessionId,
    status: String(session.run.status),
    meta: session.meta,
    agenda: session.meta.agenda ?? null,
    agendaMeta: session.meta.agenda_meta ?? null,
    minutesDraft: session.meta.minutes_draft ?? null,
    committee: getCommittee(session.meta.committee_key),
    rounds,
    evaluation,
  };
}

/** List committee sessions for an opportunity (process_run rows with meta). */
export function listCommitteeSessions(
  entityId: string,
): Array<{ sessionId: string; meta: SessionMeta; status: string; startedAt: string }> {
  const rows = getDb()
    .query(
      "SELECT id, meta_json, status, started_at FROM process_run WHERE entity_id = ? AND meta_json IS NOT NULL ORDER BY started_at DESC",
    )
    .all(entityId) as Array<{ id: string; meta_json: string; status: string; started_at: string }>;
  return rows.flatMap((r) => {
    try {
      return [
        { sessionId: r.id, meta: JSON.parse(r.meta_json) as SessionMeta, status: r.status, startedAt: r.started_at },
      ];
    } catch {
      return [];
    }
  });
}

// ── Minutes regeneration (ADR-0196 decision 4) ─────────────────────────────

/**
 * Regenerate the AI-drafted minutes draft. Allowed ONLY while the minutes
 * are unconfirmed AND (the input hash changed OR the stored draft is a
 * fallback). Never callable after `minutes_confirmed_by` is set (ADR-0104 —
 * confirmation freezes the draft). Audited by the route, not here.
 */
export async function regenerateCommitteeMinutes(sessionId: string): Promise<MinutesDraft> {
  const session = readMeta(sessionId);
  if (!session) throw new CommitteeError("not_found", `committee session '${sessionId}' does not exist`);
  const { meta } = session;
  if (meta.minutes_confirmed_by) {
    throw new CommitteeError("minutes_already_confirmed", "minutes are confirmed — the record is frozen (ADR-0104)");
  }
  const rows = loadChairRows(sessionId);
  const agenda = meta.agenda ?? [];
  const currentHash = minutesInputHashFor(agenda, rows);
  if (meta.minutes_draft && !meta.minutes_draft.fallback && meta.minutes_draft.input_hash === currentHash) {
    throw new CommitteeError(
      "regenerate_not_needed",
      "the stored minutes match the current input — regeneration is not applicable",
    );
  }
  const draft = toMinutesDraft(
    await runMinutesPassForRun(
      sessionId,
      sessionTopic(getCommittee(meta.committee_key) as CommitteeDef, {
        committeeKey: meta.committee_key,
        decisionMode: meta.decision_mode,
        gate: meta.gate as ConveneOpts["gate"],
        targetRef: meta.target_ref,
        briefMd: meta.brief_md,
        actor: "chair",
      }),
      agenda,
    ),
  );
  meta.minutes_draft = draft;
  writeMeta(sessionId, meta);
  return draft;
}
