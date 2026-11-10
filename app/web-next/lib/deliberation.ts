// Deliberation Engine (ADR-0096 §4 mode 2 / §6) — multi-round rebuttal debate,
// split out of agent-orchestrator.ts so the committee (steering committee,
// ADR-0097) and the committee-deliberation CLI (scripts/co-newbiz/committee-deliberation.ts)
// own one focused module.
//
//   runDeliberationRounds — Round 1: independent positions. Round 2+: each
//       member receives the FULL prior-round positions of all other members
//       verbatim (with CO_NEWBIZ_COMMITTEE_RESPONSIVE, ADR-0196: plus the
//       member's own previous position and a response contract). Positions recorded in agent_position per round. Consumers:
//       steering committee (lib/committee-session.ts), the committee CLI.
//   buildSynthesis        — the dissent rule (ADR-0096 §6), pure and
//       unit-testable; veto-dissent positions are copied VERBATIM into
//       gate_evaluation.dissent_json — never summarized, enforced in code.
//
// Boundaries carried over from the orchestrator (design of record):
//   - The engine writes PROPOSALS only. The final synthesis is a
//     gate_evaluation row; the human go/hold/kill lives in gate_decision
//     (ADR-0094, the sole human-confirmation ledger). The `decision` table
//     (0045) is explicitly NOT used (ADR-0096 §5) and is never written here.
//   - Member LLM execution is an injected strategy (callAgent) so unit tests
//     inject fakes and deployments choose deterministic vs LLM seats.
//   - process_run bookkeeping (insertProcessRun / finishProcessRun / nowIso)
//     is shared infrastructure re-exported from agent-orchestrator.ts.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import {
  finishProcessRun,
  insertProcessRun,
  nowIso,
  type Recommendation,
  type RunOpts,
  type RunStatus,
  type EntityRef,
  type CallAgent,
  type PositionResponse,
} from "./agent-orchestrator.ts";
import { isCommitteeResponsive } from "./committee-flags.ts";

export interface DeliberationPosition {
  /** agent_key for agent members; registry key for human members. */
  memberKey: string;
  memberType?: "agent" | "human";
  /** Required for human members (app_user.user_id). */
  humanUserId?: string;
  positionMd: string;
  confidence?: number;
  recommendation?: Recommendation;
  vetoDissent?: boolean;
  /** ADR-0196 responsive-round fields (optional, allowlisted at parse time). */
  respondsTo?: PositionResponse[];
  stanceChanged?: boolean;
  issues?: string[];
}
export interface CommitteeMember {
  agentKey: string;
  memberType?: "agent" | "human";
  humanUserId?: string;
}
export interface SynthesisInput {
  recommendation: Recommendation;
  rationale: string;
  criteriaJson?: string;
  score?: number;
  evidenceJson?: string;
}
export type SynthesizeFn = (positions: DeliberationPosition[]) => SynthesisInput | Promise<SynthesisInput>;

export interface DeliberationResult {
  processRunId: string;
  rounds: Array<{ round: number; positions: DeliberationPosition[] }>;
  evaluation: {
    gateEvaluationId: string;
    gate: string;
    recommendation: Recommendation;
    dissentJson: string | null;
  } | null;
  /** ADR-0196 phase B — chair agenda pass result when the hook ran. */
  agenda?: AgendaPassResult;
  /** ADR-0196 phase B — chair minutes pass result when the hook ran. */
  minutesDraft?: MinutesPassResult;
  status: RunStatus;
}

