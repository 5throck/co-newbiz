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
import { COMMITTEE_LLM_GUIDANCE, committeeLlmAvailable, getCommitteeCallAgent } from "./committee-agents.ts";
import { COMMITTEE_REGISTRY } from "./committee-registry.generated.ts";
import { SPEC_VERSION } from "./spec-activities.generated.ts";
import { buildPreFsCommitteeBrief } from "./gate-brief.ts";

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
   * (e.g. S6/S7's t-01~t-09 screening verdicts, or the §8.3 default pre_fs
   * committee brief injected at createCommitteeSession) — persisted so
   * round 2+ (advance()) rebuilds the same enriched topic, not just
   * convene-time. */
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
  /** The round advance() has started. Human_only sessions write no agent
   * rows, so the human-position round must come from here instead of
   * max(agent_position.round) — otherwise a 2-round human_only session
   * never gets its round-2 positions and never reaches synthesis. */
  current_round?: number;
  /** Async convening (ADR tunnel-timeout split): deliberation has been kicked
   * off in the background and has not finished (or failed) yet. Cleared by
   * runCommitteeSession on completion. */
  convening?: boolean;
  /** Why the background deliberation failed (convening_error contract) —
   * surfaced by the list endpoint so the UI never hangs silently. */
  convening_error?: string;
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

/**
 * Route binding for /api/projects/:id/committee-sessions/:sessionId/* (the
 * project-scoped surface — ADR-0196 Phase E): the run must exist, be a
 * committee session, and address THIS project. The project routes gate
 * membership themselves via visibleProject (deny-by-default), so no
 * promoted-opportunity check is needed here. Null = 404.
 */
