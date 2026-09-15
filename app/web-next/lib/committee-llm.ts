// committee-llm — the LLM-mode CallAgent implementation for committee
// deliberation (ADR-0097 §5, the seam documented in lib/committee-agents.ts).
// Registered at server bootstrap (instrumentation.ts) when
// CO_NEWBIZ_COMMITTEE_AGENTS=llm AND the multi-provider LLM client
// (lib/llm.ts, ADR-0074) is configured; without both, deliberation stays on
// the deterministic templates — the boundary-#2 regression tests and any
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
import type { AgentCallResult, Recommendation } from "./agent-orchestrator.ts";

const SYSTEM_PROMPT = [
  "You are one member of a new-business review committee deliberation.",
  "Stay fully in character for your assigned agent role; answer in the same language as the topic (Korean unless the topic is English).",
  "Respond with a concise markdown position (### heading, your stance, your reasoning, what would change your mind) of roughly 150-300 words.",
  "End with EXACTLY one final line in this machine-readable form (no code fence):",
  '<!--position-meta:{"recommendation":"go|hold|kill","confidence":0-100,"veto_dissent":true|false,"criteria_scores":{"control_need":1-3,"capability_criticality":1-3,"market_uncertainty":1-3,"integration_capacity":1-3,"speed_to_capability":1-3}}-->',
  "recommendation is your gate verdict PROPOSAL (a human decides); veto_dissent=true only for a formal veto-grade dissent.",
  "criteria_scores is your own 1-3 scorecard for the 5 standard criteria (1=low, 3=high) based on the material you were given — omit a criterion only if you truly cannot judge it, never guess a number you have no basis for.",
].join("\n");

const META_RE = /<!--position-meta:\s*(\{[^}]*\})\s*-->/;

/** Parse the position-meta tail. Exported for unit tests. */
export function parsePositionMeta(text: string): AgentCallResult | null {
  const m = text.match(META_RE);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]) as { recommendation?: string; confidence?: number; veto_dissent?: boolean; criteria_scores?: Record<string, unknown> };
    const rec = raw.recommendation as Recommendation | undefined;
    if (rec !== undefined && rec !== "go" && rec !== "hold" && rec !== "kill") return null;
    const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(100, Math.round(raw.confidence))) : undefined;
    // criteria_scores — whitelist-normalize (LLM JSON is never trusted raw):
    // only the 5 known keys, only integers 1-3, anything else dropped.
    const CRITERIA_KEYS = ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"];
    let criteriaScores: Record<string, number> | undefined;
    if (raw.criteria_scores && typeof raw.criteria_scores === "object") {
      const clean: Record<string, number> = {};
      for (const k of CRITERIA_KEYS) {
        const v = Number((raw.criteria_scores as Record<string, unknown>)[k]);
        if (Number.isInteger(v) && v >= 1 && v <= 3) clean[k] = v;
      }
      if (Object.keys(clean).length > 0) criteriaScores = clean;
    }
    return {
      positionMd: text.replace(META_RE, "").trim(),
      confidence,
      recommendation: rec,
      vetoDissent: raw.veto_dissent === true ? true : undefined,
      criteriaScores,
    };
  } catch {
    return null;
  }
}

export function makeLlmCommitteeAgent(): (agentKey: string, prompt: string) => Promise<AgentCallResult> {
  return async (agentKey, prompt) => {
    const user = `당신은 ${agentKey} 입니다.\n\n${prompt}`;
    try {
      const text = await complete(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        { temperature: 0.4, maxTokens: 900, agent: { key: agentKey, purpose: "위원회 심의 포지션 초안 — 제안 전용" } },
      );
      const parsed = parsePositionMeta(text);
      if (parsed) return parsed;
      // Unparseable reply — honest degradation, no fabricated verdict.
      return { positionMd: text.trim() };
    } catch (err) {
      // LLM outage mid-deliberation must not kill the run; emit an explicit
      // degraded position so the round record shows the failure happened.
      const msg = err instanceof Error ? err.message : String(err);
      return { positionMd: `### [degraded] ${agentKey}\n\nLLM 호출 실패로 이번 라운드 위치를 생성하지 못했다 (${msg}). 판정 미제출.` };
    }
  };
}
