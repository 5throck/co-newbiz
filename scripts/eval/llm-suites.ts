// @version 1.0.0
/**
 * llm-suites.ts — opt-in LLM eval suites (review-ai2, stage-reco, committee,
 * dd-tailor, business-case) for Wave B-2.
 *
 * Every suite talks to the model through the injected `EvalLlm`, so unit tests
 * use a mock and never reach a provider. The real client wraps lib/llm.ts and
 * therefore returns provider-reported usage (B-1). Scoring is deterministic
 * (schema validity, key containment, number traceability): no LLM-as-judge.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { buildAi2ndMessages } from "../../app/web-next/lib/review/ai-second.ts";
import { selectReviewer } from "../../app/web-next/lib/review/domains.ts";
import { Ai2ndOutputSchema } from "../../app/web-next/lib/review/schema.ts";
import type { GateArtifact } from "../../app/web-next/lib/review/gate-artifacts.ts";
import { runOpportunityEvaluationChain } from "../../app/web-next/lib/agent-chains.ts";
import { parsePositionMeta } from "../../app/web-next/lib/committee-llm.ts";
import { parseDrafts } from "../../app/web-next/lib/llm-executors.ts";
import { promptSystem, systemMessage } from "../../app/web-next/lib/prompts.ts";
import { completeDetailed, completeStructured, type LlmMessage, type StructuredResult, type SynthesisResult } from "../../app/web-next/lib/llm.ts";
import { costUsd, type LlmUsage } from "../../app/web-next/lib/llm-usage.ts";
import type { LoadedCase } from "./loader.ts";
import type { GoldenSet } from "./loader.ts";
import type { CaseScore, CouldNotEvaluate, SuiteResult } from "./types.ts";

export interface EvalLlm {
  completeDetailed(messages: LlmMessage[], opts: { temperature?: number; maxTokens?: number }): Promise<{ text: string; usage: LlmUsage }>;
  completeStructured<T>(opts: { messages: LlmMessage[]; schema: z.ZodType<T>; schemaName: string; maxTokens?: number }): Promise<StructuredResult<T> | SynthesisResult>;
}

export const realEvalLlm: EvalLlm = {
  completeDetailed: (messages, opts) => completeDetailed(messages, opts),
  completeStructured: (opts) => completeStructured(opts),
};

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

// ── budget + usage accounting ──────────────────────────────────────────────

export class BudgetExceeded extends Error {}

export class RunLedger {
  input = 0;
  output = 0;
  cacheRead = 0;
  cacheWrite = 0;
  costUsd = 0;
  /** true once any call had no price: the budget cannot be enforced, so the run stops. */
  unpriced = false;
  calls = 0;
  models = new Set<string>();
  providers = new Set<string>();
  lastCallCost = 0;
  constructor(readonly maxCostUsd: number) {}

  /** Throws before a call that could exceed the budget (assumes the next call costs as much as the largest so far). */
  guard(): void {
    if (this.unpriced) throw new BudgetExceeded("model has no price in config/llm-pricing.yaml; cost cannot be bounded, stopping");
    if (this.costUsd + this.lastCallCost > this.maxCostUsd) {
      throw new BudgetExceeded(`budget $${this.maxCostUsd.toFixed(2)} would be exceeded (spent $${this.costUsd.toFixed(4)}, last call $${this.lastCallCost.toFixed(4)})`);
    }
  }

  record(u: LlmUsage): void {
    this.calls++;
    this.input += u.inputTokens;
    this.output += u.outputTokens;
    this.cacheRead += u.cacheReadTokens;
    this.cacheWrite += u.cacheWriteTokens;
    this.models.add(u.model);
    this.providers.add(u.provider);
    const c = costUsd(u);
    if (c === null) this.unpriced = true;
    else {
      this.costUsd += c;
      this.lastCallCost = Math.max(this.lastCallCost, c);
    }
  }
}

