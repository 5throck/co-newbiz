// @version 1.0.0
/**
 * deterministic.ts — offline eval suites (rag, kill, antitrust) for Wave B-2.
 *
 * These score the real deterministic engines (db/lib/rag-engine.ts, the
 * kill-criteria registry + predicate evaluator) against the golden set. The
 * golden fixtures carry prose-level facts, not engine-ready inputs, so each
 * suite derives engine inputs ONLY where the fixture supplies the structured
 * value. An expectation whose input the fixture cannot supply is reported under
 * "could not evaluate" — it is never scored as pass or fail, and never guessed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateRag, RAG_DIMENSIONS, type RagEvaluationInput, type RagDimension, type StageGate } from "../../db/lib/rag-engine.ts";
import { evaluatePredicate, parsePredicate, type VarLookup } from "../../db/lib/predicate.ts";
import type { Expectation } from "../../tests/eval/golden/schema.ts";
import { ROOT, type GoldenSet, type LoadedCase } from "./loader.ts";
import { meanScore, type CaseScore, type CouldNotEvaluate, type SuiteResult } from "./types.ts";

type Facts = Record<string, unknown>;
const isObj = (v: unknown): v is Facts => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function factsFor(lc: LoadedCase, basis: "pre_decision" | "post_decision"): Facts {
  return basis === "post_decision" ? { ...lc.inputs.facts, ...(lc.postDecision?.facts ?? {}) } : lc.inputs.facts;
}

// ── antitrust derivation (2023 DOJ/FTC presumption zone, per kill-criteria registry) ──

export const PRESUMPTION_HHI_AFTER = 1800;
export const PRESUMPTION_HHI_DELTA = 100;

export interface HhiScreen {
  /** Lower-bound post-merger HHI from the listed shares only. */
  hhiAfterLowerBound: number;
  delta: number;
  presumption: boolean;
}

/** Needs `pre_deal_shares_pct` listing exactly the two merging parties (or all market players with `merging_parties`). */
export function hhiScreen(facts: Facts): HhiScreen | null {
  const shares = facts.pre_deal_shares_pct;
  if (!isObj(shares)) return null;
  const entries = Object.entries(shares).filter((e): e is [string, number] => isNum(e[1]));
  if (entries.length < 2) return null;
  const merging = Array.isArray(facts.merging_parties) ? (facts.merging_parties as string[]) : entries.length === 2 ? entries.map((e) => e[0]) : null;
  if (!merging) return null;
  const mergers = entries.filter(([n]) => merging.includes(n));
  const others = entries.filter(([n]) => !merging.includes(n));
  if (mergers.length !== 2) return null;
  const combined = mergers[0][1] + mergers[1][1];
  const delta = 2 * mergers[0][1] * mergers[1][1];
  const after = combined ** 2 + others.reduce((a, [, s]) => a + s ** 2, 0);
  return { hhiAfterLowerBound: after, delta, presumption: after > PRESUMPTION_HHI_AFTER && delta > PRESUMPTION_HHI_DELTA };
}

function scoreFlags(checks: Array<{ key: string; ok: boolean }>): { score: number; failures: string[] } {
  const failures = checks.filter((c) => !c.ok).map((c) => c.key);
  return { score: checks.length === 0 ? 0 : (checks.length - failures.length) / checks.length, failures };
}

