// @version 1.0.0
/**
 * Pure unit and proxy-chain conversion math (packages/core-scoring, Wave D).
 * No DB, fs or env access — scripts/co-newbiz/convert.ts loads md_unit /
 * proxy_chain rows and calls these.
 *
 * FR-DATA-03: a cross-dimension conversion is REFUSED here; it must go
 * through a calibrated proxy chain, never ad hoc math.
 */

export interface UnitDef {
  code: string;
  dimension: string;
  /** value x siCoefficient = SI base value. */
  siCoefficient: number;
}

/** Same-dimension conversion: value x from.si / to.si. Throws on a dimension mismatch. */
export function convertBetweenUnits(value: number, from: UnitDef, to: UnitDef): number {
  if (from.dimension !== to.dimension) {
    throw new Error(
      `convert: cross-dimension conversion refused (${from.dimension} → ${to.dimension}) — route it through a calibrated proxy chain (FR-DATA-03).`,
    );
  }
  return (value * from.siCoefficient) / to.siCoefficient;
}

export interface ProxyHopFactor {
  id: string;
  hopType: string;
  beta: number | null;
  coefficient: number | null;
}

/** The multiplicative factor of one hop: beta for statistical, coefficient otherwise. Throws when unusable. */
export function hopFactor(hop: ProxyHopFactor): number {
  const factor = hop.hopType === "statistical" ? hop.beta : hop.coefficient;
  if (factor == null || !Number.isFinite(factor)) throw new Error(`convert: proxy_link '${hop.id}' has no usable factor.`);
  return factor;
}

export interface ProxyChainConversion {
  converted: number;
  ciLow: number;
  ciHigh: number;
}

/**
 * Multiply a value along a proxy chain in order. The chain's compounded CI
 * brackets the conversion FACTOR, so it is scaled by the input value (a
 * missing bound defaults to 1, matching the historical behaviour).
 */
export function applyProxyChain(
  value: number,
  hops: readonly ProxyHopFactor[],
  compoundedCiLow: number | null,
  compoundedCiHigh: number | null,
): ProxyChainConversion {
  let converted = value;
  for (const hop of hops) converted *= hopFactor(hop);
  return { converted, ciLow: value * (compoundedCiLow ?? 1), ciHigh: value * (compoundedCiHigh ?? 1) };
}