/** Wrap an EvalLlm so every call is budget-guarded and its usage lands in the ledger. */
export function metered(llm: EvalLlm, ledger: RunLedger): EvalLlm {
  return {
    async completeDetailed(messages, opts) {
      ledger.guard();
      const r = await llm.completeDetailed(messages, opts);
      ledger.record(r.usage);
      return r;
    },
    async completeStructured(opts) {
      ledger.guard();
      const r = await llm.completeStructured(opts);
      if (r.source === "llm") ledger.record(r.usage);
      return r;
    },
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

type Facts = Record<string, unknown>;

/** Recorded system-prompt hash per suite function (design §4.3). */
export function promptHashes(): Record<string, string> {
  const reviewer = buildAi2ndMessages(reviewArtifact("hash", {}), "pm", "functional", "technical")[0].content;
  return {
    "review-ai2": sha256(reviewer),
    committee: sha256(promptSystem("committee.position")),
    "dd-tailor": sha256(promptSystem("s9.dd_tailor")),
    "business-case": sha256(promptSystem("s8.business_case_prose")),
    "stage-reco": sha256(STAGE_RECO_PROMPT_SALT),
  };
}
// agent-chains builds its system prompts inline; the hash covers the chain's step schemas used for scoring.
const STAGE_RECO_PROMPT_SALT = "agent-chains.runOpportunityEvaluationChain/v1";

const words = (key: string): string[] => key.split("_").filter((w) => w.length >= 3).map((w) => w.slice(0, 5));

/** Finding-key match without an LLM judge: every significant word stem of the key appears in one item's claim+reason. */
export function raisesKey(items: Array<{ claim: string; reason: string }>, key: string): boolean {
  const stems = words(key);
  if (stems.length === 0) return false;
  return items.some((i) => {
    const t = `${i.claim} ${i.reason}`.toLowerCase();
    return stems.every((s) => t.includes(s));
  });
}

function reviewArtifact(caseId: string, facts: Facts): GateArtifact {
  return {
    gate: "screening",
    artifactKey: `eval:${caseId}`,
    entityType: "opportunity",
    entityId: caseId,
    stageId: "S7",
    stages: [],
    authorAgents: ["financial-analyst"],
    content: facts,
    contentHash: sha256(JSON.stringify(facts)),
  };
}

const factsOf = (lc: LoadedCase): Facts => lc.inputs.facts;
const caseName = (lc: LoadedCase): string => String(factsOf(lc).target ?? factsOf(lc).entities ?? lc.case.case_id);

/** Golden expects "not go": a red overall grade or a kill-criteria hit. null = no direction labelled. */
export function expectedNotGo(lc: LoadedCase): boolean | null {
  const exp = lc.case.expectations;
  if (exp.some((e) => (e.function === "rag_overall" && e.expected.overall === "red") || (e.function === "kill_criteria" && e.expected.hits.length > 0))) return true;
  return null;
}

// ── suites ─────────────────────────────────────────────────────────────────

export async function runReviewAi2Suite(set: GoldenSet, llm: EvalLlm): Promise<SuiteResult> {
  const cases: CaseScore[] = [];
  const cne: CouldNotEvaluate[] = [];
  let valid = 0;
  let attempted = 0;
  for (const lc of set.cases) {
    const exp = lc.case.expectations.find((e) => e.function === "review_findings");
    if (!exp || exp.function !== "review_findings") continue;
    const art = reviewArtifact(lc.case.case_id, factsOf(lc));
    const sel = selectReviewer(art.authorAgents);
    if (!sel.ok) {
      cne.push({ caseId: lc.case.case_id, fn: "review_findings", reason: sel.reason });
      continue;
    }
    attempted++;
    const messages = buildAi2ndMessages(art, sel.reviewerAgent, sel.reviewerDomain, sel.authorDomain);
    const r = await llm.completeStructured({ messages, schema: Ai2ndOutputSchema, schemaName: "ai_second_review", maxTokens: 1500 });
    if (r.source !== "llm") {
      cases.push({ caseId: lc.case.case_id, stage: exp.stage, fn: "review_findings", score: 0, failures: [`no valid structured output (${"reason" in r ? String(r.reason) : "synthesis"})`] });
      continue;
    }
    valid++;
    const items = [...r.value.verified, ...r.value.could_not_verify, ...r.value.needs_judgement];
    const missed = exp.expected.must_raise.filter((k) => !raisesKey(items, k));
    const declared = r.value.could_not_verify.length > 0;
    const failures = [...missed.map((k) => `finding not raised: ${k}`), ...(exp.expected.must_declare_could_not_verify && !declared ? ["no could_not_verify declared"] : [])];
    cases.push({ caseId: lc.case.case_id, stage: exp.stage, fn: "review_findings", score: (exp.expected.must_raise.length - missed.length) / exp.expected.must_raise.length, failures });
  }
  return { name: "review-ai2", kind: "llm", cases, couldNotEvaluate: cne, metrics: { schema_valid_rate: attempted ? valid / attempted : 0 } };
}

const FactorsOut = z.object({ opportunity: z.array(z.string()), risk: z.array(z.string()) });
const ViewOut = z.object({ view: z.string(), caution: z.string() });
const FitOut = z.object({ view: z.string(), verdict: z.enum(["Go", "Hold", "Kill"]), reason: z.string() });
const SynthOut = z.object({ answer: z.string(), conflicts: z.string() });
const CHAIN_SCHEMAS: Record<string, z.ZodType> = {
  "market-intelligence-agent": FactorsOut,
  "risk-officer": ViewOut,
  "process-governance-manager": FitOut,
  pm: SynthOut,
};

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return undefined;
  }
}

