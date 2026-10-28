// @version 1.0.0
/**
 * Deterministic downside DSCR / covenant test for the S10 financing plan
 * (Monte Carlo verification D1, owner decision 2026-10-28, ADR-0187 decision log).
 *
 * Replaces the dead "latest simulation + covenant_test rows" reads: nothing in the product
 * ever wrote those rows, so every debt project was permanently blocked at S10. Here the DSCR is
 * COMPUTED, never looked up:
 *
 *   CFADS_t  = free cash flow of the ADOPTED S8 case's DOWNSIDE scenario, year t = 1..H
 *              (deterministic year table, exit/disposal value excluded). Falls back to the BASE
 *              scenario ONLY when the project has no downside case, and says so.
 *   service_t = sum over debt_instrument rows of interest + scheduled principal in year t
 *   DSCR_t   = CFADS_t / service_t              (only years with service_t > 0)
 *
 * Debt terms come from debt_instrument: principal (KRW millions, ADR-0061), rate (PERCENT, as the
 * /debt page and POST write it), maturity (a tenor like "5년"/"5y"/"5", or a date measured from the
 * S8 adoption date - never from "now", so the result does not drift with the clock), amortization
 * (annuity | equal_principal | bullet; KR synonyms accepted), covenant_json (DSCR thresholds).
 * Missing/unreadable inputs return `insufficient_evidence` naming the input - never a guess.
 *
 * Conservative by construction: the check is a screen on the deterministic downside, not a
 * lender model (no grace period, no refinancing, no cash sweep). Non-DSCR covenants (NetLev etc.)
 * need balance-sheet inputs the product does not hold; they are listed as untested, not invented.
 *
 * One function feeds every consumer: s10-checks (gate), covenant-headroom (debt route, IC package,
 * heatmap, report) and db/lib/snapshot-filler (RAG `risk.covenants_breached`).
 */
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { caseInputsForProject, caseInputsForTarget, deterministicCaseYearTable, listShortlistSubjects } from "./business-case-generator.ts";
import { adoptedModelId } from "./greenfield-execution.ts";

/**
 * D2 starting value 1.2x (2026-10-27, ADR-0187) raised to 1.3x by owner decision 2026-10-29, aligning the gate with the
 * RAG rule (Green requires downside DSCR >= 1.3x, D-M3-1): downside DSCR headroom of at least 1.3x - the minimum
 * projected DSCR across periods must be >= this multiple. Owner of the value: risk-officer +
 * quant-methodologist. Re-exported by s10-checks (the gate that applies it).
 */
export const S10_MIN_DOWNSIDE_DSCR = 1.3;

export type Amortization = "annuity" | "equal_principal" | "bullet";
export type DscrReason = "no_debt" | "no_adopted_case" | "missing_input" | "no_cash_flows";

export interface DscrPeriod {
  year: number;
  cfads: number;
  debt_service: number;
  dscr: number | null;
}

export interface DscrCovenantTest {
  period_id: string;
  covenant_key: string;
  threshold: number;
  projected_value: number;
  breached: 0 | 1;
  direction: "min" | "max";
}

export interface DscrReport {
  status: "computed" | "insufficient_evidence";
  reason?: DscrReason;
  /** Korean message naming the missing input / the unusable case (insufficient_evidence only). */
  message: string | null;
  /** Names of the inputs that are missing, e.g. `만기/상환기간(maturity) [Bank A]`. */
  missing_inputs: string[];
  scenario: "downside" | "base" | null;
  /** True when the base scenario was used because the project has no downside case. */
  fallback_to_base: boolean;
  case_id: string | null;
  periods: DscrPeriod[];
  min_dscr: number | null;
  min_dscr_year: number | null;
  covenant_tests: DscrCovenantTest[];
  breached_periods: number;
  /** Periods below max(declared DSCR covenant, S10 floor) - what `risk.covenants_breached` counts. */
  rag_breached_periods: number;
  /** Provenance for evidence_ref: adopted case, scenario, source model, driver hash. */
  evidence: string | null;
  /** Declared covenant keys the product cannot compute (e.g. NetLev). */
  untested_covenants: string[];
  /** Non-blocking notes a person must read. */
  advisories: string[];
}

