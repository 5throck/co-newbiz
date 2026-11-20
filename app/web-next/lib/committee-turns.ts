// committee-turns — the turn-based meeting engine (ADR-0204, design
// 2026-11-20-committee-turn-based-meeting-design §4 / §15). Selected per
// session by meta.engine === "turns" (committee-flags.ts); the round engine
// (deliberation.ts runDeliberationRounds) is untouched and stays the default.
//
// A meeting is a bounded dialogue: for each agenda issue the chair opens the
// issue, seats take ONE short move each (propose | ask | answer | rebut |
// concede | amend | pass) in a deterministic code order (§4.3), the chair puts
// a consensus proposal, and each seat accepts or reserves. Each issue closes
// agreed | narrowed | unresolved. These labels describe the AI exchange only —
// the recommendation and the verbatim dissent come from the unchanged
// buildSynthesis rule (ADR-0096 §6) and the gate_evaluation row is a PROPOSAL;
// no code path here writes gate_decision / route_decision / brownfield_target.
//
// Storage (Q1, no migration): one agent_position row per turn. round = issue
// ordinal; position_md = the utterance + a <!--position-meta:{kind:"turn",...}-->
// tail (TurnMeta). `seq` is allocated as max+1 inside the same immediate
// transaction as the INSERT (insertTurn) and is never reused, so it orders
// turns across issues and sittings even when created_at ties. Chair mechanics
// (open / call / propose_consensus / close / resume / pass_on_behalf) are rows
// under the chair's agent_key; a timed-out human turn is a chair
// pass_on_behalf row, never a human row with NULL human_user_id (0065
// invariant) and never invented words.
//
// The module is DB-aware but session-agnostic: committee-session.ts owns
// meta_json, resume claiming and the human endpoints, and injects progress
// persistence through RunTurnMeetingOpts.onProgress. LLM access is the
// injected CallTurn seam; there is NO silent fallback — a call error or three
// consecutive unusable turns stop the run (TurnEngineError → failed_at).
import { z } from "zod";
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import {
  finishProcessRun,
  insertProcessRun,
  nowIso,
  type CallAgent,
  type EntityRef,
  type Recommendation,
  type RunOpts,
} from "./agent-orchestrator.ts";
import {
  buildSynthesis,
  estimateTokens,
  type AgendaIssue,
  type DeliberationResult,
  type MinutesPassResult,
  type SynthesisPositionInput,
} from "./deliberation.ts";
import type { MeetingAwaiting, MeetingPhase, MeetingProgress } from "./committee-progress.ts";

// ── Vocabulary ─────────────────────────────────────────────────────────────

export const SEAT_MOVES = ["propose", "ask", "answer", "rebut", "concede", "amend", "pass"] as const;
export const VOTE_MOVES = ["accept", "reserve"] as const;
export const CHAIR_MOVES = ["open", "call", "propose_consensus", "close", "resume", "pass_on_behalf"] as const;
/** A human's utterance when the chair gave them the floor (hybrid). */
export const HUMAN_MOVES = ["speak"] as const;
export type SeatMove = (typeof SEAT_MOVES)[number];
export type VoteMove = (typeof VOTE_MOVES)[number];
export type ChairMove = (typeof CHAIR_MOVES)[number];
export type TurnMove = SeatMove | VoteMove | ChairMove | (typeof HUMAN_MOVES)[number];
export type TurnRole = "seat" | "chair" | "human";
export type IssueOutcome = "agreed" | "narrowed" | "unresolved";
export type Stance = "for" | "against" | "conditional" | "unsure";

const ALL_MOVES = [...SEAT_MOVES, ...VOTE_MOVES, ...CHAIR_MOVES, ...HUMAN_MOVES] as const;

export interface TurnBudgets {
  /** Per issue: min(perIssueCap, perIssueMultiplier x seats) discussion turns. */
  perIssueMultiplier: number;
  perIssueCap: number;
  /** Discussion turns per meeting (chair mechanics and votes excluded). */
  turnsTotalMax: number;
  /** Agent compute per sitting; human wait is excluded (§15.2). */
  wallClockMs: number;
  /** Bounded wait for one human turn. */
  humanWaitPerTurnMs: number;
  /** Total human wait per meeting; past it, human calls are skipped as pass. */
  humanWaitTotalMs: number;
}

/** Owner-confirmed defaults (Q2, §15.2): 3 x seats (max 12) / 40 / 8 min; 3 min per human turn, 20 min total. */
export const DEFAULT_TURN_BUDGETS: TurnBudgets = {
  perIssueMultiplier: 3,
  perIssueCap: 12,
  turnsTotalMax: 40,
  wallClockMs: 8 * 60_000,
  humanWaitPerTurnMs: 3 * 60_000,
  humanWaitTotalMs: 20 * 60_000,
};

/** Consecutive unusable outputs that stop the run (design §4.5). */
export const MAX_CONSECUTIVE_FAILED_TURNS = 3;

/** Error with a stable code; failed_at.error_code carries the code, never the message. */
export class TurnEngineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TurnEngineError";
    this.code = code;
  }
}

// ── Tail contract (position-meta of a turn row) ────────────────────────────

export const turnMetaSchema = z.object({
  kind: z.literal("turn"),
  seq: z.number().int().min(1),
  attempt: z.number().int().min(1),
  issue_index: z.number().int().min(1),
  issue_id: z.string().optional(),
  role: z.enum(["seat", "chair", "human"]),
  /** Seat key (a role, never a person). Humans speak as their registry seat or "human". */
  speaker_seat: z.string().min(1),
  move: z.enum(ALL_MOVES),
  addressed_to: z.string().optional(),
  /** agent_position.id of the turn this one answers. */
  responds_to_turn: z.string().optional(),
  stance: z.enum(["for", "against", "conditional", "unsure"]).optional(),
  vote: z.enum(VOTE_MOVES).optional(),
  /** Final-stance fields on votes / human turns; feed buildSynthesis. */
  recommendation: z.enum(["go", "hold", "kill"]).optional(),
  veto_dissent: z.boolean().optional(),
  confidence: z.number().min(0).max(100).optional(),
  /** propose_consensus: agent_position ids the proposal rests on. */
  rests_on: z.array(z.string()).optional(),
  /** close: how the issue ended. */
  outcome: z.enum(["agreed", "narrowed", "unresolved"]).optional(),
  votes: z.object({ accept: z.number(), reserve: z.number(), abstain: z.number() }).optional(),
  /** Why: "budget" | "human_timeout" | "human_wait_cap" | "consensus_failed" | "resume". */
  reason: z.string().optional(),
  /** pass_on_behalf: the seat the chair passed for. */
  for_seat: z.string().optional(),
  /** A turn stored as pass because its output was unusable twice. */
  error: z.string().optional(),
});
export type TurnMeta = z.infer<typeof turnMetaSchema>;

const POSITION_META_RE = /<!--position-meta:([\s\S]*?)-->/;

export interface TurnRecord {
  /** agent_position.id — the id minutes refs resolve to. */
  id: string;
  seq: number;
  attempt: number;
  issueIndex: number;
  issueId?: string;
  role: TurnRole;
  speaker: string;
  move: TurnMove;
  addressedTo?: string;
  respondsToTurn?: string;
  stance?: Stance;
  vote?: VoteMove;
  recommendation?: Recommendation;
  vetoDissent?: boolean;
  confidence?: number;
  restsOn?: string[];
  outcome?: IssueOutcome;
  votes?: { accept: number; reserve: number; abstain: number };
  reason?: string;
  forSeat?: string;
  error?: string;
  /** The utterance without the position-meta tail. */
  utterance: string;
  memberType: "agent" | "human";
  agentKey: string | null;
  humanUserId: string | null;
  /** Stored text including the tail (what dissent_json copies verbatim). */
  positionMd: string;
  createdAt: string;
}