export function committeeSessionForProject(projectId: string, sessionId: string): { id: string; stage: string } | null {
  const run = getDb()
    .query("SELECT id, entity_type, entity_id, stage, meta_json FROM process_run WHERE id = ?")
    .get(sessionId) as
    | { id: string; entity_type: string; entity_id: string; stage: string; meta_json: string | null }
    | undefined;
  if (run?.entity_type !== "project" || run.entity_id !== projectId || !isCommitteeRun(run.stage, run.meta_json))
    return null;
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
  degradedResolutions?: number;
}): MinutesDraft {
  return {
    json: r.json as MinutesDraft["json"],
    fallback: r.fallback,
    ...(r.model ? { model: r.model } : {}),
    prompt_version: r.promptVersion,
    input_hash: r.inputHash,
    created_at: r.createdAt,
    // Design §8.6: the silently-filled resolution count is a SIBLING key of
    // the minutes_draft meta object (never inside the zod JSON), stored on
    // every LLM-pass draft as an integer >= 0 (0 included). ABSENT on
    // fallback drafts — their "unresolved" fill is the fallback's own
    // declared output, not a silent repair, and absence of the key means
    // "fallback draft or pre-amendment session".
    ...(r.fallback ? {} : { degraded_resolutions: r.degradedResolutions ?? 0 }),
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

async function runMinutesPassForRun(runId: string, topic: string, agenda: AgendaIssue[]): Promise<MinutesPassResult> {
  const rows = loadChairRows(runId);
  // Design §8.4: the topic flows into the minutes material (## 심의 안건) and
  // the input hash — the pass knows what meeting it is minuting.
  return runChairMinutes({ topic, agenda, rows, seats: rows.map((r) => r.seat) });
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
 * Create (convene) a committee session — the synchronous, fast half of the
 * split convene path. Runs ALL validation (committee key, decision mode,
 * llm_required guard, agent_team membership) BEFORE any insert, then inserts
 * the session run. For the LLM-backed modes (agent_team / hybrid) the row is
 * marked meta.convening = true and the deliberation is executed later by
 * runCommitteeSession (the Cloudflare-tunnel 100s proxy timeout makes the
 * synchronous full deliberation structurally impossible over the tunnel).
 * process_run.status semantics stay untouched ("running" at creation,
 * exactly as insertProcessRun writes today) — the convening state lives in
 * meta_json only, and listCommitteeSessions exposes it through
 * session.convening / session.conveningError.
 */
export function createCommitteeSession(entity: EntityRef, opts: ConveneOpts): CreateSessionResult {
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
  // Owner decision 10 (ADR-0196 amendment 2026-11-09): agent-backed
  // deliberation convenes only when an LLM-backed callAgent can actually be
  // constructed (the bootstrap factory is registered). An explicitly passed
  // opts.callAgent is the caller's own choice (injected deterministic run,
  // tests) and is not guarded here. Fires BEFORE the session row exists, so
  // an unconfigured LLM never yields a 202.
  if (
    (opts.decisionMode === "agent_team" || opts.decisionMode === "hybrid") &&
    opts.callAgent === undefined &&
    !committeeLlmAvailable()
  ) {
    throw new CommitteeError("llm_required", COMMITTEE_LLM_GUIDANCE);
  }
  // S7 committee (applies_to brownfield_target) convenes the target_screening
  // gate — the same key the human GateDecisionPanel below records (0111).
  const gate = opts.gate ?? (committee.applies_to === "brownfield_target" ? "target_screening" : "pre_fs");
  // Design §8.3 (amendment 2026-11-10): default pre_fs brief for OPPORTUNITY
  // sessions. This is the single convening choke point — both the web POST
  // route and the pipeline automation funnel through createCommitteeSession,
  // so one guard covers both paths. Client-supplied briefMd always wins (the
  // S6/S7 committees keep their caller-built briefs untouched; injection
  // never overrides an explicit brief); project-entity sessions are excluded
  // by the entity-type guard and never receive an opportunity brief.
  let briefMd = opts.briefMd;
  if (entity.entityType === "opportunity" && gate === "pre_fs" && briefMd === undefined) {
    try {
      // May itself return undefined (no artifacts) — then no brief, convening
      // proceeds with the plain one-liner topic (no fabrication, §8.2).
      briefMd = buildPreFsCommitteeBrief(getDb(), entity.entityId);
    } catch (err) {
      // A brief-builder failure never blocks convening — log and proceed
      // without a brief (the brief is a declared-input grounding, not a gate
      // condition; §8.12 alternative 2).
      console.warn(
        `[committee-session] pre_fs committee brief build failed for ${entity.entityId} — convening without a brief:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  const meta: SessionMeta = {
    committee_key: opts.committeeKey,
    decision_mode: opts.decisionMode,
    gate,
    ...(opts.targetRef ? { target_ref: opts.targetRef } : {}),
    ...(opts.track ? { track: opts.track } : {}),
    ...(briefMd ? { brief_md: briefMd } : {}),
  };
  // agent_team needs agent members — validated at create time so a bad
  // request never reaches the async half.
  if (opts.decisionMode === "agent_team") {
    const agents = seatsForSession(committee, opts.track).filter((m) => m.type === "agent");
    if (agents.length === 0) {
      throw new CommitteeError(
        "no_agent_members",
        `committee '${opts.committeeKey}' has no agent members for agent_team mode`,
      );
    }
  }
  const needsRun = opts.decisionMode !== "human_only";
  const runId = createSessionRun(entity, committee, opts, needsRun ? { ...meta, convening: true } : meta);
  return {
    sessionId: runId,
    committeeKey: opts.committeeKey,
    decisionMode: opts.decisionMode,
    convening: needsRun,
  };
}

export interface CreateSessionResult {
  sessionId: string;
  committeeKey: string;
  decisionMode: DecisionMode;
  /** true = deliberation runs in the background (runCommitteeSession). */
  convening: boolean;
}

/**
 * Execute the background half of the split convene path: the full deliberation
 * rounds + chair synthesis for an agent_team session, or round-1 agent
 * positions for a hybrid session — exactly what conveneCommitteeSession did
 * synchronously. Marks meta.convening = false on completion; on failure marks
 * meta.convening_error and process_run.status = 'failed' before rethrowing,
 * so the session never hangs silently in the convening state.
 */
export async function runCommitteeSession(
  sessionId: string,
  opts: { callAgent?: CallAgent } = {},
): Promise<ConveneResult> {
  const session = readMeta(sessionId);
  if (!session) throw new CommitteeError("not_found", `committee session '${sessionId}' does not exist`);
  const meta = session.meta;
  if (meta.convening !== true) {
    throw new CommitteeError("not_convening", `committee session '${sessionId}' is not in the convening state`);
  }
  const committee = getCommittee(meta.committee_key) as CommitteeDef;
  const run = session.run as { entity_type: string; entity_id: string; started_by: unknown; source: unknown };
  const entity: EntityRef = {
    entityType: run.entity_type === "project" ? "project" : "opportunity",
    entityId: String(run.entity_id),
  };
  const convOpts: ConveneOpts = {
    committeeKey: meta.committee_key,
    decisionMode: meta.decision_mode,
    gate: meta.gate as ConveneOpts["gate"],
    targetRef: meta.target_ref,
    track: meta.track,
    briefMd: meta.brief_md,
    actor: typeof run.started_by === "string" ? run.started_by : "system",
    callAgent: opts.callAgent,
    source: typeof run.source === "string" ? run.source : "web",
  };
  try {
    if (meta.decision_mode === "agent_team") {
      // agent_team: agents propose through the full engine — one call, all
      // rounds, chair synthesis included (never a confirming record).
      const agents = seatsForSession(committee, meta.track)
        .filter((m) => m.type === "agent")
        .map((m) => ({ agentKey: m.key }));
      const topic = sessionTopic(committee, convOpts);
      const result = await runDeliberationRounds(entity, {
        committeeKey: meta.committee_key,
        agents,
        rounds: committee.rounds,
        topic,
        callAgent: opts.callAgent ?? getCommitteeCallAgent(),
        gate: meta.gate as ConveneOpts["gate"],
        actor: convOpts.actor,
        stage: meta.committee_key,
        source: convOpts.source,
        chair: committee.chair,
        // ADR-0196 phase B: the chair agenda pass after round 1 and the
        // minutes pass at synthesis. Both compute + return; persistence into
        // meta_json happens in the writeMeta below (one writer per meta key).
        chairAgendaPass:
          committee.rounds >= 2 ? async (ctx) => runAgendaPassForRun(ctx.processRunId, ctx.topic, 1) : undefined,
        chairMinutesPass: async (ctx) => runMinutesPassForRun(ctx.processRunId, ctx.topic, ctx.agenda),
      });
      // The engine creates its OWN process_run; the async contract keeps the
      // sessionId the client already holds stable, so migrate the engine
      // run's rows onto the shell run and drop the engine run. agent_position
      // and gate_evaluation are moved wholesale (created_at ordering intact),
      // and the meta (with the chair-pass results) lands on the shell.
      const db = getDb();
      db.run("UPDATE agent_position SET process_run_id = ? WHERE process_run_id = ?", [sessionId, result.processRunId]);
      db.run("UPDATE gate_evaluation SET process_run_id = ? WHERE process_run_id = ?", [
        sessionId,
        result.processRunId,
      ]);
      db.run("DELETE FROM process_run WHERE id = ?", [result.processRunId]);
      writeMeta(sessionId, {
        ...meta,
        convening: false,
        synthesized: true,
        evaluation_id: result.evaluation?.gateEvaluationId,
        ...(result.agenda ? { agenda: result.agenda.agenda, agenda_meta: toAgendaMeta(result.agenda) } : {}),
        ...(result.minutesDraft ? { minutes_draft: toMinutesDraft(result.minutesDraft) } : {}),
      });
      db.run("UPDATE process_run SET status = 'done', finished_at = ? WHERE id = ?", [nowIso(), sessionId]);
      return {
        sessionId,
        committeeKey: meta.committee_key,
        decisionMode: meta.decision_mode,
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
    // hybrid: round 1 agent positions run in the background (engine round
    // semantics: independent positions); humans join via submitHumanPosition
    // per round afterwards, exactly as before the split.
    const agentSeats = seatsForSession(committee, meta.track).filter((m) => m.type === "agent");
    const topic = sessionTopic(committee, convOpts);
    for (const seat of agentSeats) {
      const member = { agentKey: seat.key };
      const out = await (opts.callAgent ?? getCommitteeCallAgent())(seat.key, deliberationPrompt(member, topic, [], 1));
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
        1,
      );
    }
    writeMeta(sessionId, { ...meta, convening: false });
    return { sessionId, committeeKey: meta.committee_key, decisionMode: meta.decision_mode, evaluation: null };
  } catch (err) {
    markConveningFailed(sessionId, err);
    throw err;
  }
}

/**
 * Mark a session's background deliberation as failed (meta.convening_error,
 * process_run.status 'failed'). Best-effort — never masks the original error.
 */
function markConveningFailed(sessionId: string, err: unknown): void {
  try {
    const session = readMeta(sessionId);
    if (!session) return;
    writeMeta(sessionId, {
      ...session.meta,
      convening: false,
      convening_error: err instanceof Error ? err.message : String(err),
    });
    getDb().run("UPDATE process_run SET status = 'failed' WHERE id = ?", [sessionId]);
  } catch {
    // best effort — the original error propagates instead
  }
}

/**
 * Convene a committee session (synchronous composition of the split path —
 * kept for the CLI and the existing tests): createCommitteeSession for all
 * validation and the session row, then runCommitteeSession awaited inline.
 * agent_team deliberates end-to-end now (the engine's full
 * runDeliberationRounds — all rounds, synthesis, dissent); human_only/hybrid
 * create the session shell and (hybrid) run round 1 agent positions, then
 * wait for human positions.
 */
export async function conveneCommitteeSession(entity: EntityRef, opts: ConveneOpts): Promise<ConveneResult> {
  const created = createCommitteeSession(entity, opts);
  if (!created.convening) {
    return {
      sessionId: created.sessionId,
      committeeKey: created.committeeKey,
      decisionMode: created.decisionMode,
      evaluation: null,
    };
  }
  return runCommitteeSession(created.sessionId, { callAgent: opts.callAgent });
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
  // The active round: advance() records it in meta (current_round) — the
  // authoritative signal for human_only sessions, where no agent rows exist
  // to derive max(round) from. The max-position fallback keeps hybrid
  // sessions (whose agent rows already carry the round) working unchanged.
  const positions = loadPositions(opts.sessionId);
  const round = Math.min(
    session.meta.current_round ?? (positions.length === 0 ? 1 : Math.max(...positions.map((p) => p.round))),
    committee.rounds,
  );
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
  // Same policy as convene (owner decision 10): the default agent path needs
  // a configured provider; an injected callAgent is the caller's choice.
  // human_only sessions run no agent rounds and stay exempt.
  if (meta.decision_mode !== "human_only" && opts.callAgent === undefined && !committeeLlmAvailable()) {
    throw new CommitteeError("llm_required", COMMITTEE_LLM_GUIDANCE);
  }
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
    }
    // Track the started round in meta (phase B defect fix): human_only
    // sessions write no agent rows, so submitHumanPosition cannot derive
    // the active round from max(agent_position.round) — it reads this key
    // instead. Hybrid sessions carry the same key redundantly (their agent
    // rows agree with it), so they are unaffected.
    meta.current_round = nextRound;
    writeMeta(sessionId, meta);
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

/** List committee sessions for an entity (process_run rows with meta). */
export function listCommitteeSessions(
  entityId: string,
  entityType: "opportunity" | "project" = "opportunity",
): Array<{
  sessionId: string;
  meta: SessionMeta;
  status: string;
  startedAt: string;
  /** Async convening contract: deliberation still running in the background. */
  convening: boolean;
  /** Populated when the background deliberation failed (never silent). */
  conveningError: string | null;
}> {
  const rows = getDb()
    .query(
      "SELECT id, meta_json, status, started_at FROM process_run WHERE entity_type = ? AND entity_id = ? AND meta_json IS NOT NULL ORDER BY started_at DESC",
    )
    .all(entityType, entityId) as Array<{ id: string; meta_json: string; status: string; started_at: string }>;
  return rows.flatMap((r) => {
    try {
      const meta = JSON.parse(r.meta_json) as SessionMeta;
      return [
        {
          sessionId: r.id,
          meta,
          status: r.status,
          startedAt: r.started_at,
          convening: meta.convening === true,
          conveningError: meta.convening_error ?? null,
        },
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
  // Design §8.4: the topic joins the input-hash parts, so the recomputed hash
  // never matches a pre-amendment stored hash — every UNCONFIRMED session is
  // regeneration-eligible; CONFIRMED sessions never reach this line (the
  // minutes_already_confirmed refusal above precedes the comparison).
  const topic = sessionTopic(getCommittee(meta.committee_key) as CommitteeDef, {
    committeeKey: meta.committee_key,
    decisionMode: meta.decision_mode,
    gate: meta.gate as ConveneOpts["gate"],
    targetRef: meta.target_ref,
    briefMd: meta.brief_md,
    actor: "chair",
  });
  const currentHash = minutesInputHashFor(topic, agenda, rows);
  if (meta.minutes_draft && !meta.minutes_draft.fallback && meta.minutes_draft.input_hash === currentHash) {
    throw new CommitteeError(
      "regenerate_not_needed",
      "the stored minutes match the current input — regeneration is not applicable",
    );
  }
  const draft = toMinutesDraft(await runMinutesPassForRun(sessionId, topic, agenda));
  meta.minutes_draft = draft;
  writeMeta(sessionId, meta);
  return draft;
}