export interface RunDeliberationOpts extends RunOpts {
  committeeKey: string;
  /** Committee seats, in speaking order. Agent members by default. */
  agents: CommitteeMember[];
  rounds: number;
  topic: string;
  /** Injected member executor — required (no hidden LLM dependency). */
  callAgent: CallAgent;
  /** Gate the synthesized evaluation proposes against (0045 CHECK enum). */
  gate?: "screening" | "pre_fs" | "target_screening" | "fs" | "dd" | "entity_ic" | "group_ic";
  /** Chair override; default synthesis uses buildSynthesis (dissent rule). */
  synthesize?: SynthesizeFn;
  /** evaluated_by for the gate_evaluation row; default is the standing chair. */
  chair?: string;
  /**
   * Chair agenda for rounds 2+ (ADR-0196 §2.2). Accepted and threaded into the
   * round prompt; generating it is a later phase, so callers pass it
   * explicitly or omit it.
   */
  agenda?: AgendaIssue[];
  /**
   * Chair agenda pass (ADR-0196 §2.2, phase B) — run once after round 1 when
   * rounds >= 2; its agenda threads into the round 2+ prompts. Injected by
   * the caller (committee-session.ts, the CLI) so this engine stays
   * DB/LLM-agnostic; null/throwing hooks simply skip the pass.
   */
  chairAgendaPass?: (ctx: {
    processRunId: string;
    topic: string;
    round1Positions: DeliberationPosition[];
  }) => Promise<AgendaPassResult | null>;
  /**
   * Chair minutes pass (ADR-0196 §2.3, phase B) — run once after the
   * gate_evaluation insert; its result is persisted by the caller into
   * process_run.meta_json. Never fails the run.
   */
  chairMinutesPass?: (ctx: {
    processRunId: string;
    topic: string;
    rounds: DeliberationPosition[][];
    agenda: AgendaIssue[];
    evaluation: { recommendation: Recommendation; dissentJson: string | null };
  }) => Promise<MinutesPassResult | null>;
}

export interface AgendaPassResult {
  agenda: AgendaIssue[];
  source: "llm" | "fallback";
  model?: string;
  promptVersion: string;
  inputHash: string;
  createdAt: string;
}

export interface MinutesPassResult {
  json: unknown;
  fallback: boolean;
  model?: string;
  promptVersion: string;
  inputHash: string;
  createdAt: string;
  /** Design §8.6: silently-filled resolution count from the chair minutes
   * pass (0 for fallback drafts). Persisted by the caller as the
   * minutes_draft.degraded_resolutions sibling meta key. */
  degradedResolutions?: number;
}

/** One chair-proposed discussion issue (ADR-0196 §2.2). */
export interface AgendaIssue {
  id: string;
  title: string;
  raisedBy?: string[];
  contested?: boolean;
}

export interface DeliberationPromptOpts {
  /** Force responsive rounds on/off; default reads CO_NEWBIZ_COMMITTEE_RESPONSIVE. */
  responsive?: boolean;
  /** Chair agenda shown in rounds 2+ of a responsive prompt. */
  agenda?: AgendaIssue[];
  /** Override the peer-text paste cap (tokens); default PEER_PASTE_TOKEN_CAP. */
  peerTokenCap?: number;
}

/**
 * Peer-text paste cap for responsive rounds (ADR-0196 §2.6): when the peers'
 * prior-round text would exceed this, only the LATEST prior round stays
 * verbatim and earlier rounds collapse to their position-meta lines. The
 * latest round is always delivered in full (ADR-0096 §4).
 */
export const PEER_PASTE_TOKEN_CAP = 6000;

/**
 * Cheap, dependency-free token estimate that errs high for Hangul: ASCII ≈ 4
 * chars/token, everything else ≈ 1.5 chars/token.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) ch.charCodeAt(0) < 128 ? ascii++ : other++;
  return Math.ceil(ascii / 4 + other / 1.5);
}

const META_TAIL_RE = /<!--position-meta:\s*(\{[\s\S]*?\})\s*-->/;

/** A peer's position-meta line for a collapsed (over-cap) earlier round. */
function peerMetaLine(p: DeliberationPosition): string {
  const m: Record<string, unknown> = {};
  if (p.recommendation) m.recommendation = p.recommendation;
  if (p.confidence !== undefined) m.confidence = p.confidence;
  if (p.vetoDissent) m.veto_dissent = true;
  if (p.respondsTo && p.respondsTo.length > 0) m.responds_to = p.respondsTo;
  if (p.stanceChanged !== undefined) m.stance_changed = p.stanceChanged;
  if (p.issues && p.issues.length > 0) m.issues = p.issues;
  if (Object.keys(m).length > 0) return `- ${p.memberKey}: ${JSON.stringify(m)}`;
  // Positions replayed from storage keep their tail inside the text.
  const tail = p.positionMd.match(META_TAIL_RE);
  return `- ${p.memberKey}: ${tail ? tail[1] : "(position-meta 없음)"}`;
}