/** Parse a stored row into a TurnRecord; null for legacy round rows (no kind:"turn" tail). */
export function parseTurnRow(row: {
  id: string;
  position_md: string;
  member_type: string;
  agent_key: string | null;
  human_user_id: string | null;
  created_at: string;
}): TurnRecord | null {
  const m = row.position_md.match(POSITION_META_RE);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== "turn") return null;
  const parsed = turnMetaSchema.safeParse(raw);
  if (!parsed.success) return null;
  const t = parsed.data;
  return {
    id: row.id,
    seq: t.seq,
    attempt: t.attempt,
    issueIndex: t.issue_index,
    ...(t.issue_id ? { issueId: t.issue_id } : {}),
    role: t.role,
    speaker: t.speaker_seat,
    move: t.move,
    ...(t.addressed_to ? { addressedTo: t.addressed_to } : {}),
    ...(t.responds_to_turn ? { respondsToTurn: t.responds_to_turn } : {}),
    ...(t.stance ? { stance: t.stance } : {}),
    ...(t.vote ? { vote: t.vote } : {}),
    ...(t.recommendation ? { recommendation: t.recommendation } : {}),
    ...(t.veto_dissent ? { vetoDissent: true } : {}),
    ...(t.confidence !== undefined ? { confidence: t.confidence } : {}),
    ...(t.rests_on ? { restsOn: t.rests_on } : {}),
    ...(t.outcome ? { outcome: t.outcome } : {}),
    ...(t.votes ? { votes: t.votes } : {}),
    ...(t.reason ? { reason: t.reason } : {}),
    ...(t.for_seat ? { forSeat: t.for_seat } : {}),
    ...(t.error ? { error: t.error } : {}),
    utterance: row.position_md.replace(POSITION_META_RE, "").trim(),
    memberType: row.member_type === "human" ? "human" : "agent",
    agentKey: row.agent_key,
    humanUserId: row.human_user_id,
    positionMd: row.position_md,
    createdAt: row.created_at,
  };
}

/** True when the stored text carries a turn tail (cheap pre-filter for readers). */
export function isTurnText(positionMd: string): boolean {
  const m = positionMd.match(POSITION_META_RE);
  if (!m) return false;
  try {
    return (JSON.parse(m[1]) as { kind?: unknown } | null)?.kind === "turn";
  } catch {
    return false;
  }
}

/**
 * All turn rows of a run, ordered by seq (the ONLY trustworthy order: created_at
 * can tie within a millisecond and ulid() is not monotonic inside one).
 */
export function loadTurnRecords(runId: string): TurnRecord[] {
  const rows = getDb()
    .query(
      "SELECT id, position_md, member_type, agent_key, human_user_id, created_at FROM agent_position WHERE process_run_id = ?",
    )
    .all(runId) as Array<{
    id: string;
    position_md: string;
    member_type: string;
    agent_key: string | null;
    human_user_id: string | null;
    created_at: string;
  }>;
  const out: TurnRecord[] = [];
  for (const r of rows) {
    const t = parseTurnRow(r);
    if (t) out.push(t);
  }
  return out.sort((a, b) => a.seq - b.seq);
}

// ── Writing turns ──────────────────────────────────────────────────────────

export interface NewTurn {
  role: TurnRole;
  /** Seat key for seats and the chair; the human's seat label for humans. */
  speaker: string;
  move: TurnMove;
  issueIndex: number;
  issueId?: string;
  attempt: number;
  utterance: string;
  /** Required when role = "human" (app_user.user_id). */
  humanUserId?: string;
  addressedTo?: string;
  respondsToTurn?: string;
  stance?: Stance;
  vote?: VoteMove;
  recommendation?: Recommendation;
  vetoDissent?: boolean;
  confidence?: number;
  restsOn?: string[];
  outcome?: IssueOutcome;
  votes?: { accept: number; reserve: number; abstain: number };
  reason?: string;
  forSeat?: string;
  error?: string;
}

/**
 * An utterance can never carry a position-meta tail of its own: the reader takes
 * the FIRST tail in the text, so a model-forged "<!--position-meta:" would
 * otherwise override the engine's tail. Comment delimiters are removed.
 */
export function sanitizeUtterance(text: string): string {
  return text.replace(/<!--/g, "").replace(/-->/g, "").replace(/\r\n/g, "\n").trim().slice(0, 2000);
}

type SqlDb = ReturnType<typeof getDb>;

/**
 * Insert one turn row WITHOUT opening a transaction — the caller must already
 * hold an immediate transaction (insertTurn wraps this; resume claiming calls it
 * inside its own). seq = max(seq of this run's turn rows) + 1; seqs are never
 * reused. Enforces the 0065 invariant: a human row has human_user_id and no
 * agent_key; every other row has agent_key and no human_user_id.
 */