export async function runStageRecoSuite(set: GoldenSet, llm: EvalLlm): Promise<SuiteResult> {
  const cases: CaseScore[] = [];
  let steps = 0;
  let validSteps = 0;
  for (const lc of set.cases) {
    const f = factsOf(lc);
    const texts = new Map<string, string>();
    const ask: Parameters<typeof runOpportunityEvaluationChain>[1] = async (agent, system, user, fallback, maxTokens) => {
      try {
        const r = await llm.completeDetailed([{ role: "system", content: system }, { role: "user", content: user }], { temperature: 0, maxTokens });
        texts.set(agent.key, r.text);
        return { text: r.text, source: "llm" };
      } catch (err) {
        if (err instanceof BudgetExceeded) throw err;
        return { text: fallback(), source: "synthesis" };
      }
    };
    await runOpportunityEvaluationChain(
      {
        opportunityId: lc.case.case_id,
        name: caseName(lc),
        marketScope: typeof f.relevant_market === "string" ? f.relevant_market : null,
        rationale: typeof f.stated_rationale === "string" ? f.stated_rationale : JSON.stringify(f).slice(0, 600),
        attractivenessScore: null,
        factors: { opportunity: [], risk: [] },
      },
      ask,
    );
    const failures: string[] = [];
    let ok = 0;
    for (const [key, schema] of Object.entries(CHAIN_SCHEMAS)) {
      steps++;
      const text = texts.get(key);
      if (text !== undefined && schema.safeParse(parseJsonLoose(text)).success) {
        ok++;
        validSteps++;
      } else failures.push(`step ${key}: reply not schema-valid`);
    }
    let score = ok / Object.keys(CHAIN_SCHEMAS).length;
    const dir = expectedNotGo(lc);
    if (dir) {
      const fit = FitOut.safeParse(parseJsonLoose(texts.get("process-governance-manager") ?? ""));
      if (fit.success && fit.data.verdict === "Go") {
        failures.push("direction: golden expects not-Go (red/kill), chain proposed Go");
        score = Math.min(score, 0.5);
      }
    }
    cases.push({ caseId: lc.case.case_id, stage: "S3", fn: "stage_reco", score, failures });
  }
  return { name: "stage-reco", kind: "llm", cases, couldNotEvaluate: [], metrics: { schema_valid_rate: steps ? validSteps / steps : 0 } };
}

export async function runCommitteeSuite(set: GoldenSet, llm: EvalLlm): Promise<SuiteResult> {
  const cases: CaseScore[] = [];
  let valid = 0;
  for (const lc of set.cases) {
    const agentKey = "risk-officer";
    const prompt = `Deal: ${caseName(lc)}\nFacts (public, pre-decision): ${JSON.stringify(factsOf(lc)).slice(0, 1500)}\nGive your position.`;
    const r = await llm.completeDetailed([systemMessage("committee.position"), { role: "user", content: `당신은 ${agentKey} 입니다.\n\n${prompt}` }], { temperature: 0, maxTokens: 900 });
    const meta = parsePositionMeta(r.text);
    const failures: string[] = [];
    let score = 1;
    if (!meta || meta.recommendation === undefined) {
      failures.push("position-meta tail missing or invalid");
      score = 0;
    } else {
      valid++;
      if (expectedNotGo(lc) && meta.recommendation === "go") {
        failures.push("vote: golden expects not-go (red/kill), member voted go");
        score = 0.5;
      }
    }
    cases.push({ caseId: lc.case.case_id, stage: "S7", fn: "committee_position", score, failures });
  }
  return { name: "committee", kind: "llm", cases, couldNotEvaluate: set.cases.length ? [{ caseId: "*", fn: "committee.dissent", reason: "golden set has no committee-vote expectation type; only schema validity and not-go direction are scored" }] : [], metrics: { schema_valid_rate: set.cases.length ? valid / set.cases.length : 0 } };
}

