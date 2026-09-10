// @version 1.0.0
/**
 * WACC component decomposition — CAPM assembly with per-component provenance
 * (ADR-0115; implements the CAPM-component scope the 2026-09-09 engine-seams
 * design deferred).
 *
 * The WACC input session (db/lib/wacc.ts) records the human-confirmed final
 * scalar under the exact keys `wacc` / `hurdle_irr` — that kill-criteria
 * contract is untouched. This module owns the layer BELOW the scalar: the
 * CAPM components, each persisted as its own assumption row under a
 * `wacc.<name>` key (a namespace the snapshot filler's exact-key match never
 * collides with), so the final figure can always be re-derived — formulas and
 * substituted numbers included — from stored provenance.
 *
 * Pure math only (no bun:sqlite): the web-next WACC page imports this module
 * client-side to render exactly the derivation the server persists — one
 * implementation, no drift. Derivation steps are Korean because they are
 * rendered verbatim into Korean UI screens and S5/S8 deliverable markdown
 * (via `wacc:derivation`), mirroring the approved UI mockup.
 */

import { isValidEvidenceRef } from "./evidence-ref.ts";

/** Every component key the CAPM session may persist (assumption_key namespace `wacc.*`). */
export const WACC_COMPONENT_KEYS = [
  "wacc.risk_free",
  "wacc.erp",
  "wacc.size_premium",
  "wacc.beta_levered",
  "wacc.beta_unlevered",
  "wacc.observed_de",
  "wacc.target_de",
  "wacc.tax_rate",
  "wacc.cost_of_debt",
  "wacc.debt_spread",
  // Regression display stats — never WACC math inputs, but recorded so the
  // "how volatile vs the market" answer stays reproducible from the registry.
  "wacc.beta_r2",
  "wacc.beta_alpha",
  "wacc.beta_vol_asset",
  "wacc.beta_vol_market",
] as const;

export type WaccComponentKey = (typeof WACC_COMPONENT_KEYS)[number];

const WACC_COMPONENT_KEY_SET = new Set<string>(WACC_COMPONENT_KEYS);

/** Component kinds — the three evidentiary tiers a session may write. `assumed` is refused: a CAPM session exists to replace assumptions. */
const WACC_COMPONENT_KINDS = new Set(["live", "user", "derived"]);

export interface WaccComponentInput {
  key: WaccComponentKey;
  value: number;
  kind: "live" | "user" | "derived";
  /** Human-readable citation, e.g. "한국은행 ECOS — 국고채(3년)". Prepended to the stored rationale. */
  sourceLabel?: string;
  /** Evidence-ref vocabulary (doc: | src: | https://) — validated. */
  anchorRef?: string | null;
  asOf?: string;
  rationale?: string;
}

export class WaccComponentValidationError extends Error {
  constructor(
    public readonly code: "invalid_request" | "ref_invalid",
    message: string,
  ) {
    super(message);
  }
}

/** Anything with the two fields assembleDerivation needs — assumption rows and API inputs both fit. */
export interface WaccComponentLike {
  key: string;
  value: number;
}

export interface DerivationStep {
  item: string;
  formula: string;
  substitution: string;
  result: number;
  /** Optional display override when the result is not a single rate (e.g. weights "62.5% / 37.5%"). */
  resultLabel?: string;
}

export interface WaccDerivation {
  /** Normalized component map the steps were computed from. */
  components: Record<string, number>;
  steps: DerivationStep[];
  computed: {
    betaUnlevered: number | null;
    betaLevered: number | null;
    ke: number | null;
    kd: number | null;
    we: number | null;
    wd: number | null;
    wacc: number | null;
  };
  /** Korean labels for required components that were absent — rendered as the UI's "missing" list. */
  missing: string[];
  betaPath: "peer_unlevered" | "regression_relevered" | "levered_direct" | null;
}

export function hamadaUnlever(betaLevered: number, deRatio: number, taxRate: number): number {
  return betaLevered / (1 + (1 - taxRate) * deRatio);
}

export function hamadaRelever(betaUnlevered: number, deRatio: number, taxRate: number): number {
  return betaUnlevered * (1 + (1 - taxRate) * deRatio);
}

export function capmCostOfEquity(rf: number, betaLevered: number, erp: number, sizePremium = 0): number {
  return rf + betaLevered * erp + sizePremium;
}

export function weightsFromDe(deRatio: number): { we: number; wd: number } {
  return { we: 1 / (1 + deRatio), wd: deRatio / (1 + deRatio) };
}