export function runAntitrustSuite(set: GoldenSet): SuiteResult {
  const cases: CaseScore[] = [];
  const cne: CouldNotEvaluate[] = [];
  for (const lc of set.cases) {
    for (const e of lc.case.expectations) {
      if (e.function !== "antitrust_flags") continue;
      const facts = factsFor(lc, e.input_basis);
      const checks: Array<{ key: string; ok: boolean }> = [];
      const x = e.expected;
      if (x.jurisdictions !== undefined) {
        if (Array.isArray(facts.jurisdictions)) {
          const got = [...(facts.jurisdictions as string[])].sort().join(",");
          checks.push({ key: `jurisdictions(got ${got})`, ok: got === [...x.jurisdictions].sort().join(",") });
        } else cne.push({ caseId: lc.case.case_id, fn: "antitrust_flags.jurisdictions", reason: "fixture has no `jurisdictions` list" });
      }
      if (x.multi_jurisdiction !== undefined) {
        if (Array.isArray(facts.jurisdictions)) checks.push({ key: "multi_jurisdiction", ok: ((facts.jurisdictions as unknown[]).length > 1) === x.multi_jurisdiction });
        else cne.push({ caseId: lc.case.case_id, fn: "antitrust_flags.multi_jurisdiction", reason: "fixture has no `jurisdictions` list" });
      }
      if (x.hhi_flag !== undefined) {
        const h = hhiScreen(facts);
        if (h) checks.push({ key: `hhi_flag(delta ${Math.round(h.delta)}, after>=${Math.round(h.hhiAfterLowerBound)})`, ok: (h.presumption ? "high" : "not_high") === (x.hhi_flag === "high" ? "high" : "not_high") });
        else cne.push({ caseId: lc.case.case_id, fn: "antitrust_flags.hhi_flag", reason: "fixture lacks the two merging parties' individual pre-deal shares" });
      }
      for (const k of ["filing_required", "combination_type", "product_overlap", "certain_block", "relevant_markets"] as const) {
        if (x[k] !== undefined) cne.push({ caseId: lc.case.case_id, fn: `antitrust_flags.${k}`, reason: "judgement/threshold input not in fixture; no deterministic engine to score" });
      }
      if (checks.length > 0) {
        const s = scoreFlags(checks);
        cases.push({ caseId: lc.case.case_id, stage: e.stage, fn: "antitrust_flags", score: s.score, failures: s.failures });
      }
    }
  }
  return { name: "antitrust", kind: "deterministic", cases, couldNotEvaluate: cne, metrics: {} };
}

// ── rag ────────────────────────────────────────────────────────────────────

type ExpGrade = "green" | "amber" | "red" | "not_graded";
const GRADE_RANK: Record<string, number> = { green: 0, amber: 1, red: 2 };

function remedyFrom(reg: unknown): RagEvaluationInput["regulatory"] | undefined {
  if (!isObj(reg)) return undefined;
  if (reg.outcome === "prohibition") return { remedyType: "prohibited" };
  const t = reg.remedy_type;
  if (t === "structural") return { remedyType: "structural", dischargeConfirmedAt: reg.condition_status === "discharged" && typeof reg.discharged_at === "string" ? reg.discharged_at : null };
  if (t === "behavioral") return { remedyType: "behavioral", obligationActive: reg.obligation_active !== false };
  if (t === "none") return { remedyType: "none" };
  return undefined;
}

export function ragInputFromFacts(gate: StageGate, facts: Facts): { input: RagEvaluationInput; derived: Set<RagDimension> } {
  const input: RagEvaluationInput = { stageGate: gate };
  const derived = new Set<RagDimension>();
  const fin = facts.financial;
  if (isObj(fin) && isNum(fin.irr) && isNum(fin.hurdle) && isNum(fin.dscrDownside)) {
    input.financial = { irr: fin.irr, hurdle: fin.hurdle, dscrDownside: fin.dscrDownside };
    derived.add("financial");
  }
  const reg = remedyFrom(facts.regulatory);
  if (reg) {
    input.regulatory = reg;
    derived.add("regulatory_permit");
  }
  if (facts.chain_grade === "A" || facts.chain_grade === "B" || facts.chain_grade === "C") {
    input.chainGrade = facts.chain_grade;
    derived.add("data_confidence");
  }
  for (const [k, dim, prop] of [["market_grade", "market", "marketGrade"], ["technical_grade", "technical_execution", "technicalGrade"], ["risk_grade", "risk", "riskGrade"]] as const) {
    const g = facts[k];
    if (g === "green" || g === "amber" || g === "red") {
      input[prop] = g;
      derived.add(dim);
    }
  }
  return { input, derived };
}