export async function runDdTailorSuite(set: GoldenSet, llm: EvalLlm): Promise<SuiteResult> {
  const cases: CaseScore[] = [];
  const cne: CouldNotEvaluate[] = [];
  let valid = 0;
  let n = 0;
  for (const lc of set.cases) {
    const exp = lc.case.expectations.find((e) => e.function === "dd_tailoring");
    if (!exp) continue;
    n++;
    const r = await llm.completeDetailed([systemMessage("s9.dd_tailor"), { role: "user", content: `도메인: legal\n산업: ${String(factsOf(lc).relevant_market ?? caseName(lc))}\n프로젝트: ${lc.case.case_id}` }], { temperature: 0, maxTokens: 1400 });
    const drafts = parseDrafts(r.text);
    const failures: string[] = [];
    if (drafts.length === 0) failures.push("no parseable tailored items");
    else valid++;
    if (drafts.some((d) => d.sourceUrl !== null || d.sourceReliability !== "C")) failures.push("tailor cited a source (ADR-0099 6 forbids)");
    cases.push({ caseId: lc.case.case_id, stage: exp.stage, fn: "dd_tailoring", score: failures.length === 0 ? 1 : 0, failures });
  }
  if (n > 0) cne.push({ caseId: "*", fn: "dd_tailoring.required_items", reason: "the tailor executor proposes additional items and does not take the base checklist, so retention of required items cannot be measured yet" });
  return { name: "dd-tailor", kind: "llm", cases, couldNotEvaluate: cne, metrics: { schema_valid_rate: n ? valid / n : 0 } };
}

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const normNums = (s: string): string[] => (s.match(NUM_RE) ?? []).map((x) => x.replace(/,/g, ""));

export async function runBusinessCaseSuite(set: GoldenSet, llm: EvalLlm): Promise<SuiteResult> {
  const cases: CaseScore[] = [];
  let valid = 0;
  for (const lc of set.cases) {
    const block = Object.entries(factsOf(lc))
      .filter(([, v]) => typeof v === "number" || typeof v === "string")
      .map(([k, v]) => `- ${k}: ${String(v)}`)
      .join("\n");
    const r = await llm.completeDetailed([systemMessage("s8.business_case_prose"), { role: "user", content: `단계/역할: valuation-agent\n시나리오: base\n\n[확정 수치 블록]\n${block}` }], { temperature: 0, maxTokens: 800 });
    const text = r.text.trim();
    const failures: string[] = [];
    if (!text) {
      cases.push({ caseId: lc.case.case_id, stage: "S8", fn: "business_case_prose", score: 0, failures: ["empty prose"] });
      continue;
    }
    valid++;
    const allowed = new Set(normNums(block));
    const out = normNums(text);
    const untraced = out.filter((x) => !allowed.has(x));
    if (untraced.length > 0) failures.push(`numbers not in input block: ${[...new Set(untraced)].slice(0, 6).join(", ")}`);
    cases.push({ caseId: lc.case.case_id, stage: "S8", fn: "business_case_prose", score: out.length === 0 ? 1 : (out.length - untraced.length) / out.length, failures });
  }
  return { name: "business-case", kind: "llm", cases, couldNotEvaluate: [], metrics: { schema_valid_rate: set.cases.length ? valid / set.cases.length : 0 } };
}

export const LLM_SUITES = {
  "review-ai2": runReviewAi2Suite,
  "stage-reco": runStageRecoSuite,
  committee: runCommitteeSuite,
  "dd-tailor": runDdTailorSuite,
  "business-case": runBusinessCaseSuite,
} as const;
export type LlmSuiteName = keyof typeof LLM_SUITES;