function responseContractLines(round: number, peers: string[], agenda: AgendaIssue[] | undefined): string[] {
  const named = Math.min(2, peers.length);
  const lines = [
    "",
    `## 응답 규칙 (라운드 ${round} — 회의 중)`,
    "위의 '내 이전 입장'과 '타 위원 이전 라운드 입장'을 읽고, 첫 라운드 입장을 반복하지 말고 동료에게 직접 응답하세요.",
  ];
  if (named > 0) {
    lines.push(
      `- 위원 ${named}명 이상을 seat key로 지명하고, 각 위원에 대해 동의(agree), 반박(rebut, 이유 명시), 질문(ask, 직접 질문) 중 하나로 응답하세요. 지명 가능한 seat: ${peers.join(", ")}.`,
    );
  }
  lines.push(
    "- 지난 라운드에 당신에게 던져진 질문에는 모두 답하세요.",
    "- 본문에 'Stance change:' 줄을 한 줄 두세요: 'unchanged' 또는 'changed (from X to Y) because <위원/근거>'.",
  );
  if (agenda && agenda.length > 0) {
    lines.push("- 위 '안건 쟁점' 안에서 논의하세요. 쟁점 밖의 내용은 'New issue:' 아래에 한 문단 이내로만 쓰세요.");
  }
  lines.push(
    `- 끝의 position-meta JSON에 선택 필드를 추가하세요: "responds_to":[{"seat":"<seat key>","act":"agree|rebut|ask"${agenda && agenda.length > 0 ? ',"issue":"I1"' : ""}}], "stance_changed":true|false${agenda && agenda.length > 0 ? ', "issues":["I1"]' : ""}.`,
  );
  return lines;
}

/**
 * Member prompt. Round 1 (and every round while responsive rounds are off):
 * the topic alone for round 1; rounds 2+ carry the other members' prior-round
 * positions verbatim — the pre-ADR-0196 prompt, byte-identical.
 *
 * Responsive rounds (CO_NEWBIZ_COMMITTEE_RESPONSIVE, ADR-0196 §2.1) change
 * round 2+ only: the prompt adds the member's OWN previous position, optional
 * chair agenda, keeps peers' positions verbatim (ADR-0096 §4), caps pasted
 * peer text, and ends with the response contract.
 */
export function deliberationPrompt(
  member: CommitteeMember,
  topic: string,
  priorRounds: DeliberationPosition[][],
  round: number,
  opts: DeliberationPromptOpts = {},
): string {
  const lines = [
    `당신은 '${member.memberType === "human" ? (member.humanUserId ?? member.agentKey) : member.agentKey}' 위원입니다. 아래 검토/안건에 대한 입장을 작성하세요.`,
    "",
    `## 검토/안건`,
    topic,
  ];
  const responsive = (opts.responsive ?? isCommitteeResponsive()) && round >= 2;
  if (!responsive) {
    // Rounds 2+: EVERY member receives the FULL prior-round positions of all
    // OTHER members, verbatim — the core requirement (ADR-0096 §4). Own prior
    // positions are omitted (the member already knows their own stance).
    if (round >= 2) {
      for (const prior of priorRounds) {
        const others = prior.filter((p) => p.memberKey !== member.agentKey);
        if (others.length === 0) continue;
        lines.push("", `## 타 위원 이전 라운드 입장 (전문)`);
        for (const p of others) {
          lines.push("", `### ${p.memberKey}`, p.positionMd);
        }
      }
    }
    return lines.join("\n");
  }

  // ── Responsive round (ADR-0196 §2.1) ──
  const agenda = opts.agenda && opts.agenda.length > 0 ? opts.agenda : undefined;
  if (agenda) {
    lines.push("", `## 안건 쟁점 (의장 제안)`);
    for (const issue of agenda) {
      const tags = [
        issue.contested ? "쟁점 분분" : null,
        issue.raisedBy && issue.raisedBy.length > 0 ? `제기: ${issue.raisedBy.join(", ")}` : null,
      ].filter(Boolean);
      lines.push(`- ${issue.id}: ${issue.title}${tags.length > 0 ? ` (${tags.join("; ")})` : ""}`);
    }
  }

  // Own most recent position: a stateless LLM call cannot state a stance change
  // without seeing what it said last time.
  for (let i = priorRounds.length - 1; i >= 0; i--) {
    const own = priorRounds[i].find((p) => p.memberKey === member.agentKey);
    if (own) {
      lines.push("", `## 내 이전 입장 (라운드 ${i + 1})`, own.positionMd);
      break;
    }
  }

  // Peers' prior positions, verbatim. Over the cap: latest round stays in
  // full, earlier rounds collapse to position-meta lines.
  const peersByRound = priorRounds.map((prior) => prior.filter((p) => p.memberKey !== member.agentKey));
  const cap = opts.peerTokenCap ?? PEER_PASTE_TOKEN_CAP;
  const totalTokens = peersByRound.reduce(
    (n, others) => n + others.reduce((m, p) => m + estimateTokens(p.positionMd), 0),
    0,
  );
  const collapseEarlier = totalTokens > cap;
  const latestIndex = peersByRound.length - 1;
  const peerKeys: string[] = [];
  peersByRound.forEach((others, i) => {
    if (others.length === 0) return;
    for (const p of others) if (!peerKeys.includes(p.memberKey)) peerKeys.push(p.memberKey);
    if (collapseEarlier && i < latestIndex) {
      lines.push("", `## 타 위원 이전 라운드 입장 (라운드 ${i + 1} — 분량 상한으로 position-meta 요약만)`);
      for (const p of others) lines.push(peerMetaLine(p));
      return;
    }
    lines.push("", `## 타 위원 이전 라운드 입장 (전문) — 라운드 ${i + 1}`);
    for (const p of others) {
      lines.push("", `### ${p.memberKey}`, p.positionMd);
    }
  });

  lines.push(...responseContractLines(round, peerKeys, agenda));
  return lines.join("\n");
}