export function insertTurnRow(db: SqlDb, runId: string, t: NewTurn): { id: string; seq: number } {
  if (t.role === "human" && !t.humanUserId) {
    throw new Error(`agent_position invariant violation: human turn by '${t.speaker}' has no human_user_id`);
  }
  const rows = db.query("SELECT position_md FROM agent_position WHERE process_run_id = ?").all(runId) as Array<{
    position_md: string;
  }>;
  let max = 0;
  for (const r of rows) {
    const m = r.position_md.match(POSITION_META_RE);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]) as { kind?: unknown; seq?: unknown };
      if (j.kind === "turn" && typeof j.seq === "number" && j.seq > max) max = j.seq;
    } catch {
      /* not a turn tail */
    }
  }
  const seq = max + 1;
  const meta: TurnMeta = {
    kind: "turn",
    seq,
    attempt: t.attempt,
    issue_index: t.issueIndex,
    ...(t.issueId ? { issue_id: t.issueId } : {}),
    role: t.role,
    speaker_seat: t.speaker,
    move: t.move,
    ...(t.addressedTo ? { addressed_to: t.addressedTo } : {}),
    ...(t.respondsToTurn ? { responds_to_turn: t.respondsToTurn } : {}),
    ...(t.stance ? { stance: t.stance } : {}),
    ...(t.vote ? { vote: t.vote } : {}),
    ...(t.recommendation ? { recommendation: t.recommendation } : {}),
    ...(t.vetoDissent ? { veto_dissent: true } : {}),
    ...(t.confidence !== undefined ? { confidence: t.confidence } : {}),
    ...(t.restsOn ? { rests_on: t.restsOn } : {}),
    ...(t.outcome ? { outcome: t.outcome } : {}),
    ...(t.votes ? { votes: t.votes } : {}),
    ...(t.reason ? { reason: t.reason } : {}),
    ...(t.forSeat ? { for_seat: t.forSeat } : {}),
    ...(t.error ? { error: t.error } : {}),
  };
  const id = ulid();
  const isHuman = t.role === "human";
  db.run(
    `INSERT INTO agent_position (id, process_run_id, member_type, agent_key, human_user_id, position_md, confidence, round, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      runId,
      isHuman ? "human" : "agent",
      isHuman ? null : t.speaker,
      isHuman ? (t.humanUserId as string) : null,
      `${sanitizeUtterance(t.utterance)}\n<!--position-meta:${JSON.stringify(meta)}-->`,
      null, // confidence column stays NULL for turns (the tail carries it)
      t.issueIndex,
      nowIso(),
    ],
  );
  return { id, seq };
}

/** Insert one turn in its own immediate transaction (seq allocation is atomic with the INSERT). */
export function insertTurn(runId: string, t: NewTurn): { id: string; seq: number } {
  const db = getDb();
  return db.transaction((): { id: string; seq: number } => insertTurnRow(db, runId, t)).immediate();
}

// ── Liveness (resume) ──────────────────────────────────────────────────────

/** Issues that a sitting closed: `${attempt}:${issueIndex}`. */
function closedKeys(records: TurnRecord[]): Set<string> {
  const s = new Set<string>();
  for (const r of records) if (r.role === "chair" && r.move === "close") s.add(`${r.attempt}:${r.issueIndex}`);
  return s;
}

/** True when a turn of a stopped sitting was abandoned: its issue was re-run in a later sitting. */
export function isAbandoned(r: TurnRecord, currentAttempt: number, closed: Set<string>): boolean {
  return r.attempt < currentAttempt && !closed.has(`${r.attempt}:${r.issueIndex}`);
}

/**
 * Rows that still count: the current sitting's rows plus rows of earlier
 * sittings whose issue they closed. Partial turns of a failed sitting are kept
 * in the table (append-only) but excluded here — from live transcripts,
 * consensus input, budgets and synthesis.
 */
export function liveRecords(records: TurnRecord[], currentAttempt: number): TurnRecord[] {
  const closed = closedKeys(records);
  return records.filter((r) => !isAbandoned(r, currentAttempt, closed));
}

export function isIssueClosed(records: TurnRecord[], issueIndex: number): boolean {
  return records.some((r) => r.role === "chair" && r.move === "close" && r.issueIndex === issueIndex);
}

const isSeatMove = (m: TurnMove): m is SeatMove => (SEAT_MOVES as readonly string[]).includes(m);

/** A discussion turn: counted against the budgets (votes and chair mechanics are not). */
function isDiscussionTurn(r: TurnRecord): boolean {
  return (r.role === "seat" && isSeatMove(r.move)) || (r.role === "human" && r.move === "speak");
}

export function discussionTurnCount(live: TurnRecord[]): number {
  return live.filter(isDiscussionTurn).length;
}

// ── Pure rules: speaker order, stop rule, consensus ────────────────────────

export const FIRST_TURN_MOVES: SeatMove[] = ["propose", "ask"];
export const OPEN_TURN_MOVES: SeatMove[] = ["propose", "ask", "rebut", "concede", "amend", "pass"];
export const ANSWER_ONLY: SeatMove[] = ["answer"];

export interface NextSpeaker {
  seat: string;
  allowed: SeatMove[];
  /** The ask this turn must answer (agent_position.id). */
  answering?: TurnRecord;
}

/**
 * Deterministic speaker choice (design §4.3). `seats` is in registry order and
 * `issueTurns` are the live seat turns of THIS issue in seq order.
 *   1. a pending `ask` addressed to X → X answers (only `answer` allowed);
 *   2. otherwise the seat named by the most recent unanswered `rebut`;
 *   3. otherwise round-robin over seats that have not spoken on the issue, then
 *      the seat with the fewest turns (registry order breaks ties, and the last
 *      speaker is avoided while another seat is eligible);
 *   4. a seat that passed twice on this issue is skipped.
 * Returns null when no seat is eligible (the discussion ends).
 */
export function nextSpeaker(seats: readonly string[], issueTurns: readonly TurnRecord[]): NextSpeaker | null {
  const turns = issueTurns.filter((t) => t.role === "seat" && isSeatMove(t.move));
  const passes = new Map<string, number>();
  for (const t of turns) if (t.move === "pass") passes.set(t.speaker, (passes.get(t.speaker) ?? 0) + 1);
  const eligible = seats.filter((s) => (passes.get(s) ?? 0) < 2);
  if (eligible.length === 0) return null;

  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if ((t.move !== "ask" && t.move !== "rebut") || !t.addressedTo) continue;
    const target = t.addressedTo;
    if (target === t.speaker || !eligible.includes(target)) continue;
    if (turns.slice(i + 1).some((x) => x.speaker === target)) continue; // already replied
    if (t.move === "ask") return { seat: target, allowed: ANSWER_ONLY, answering: t };
    return { seat: target, allowed: OPEN_TURN_MOVES.filter((m) => m !== "answer") };
  }

  const allowed = turns.length === 0 ? FIRST_TURN_MOVES : OPEN_TURN_MOVES;
  const spoken = new Set(turns.map((t) => t.speaker));
  const unspoken = eligible.find((s) => !spoken.has(s));
  if (unspoken) return { seat: unspoken, allowed };
  const counts = new Map<string, number>();
  for (const t of turns) counts.set(t.speaker, (counts.get(t.speaker) ?? 0) + 1);
  const last = turns.length > 0 ? turns[turns.length - 1].speaker : undefined;
  const pool = eligible.length > 1 ? eligible.filter((s) => s !== last) : eligible;
  const min = Math.min(...pool.map((s) => counts.get(s) ?? 0));
  const seat = pool.find((s) => (counts.get(s) ?? 0) === min) as string;
  return { seat, allowed };
}

export type StopReason = "turn_cap" | "converged" | "silent";

/**
 * Per-issue stop rule (design §4.4); the first that holds ends the discussion:
 *  - turn_cap: perIssueMax discussion turns reached;
 *  - converged: every seat spoke and the last full cycle (one turn per seat)
 *    produced only concede / pass / amend — no new rebut, ask or proposal;
 *  - silent: two full cycles of only pass.
 */
export function shouldStopIssue(
  seats: readonly string[],
  issueTurns: readonly TurnRecord[],
  perIssueMax: number,
): StopReason | null {
  const turns = issueTurns.filter((t) => t.role === "seat" && isSeatMove(t.move));
  if (turns.length >= perIssueMax) return "turn_cap";
  const n = seats.length;
  if (n === 0 || turns.length < n) return null;
  if (!seats.every((s) => turns.some((t) => t.speaker === s))) return null;
  const lastCycle = turns.slice(-n);
  if (lastCycle.every((t) => t.move === "concede" || t.move === "pass" || t.move === "amend")) return "converged";
  if (turns.length >= 2 * n && turns.slice(-2 * n).every((t) => t.move === "pass")) return "silent";
  return null;
}

/** perIssueMax = 3 x seats, capped at 12 (never below 1). */
export function perIssueMax(seatCount: number, b: TurnBudgets): number {
  return Math.max(1, Math.min(b.perIssueCap, b.perIssueMultiplier * seatCount));
}

/**
 * agreed: every seat accepted. narrowed: most seats accepted and the reservations
 * stand verbatim as the narrower point. unresolved: otherwise. Abstentions
 * (a vote whose output was unusable) never count as accept.
 */
export function classifyConsensus(
  votes: { accept: number; reserve: number; abstain: number },
  seatCount: number,
): IssueOutcome {
  if (seatCount > 0 && votes.accept === seatCount) return "agreed";
  if (votes.accept * 2 > seatCount) return "narrowed";
  return "unresolved";
}

// ── Prompts ────────────────────────────────────────────────────────────────

const MOVE_HINT: Record<string, string> = {
  propose: "propose — 제안: 새 주장이나 안을 내놓는다",
  ask: "ask — 질문: 특정 위원에게 직접 묻는다 (addressed_to 필수)",
  answer: "answer — 답변: 받은 질문에 답한다",
  rebut: "rebut — 반박: 앞선 발언을 이유를 들어 반박한다 (addressed_to에 그 위원)",
  concede: "concede — 수긍: 앞선 발언에 동의하거나 양보한다",
  amend: "amend — 수정: 표준 안을 고쳐 다시 내놓는다",
  pass: "pass — 넘김: 더할 말이 없다",
  accept: "accept — 동의: 합의안에 찬성한다",
  reserve: "reserve — 유보: 합의안에 동의하지 못한다 (이유를 한 줄로)",
};

export interface IssueTitle {
  index: number;
  id: string;
  title: string;
}

function labelOf(t: TurnRecord): string {
  return t.role === "chair" ? `${t.speaker}(의장)` : t.role === "human" ? `${t.speaker}(사람)` : t.speaker;
}

function renderTurnLine(t: TurnRecord): string {
  const to = t.addressedTo ? ` → ${t.addressedTo}` : "";
  return `#${t.seq} ${labelOf(t)} [${t.move}${to}]: ${t.utterance.replace(/\s+/g, " ")}`;
}

