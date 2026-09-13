// Deliberation Engine (ADR-0096 §4 mode 2 / §6) — multi-round rebuttal debate,
// split out of agent-orchestrator.ts so the committee (steering committee,
// ADR-0097) and the committee-deliberation CLI (scripts/co-newbiz/committee-deliberation.ts)
// own one focused module.
//
//   runDeliberationRounds — Round 1: independent positions. Round 2+: each
//       member receives the FULL prior-round positions of all other members
//       verbatim. Positions recorded in agent_position per round. Consumers:
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
} from "./agent-orchestrator.ts";

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
  gate?: "screening" | "pre_fs" | "fs" | "dd" | "entity_ic" | "group_ic";
  /** Chair override; default synthesis uses buildSynthesis (dissent rule). */
  synthesize?: SynthesizeFn;
  /** evaluated_by for the gate_evaluation row; default is the standing chair. */
  chair?: string;
}

/** Round-1 prompt: the topic alone — members deliberate independently. */
export function deliberationPrompt(member: CommitteeMember, topic: string, priorRounds: DeliberationPosition[][], round: number): string {
  const lines = [
    `당신은 '${member.memberType === "human" ? member.humanUserId ?? member.agentKey : member.agentKey}' 위원입니다. 아래 검토/안건에 대한 입장을 작성하세요.`,
    "",
    `## 검토/안건`,
    topic,
  ];
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

/**
 * Write an agent_position row, enforcing the 0065 app-layer invariant:
 * EXACTLY ONE of agent_key | human_user_id non-null. Deliberate trade
 * (ADR-0096 §2): no cross-column CHECK — this one line is the enforcement.
 */
function insertPosition(
  processRunId: string,
  position: DeliberationPosition,
  round: number,
): void {
  const isHuman = position.memberType === "human";
  const agentKey = isHuman ? null : position.memberKey;
  const humanUserId = isHuman ? (position.humanUserId ?? position.memberKey) : null;
  if (isHuman && !humanUserId) {
    throw new Error(`agent_position invariant violation: human member '${position.memberKey}' has no human_user_id`);
  }
  getDb().run(
    `INSERT INTO agent_position (id, process_run_id, member_type, agent_key, human_user_id, position_md, confidence, round, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ulid(), processRunId, position.memberType ?? "agent", agentKey, humanUserId, position.positionMd, position.confidence ?? null, round, nowIso()],
  );
}

/**
 * Multi-round deliberation. Round 1: independent positions. Round 2+: each
 * member's prompt INCLUDES the full prior-round positions of all other
 * members verbatim. Every position is recorded in agent_position per round.
 * Final: chair synthesis into one gate_evaluation row — a PROPOSED
 * recommendation; the human decision is still gate_decision's alone.
 */
export async function runDeliberationRounds(
  entity: EntityRef,
  opts: RunDeliberationOpts,
): Promise<DeliberationResult> {
  const rounds: DeliberationResult["rounds"] = [];
  const priorRounds: DeliberationPosition[][] = [];
  const runId = insertProcessRun(entity, opts.stage ?? opts.committeeKey, opts);

  try {
    for (let round = 1; round <= Math.max(1, opts.rounds); round++) {
      const roundPositions: DeliberationPosition[] = [];
      for (const member of opts.agents) {
        const prompt = deliberationPrompt(member, opts.topic, priorRounds, round);
        const out = await opts.callAgent(member.agentKey, prompt);
        const position: DeliberationPosition = {
          memberKey: member.agentKey,
          memberType: member.memberType ?? "agent",
          humanUserId: member.humanUserId,
          positionMd: out.positionMd,
          confidence: out.confidence,
          recommendation: out.recommendation,
          vetoDissent: out.vetoDissent,
        };
        insertPosition(runId, position, round);
        roundPositions.push(position);
      }
      rounds.push({ round, positions: roundPositions });
      priorRounds.push(roundPositions);
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
        synthesis.criteriaJson ?? JSON.stringify({ committee: opts.committeeKey, rounds: opts.rounds, topic: opts.topic }),
        synthesis.score ?? null,
        synthesis.evidenceJson ?? null,
        synthesis.recommendation,
        opts.chair ?? "process-governance-manager",
        nowIso(),
        dissentJson,
      ],
    );
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