const empty = (): DscrReport => ({
  status: "insufficient_evidence", message: null, missing_inputs: [], scenario: null, fallback_to_base: false, case_id: null,
  periods: [], min_dscr: null, min_dscr_year: null, covenant_tests: [], breached_periods: 0, rag_breached_periods: 0, evidence: null, untested_covenants: [], advisories: [],
});
const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface DebtRow {
  id: string;
  lender: string | null;
  principal: number;
  rate: number;
  maturity: string | null;
  amortization: string | null;
  covenant_json: string | null;
}

export function parseAmortization(raw: string | null | undefined): Amortization | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/equal[\s_-]*principal|straight|linear|원금\s*균등|균등\s*분할|원금균등/.test(v)) return "equal_principal";
  if (/annuity|level|mortgage|equal[\s_-]*payment|원리금|연금/.test(v)) return "annuity";
  if (/bullet|balloon|at[\s_-]*maturity|만기\s*일시|일시\s*상환/.test(v)) return "bullet";
  return null;
}

/**
 * Tenor in whole years. A bare number / "5y" / "5년" is a tenor; a date (YYYY, YYYY-MM, YYYY-MM-DD)
 * is a maturity measured from `refIso` (the S8 adoption timestamp), rounded DOWN to whole years (minimum 1): a shorter tenor means more debt service per year, so the screen stays conservative.
 * Returns null when unreadable or not after the reference date.
 */
export function parseTenorYears(raw: string | null | undefined, refIso: string | null): number | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const tenor = v.match(/^(\d+(?:\.\d+)?)\s*(?:y|yr|yrs|year|years|년)?$/i);
  if (tenor && !/^(19|20)\d{2}$/.test(tenor[1])) {
    const n = Number(tenor[1]);
    return n > 0 && n <= 50 ? Math.max(1, Math.floor(n)) : null;
  }
  const date = v.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!date || !refIso) return null;
  const iso = date[3] ? v : date[2] ? `${v}-01` : `${v}-12-31`;
  const end = Date.parse(`${iso}T00:00:00Z`);
  const ref = Date.parse(refIso);
  if (!Number.isFinite(end) || !Number.isFinite(ref)) return null;
  const years = (end - ref) / (365.25 * 24 * 3600 * 1000);
  return years > 0 ? Math.max(1, Math.floor(years + 1e-9)) : null;
}

interface DeclaredCovenant { key: string; direction: "min" | "max"; value: number }

/** Covenant thresholds out of covenant_json (JSON object/array or "DSCR >= 1.3 · NetLev <= 3.5x"). */
export function parseDeclaredCovenants(raw: string | null | undefined): DeclaredCovenant[] {
  if (!raw?.trim()) return [];
  const out: DeclaredCovenant[] = [];
  const norm = (k: string) => k.trim().replace(/[_-]?(min|max|floor|ceiling)$/i, "");
  const dirOfKey = (k: string): "min" | "max" => (/(max|ceiling|upper|상한)/i.test(k) ? "max" : "min");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    for (const m of raw.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*(>=|<=|≥|≤|>|<)\s*([0-9.]+)/g)) {
      out.push({ key: m[1], direction: /^(>=|≥|>)$/.test(m[2]) ? "min" : "max", value: Number(m[3]) });
    }
    return out;
  }
  const fromSpec = (key: string, spec: unknown) => {
    if (typeof spec === "number") out.push({ key: norm(key), direction: dirOfKey(key), value: spec });
    else if (spec && typeof spec === "object") {
      const o = spec as Record<string, unknown>;
      if (typeof o.min === "number") out.push({ key: norm(key), direction: "min", value: o.min });
      else if (typeof o.max === "number") out.push({ key: norm(key), direction: "max", value: o.max });
      else if (typeof o.threshold === "number" || typeof o.value === "number") {
        out.push({ key: norm(key), direction: o.direction === "max" || o.type === "max" ? "max" : "min", value: (o.threshold ?? o.value) as number });
      }
    }
  };
  if (Array.isArray(parsed)) {
    for (const e of parsed) if (e && typeof e === "object" && typeof (e as { key?: unknown }).key === "string") fromSpec((e as { key: string }).key, e);
  } else if (parsed && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) fromSpec(k, v);
  }
  return out.filter((c) => Number.isFinite(c.value));
}

