// committee-llm — the LLM-mode CallAgent implementation for committee
// deliberation (ADR-0097 §5, the seam documented in lib/committee-agents.ts).
// Registered at server bootstrap (instrumentation.ts) when the multi-provider
// LLM client (lib/llm.ts, ADR-0074) is configured; without it, deliberation
// refuses with llm_required (ADR-0196 decision 10 — no mode env var). The
// boundary-#2 regression tests and any
// LLM-less deployment must keep working unchanged.
//
// Contract in/out (agent-orchestrator.ts): (agentKey, prompt) →
// { positionMd, confidence?, recommendation?, vetoDissent? }. The model is
// asked to end its markdown position with the same machine-readable tail the
// deterministic templates emit — <!--position-meta:{...}--> — which
// runDeliberationRounds/buildSynthesis parse. On any LLM or parse failure we
// degrade honestly: the raw text becomes the position and the judgment fields
// are left unset (an unparseable position is treated as a plain contribution,
// never a fabricated verdict).
import { complete } from "./llm.ts";
import type { AgentCallResult, PositionAct, PositionResponse, Recommendation } from "./agent-orchestrator.ts";
import { systemMessage, promptAgent } from "./prompts.ts";

// Lazy up to the closing comment (not the first `}`): the tail carries nested
// JSON (criteria_scores, responds_to) — a `[^}]*` body never matched those.
const META_RE = /<!--position-meta:\s*(\{[\s\S]*?\})\s*-->/;

const CRITERIA_KEYS = [
  "control_need",
  "capability_criticality",
  "market_uncertainty",
  "integration_capacity",
  "speed_to_capability",
];
const POSITION_ACTS: readonly PositionAct[] = ["agree", "rebut", "ask"];
const SEAT_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ISSUE_ID_RE = /^I\d{1,2}$/;
const MAX_RESPONSES = 8;
const MAX_ISSUES = 8;

/**
 * Whitelist-normalize `responds_to` (ADR-0196 §2.1; LLM JSON is never trusted
 * raw). An entry survives only with a seat-key-shaped `seat` and an `act` in
 * agree|rebut|ask; `issue` is kept only when it looks like an agenda id.
 * When `knownSeats` is given (the session's seats), entries naming any other
 * seat are dropped too — a fabricated colleague never reaches the record.
 */
function normalizeRespondsTo(value: unknown, knownSeats?: readonly string[]): PositionResponse[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean: PositionResponse[] = [];
  for (const item of value) {
    if (clean.length >= MAX_RESPONSES) break;
    if (!item || typeof item !== "object") continue;
    const { seat, act, issue } = item as Record<string, unknown>;
    if (typeof seat !== "string" || !SEAT_KEY_RE.test(seat)) continue;
    if (knownSeats && !knownSeats.includes(seat)) continue;
    if (typeof act !== "string" || !(POSITION_ACTS as readonly string[]).includes(act)) continue;
    const entry: PositionResponse = { seat, act: act as PositionAct };
    if (typeof issue === "string" && ISSUE_ID_RE.test(issue)) entry.issue = issue;
    clean.push(entry);
  }
  return clean;
}

function normalizeIssues(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean: string[] = [];
  for (const v of value) {
    if (clean.length >= MAX_ISSUES) break;
    if (typeof v === "string" && ISSUE_ID_RE.test(v) && !clean.includes(v)) clean.push(v);
  }
  return clean;
}

/**
 * Parse the position-meta tail. Exported for unit tests. The ADR-0196 fields
 * (responds_to, stance_changed, issues) are optional and allowlisted; old tails
 * without them parse exactly as before.
 */