export function runRagSuite(set: GoldenSet): SuiteResult {
  const cases: CaseScore[] = [];
  const cne: CouldNotEvaluate[] = [];
  for (const lc of set.cases) {
    for (const e of lc.case.expectations) {
      if (e.function !== "rag_dimensions" && e.function !== "rag_overall" && e.function !== "confidence_cap") continue;
      const facts = factsFor(lc, e.input_basis);
      const { input, derived } = ragInputFromFacts(e.gate as StageGate, facts);
      const killHit = killHitsFor(lc, e.gate, facts).hits.length > 0;
      if (killHit) input.killCriteriaTriggered = true;
      const ev = evaluateRag(input);
      const dimOf = (d: RagDimension): ExpGrade => {
        const a = ev.dimensions.find((x) => x.dimension === d);
        return !a || !a.assessed ? "not_graded" : a.grade;
      };
      const checks: Array<{ key: string; ok: boolean }> = [];
      const id = lc.case.case_id;
      if (e.function === "rag_dimensions") {
        for (const [d, want] of Object.entries(e.expected) as Array<[RagDimension, ExpGrade]>) {
          // reduced-check financial at screening/pre_fs is an assessed policy grade, so not_graded is only expectable from FS on.
          if (want !== "not_graded" && !derived.has(d)) {
            cne.push({ caseId: id, fn: `rag_dimensions.${d}`, reason: `fixture lacks the structured input for ${d}` });
            continue;
          }
          const got = dimOf(d);
          const ok =
            got === want ||
            (e.tolerance === "one_grade" && want !== "not_graded" && got !== "not_graded" && Math.abs(GRADE_RANK[got] - GRADE_RANK[want]) <= 1);
          checks.push({ key: `${d}: expected ${want}, got ${got}`, ok });
        }
      } else if (e.function === "rag_overall") {
        const want = e.expected.overall;
        const dangerSignal = ev.overall !== null;
        if (want !== "not_graded" && !dangerSignal) {
          cne.push({ caseId: id, fn: "rag_overall", reason: `expected ${want} needs structured inputs (kill-criteria var or graded dimensions) the fixture lacks` });
        } else {
          const got = ev.overall?.grade ?? "not_graded";
          checks.push({ key: `overall: expected ${want}, got ${got}`, ok: got === want });
          checks.push({ key: `complete: expected ${e.expected.complete}, got ${ev.complete}`, ok: ev.complete === e.expected.complete });
        }
      } else {
        const dc = dimOf("data_confidence");
        const capApplies = dc !== "not_graded" && dc !== "green";
        checks.push({ key: `data_confidence: expected ${e.expected.data_confidence}, got ${dc}`, ok: dc === e.expected.data_confidence });
        checks.push({ key: `cap_applies: expected ${e.expected.cap_applies}, got ${capApplies}`, ok: capApplies === e.expected.cap_applies });
      }
      if (checks.length > 0) {
        const s = scoreFlags(checks);
        cases.push({ caseId: id, stage: e.stage, fn: e.function, score: s.score, failures: s.failures });
      }
    }
  }
  return { name: "rag", kind: "deterministic", cases, couldNotEvaluate: cne, metrics: {} };
}

// ── kill ───────────────────────────────────────────────────────────────────

interface RegistryJson { procedure: string; criterion_id: string; predicate: unknown; enabled: boolean }

const REGISTRY_DIR = join(ROOT, "procedures", "_kill-criteria");

function procedureFor(dealType: string, gate: string): string | null {
  const prefix = dealType === "brownfield" ? "brownfield" : dealType === "greenfield" ? "greenfield" : null;
  if (!prefix) return null;
  const suffix: Record<string, string> = { screening: "screening", pre_fs: "pre-fs", fs: "fs", dd: "dd" };
  return suffix[gate] ? `${prefix}-${suffix[gate]}` : null;
}

function registryFor(procedure: string): RegistryJson[] {
  return readdirSync(REGISTRY_DIR)
    .filter((f) => f.startsWith(`${procedure}__`) && f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(REGISTRY_DIR, f), "utf-8")) as RegistryJson)
    .filter((r) => r.enabled && r.predicate !== null && r.predicate !== undefined);
}