/**
 * Write an agent_position row, enforcing the 0065 app-layer invariant:
 * EXACTLY ONE of agent_key | human_user_id non-null. Deliberate trade
 * (ADR-0096 §2): no cross-column CHECK — this one line is the enforcement.
 */
function insertPosition(processRunId: string, position: DeliberationPosition, round: number): void {
  const isHuman = position.memberType === "human";
  const agentKey = isHuman ? null : position.memberKey;
  const humanUserId = isHuman ? (position.humanUserId ?? position.memberKey) : null;
  if (isHuman && !humanUserId) {
    throw new Error(`agent_position invariant violation: human member '${position.memberKey}' has no human_user_id`);
  }
  getDb().run(
    `INSERT INTO agent_position (id, process_run_id, member_type, agent_key, human_user_id, position_md, confidence, round, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      ulid(),
      processRunId,
      position.memberType ?? "agent",
      agentKey,
      humanUserId,
      position.positionMd,
      position.confidence ?? null,
      round,
      nowIso(),
    ],
  );
}

/**
 * Multi-round deliberation. Round 1: independent positions. Round 2+: each
 * member's prompt INCLUDES the full prior-round positions of all other
 * members verbatim. Every position is recorded in agent_position per round.
 * Final: chair synthesis into one gate_evaluation row — a PROPOSED
 * recommendation; the human decision is still gate_decision's alone.
 */
export async function runDeliberationRounds(entity: EntityRef, opts: RunDeliberationOpts): Promise<DeliberationResult> {
  const rounds: DeliberationResult["rounds"] = [];
  const priorRounds: DeliberationPosition[][] = [];
  const runId = insertProcessRun(entity, opts.stage ?? opts.committeeKey, opts);

  try {
    let agendaResult: AgendaPassResult | undefined;
    for (let round = 1; round <= Math.max(1, opts.rounds); round++) {
      const roundPositions: DeliberationPosition[] = [];
      for (const member of opts.agents) {
        const prompt = deliberationPrompt(member, opts.topic, priorRounds, round, {
          agenda: opts.agenda ?? agendaResult?.agenda,
        });
        const out = await opts.callAgent(member.agentKey, prompt);
        const position: DeliberationPosition = {
          memberKey: member.agentKey,
          memberType: member.memberType ?? "agent",
          humanUserId: member.humanUserId,
          positionMd: out.positionMd,
          confidence: out.confidence,
          recommendation: out.recommendation,
          vetoDissent: out.vetoDissent,
          ...(out.respondsTo !== undefined ? { respondsTo: out.respondsTo } : {}),
          ...(out.stanceChanged !== undefined ? { stanceChanged: out.stanceChanged } : {}),
          ...(out.issues !== undefined ? { issues: out.issues } : {}),
        };
        insertPosition(runId, position, round);
        roundPositions.push(position);
      }
      rounds.push({ round, positions: roundPositions });
      priorRounds.push(roundPositions);
      // Chair agenda pass (ADR-0196 section 2.2): once, after round 1, when
      // the committee runs 2+ rounds. A null/throwing hook skips the pass;
      // the agenda then threads into every round 2+ prompt above.
      if (round === 1 && Math.max(1, opts.rounds) >= 2 && opts.chairAgendaPass) {
        try {
          agendaResult =
            (await opts.chairAgendaPass({ processRunId: runId, topic: opts.topic, round1Positions: roundPositions })) ??
            undefined;
        } catch {
          agendaResult = undefined; // a chair pass never fails the run
        }
      }
    }

    const finalPositions = rounds[rounds.length - 1].positions;
    const synthesis = opts.synthesize
      ? await opts.synthesize(finalPositions)
      : await Promise.resolve(defaultSynthesis(finalPositions));

    const evalId = ulid();
    const dissentJson = buildSynthesis(finalPositions).dissent_json; // dissent rule — never summarized
    getDb().run(
      `INSERT INTO gate_evaluation (id, process_run_id, gate, criteria_json, score, evidence_json, recommendation, evaluated_by, created_at, dissent_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        evalId,
        runId,
        opts.gate ?? "screening",
        synthesis.criteriaJson ??
          JSON.stringify({ committee: opts.committeeKey, rounds: opts.rounds, topic: opts.topic }),
        synthesis.score ?? null,
        synthesis.evidenceJson ?? null,
        synthesis.recommendation,
        opts.chair ?? "process-governance-manager",
        nowIso(),
        dissentJson,
      ],
    );
    let minutesDraft: MinutesPassResult | undefined;
    if (opts.chairMinutesPass) {
      try {
        minutesDraft =
          (await opts.chairMinutesPass({
            processRunId: runId,
            topic: opts.topic,
            rounds: priorRounds,
            agenda: opts.agenda ?? agendaResult?.agenda ?? [],
            evaluation: { recommendation: synthesis.recommendation, dissentJson },
          })) ?? undefined;
      } catch {
        minutesDraft = undefined; // a chair pass never fails the run
      }
    }
    finishProcessRun(runId, "done");
    return {
      processRunId: runId,
      rounds,
      evaluation: {
        gateEvaluationId: evalId,
        gate: opts.gate ?? "screening",
        recommendation: synthesis.recommendation,
        dissentJson,
      },
      ...(agendaResult ? { agenda: agendaResult } : {}),
      ...(minutesDraft ? { minutesDraft } : {}),
      status: "done",
    };
  } catch (err) {
    finishProcessRun(runId, "failed");
    throw err;
  }
}