/**
 * The transcript a speaker sees (design §4.5): the CURRENT issue verbatim (live
 * rows only — partial turns of a stopped sitting are excluded), earlier issues
 * compacted to their outcome plus the consensus text, capped at ~8k tokens by
 * dropping the oldest earlier issues first. The current issue is always whole.
 */
export function buildTurnTranscript(opts: {
  agenda: readonly AgendaIssue[];
  issueIndex: number;
  live: readonly TurnRecord[];
  tokenCap?: number;
}): string {
  const cap = opts.tokenCap ?? 8000;
  const here = opts.live.filter((r) => r.issueIndex === opts.issueIndex && r.move !== "resume");
  const current = here.map(renderTurnLine);
  const earlier: string[] = [];
  for (let j = 1; j < opts.issueIndex; j++) {
    const rows = opts.live.filter((r) => r.issueIndex === j);
    const close = rows.find((r) => r.role === "chair" && r.move === "close");
    if (!close) continue;
    const cons = rows.find((r) => r.role === "chair" && r.move === "propose_consensus" && !r.error);
    earlier.push(
      `- 안건 ${j} (${opts.agenda[j - 1]?.title ?? ""}): ${OUTCOME_LABEL[close.outcome ?? "unresolved"]}${cons ? ` — 합의안: ${cons.utterance.replace(/\s+/g, " ")}` : ""}`,
    );
  }
  let kept = earlier;
  const total = () => estimateTokens([...kept, ...current].join("\n"));
  while (kept.length > 0 && total() > cap) kept = kept.slice(1);
  const parts: string[] = [];
  if (kept.length > 0) parts.push("### 앞선 안건 결과", ...kept, "");
  parts.push(
    `### 안건 ${opts.issueIndex} 지금까지의 발언 (전문)`,
    ...(current.length > 0 ? current : ["(아직 발언 없음)"]),
  );
  return parts.join("\n");
}

export const OUTCOME_LABEL: Record<IssueOutcome, string> = {
  agreed: "합의됨",
  narrowed: "일부 합의 (유보 의견 있음)",
  unresolved: "미해결",
};

function agendaLines(agenda: readonly AgendaIssue[], current: number): string[] {
  return agenda.map((a, i) => `- ${i + 1}. ${a.title}${i + 1 === current ? "  ← 지금 논의 중" : ""}`);
}

export function buildTurnPrompt(opts: {
  seat: string;
  topic: string;
  agenda: readonly AgendaIssue[];
  issueIndex: number;
  live: readonly TurnRecord[];
  allowed: readonly TurnMove[];
  answering?: TurnRecord;
  seats: readonly string[];
}): string {
  const lines = [
    `당신은 '${opts.seat}' 위원입니다. 지금은 AI 위원회 회의 중이며, 이번 차례에 행동 하나만 합니다.`,
    "",
    "## 검토/안건",
    opts.topic,
    "",
    "## 의장이 정한 안건",
    ...agendaLines(opts.agenda, opts.issueIndex),
    "",
    "## 회의 진행 기록",
    buildTurnTranscript({ agenda: opts.agenda, issueIndex: opts.issueIndex, live: opts.live }),
    "",
    "## 이번 차례",
    `위원: ${opts.seats.join(", ")}`,
    "가능한 행동:",
    ...opts.allowed.map((m) => `- ${MOVE_HINT[m] ?? m}`),
  ];
  if (opts.answering) {
    lines.push(
      "",
      `${opts.answering.speaker} 위원이 #${opts.answering.seq}에서 당신에게 물었습니다. 먼저 그 질문에 답하세요.`,
    );
  }
  lines.push(
    "",
    "## 응답 형식",
    'JSON 객체 하나만: {"move":"...","addressed_to":"위원 이름 또는 생략","responds_to_turn":"발언 번호 또는 생략","utterance":"40~120자 분량의 발언 한 가지 논점","stance":"for|against|conditional|unsure"}',
  );
  return lines.join("\n");
}

export function buildConsensusPrompt(opts: {
  chair: string;
  topic: string;
  agenda: readonly AgendaIssue[];
  issueIndex: number;
  live: readonly TurnRecord[];
}): string {
  return [
    `당신은 의장 '${opts.chair}' 입니다. 지금 안건의 토의가 끝났습니다. 표결에 부칠 합의안 하나를 정리하세요.`,
    "",
    "## 검토/안건",
    opts.topic,
    "",
    "## 의장이 정한 안건",
    ...agendaLines(opts.agenda, opts.issueIndex),
    "",
    "## 회의 진행 기록",
    buildTurnTranscript({ agenda: opts.agenda, issueIndex: opts.issueIndex, live: opts.live }),
    "",
    "## 응답 형식",
    'JSON 객체 하나만: {"proposal":"합의안 2~4문장","rests_on_turns":[발언 번호, ...]}',
  ].join("\n");
}

export function buildVotePrompt(opts: {
  seat: string;
  topic: string;
  agenda: readonly AgendaIssue[];
  issueIndex: number;
  live: readonly TurnRecord[];
  proposal: string;
  seats: readonly string[];
}): string {
  return [
    `당신은 '${opts.seat}' 위원입니다. 의장이 이 안건의 합의안을 표결에 부쳤습니다.`,
    "",
    "## 검토/안건",
    opts.topic,
    "",
    "## 의장이 정한 안건",
    ...agendaLines(opts.agenda, opts.issueIndex),
    "",
    "## 회의 진행 기록",
    buildTurnTranscript({ agenda: opts.agenda, issueIndex: opts.issueIndex, live: opts.live }),
    "",
    "## 합의안",
    opts.proposal,
    "",
    "## 이번 차례",
    "가능한 행동 (하나만):",
    `- ${MOVE_HINT.accept}`,
    `- ${MOVE_HINT.reserve}`,
    "최종 입장도 함께 밝히세요: recommendation(go|hold|kill), confidence(0-100), 정식 거부권 수준의 반대일 때만 veto_dissent:true. 이 값은 제안일 뿐이며 사람이 결정합니다.",
    "",
    "## 응답 형식",
    'JSON 객체 하나만: {"move":"accept|reserve","utterance":"이유 한 줄","recommendation":"go|hold|kill","confidence":0-100,"veto_dissent":true|false}',
  ].join("\n");
}

// ── LLM seam ───────────────────────────────────────────────────────────────

export interface TurnRequest {
  kind: "turn" | "vote" | "consensus";
  agentKey: string;
  /** The full user message (system prompt is chosen by the caller from `kind`). */
  prompt: string;
  allowedMoves: readonly TurnMove[];
  issueIndex: number;
  issueId: string;
  /** How many turns this seat already took on this issue (0 = first). */
  seatTurnNo: number;
}
/** Returns the raw model text; throws on any LLM or transport error (no degraded output). */
export type CallTurn = (req: TurnRequest) => Promise<string>;

/** Adapt the committee CallAgent seam (tests / dry runs): its positionMd is the raw JSON reply. */
export function callTurnFromCallAgent(callAgent: CallAgent): CallTurn {
  return async (req) => (await callAgent(req.agentKey, req.prompt)).positionMd;
}