/** Year-t debt service (interest + scheduled principal) of one instrument; 0 after maturity. */
export function debtServiceByYear(principal: number, ratePct: number, tenor: number, amortization: Amortization): number[] {
  const r = ratePct / 100;
  const out: number[] = [];
  let balance = principal;
  const annuity = r > 0 ? (principal * r) / (1 - Math.pow(1 + r, -tenor)) : principal / tenor;
  for (let t = 1; t <= tenor; t++) {
    const interest = balance * r;
    const repay = amortization === "bullet" ? (t === tenor ? balance : 0) : amortization === "equal_principal" ? principal / tenor : annuity - interest;
    const principalPaid = Math.min(balance, Math.max(0, repay));
    out.push(interest + principalPaid);
    balance -= principalPaid;
  }
  return out;
}

interface Cfads {
  caseId: string;
  /** The model whose frozen snapshot supplied the flows (adopted case, or its same-round downside/base sibling). */
  sourceModelId: string;
  scenario: "downside" | "base";
  fallback: boolean;
  adoptedAt: string | null;
  years: Array<{ year: number; cfads: number }>;
  inputsHash: string;
  stale: boolean;
  legacy: boolean;
}

/** Models of one generation round are created within seconds of each other; siblings must fall inside this window. */
export const SAME_ROUND_WINDOW_MS = 30 * 60 * 1000;

interface FrozenFlows { years: Array<{ year: number; fcf: number }>; exit_value: number; horizon: number }

function snapshotOf(inputsJson: string | null): { flows: FrozenFlows | null; hash: string } {
  if (!inputsJson) return { flows: null, hash: "none" };
  try {
    const spec = JSON.parse(inputsJson) as { deterministic_flows?: FrozenFlows; cases?: Array<{ drivers?: unknown }> };
    const hash = createHash("sha256").update(JSON.stringify(spec.cases?.[0]?.drivers ?? null)).digest("hex").slice(0, 12);
    const f = spec.deterministic_flows;
    return { flows: f && Array.isArray(f.years) ? f : null, hash };
  } catch {
    return { flows: null, hash: "unreadable" };
  }
}

function liveYears(db: Database, projectId: string, model: { variant: "market_forward" | "historical"; target_id: string | null }, scenario: "downside" | "base"): Array<{ year: number; cfads: number }> {
  let inputs = caseInputsForProject(projectId);
  if (model.target_id) {
    const opp = (db.query("SELECT source_opportunity_id AS o FROM md_project WHERE id = ?").get(projectId) as { o: string | null } | null)?.o;
    const subject = opp ? listShortlistSubjects(db as never, opp).find((s) => s.id === model.target_id) : undefined;
    inputs = caseInputsForTarget(projectId, { id: model.target_id, companyId: subject?.companyId ?? null }, inputs);
  }
  const table = deterministicCaseYearTable(inputs, scenario, model.variant);
  // The last year's fcf carries the exit/disposal value; debt service is not paid from a sale.
  return table.rows.filter((r) => r.year >= 1).map((r) => ({ year: r.year, cfads: r.year === table.horizon ? r.fcf - table.exitValue : r.fcf }));
}

/**
 * The adopted case's per-year CFADS from its FROZEN snapshot (business_case_model.inputs_json
 * `deterministic_flows`, written at generation), so a verdict never moves because live inputs
 * moved. The downside is the same-generation-round sibling (same variant/target, nearest in time
 * within SAME_ROUND_WINDOW_MS); base only if no downside exists in the round. If the live inputs
 * now produce different flows the case is stale: judged on the snapshot, flagged in an advisory.
 * Snapshots that predate frozen flows fall back to live inputs, with an advisory.
 */