export function parsePositionMeta(text: string, opts: { knownSeats?: readonly string[] } = {}): AgentCallResult | null {
  const m = text.match(META_RE);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]) as {
      recommendation?: string;
      confidence?: number;
      veto_dissent?: boolean;
      criteria_scores?: Record<string, unknown>;
      responds_to?: unknown;
      stance_changed?: unknown;
      issues?: unknown;
    };
    const rec = raw.recommendation as Recommendation | undefined;
    if (rec !== undefined && rec !== "go" && rec !== "hold" && rec !== "kill") return null;
    const confidence =
      typeof raw.confidence === "number" ? Math.max(0, Math.min(100, Math.round(raw.confidence))) : undefined;
    // criteria_scores — whitelist-normalize (LLM JSON is never trusted raw):
    // only the 5 known keys, only integers 1-3, anything else dropped.
    let criteriaScores: Record<string, number> | undefined;
    if (raw.criteria_scores && typeof raw.criteria_scores === "object") {
      const clean: Record<string, number> = {};
      for (const k of CRITERIA_KEYS) {
        const v = Number((raw.criteria_scores as Record<string, unknown>)[k]);
        if (Number.isInteger(v) && v >= 1 && v <= 3) clean[k] = v;
      }
      if (Object.keys(clean).length > 0) criteriaScores = clean;
    }
    const result: AgentCallResult = {
      positionMd: text.replace(META_RE, "").trim(),
      confidence,
      recommendation: rec,
      vetoDissent: raw.veto_dissent === true ? true : undefined,
      criteriaScores,
    };
    // ADR-0196 fields are added only when present, so a legacy tail yields the
    // exact legacy result shape.
    const respondsTo = normalizeRespondsTo(raw.responds_to, opts.knownSeats);
    if (respondsTo !== undefined) result.respondsTo = respondsTo;
    if (typeof raw.stance_changed === "boolean") result.stanceChanged = raw.stance_changed;
    const issues = normalizeIssues(raw.issues);
    if (issues !== undefined) result.issues = issues;
    return result;
  } catch {
    return null;
  }
}

/**
 * Chair agenda pass caller (ADR-0196 §2.2): committee.agenda system prompt,
 * temperature 0.2, ~600 output tokens. Returns the RAW model text — parsing,
 * the 2–5 issue clamp, and the deterministic fallback live in
 * committee-chair.ts so the fallback rule is testable without an LLM.
 * Throws on any LLM error (including budget/rate limit) — the caller falls
 * back; the run never fails because of a chair pass.
 */
export function makeLlmChairAgenda(): (material: string) => Promise<string> {
  return async (material) =>
    complete([systemMessage("committee.agenda"), { role: "user", content: material }], {
      temperature: 0.2,
      maxTokens: 600,
      agent: promptAgent("committee.agenda", { key: "process-governance-manager" }),
    });
}

/**
 * Chair minutes pass caller (ADR-0196 §2.3): committee.minutes system
 * prompt, temperature 0.2, ~2500 output tokens. Same raw-text contract as
 * makeLlmChairAgenda.
 */
export function makeLlmChairMinutes(): (material: string) => Promise<string> {
  return async (material) =>
    complete([systemMessage("committee.minutes"), { role: "user", content: material }], {
      temperature: 0.2,
      maxTokens: 2500,
      agent: promptAgent("committee.minutes", { key: "process-governance-manager" }),
    });
}

export function makeLlmCommitteeAgent(): (agentKey: string, prompt: string) => Promise<AgentCallResult> {
  return async (agentKey, prompt) => {
    const user = `당신은 ${agentKey} 입니다.\n\n${prompt}`;
    try {
      const text = await complete([systemMessage("committee.position"), { role: "user", content: user }], {
        temperature: 0.4,
        maxTokens: 900,
        agent: promptAgent("committee.position", { key: agentKey }),
      });
      const parsed = parsePositionMeta(text);
      if (parsed) return parsed;
      // Unparseable reply — honest degradation, no fabricated verdict.
      return { positionMd: text.trim() };
    } catch (err) {
      // LLM outage mid-deliberation must not kill the run; emit an explicit
      // degraded position so the round record shows the failure happened.
      const msg = err instanceof Error ? err.message : String(err);
      return {
        positionMd: `### [degraded] ${agentKey}\n\nLLM 호출 실패로 이번 라운드 위치를 생성하지 못했다 (${msg}). 판정 미제출.`,
      };
    }
  };
}