/**
 * Deterministic, scripted turns — no LLM, reproducible. For dry runs (the CLI
 * --deterministic flag) and tests, never a silent fallback: reachable only by
 * explicit injection. Each seat proposes once, then concedes; the red-team seat
 * (risk-officer) reserves with a veto dissent on the vote.
 */
export function deterministicTurnCaller(): CallTurn {
  return async (req) => {
    const red = req.agentKey === "risk-officer";
    if (req.kind === "consensus") {
      const ref = req.prompt.match(/#(\d+)/)?.[1];
      return JSON.stringify({
        proposal: "토의에서 나온 전제를 확인하는 조건으로 진행하는 안을 제안합니다. 이견은 유보 의견으로 남깁니다.",
        rests_on_turns: ref ? [Number(ref)] : [],
      });
    }
    if (req.kind === "vote") {
      return JSON.stringify({
        move: red ? "reserve" : "accept",
        utterance: red ? "하락 시나리오 검증이 충분하지 않아 유보합니다." : "합의안에 동의합니다.",
        recommendation: red ? "kill" : "go",
        confidence: red ? 80 : 70,
        veto_dissent: red,
      });
    }
    if (req.allowedMoves.length === 1 && req.allowedMoves[0] === "answer") {
      return JSON.stringify({ move: "answer", utterance: `${req.agentKey} 위원의 답변입니다.`, stance: "conditional" });
    }
    const move =
      req.seatTurnNo === 0 ? (req.allowedMoves.includes("propose") ? "propose" : req.allowedMoves[0]) : "concede";
    return JSON.stringify({
      move: req.allowedMoves.includes(move as SeatMove) ? move : req.allowedMoves[0],
      utterance: red
        ? "낙관 편향을 의심하며 하락 시나리오를 먼저 확인해야 합니다."
        : "제시된 전제 안에서는 진행이 타당합니다.",
      stance: red ? "against" : "for",
    });
  };
}

// ── Output parsing (zod, tolerant) ─────────────────────────────────────────

/** Pull the outermost JSON object out of a reply that may carry prose / fences / trailing commas. */
export function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = cleaned.slice(start, end + 1);
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the repaired form next */
    }
  }
  return null;
}

const ref = z.union([z.string(), z.number()]);
const turnOutputSchema = z.object({
  move: z.string(),
  addressed_to: z.string().nullish().catch(undefined),
  responds_to_turn: ref.nullish().catch(undefined),
  utterance: z
    .string()
    .transform((s) => sanitizeUtterance(s))
    .pipe(z.string().min(1)),
  stance: z.enum(["for", "against", "conditional", "unsure"]).nullish().catch(undefined),
  recommendation: z.enum(["go", "hold", "kill"]).nullish().catch(undefined),
  confidence: z.number().min(0).max(100).nullish().catch(undefined),
  veto_dissent: z.boolean().nullish().catch(undefined),
});
const consensusOutputSchema = z.object({
  proposal: z
    .string()
    .transform((s) => sanitizeUtterance(s))
    .pipe(z.string().min(1)),
  rests_on_turns: z.array(ref).catch([]),
});

export interface ParsedTurn {
  move: TurnMove;
  addressedTo?: string;
  respondsRef?: string | number;
  utterance: string;
  stance?: Stance;
  recommendation?: Recommendation;
  confidence?: number;
  vetoDissent?: boolean;
}

/**
 * Validate one seat/vote reply against the allowed moves and the seat list.
 * Returns {error} when unusable: not JSON, wrong shape, a move outside
 * `allowed`, or an `ask` without a valid addressee (the speaker itself is not
 * one). An unknown `addressed_to` on other moves is dropped, not an error.
 */
export function parseTurnOutput(
  raw: string,
  ctx: { allowed: readonly TurnMove[]; seats: readonly string[]; speaker: string },
): { ok: true; turn: ParsedTurn } | { ok: false; error: string } {
  const json = extractJsonObject(raw);
  if (json === null) return { ok: false, error: "not_json" };
  const r = turnOutputSchema.safeParse(json);
  if (!r.success) return { ok: false, error: "invalid_shape" };
  const move = r.data.move.trim().toLowerCase() as TurnMove;
  if (!ctx.allowed.includes(move)) return { ok: false, error: "move_not_allowed" };
  const addressed = r.data.addressed_to?.trim();
  const validAddressee =
    addressed && ctx.seats.includes(addressed) && addressed !== ctx.speaker ? addressed : undefined;
  if (move === "ask" && !validAddressee) return { ok: false, error: "ask_needs_addressee" };
  return {
    ok: true,
    turn: {
      move,
      ...(validAddressee ? { addressedTo: validAddressee } : {}),
      ...(r.data.responds_to_turn != null ? { respondsRef: r.data.responds_to_turn } : {}),
      utterance: r.data.utterance,
      ...(r.data.stance ? { stance: r.data.stance } : {}),
      ...(r.data.recommendation ? { recommendation: r.data.recommendation } : {}),
      ...(r.data.confidence != null ? { confidence: Math.round(r.data.confidence) } : {}),
      ...(r.data.veto_dissent === true ? { vetoDissent: true } : {}),
    },
  };
}

export function parseConsensusOutput(
  raw: string,
): { ok: true; proposal: string; refs: Array<string | number> } | { ok: false; error: string } {
  const json = extractJsonObject(raw);
  if (json === null) return { ok: false, error: "not_json" };
  const r = consensusOutputSchema.safeParse(json);
  if (!r.success) return { ok: false, error: "invalid_shape" };
  return { ok: true, proposal: r.data.proposal, refs: r.data.rests_on_turns };
}

