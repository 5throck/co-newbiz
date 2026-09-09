#!/usr/bin/env bun
// @version 1.0.0
/**
 * convert.ts — unit / proxy conversion with explicit error bands (Wave A2).
 *
 * Two modes:
 *   1. Same-dimension unit conversion through md_unit.si_coefficient
 *      (--value --from-unit <code> --to-unit <code>) — cross-dimension
 *      requests are REFUSED (FR-DATA-03: they must go through proxy_link,
 *      never ad hoc math).
 *   2. Proxy-chain conversion (--chain <proxy_chain_id> --value <n>) — the
 *      value is multiplied along the chain's statistical hops in order, and
 *      the result is reported WITH the chain's compounded CI band and its
 *      grade (which caps downstream confidence — proxy-industry-chain rule 5).
 */

import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { KOSIS_UNITS } from "./kosis-units.ts";

export interface UnitConversionResult {
  value: number;
  fromUnit: string;
  toUnit: string;
  converted: number;
}

export function convertUnits(value: number, fromUnit: string, toUnit: string): UnitConversionResult {
  const db = getDb();
  const load = (code: string) =>
    db.query("SELECT id, code, dimension, si_coefficient FROM md_unit WHERE code = ?").get(code) as
      | { id: string; code: string; dimension: string; si_coefficient: number }
      | undefined;
  const seedKnown = (code: string) => {
    // The KOSIS_UNITS catalog is a constant of the methodology — seed it on
    // demand so convert works on a fresh database without a prior fetch.
    const known = Object.values(KOSIS_UNITS).find((u) => u.unitCode === code);
    if (!known) return;
    getDb().run("INSERT INTO md_unit (id, code, dimension, si_coefficient, created_at) VALUES (?,?,?,?,?)",
      [ulid(), known.unitCode, known.dimension, known.siCoefficient, new Date().toISOString()]);
  };
  if (!load(fromUnit)) seedKnown(fromUnit);
  if (!load(toUnit)) seedKnown(toUnit);
  const from = load(fromUnit);
  const to = load(toUnit);
  if (!from || !to) throw new Error(`convert: unknown unit '${!from ? fromUnit : toUnit}' — md:sync/fetch seeds md_unit rows.`);
  if (from.dimension !== to.dimension) {
    throw new Error(
      `convert: cross-dimension conversion refused (${from.dimension} → ${to.dimension}) — route it through a calibrated proxy chain (FR-DATA-03).`,
    );
  }
  // value × from.si → SI base → ÷ to.si
  return { value, fromUnit: from.code, toUnit: to.code, converted: (value * from.si_coefficient) / to.si_coefficient };
}

export interface ProxyConversionResult {
  value: number;
  converted: number;
  ciLow: number;
  ciHigh: number;
  grade: string;
  gradeRationale: string;
  hops: number;
}

export function convertViaProxyChain(value: number, chainId: string): ProxyConversionResult {
  const db = getDb();
  const chain = db
    .query("SELECT id, target_industry_id, hop_ids, reliability_grade, grade_rationale, compounded_ci_low, compounded_ci_high FROM proxy_chain WHERE id = ?")
    .get(chainId) as
    | { id: string; target_industry_id: string; hop_ids: string; reliability_grade: string; grade_rationale: string; compounded_ci_low: number | null; compounded_ci_high: number | null; }
    | undefined;
  if (!chain) throw new Error(`convert: proxy_chain '${chainId}' not found.`);
  const hopIds = JSON.parse(chain.hop_ids) as string[];
  let converted = value;
  for (const hopId of hopIds) {
    const hop = db
      .query("SELECT id, hop_type, beta, coefficient FROM proxy_link WHERE id = ?")
      .get(hopId) as { id: string; hop_type: string; beta: number | null; coefficient: number | null } | undefined;
    if (!hop) throw new Error(`convert: proxy_link '${hopId}' missing.`);
    const factor = hop.hop_type === "statistical" ? hop.beta : hop.coefficient;
    if (factor == null || !Number.isFinite(factor)) throw new Error(`convert: proxy_link '${hopId}' has no usable factor.`);
    converted *= factor;
  }
  // The chain's compounded CI brackets the conversion FACTOR — scale it by
  // the input value so the band brackets the CONVERTED figure.
  return {
    value,
    converted,
    ciLow: value * (chain.compounded_ci_low ?? 1),
    ciHigh: value * (chain.compounded_ci_high ?? 1),
    grade: chain.reliability_grade,
    gradeRationale: chain.grade_rationale,
    hops: hopIds.length,
  };
}