export function killHitsFor(lc: LoadedCase, gate: string, facts: Facts): { hits: string[]; unassessed: string[]; falses: string[]; evaluable: boolean } {
  const proc = procedureFor(lc.case.deal_type, gate);
  if (!proc) return { hits: [], unassessed: [], falses: [], evaluable: false };
  const screen = hhiScreen(facts);
  const lookup: VarLookup = (key) =>
    key === "antitrust.presumption_screens_triggered" && screen ? { status: "present", value: screen.presumption ? 1 : 0 } : undefined;
  const out = { hits: [] as string[], unassessed: [] as string[], falses: [] as string[], evaluable: true };
  for (const r of registryFor(proc)) {
    const t = evaluatePredicate(parsePredicate(r.predicate), lookup);
    (t === "true" ? out.hits : t === "false" ? out.falses : out.unassessed).push(r.criterion_id);
  }
  return out;
}

export function runKillSuite(set: GoldenSet): SuiteResult {
  const cases: CaseScore[] = [];
  const cne: CouldNotEvaluate[] = [];
  for (const lc of set.cases) {
    for (const e of lc.case.expectations as Expectation[]) {
      if (e.function !== "kill_criteria") continue;
      const id = lc.case.case_id;
      const r = killHitsFor(lc, e.gate, factsFor(lc, e.input_basis));
      if (!r.evaluable) {
        cne.push({ caseId: id, fn: "kill_criteria", reason: `no kill-criteria registry for ${lc.case.deal_type}/${e.gate}` });
        continue;
      }
      const failures: string[] = [];
      const expectedEvaluable = e.expected.hits.filter((h) => {
        if (r.unassessed.includes(h)) {
          cne.push({ caseId: id, fn: `kill_criteria.${h}`, reason: "predicate variable not supplied by the fixture (UNASSESSED)" });
          return false;
        }
        return true;
      });
      const tp = expectedEvaluable.filter((h) => r.hits.includes(h)).length;
      const fn = expectedEvaluable.length - tp;
      const fp = r.hits.filter((h) => !e.expected.hits.includes(h)).length;
      for (const h of expectedEvaluable) if (!r.hits.includes(h)) failures.push(`missed hit ${h}`);
      for (const h of r.hits) if (!e.expected.hits.includes(h)) failures.push(`unexpected hit ${h} (golden expects ${JSON.stringify(e.expected.hits)})`);
      for (const k of e.expected.not_evaluable ?? []) {
        if (!r.unassessed.includes(k)) failures.push(`${k} should be UNASSESSED, was ${r.hits.includes(k) ? "true" : r.falses.includes(k) ? "false" : "absent from registry"}`);
      }
      const denom = tp + fp + fn;
      const score = failures.length === 0 ? 1 : denom === 0 ? 0 : Math.min(tp / denom, 0.99);
      cases.push({ caseId: id, stage: e.stage, fn: "kill_criteria", score, failures });
    }
  }
  return { name: "kill", kind: "deterministic", cases, couldNotEvaluate: cne, metrics: {} };
}

// ── thresholds (regression gates, design §9; not proofs of accuracy) ───────

/** Minimum mean score per deterministic suite. Set at the recorded baseline; raise only with a golden VERSION bump. */
export const DETERMINISTIC_THRESHOLDS: Record<string, number> = { rag: 1, kill: 0.85, antitrust: 1 };

export function runDeterministicSuites(set: GoldenSet): SuiteResult[] {
  return [runRagSuite(set), runKillSuite(set), runAntitrustSuite(set)];
}

export function checkThresholds(results: SuiteResult[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    const min = DETERMINISTIC_THRESHOLDS[r.name];
    const m = meanScore(r.cases);
    if (min !== undefined && (m === null || m + 1e-9 < min)) out.push(`${r.name}: mean ${m === null ? "n/a" : m.toFixed(3)} < threshold ${min}`);
  }
  return out;
}

export { RAG_DIMENSIONS };