function adoptedCfads(db: Database, projectId: string): Cfads | { missing: string } {
  const modelId = adoptedModelId(projectId, db);
  if (!modelId) return { missing: "S8 채택 Business Case" };
  const model = db
    .query("SELECT id, created_at, COALESCE(variant, 'market_forward') AS variant, target_id FROM business_case_model WHERE id = ? AND project_id = ?")
    .get(modelId, projectId) as { id: string; created_at: string; variant: "market_forward" | "historical"; target_id: string | null } | null;
  if (!model) return { missing: "S8 채택 Business Case 모델" };
  const adoptedAt = (db
    .query("SELECT started_at AS at FROM process_run WHERE entity_type = 'project' AND entity_id = ? AND stage = 's8_case_adopt' AND status = 'done' ORDER BY started_at DESC, id DESC LIMIT 1")
    .get(projectId) as { at: string } | null)?.at ?? model.created_at;
  const round = db
    .query(
      `SELECT m.id, m.created_at, m.inputs_json, (SELECT v.scenario FROM valuation_simulation v WHERE v.model_id = m.id LIMIT 1) AS scenario
       FROM business_case_model m
       WHERE m.project_id = ? AND m.archived_at IS NULL AND COALESCE(m.variant, 'market_forward') = ? AND COALESCE(m.target_id, '') = ?`,
    )
    .all(projectId, model.variant, model.target_id ?? "") as Array<{ id: string; created_at: string; inputs_json: string | null; scenario: string | null }>;
  const t0 = Date.parse(model.created_at);
  const pick = (scenario: string) =>
    round
      .filter((m) => m.scenario === scenario && Math.abs(Date.parse(m.created_at) - t0) <= SAME_ROUND_WINDOW_MS)
      .sort((a, b) => Math.abs(Date.parse(a.created_at) - t0) - Math.abs(Date.parse(b.created_at) - t0))[0];
  const down = pick("downside");
  const chosen = down ?? pick("base");
  if (!chosen) return { missing: "채택 케이스와 같은 생성 회차의 다운사이드/기준 시나리오 케이스" };
  const scenario = down ? "downside" : "base";
  const snap = snapshotOf(chosen.inputs_json);
  let years: Array<{ year: number; cfads: number }>;
  let stale = false;
  let legacy = false;
  if (snap.flows) {
    years = snap.flows.years.map((y) => ({ year: y.year, cfads: y.year === snap.flows!.horizon ? y.fcf - snap.flows!.exit_value : y.fcf }));
    try {
      const live = liveYears(db, projectId, model, scenario);
      stale = live.length !== years.length || live.some((l, i) => Math.abs(l.cfads - years[i].cfads) > 0.01);
    } catch {
      stale = false; // live inputs unavailable: nothing to compare against
    }
  } else {
    legacy = true;
    years = liveYears(db, projectId, model, scenario);
  }
  return { caseId: modelId, sourceModelId: chosen.id, scenario, fallback: !down, adoptedAt, years, inputsHash: snap.hash, stale, legacy };
}