/** Default chair synthesis: majority recommendation + recorded rationale. */
function defaultSynthesis(positions: DeliberationPosition[]): SynthesisInput {
  const { recommendation } = buildSynthesis(positions);
  return {
    recommendation,
    rationale: `위원 ${positions.length}인 합의에 따른 다수 권고: ${recommendation}`,
  };
}

// ---------------------------------------------------------------------------
// buildSynthesis — the dissent rule (ADR-0096 §6), pure and unit-testable
// ---------------------------------------------------------------------------

export interface SynthesisPositionInput {
  memberKey: string;
  positionMd: string;
  recommendation?: Recommendation;
  vetoDissent?: boolean;
}
export interface SynthesisOutput {
  recommendation: Recommendation;
  dissent_json: string | null;
  dissents: Array<{ member_key: string; position_md: string }>;
}

/**
 * Majority recommendation across positions that state one (tie or no stated
 * recommendation → 'hold'). Any position flagged veto_dissent whose
 * recommendation DIFFERS from the majority is a dissent and is copied into
 * dissent_json VERBATIM — position_md is never summarized, averaged, or
 * otherwise compressed. Enforced here, in code, not left to the chair model.
 */
export function buildSynthesis(
  positions: SynthesisPositionInput[],
  _opts: { vetoDissentKeys?: string[] } = {},
): SynthesisOutput {
  const tally = new Map<Recommendation, number>();
  for (const p of positions) {
    if (p.recommendation) tally.set(p.recommendation, (tally.get(p.recommendation) ?? 0) + 1);
  }
  let majority: Recommendation = "hold";
  let best = 0;
  let ties = 0;
  for (const rec of ["go", "hold", "kill"] as Recommendation[]) {
    const n = tally.get(rec) ?? 0;
    if (n > best) {
      best = n;
      majority = rec;
      ties = 1;
    } else if (n === best && n > 0) {
      ties += 1;
    }
  }
  if (ties > 1) majority = "hold"; // no strict majority → hold (conservative default)

  const dissents = positions
    .filter((p) => p.vetoDissent && p.recommendation !== undefined && p.recommendation !== majority)
    .map((p) => ({ member_key: p.memberKey, position_md: p.positionMd })); // verbatim

  return {
    recommendation: majority,
    dissents,
    dissent_json: dissents.length > 0 ? JSON.stringify(dissents) : null,
  };
}
