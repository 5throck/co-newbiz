// @version 1.0.0
/**
 * Proxy-chain reliability grading — design v1.0 §4-5, meeting M4 decisions
 * D-M4-1 through D-M4-3, guidelines/proxy-chain-hop-classification.md.
 *
 * THE central correction from meeting M4 (D-M4-2): grade is driven by
 * STATISTICAL hop count, not total hop count. A chain with one engineering
 * hop (fixed physical coefficient) and one statistical hop with R2>=0.6 is
 * Grade B — the same grade a genuinely single-hop statistical chain gets.
 * Engineering hops never degrade the grade; they also never upgrade it.
 */

export interface Hop {
  hopType: "engineering" | "statistical";
  r2?: number;
  ciLow?: number;
  ciHigh?: number;
  betaOrCoefficient: number;
}

export interface ChainGradeResult {
  grade: "A" | "B" | "C";
  rationale: string;
  compoundedCiLow: number | null;
  compoundedCiHigh: number | null;
}

/**
 * D-M4-1 grade criteria:
 *   A = all hops engineering (or a single direct-market-data hop, i.e. no
 *       hops at all — not modeled here, that's a Screening-stage decision)
 *   B = exactly one statistical hop, R2 >= 0.6, any number of engineering
 *       hops alongside it (engineering hops don't count against the "single
 *       statistical hop" requirement)
 *   C = more than one statistical hop, OR any statistical hop with R2 < 0.6
 */
export function gradeChain(hops: Hop[]): ChainGradeResult {
  if (hops.length === 0) {
    throw new Error("gradeChain requires at least one hop");
  }

  const statisticalHops = hops.filter((h) => h.hopType === "statistical");

  // All-engineering chain: Grade A, no statistical uncertainty to compound.
  if (statisticalHops.length === 0) {
    return {
      grade: "A",
      rationale: "All hops are engineering (fixed physical coefficients) — no statistical estimation involved.",
      compoundedCiLow: null,
      compoundedCiHigh: null,
    };
  }

  // More than one statistical hop: Grade C regardless of each hop's R2 —
  // D-M4-1's "multi-hop statistical conversion" clause.
  if (statisticalHops.length > 1) {
    return {
      grade: "C",
      rationale: `Chain has ${statisticalHops.length} statistical hops — multi-hop statistical conversion caps the grade at C regardless of individual hop R2 values (D-M4-1).`,
      ...compoundCi(statisticalHops),
    };
  }

  // Exactly one statistical hop — grade depends on its R2.
  const hop = statisticalHops[0];
  if (hop.r2 === undefined) {
    throw new Error("Statistical hop is missing r2 — cannot grade");
  }

  if (hop.r2 < 0.6) {
    return {
      grade: "C",
      rationale: `Single statistical hop has R2=${hop.r2.toFixed(2)} < 0.6 — below the Grade B bar (D-M4-1).`,
      ...compoundCi(statisticalHops),
    };
  }

  const engineeringCount = hops.length - statisticalHops.length;
  return {
    grade: "B",
    rationale:
      engineeringCount > 0
        ? `Single statistical hop (R2=${hop.r2.toFixed(2)} >= 0.6) plus ${engineeringCount} engineering hop(s) that don't degrade the grade — corrected per meeting M4 D-M4-2 from a naive "total hop count" framing.`
        : `Single statistical hop, R2=${hop.r2.toFixed(2)} >= 0.6.`,
    ...compoundCi(statisticalHops),
  };
}

/**
 * D-M4-3: per-hop confidence intervals compound via quadrature (relative
 * errors add in quadrature for independent hops), not simple addition —
 * simple addition overstates combined uncertainty for genuinely
 * independent regression errors.
 */
function compoundCi(statisticalHops: Hop[]): { compoundedCiLow: number | null; compoundedCiHigh: number | null } {
  const withCi = statisticalHops.filter((h) => h.ciLow !== undefined && h.ciHigh !== undefined);
  if (withCi.length === 0) {
    return { compoundedCiLow: null, compoundedCiHigh: null };
  }

  // Relative half-width per hop: (ciHigh - ciLow) / 2 / |beta|.
  // Quadrature-sum the relative half-widths, then apply to the product of
  // point estimates (betaOrCoefficient) to get the compounded interval.
  const pointProduct = statisticalHops.reduce((acc, h) => acc * h.betaOrCoefficient, 1);

  let sumSquaredRelativeHalfWidth = 0;
  for (const h of withCi) {
    const halfWidth = (h.ciHigh! - h.ciLow!) / 2;
    const relative = h.betaOrCoefficient !== 0 ? halfWidth / Math.abs(h.betaOrCoefficient) : 0;
    sumSquaredRelativeHalfWidth += relative * relative;
  }
  const compoundedRelativeHalfWidth = Math.sqrt(sumSquaredRelativeHalfWidth);
  const compoundedAbsoluteHalfWidth = compoundedRelativeHalfWidth * Math.abs(pointProduct);

  return {
    compoundedCiLow: pointProduct - compoundedAbsoluteHalfWidth,
    compoundedCiHigh: pointProduct + compoundedAbsoluteHalfWidth,
  };
}