/** Compute the deterministic downside DSCR report for a project. A project with no debt reports `no_debt`. */
export function computeDownsideDscr(db: Database, projectId: string): DscrReport {
  const out = empty();
  const debt = db
    .query("SELECT id, lender, principal, rate, maturity, amortization, covenant_json FROM debt_instrument WHERE project_id = ? ORDER BY rowid")
    .all(projectId) as DebtRow[];
  if (debt.length === 0) return { ...out, reason: "no_debt", message: null };

  const cf = adoptedCfads(db, projectId);
  if ("missing" in cf) {
    return { ...out, reason: "no_adopted_case", missing_inputs: [cf.missing], message: `다운사이드 DSCR을 계산할 수 없습니다 — ${cf.missing}이(가) 없습니다 (S8에서 케이스를 채택하세요)` };
  }
  if (cf.years.length === 0) {
    return { ...out, reason: "no_cash_flows", case_id: cf.caseId, message: "다운사이드 DSCR을 계산할 수 없습니다 — 채택 케이스에 연도별 현금흐름이 없습니다" };
  }

  // Inputs per instrument: every missing one is named (no silent default).
  const missing: string[] = [];
  const schedules: Array<{ row: DebtRow; service: number[] }> = [];
  for (const d of debt) {
    const who = d.lender?.trim() || d.id.slice(-6);
    const amort = parseAmortization(d.amortization);
    const tenor = parseTenorYears(d.maturity, cf.adoptedAt);
    const bad: string[] = [];
    if (!(d.principal > 0)) bad.push("원금(principal)");
    if (!(d.rate > 0)) bad.push("금리(rate, % 단위; 0이거나 없음)");
    else if (d.rate < 1) bad.push(`금리(rate=${d.rate} — % 단위입니다. 0.05처럼 소수로 입력했다면 5로 고쳐 주세요; 정말 ${d.rate}%라면 확인 후 재입력)`);
    else if (d.rate > 100) bad.push(`금리(rate=${d.rate} — 100% 초과)`);
    if (tenor === null) bad.push(d.maturity?.trim() ? `만기/상환기간(maturity='${d.maturity}' — 'N년' 또는 채택일 이후 날짜 필요)` : "만기/상환기간(maturity)");
    if (amort === null) bad.push(d.amortization?.trim() ? `상환방식(amortization='${d.amortization}' — 원리금균등·원금균등·만기일시 중 하나)` : "상환방식(amortization)");
    if (bad.length > 0) {
      for (const b of bad) missing.push(`${b} [${who}]`);
      continue;
    }
    schedules.push({ row: d, service: debtServiceByYear(d.principal, d.rate, tenor as number, amort as Amortization) });
  }
  if (missing.length > 0) {
    return { ...out, reason: "missing_input", case_id: cf.caseId, missing_inputs: missing, message: `다운사이드 DSCR 계산에 필요한 부채 조건이 없습니다 — ${missing.join("; ")}` };
  }

  const horizon = cf.years.length;
  const longest = Math.max(...schedules.map((s) => s.service.length));
  const periods: DscrPeriod[] = cf.years.map(({ year, cfads }) => {
    const service = schedules.reduce((sum, s) => sum + (s.service[year - 1] ?? 0), 0);
    return { year, cfads: r3(cfads), debt_service: r3(service), dscr: service > 0 ? r3(cfads / service) : null };
  });
  const tested = periods.filter((p) => p.dscr !== null);
  const min = tested.reduce<DscrPeriod | null>((m, p) => (m === null || (p.dscr as number) < (m.dscr as number) ? p : m), null);

  // Declared DSCR covenants: the tightest min-threshold across instruments is tested per period.
  const declared = debt.flatMap((d) => parseDeclaredCovenants(d.covenant_json));
  const dscrDeclared = declared.filter((c) => /^dscr/i.test(c.key));
  const tests: DscrCovenantTest[] = [];
  const minTh = dscrDeclared.filter((c) => c.direction === "min").map((c) => c.value);
  if (minTh.length > 0) {
    const threshold = Math.max(...minTh);
    for (const p of tested) tests.push({ period_id: `Y${p.year}`, covenant_key: "DSCR", threshold, projected_value: p.dscr as number, breached: (p.dscr as number) < threshold ? 1 : 0, direction: "min" });
  }
  const advisories: string[] = [];
  const untested = [...new Set(declared.filter((c) => !/^dscr/i.test(c.key)).map((c) => c.key))];
  if (untested.length > 0) advisories.push(`[권고·비차단] 커버넌트 ${untested.join(", ")}은(는) 재무상태표 입력이 없어 자동 시험하지 않았습니다 — 사람이 직접 확인하세요.`);
  if (cf.fallback) advisories.push("[권고·비차단] 이 프로젝트에는 다운사이드 케이스가 없어 기준(base) 시나리오 현금흐름으로 DSCR을 계산했습니다 — 다운사이드 케이스를 생성하면 다운사이드 기준으로 다시 계산됩니다.");
  if (cf.stale) advisories.push("[권고·비차단] 채택 케이스의 입력이 채택 이후 바뀌었습니다(채택 케이스가 오래됨) — 채택 당시 저장된 스냅샷 현금흐름으로 판정했습니다. 최신 입력으로 보려면 S8에서 케이스를 재생성·재채택하세요.");
  if (cf.legacy) advisories.push("[권고·비차단] 채택 케이스 스냅샷에 저장된 현금흐름이 없어(구버전 생성물) 현재 입력으로 계산했습니다 — 재생성하면 스냅샷에 고정됩니다.");
  if (longest > horizon) advisories.push(`[권고·비차단] 차입 상환기간(${longest}년)이 사업 계획 기간(${horizon}년)보다 길어 계획 기간 이후 연도는 DSCR을 시험하지 않았습니다.`);
  if (tested.length === 0) advisories.push("[권고·비차단] 계획 기간 안에 원리금 상환 연도가 없어 DSCR 시험 대상 기간이 없습니다.");

  return {
    ...out,
    status: "computed",
    scenario: cf.scenario,
    fallback_to_base: cf.fallback,
    case_id: cf.caseId,
    periods,
    min_dscr: min?.dscr ?? null,
    min_dscr_year: min?.year ?? null,
    covenant_tests: tests,
    breached_periods: tests.filter((t) => t.breached === 1).length,
    // RAG count (MEDIUM-4): periods below the tighter of the declared DSCR covenant and the S10 floor,
    // so a floor breach without a declared covenant counts and RAG agrees with the gate.
    rag_breached_periods: tested.filter((p) => (p.dscr as number) < Math.max(minTh.length > 0 ? Math.max(...minTh) : 0, S10_MIN_DOWNSIDE_DSCR)).length,
    evidence: `case=${cf.caseId};scenario=${cf.scenario};source_model=${cf.sourceModelId};inputs=${cf.inputsHash}`,
    untested_covenants: untested,
    advisories,
  };
}