/** Resolve a model-supplied turn reference (seq number, "#7", "7" or an id) to an agent_position.id in `rows`. */
export function resolveTurnRef(refValue: string | number | undefined, rows: readonly TurnRecord[]): string | undefined {
  if (refValue === undefined) return undefined;
  const s = String(refValue).trim().replace(/^#/, "");
  if (/^\d+$/.test(s)) return rows.find((r) => r.seq === Number(s))?.id;
  return rows.find((r) => r.id === s)?.id;
}

// ── Recording helpers for the session layer ────────────────────────────────

export interface HumanTurnInput {
  runId: string;
  attempt: number;
  issueIndex: number;
  issueId?: string;
  seat: string;
  humanUserId: string;
  utterance: string;
  recommendation?: Recommendation;
  vetoDissent?: boolean;
  confidence?: number;
  respondsToTurn?: string;
}

/** A human's turn at an open floor. Runs inside the caller's transaction when `db` is given. */
export function recordHumanTurn(input: HumanTurnInput, db?: SqlDb): { id: string; seq: number } {
  const turn: NewTurn = {
    role: "human",
    speaker: input.seat,
    move: "speak",
    issueIndex: input.issueIndex,
    ...(input.issueId ? { issueId: input.issueId } : {}),
    attempt: input.attempt,
    utterance: input.utterance,
    humanUserId: input.humanUserId,
    ...(input.recommendation ? { recommendation: input.recommendation } : {}),
    ...(input.vetoDissent ? { vetoDissent: true } : {}),
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    ...(input.respondsToTurn ? { respondsToTurn: input.respondsToTurn } : {}),
  };
  return db ? insertTurnRow(db, input.runId, turn) : insertTurn(input.runId, turn);
}

/**
 * The chair passes for a human seat that did not answer. Words are NEVER put in
 * a person's mouth: the row is the chair's, and the line says so.
 */
export function recordPassOnBehalf(
  input: {
    runId: string;
    chair: string;
    attempt: number;
    issueIndex: number;
    issueId?: string;
    forSeat: string;
    reason: "human_timeout" | "human_wait_cap";
  },
  db?: SqlDb,
): { id: string; seq: number } {
  const turn: NewTurn = {
    role: "chair",
    speaker: input.chair,
    move: "pass_on_behalf",
    issueIndex: input.issueIndex,
    ...(input.issueId ? { issueId: input.issueId } : {}),
    attempt: input.attempt,
    utterance:
      input.reason === "human_timeout"
        ? `응답 없음 (시간 초과) — 의장이 ${input.forSeat} 순서를 넘깁니다.`
        : `사람 위원 대기 한도를 넘어 ${input.forSeat} 순서를 넘깁니다.`,
    reason: input.reason,
    forSeat: input.forSeat,
  };
  return db ? insertTurnRow(db, input.runId, turn) : insertTurn(input.runId, turn);
}

// ── The engine ─────────────────────────────────────────────────────────────

export interface TurnState {
  /** Agent compute (ms) of the current sitting; human wait never counts. */
  agent_elapsed_ms: number;
  /** Total human wait (ms) of the meeting. */
  human_wait_ms: number;
}

export interface RunTurnMeetingOpts extends RunOpts {
  committeeKey: string;
  /** Speaking seats in registry order (agent seats). */
  seats: readonly string[];
  topic: string;
  /** The chair: facilitates and votes nothing; evaluated_by of the proposal row. */
  chair: string;
  agenda: readonly AgendaIssue[];
  callTurn: CallTurn;
  gate?: "screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic";
  /** Adopt the session shell; the caller then owns the run's status lifecycle. */
  processRunId?: string;
  /** Hybrid: the chair offers each issue's floor to a human before the consensus. */
  hybrid?: boolean;
  /** Seat label a human speaks for; default "human". */
  humanSeat?: string;
  /** 1-based sitting number; > 1 writes one chair `resume` turn. Default 1. */
  attempt?: number;
  resumedFromIssueIndex?: number;
  startedAt?: string;
  turnState?: Partial<TurnState>;
  budgets?: Partial<TurnBudgets>;
  /** Millisecond clock (tests inject a fake one). */
  clock?: () => number;
  /** Progress + durable state after every phase / issue / speaker change. A throwing hook never fails the run. */
  onProgress?: (progress: MeetingProgress, state: TurnState) => void;
  /** Chair minutes pass after the proposal row (never fails the run). */
  chairMinutesPass?: (ctx: {
    processRunId: string;
    topic: string;
    agenda: AgendaIssue[];
    evaluation: { recommendation: Recommendation; dissentJson: string | null };
  }) => Promise<MinutesPassResult | null>;
}

export interface TurnMeetingResult extends Omit<DeliberationResult, "status" | "rounds"> {
  status: "done" | "awaiting_human";
  rounds: DeliberationResult["rounds"];
  /** Set when status = "awaiting_human". */
  awaiting?: MeetingAwaiting;
  turnState: TurnState;
}

export async function runTurnMeeting(entity: EntityRef, opts: RunTurnMeetingOpts): Promise<TurnMeetingResult> {
  const adopted = opts.processRunId !== undefined;
  const runId = opts.processRunId ?? insertProcessRun(entity, opts.stage ?? opts.committeeKey, opts);
  const budgets: TurnBudgets = { ...DEFAULT_TURN_BUDGETS, ...opts.budgets };
  const seats = opts.seats;
  const agenda = opts.agenda as AgendaIssue[];
  if (seats.length === 0) throw new TurnEngineError("no_seats", "a turn meeting needs at least one speaking seat");
  if (agenda.length === 0) throw new TurnEngineError("no_agenda", "a turn meeting needs at least one agenda issue");
  const attempt = opts.attempt ?? 1;
  const clock = opts.clock ?? Date.now;
  const t0 = clock();
  const elapsedBase = opts.turnState?.agent_elapsed_ms ?? 0;
  const humanWaitMs = opts.turnState?.human_wait_ms ?? 0;
  const elapsed = (): number => elapsedBase + (clock() - t0);
  const startedAt = opts.startedAt ?? nowIso();
  const issueMax = perIssueMax(seats.length, budgets);
  let failStreak = 0;
  let budgetHit = false;

  const state = (): TurnState => ({ agent_elapsed_ms: Math.round(elapsed()), human_wait_ms: humanWaitMs });
  const load = (): TurnRecord[] => loadTurnRecords(runId);
  const live = (): TurnRecord[] => liveRecords(load(), attempt);
  const budgetExhausted = (): boolean =>
    discussionTurnCount(live()) >= budgets.turnsTotalMax || elapsed() >= budgets.wallClockMs;

  const progress = (
    phase: MeetingPhase,
    ex: { issueIndex?: number; speakerSeat?: string; awaiting?: MeetingAwaiting } = {},
  ): void => {
    if (!opts.onProgress) return;
    try {
      const p: MeetingProgress = {
        engine: "turns",
        phase,
        ...(ex.issueIndex !== undefined
          ? {
              issue_index: ex.issueIndex,
              issue_count: agenda.length,
              issue_title: agenda[ex.issueIndex - 1]?.title,
            }
          : {}),
        ...(ex.speakerSeat !== undefined ? { speaker_seat: ex.speakerSeat } : {}),
        turn_count: discussionTurnCount(live()),
        turn_budget: budgets.turnsTotalMax,
        attempt,
        ...(opts.resumedFromIssueIndex !== undefined && attempt > 1
          ? { resumed_from_issue_index: opts.resumedFromIssueIndex }
          : {}),
        ...(ex.awaiting ? { awaiting: ex.awaiting } : {}),
        started_at: startedAt,
        updated_at: nowIso(),
      };
      opts.onProgress(p, state());
    } catch {
      // progress is observability only — it never fails the run
    }
  };

  const chairTurn = (issueIndex: number, move: ChairMove, utterance: string, extra: Partial<NewTurn> = {}) =>
    insertTurn(runId, {
      role: "chair",
      speaker: opts.chair,
      move,
      issueIndex,
      issueId: agenda[issueIndex - 1]?.id,
      attempt,
      utterance,
      ...extra,
    });

  /** One LLM call with up to two tries for unusable output; a thrown call error is NOT retried or swallowed. */
  async function callParsed<T>(
    req: TurnRequest,
    parse: (raw: string) => { ok: true; value: T } | { ok: false; error: string },
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    let lastError = "unusable";
    for (let tryNo = 1; tryNo <= 2; tryNo++) {
      const raw = await opts.callTurn(req);
      const parsed = parse(raw);
      if (parsed.ok) return parsed;
      lastError = parsed.error;
    }
    return { ok: false, error: lastError };
  }

  const noteFailure = (): void => {
    failStreak += 1;
    if (failStreak >= MAX_CONSECUTIVE_FAILED_TURNS) {
      throw new TurnEngineError(
        "turn_output_unusable",
        `${MAX_CONSECUTIVE_FAILED_TURNS} consecutive turns produced no usable output`,
      );
    }
  };

  async function discuss(i: number): Promise<"done" | "budget"> {
    const issue = agenda[i - 1];
    for (;;) {
      const lv = live();
      const here = lv.filter((r) => r.issueIndex === i);
      const issueTurns = here.filter((r) => r.role === "seat" || r.role === "human");
      if (shouldStopIssue(seats, issueTurns, issueMax)) return "done";
      if (discussionTurnCount(lv) >= budgets.turnsTotalMax || elapsed() >= budgets.wallClockMs) return "budget";
      const next = nextSpeaker(seats, issueTurns);
      if (!next) return "done";
      progress("discussion", { issueIndex: i, speakerSeat: next.seat });
      const seatTurnNo = issueTurns.filter((t) => t.speaker === next.seat).length;
      const req: TurnRequest = {
        kind: "turn",
        agentKey: next.seat,
        prompt: buildTurnPrompt({
          seat: next.seat,
          topic: opts.topic,
          agenda,
          issueIndex: i,
          live: lv,
          allowed: next.allowed,
          answering: next.answering,
          seats,
        }),
        allowedMoves: next.allowed,
        issueIndex: i,
        issueId: issue.id,
        seatTurnNo,
      };
      const res = await callParsed(req, (raw) => {
        const p = parseTurnOutput(raw, { allowed: next.allowed, seats, speaker: next.seat });
        return p.ok ? { ok: true, value: p.turn } : p;
      });
      if (!res.ok) {
        // Unusable twice: stored as a pass with the error, the meeting continues.
        insertTurn(runId, {
          role: "seat",
          speaker: next.seat,
          move: "pass",
          issueIndex: i,
          issueId: issue.id,
          attempt,
          utterance: "(이번 차례의 발언을 받지 못했습니다)",
          error: res.error,
        });
        noteFailure();
        continue;
      }
      failStreak = 0;
      const t = res.value;
      insertTurn(runId, {
        role: "seat",
        speaker: next.seat,
        move: t.move,
        issueIndex: i,
        issueId: issue.id,
        attempt,
        utterance: t.utterance,
        ...(t.addressedTo ? { addressedTo: t.addressedTo } : {}),
        // An answer always points at the ask it answers (code-decided, not the model's).
        ...(next.answering
          ? { respondsToTurn: next.answering.id }
          : t.respondsRef !== undefined
            ? { respondsToTurn: resolveTurnRef(t.respondsRef, here) }
            : {}),
        ...(t.stance ? { stance: t.stance } : {}),
      });
    }
  }

  /** Close an issue without a vote because a budget ended the meeting. */
  const closeForBudget = (i: number, started: boolean): void => {
    chairTurn(
      i,
      "close",
      started
        ? `안건 ${i}: 발언·시간 한도에 도달해 합의 없이 닫습니다 (${OUTCOME_LABEL.unresolved}).`
        : `안건 ${i}: 한도에 도달해 논의하지 못했습니다 (${OUTCOME_LABEL.unresolved}).`,
      { outcome: "unresolved", reason: "budget" },
    );
  };

  async function consensusAndVotes(i: number): Promise<void> {
    const issue = agenda[i - 1];
    progress("consensus", { issueIndex: i });
    const lv = live();
    const here = lv.filter((r) => r.issueIndex === i);
    const cres = await callParsed(
      {
        kind: "consensus",
        agentKey: opts.chair,
        prompt: buildConsensusPrompt({ chair: opts.chair, topic: opts.topic, agenda, issueIndex: i, live: lv }),
        allowedMoves: ["propose_consensus"],
        issueIndex: i,
        issueId: issue.id,
        seatTurnNo: 0,
      },
      (raw) => {
        const p = parseConsensusOutput(raw);
        return p.ok ? { ok: true, value: p } : p;
      },
    );
    if (!cres.ok) {
      chairTurn(i, "propose_consensus", "(합의안을 정리하지 못했습니다)", { error: cres.error });
      noteFailure();
      chairTurn(i, "close", `안건 ${i}: 합의안이 없어 닫습니다 (${OUTCOME_LABEL.unresolved}).`, {
        outcome: "unresolved",
        reason: "consensus_failed",
      });
      return;
    }
    failStreak = 0;
    const proposal = cres.value.proposal;
    const refs = cres.value.refs
      .map((r) => resolveTurnRef(r, here))
      .filter((x, idx, arr): x is string => x !== undefined && arr.indexOf(x) === idx);
    chairTurn(i, "propose_consensus", proposal, { restsOn: refs });

    const votes = { accept: 0, reserve: 0, abstain: 0 };
    for (const seat of seats) {
      progress("consensus", { issueIndex: i, speakerSeat: seat });
      const vres = await callParsed(
        {
          kind: "vote",
          agentKey: seat,
          prompt: buildVotePrompt({
            seat,
            topic: opts.topic,
            agenda,
            issueIndex: i,
            live: live(),
            proposal,
            seats,
          }),
          allowedMoves: VOTE_MOVES,
          issueIndex: i,
          issueId: issue.id,
          seatTurnNo: 0,
        },
        (raw) => {
          const p = parseTurnOutput(raw, { allowed: VOTE_MOVES, seats, speaker: seat });
          return p.ok ? { ok: true, value: p.turn } : p;
        },
      );
      if (!vres.ok) {
        votes.abstain += 1;
        insertTurn(runId, {
          role: "seat",
          speaker: seat,
          move: "pass",
          issueIndex: i,
          issueId: issue.id,
          attempt,
          utterance: "(표결 응답을 받지 못했습니다)",
          error: vres.error,
        });
        noteFailure();
        continue;
      }
      failStreak = 0;
      const v = vres.value;
      const vote = v.move as VoteMove;
      votes[vote] += 1;
      insertTurn(runId, {
        role: "seat",
        speaker: seat,
        move: vote,
        issueIndex: i,
        issueId: issue.id,
        attempt,
        utterance: v.utterance,
        vote,
        ...(v.stance ? { stance: v.stance } : {}),
        ...(v.recommendation ? { recommendation: v.recommendation } : {}),
        ...(v.confidence !== undefined ? { confidence: v.confidence } : {}),
        ...(v.vetoDissent ? { vetoDissent: true } : {}),
      });
    }
    const outcome = classifyConsensus(votes, seats.length);
    chairTurn(
      i,
      "close",
      `안건 ${i} 마침 — ${OUTCOME_LABEL[outcome]} (동의 ${votes.accept}, 유보 ${votes.reserve}${votes.abstain > 0 ? `, 응답 없음 ${votes.abstain}` : ""}).`,
      { outcome, votes },
    );
  }

  try {
    // Sitting marker: one chair `resume` turn per restarted sitting.
    if (attempt > 1 && !load().some((r) => r.role === "chair" && r.move === "resume" && r.attempt === attempt)) {
      const all = load();
      const firstOpen = agenda.findIndex((_, idx) => !isIssueClosed(all, idx + 1)) + 1; // 0 = every issue closed
      const from = opts.resumedFromIssueIndex ?? (firstOpen > 0 ? firstOpen : agenda.length);
      chairTurn(
        from,
        "resume",
        firstOpen === 0 && opts.resumedFromIssueIndex === undefined
          ? `회의 재개 — ${attempt}차 시도, 마무리 단계부터`
          : `회의 재개 — ${attempt}차 시도, 안건 ${from}부터`,
        { reason: "resume" },
      );
    }

    for (let i = 1; i <= agenda.length; i++) {
      if (isIssueClosed(load(), i)) continue;
      if (budgetHit || budgetExhausted()) {
        budgetHit = true;
        closeForBudget(i, false);
        continue;
      }
      let rows = live().filter((r) => r.issueIndex === i);
      const issue = agenda[i - 1];
      if (!rows.some((r) => r.role === "chair" && r.move === "open")) {
        progress("discussion", { issueIndex: i });
        chairTurn(i, "open", `안건 ${i}/${agenda.length} — ${issue.title}`);
        rows = live().filter((r) => r.issueIndex === i);
      }
      const call = rows.find((r) => r.role === "chair" && r.move === "call");
      if (!call) {
        if ((await discuss(i)) === "budget") {
          budgetHit = true;
          closeForBudget(i, true);
          continue;
        }
        if (opts.hybrid) {
          const seat = opts.humanSeat ?? "human";
          if (humanWaitMs >= budgets.humanWaitTotalMs) {
            recordPassOnBehalf({
              runId,
              chair: opts.chair,
              attempt,
              issueIndex: i,
              issueId: issue.id,
              forSeat: seat,
              reason: "human_wait_cap",
            });
          } else {
            const called = chairTurn(
              i,
              "call",
              `사람 위원 발언 요청 — ${Math.round(budgets.humanWaitPerTurnMs / 60_000)}분 안에 응답이 없으면 넘어갑니다.`,
              { addressedTo: seat },
            );
            const nowMs = clock();
            const awaiting: MeetingAwaiting = {
              seat,
              seq: called.seq,
              issue_index: i,
              called_at: new Date(nowMs).toISOString(),
              deadline_at: new Date(nowMs + budgets.humanWaitPerTurnMs).toISOString(),
            };
            progress("awaiting_human", { issueIndex: i, awaiting });
            return {
              processRunId: runId,
              rounds: [],
              evaluation: null,
              status: "awaiting_human",
              awaiting,
              turnState: state(),
            };
          }
        }
      } else {
        // Re-entry at an open floor: answered (human row or chair pass after the call) → go on; else still waiting.
        const answered = live().some(
          (r) => r.issueIndex === i && r.seq > call.seq && (r.role === "human" || r.move === "pass_on_behalf"),
        );
        if (!answered) {
          const awaiting: MeetingAwaiting = {
            seat: call.addressedTo ?? opts.humanSeat ?? "human",
            seq: call.seq,
            issue_index: i,
            called_at: call.createdAt,
            deadline_at: new Date(Date.parse(call.createdAt) + budgets.humanWaitPerTurnMs).toISOString(),
          };
          progress("awaiting_human", { issueIndex: i, awaiting });
          return {
            processRunId: runId,
            rounds: [],
            evaluation: null,
            status: "awaiting_human",
            awaiting,
            turnState: state(),
          };
        }
      }
      await consensusAndVotes(i);
    }

    // Synthesis: the unchanged dissent rule (ADR-0096 §6) over each speaker's latest stated stance.
    progress("consensus");
    const finalPositions = finalStances(live());
    const synthesis = buildSynthesis(finalPositions);
    const evalId = ulid();
    getDb().run(
      `INSERT INTO gate_evaluation (id, process_run_id, gate, criteria_json, score, evidence_json, recommendation, evaluated_by, created_at, dissent_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        evalId,
        runId,
        opts.gate ?? "screening",
        JSON.stringify({ committee: opts.committeeKey, engine: "turns", topic: opts.topic }),
        null,
        null,
        synthesis.recommendation,
        opts.chair,
        nowIso(),
        synthesis.dissent_json,
      ],
    );
    let minutesDraft: MinutesPassResult | undefined;
    if (opts.chairMinutesPass) {
      progress("minutes");
      try {
        minutesDraft =
          (await opts.chairMinutesPass({
            processRunId: runId,
            topic: opts.topic,
            agenda,
            evaluation: { recommendation: synthesis.recommendation, dissentJson: synthesis.dissent_json },
          })) ?? undefined;
      } catch {
        minutesDraft = undefined; // a chair pass never fails the run
      }
    }
    if (!adopted) finishProcessRun(runId, "done");
    return {
      processRunId: runId,
      rounds: [],
      evaluation: {
        gateEvaluationId: evalId,
        gate: opts.gate ?? "screening",
        recommendation: synthesis.recommendation,
        dissentJson: synthesis.dissent_json,
      },
      ...(minutesDraft ? { minutesDraft } : {}),
      status: "done",
      turnState: state(),
    };
  } catch (err) {
    if (!adopted) finishProcessRun(runId, "failed");
    throw err;
  }
}

/**
 * Each speaker's LAST stated stance (recommendation / veto flag), in seq order —
 * votes carry it by design, a human turn may too. Fed to buildSynthesis, so the
 * recommendation and the verbatim dissent follow the unchanged rule; the stored
 * text (utterance + tail) is what dissent_json copies.
 */
export function finalStances(live: readonly TurnRecord[]): SynthesisPositionInput[] {
  const latest = new Map<string, SynthesisPositionInput>();
  for (const r of live) {
    if (r.role === "chair" || r.recommendation === undefined) continue;
    const key = r.role === "human" ? `human:${r.humanUserId ?? r.speaker}` : r.speaker;
    latest.set(key, {
      memberKey: r.role === "human" ? (r.humanUserId ?? r.speaker) : r.speaker,
      positionMd: r.positionMd,
      recommendation: r.recommendation,
      vetoDissent: r.vetoDissent === true,
    });
  }
  return [...latest.values()];
}

// ── Read model (API) ───────────────────────────────────────────────────────

/** One turn as the list / GET endpoints expose it (design §4.7; the frontend contract). */
export interface TurnView {
  /** agent_position.id — what minutes refs (rests_on / turn ids) resolve to. */
  turnId: string;
  /** Global, gapless-per-run, never reused: the `afterSeq` cursor. */
  seq: number;
  /** 1-based sitting that stored the turn. */
  attempt: number;
  /** 1-based agenda issue ordinal (= agent_position.round). */
  issueIndex: number;
  issueId: string | null;
  role: TurnRole;
  /** Seat key (a role, never a person). Humans: their seat label ("human"). */
  speakerSeat: string;
  memberType: "agent" | "human";
  agentKey: string | null;
  humanUserId: string | null;
  move: TurnMove;
  addressedTo: string | null;
  respondsToTurn: string | null;
  vote: VoteMove | null;
  stance: Stance | null;
  recommendation: Recommendation | null;
  vetoDissent: boolean;
  /** close rows: how the issue ended. */
  outcome: IssueOutcome | null;
  /** close rows: vote tally. */
  votes: { accept: number; reserve: number; abstain: number } | null;
  /** propose_consensus rows: the turn ids the proposal rests on. */
  restsOn: string[];
  /** "budget" | "human_timeout" | "human_wait_cap" | "consensus_failed" | "resume" | null. */
  reason: string | null;
  /** pass_on_behalf rows: the seat the chair passed for. */
  forSeat: string | null;
  /** Set on a pass stored because the seat's output was unusable twice. */
  error: string | null;
  /** The utterance, position-meta tail stripped. */
  utteranceMd: string;
  /** A turn of a stopped sitting whose issue was re-run: kept, but not part of the live transcript. */
  abandoned: boolean;
  createdAt: string;
}

export function toTurnView(r: TurnRecord, abandoned: boolean): TurnView {
  return {
    turnId: r.id,
    seq: r.seq,
    attempt: r.attempt,
    issueIndex: r.issueIndex,
    issueId: r.issueId ?? null,
    role: r.role,
    speakerSeat: r.speaker,
    memberType: r.memberType,
    agentKey: r.agentKey,
    humanUserId: r.humanUserId,
    move: r.move,
    addressedTo: r.addressedTo ?? null,
    respondsToTurn: r.respondsToTurn ?? null,
    vote: r.vote ?? null,
    stance: r.stance ?? null,
    recommendation: r.recommendation ?? null,
    vetoDissent: r.vetoDissent === true,
    outcome: r.outcome ?? null,
    votes: r.votes ?? null,
    restsOn: r.restsOn ?? [],
    reason: r.reason ?? null,
    forSeat: r.forSeat ?? null,
    error: r.error ?? null,
    utteranceMd: r.utterance,
    abandoned,
    createdAt: r.createdAt,
  };
}

/** Views of all turns in seq order, abandoned ones flagged relative to `currentAttempt`. */
export function turnViews(records: readonly TurnRecord[], currentAttempt: number): TurnView[] {
  const closed = closedKeys(records as TurnRecord[]);
  return records.map((r) => toTurnView(r, isAbandoned(r, currentAttempt, closed)));
}