function pctStr(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function numStr(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** Betas render as multiples (never %) and substitutions keep 4dp so the displayed arithmetic checks out. */
function betaStr(v: number): string {
  return v.toFixed(4);
}

/**
 * Validate one component before persistence. Throws WaccComponentValidationError
 * with an HTTP-mappable code; the REST route and the CLI share this path so
 * the rules cannot drift.
 */
export function validateComponentInput(c: WaccComponentInput): void {
  if (!WACC_COMPONENT_KEY_SET.has(c.key)) {
    throw new WaccComponentValidationError(
      "invalid_request",
      `unknown WACC component key '${c.key}' — expected one of ${WACC_COMPONENT_KEYS.join(", ")}.`,
    );
  }
  if (!WACC_COMPONENT_KINDS.has(c.kind)) {
    throw new WaccComponentValidationError(
      "invalid_request",
      `component '${c.key}' kind must be one of live|user|derived — a CAPM session replaces assumptions, it never writes kind='assumed'.`,
    );
  }
  if (typeof c.value !== "number" || !Number.isFinite(c.value)) {
    throw new WaccComponentValidationError("invalid_request", `component '${c.key}' value must be a finite number.`);
  }
  if (c.value <= -1) {
    throw new WaccComponentValidationError("invalid_request", `component '${c.key}' value must be greater than -1.`);
  }
  const betaKeys = new Set<string>(["wacc.beta_levered", "wacc.beta_unlevered"]);
  if (betaKeys.has(c.key) && c.value <= 0) {
    throw new WaccComponentValidationError("invalid_request", `component '${c.key}' beta must be positive.`);
  }
  if (c.key === "wacc.tax_rate" && (c.value < 0 || c.value >= 1)) {
    throw new WaccComponentValidationError("invalid_request", "wacc.tax_rate must be in [0, 1).");
  }
  const nonNegative = new Set<string>([
    "wacc.erp",
    "wacc.size_premium",
    "wacc.observed_de",
    "wacc.target_de",
    "wacc.debt_spread",
  ]);
  if (nonNegative.has(c.key) && c.value < 0) {
    throw new WaccComponentValidationError("invalid_request", `component '${c.key}' must be non-negative.`);
  }
  if (c.anchorRef != null && c.anchorRef.trim() !== "" && !isValidEvidenceRef(c.anchorRef)) {
    throw new WaccComponentValidationError(
      "ref_invalid",
      `component '${c.key}' anchor_ref must match ${"doc:<id> | src:<code> | https://<url>"} (ADR-0058 §2).`,
    );
  }
}

/** Required minimum for mode="capm" — the session must be able to reach a WACC. */
export function capmComponentGaps(components: readonly WaccComponentLike[]): string[] {
  const have = new Set(components.map((c) => c.key));
  const need: string[] = [];
  for (const key of ["wacc.risk_free", "wacc.erp", "wacc.tax_rate", "wacc.target_de"] as const) {
    if (!have.has(key)) need.push(key);
  }
  if (!have.has("wacc.beta_unlevered") && !have.has("wacc.beta_levered")) need.push("wacc.beta_unlevered | wacc.beta_levered");
  if (!have.has("wacc.cost_of_debt") && !have.has("wacc.debt_spread")) need.push("wacc.cost_of_debt | wacc.debt_spread");
  if (have.has("wacc.beta_levered") && !have.has("wacc.beta_unlevered") && !have.has("wacc.observed_de")) {
    need.push("wacc.observed_de (wacc.beta_levered을 비레버드 환산하려면 필요)");
  }
  return need;
}

/** Normalize the three accepted input shapes (assumption rows, API inputs, plain map) into a key→value map. */
function toMap(components: Iterable<WaccComponentLike> | Record<string, number>): Record<string, number> {
  if (!Array.isArray(components) && typeof components === "object") {
    return { ...(components as Record<string, number>) };
  }
  const map: Record<string, number> = {};
  for (const c of components as Iterable<WaccComponentLike>) {
    map[c.key] = c.value;
  }
  return map;
}

/**
 * Re-derive the WACC build-up — formulas AND substituted numbers — from
 * stored components. Compute-on-read: stored component rows are the SSOT and
 * this function is the only renderer, so the UI screen, the deliverable
 * markdown, and the database can never disagree.
 */
export function assembleDerivation(input: Iterable<WaccComponentLike> | Record<string, number>): WaccDerivation {
  const c = toMap(input);
  const steps: DerivationStep[] = [];
  const missing: string[] = [];
  const computed: WaccDerivation["computed"] = {
    betaUnlevered: null,
    betaLevered: null,
    ke: null,
    kd: null,
    we: null,
    wd: null,
    wacc: null,
  };

  const rf = c["wacc.risk_free"];
  const erp = c["wacc.erp"];
  const sp = c["wacc.size_premium"] ?? 0;
  const tax = c["wacc.tax_rate"];
  const targetDe = c["wacc.target_de"];
  const betaL = c["wacc.beta_levered"];
  const betaU = c["wacc.beta_unlevered"];
  const observedDe = c["wacc.observed_de"];
  const kdDirect = c["wacc.cost_of_debt"];
  const debtSpread = c["wacc.debt_spread"];

  // ── Beta chain ──
  let betaPath: WaccDerivation["betaPath"] = null;
  let betaUsed: number | null = null;
  let betaUTerm = "";
  if (betaU != null) {
    betaPath = "peer_unlevered";
    computed.betaUnlevered = betaU;
    betaUsed = targetDe != null && tax != null ? hamadaRelever(betaU, targetDe, tax) : null;
    betaUTerm = betaStr(betaU);
  } else if (betaL != null) {
    if (observedDe != null && tax != null) {
      betaPath = "regression_relevered";
      const u = hamadaUnlever(betaL, observedDe, tax);
      computed.betaUnlevered = u;
      steps.push({
        item: "베타 — 비레버드 (βU)",
        formula: "βU = βL / (1 + (1−t)·D/E_관측)",
        substitution: `${betaStr(betaL)} / (1 + ${(tax * 100).toFixed(0)}%×${numStr(observedDe)})  (D/E_관측 ${numStr(observedDe)})`,
        result: u,
        resultLabel: u.toFixed(2),
      });
      betaUsed = targetDe != null ? hamadaRelever(u, targetDe, tax) : null;
      betaUTerm = betaStr(u);
    } else {
      betaPath = "levered_direct";
      betaUsed = betaL;
      betaUTerm = `${numStr(betaL)} (레버드 베타 직접 사용)`;
    }
  }
  if (betaUsed != null && targetDe != null && tax != null && betaPath !== "levered_direct") {
    computed.betaLevered = betaUsed;
    steps.push({
      item: "베타 — 타겟 레버드 (βL*)",
      formula: "βL* = βU·(1 + (1−t)·D/E_타겟)",
      substitution: `${betaUTerm} × (1 + ${(tax * 100).toFixed(0)}%×${numStr(targetDe)})  (D/E_타겟 ${numStr(targetDe)})`,
      result: betaUsed,
      resultLabel: betaUsed.toFixed(2),
    });
  } else if (betaPath === "levered_direct") {
    computed.betaLevered = betaUsed;
  }

  // ── Cost of equity (CAPM) ──
  if (rf != null && erp != null && betaUsed != null) {
    const ke = capmCostOfEquity(rf, betaUsed, erp, sp);
    computed.ke = ke;
    const sub = `${pctStr(rf)} + ${betaStr(betaUsed)}×${pctStr(erp)}${sp ? ` + ${pctStr(sp)}` : ""}`;
    steps.push({
      item: "자기자본비용 (CAPM)",
      formula: `Ke = Rf + βL*×ERP${sp ? " + 규모프리미엄" : ""}`,
      substitution: sub,
      result: ke,
    });
  } else {
    if (rf == null) missing.push("wacc.risk_free (무위험이자율)");
    if (erp == null) missing.push("wacc.erp (주식위험프리미엄)");
    if (betaUsed == null) missing.push("베타 (wacc.beta_unlevered 또는 wacc.beta_levered)");
  }

  // ── Cost of debt ──
  let kd: number | null = null;
  if (kdDirect != null) {
    kd = kdDirect;
    steps.push({
      item: "타인자본비용 (Kd)",
      formula: "Kd = 실행 대출금리 (직접 입력)",
      substitution: pctStr(kdDirect),
      result: kd,
    });
  } else if (rf != null && debtSpread != null) {
    kd = rf + debtSpread;
    steps.push({
      item: "타인자본비용 (Kd)",
      formula: "Kd = Rf + 신용 가산금리",
      substitution: `${pctStr(rf)} + ${pctStr(debtSpread)}`,
      result: kd,
    });
  } else {
    missing.push("wacc.cost_of_debt 또는 wacc.debt_spread (타인자본비용)");
  }
  computed.kd = kd;

  // ── Capital structure weights ──
  let we: number | null = null;
  let wd: number | null = null;
  if (targetDe != null) {
    const w = weightsFromDe(targetDe);
    we = w.we;
    wd = w.wd;
    steps.push({
      item: "자본 가중치",
      formula: "We = 1/(1+D/E_타겟) · Wd = D/E_타겟/(1+D/E_타겟)",
      substitution: `D/E_타겟 ${numStr(targetDe)}`,
      result: we,
      resultLabel: `${pctStr(we)} / ${pctStr(wd)}`,
    });
  } else {
    missing.push("wacc.target_de (목표 D/E)");
  }
  computed.we = we;
  computed.wd = wd;

  // ── WACC ──
  if (computed.ke != null && kd != null && we != null && wd != null && tax != null) {
    const wacc = we * computed.ke + wd * kd * (1 - tax);
    computed.wacc = wacc;
    steps.push({
      item: "WACC",
      formula: "WACC = We·Ke + Wd·Kd·(1−t)",
      substitution: `${we.toFixed(4)}×${pctStr(computed.ke)} + ${wd.toFixed(4)}×${pctStr(kd)}×${(1 - tax).toFixed(2)}`,
      result: wacc,
    });
  } else if (tax == null) {
    missing.push("wacc.tax_rate (한계 세율)");
  }

  return { components: c, steps, computed, missing, betaPath };
}

/** Percent label used by the CLI's markdown output (same format the UI renders). */
export function formatPct(v: number, digits = 2): string {
  return `${(v * 100).toFixed(digits)}%`;
}
