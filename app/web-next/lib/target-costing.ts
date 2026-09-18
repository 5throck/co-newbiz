// @version 1.0.0
// target-costing — the computation + persistence behind FS procedures
// greenfield-fs 6.96 / brownfield-fs 7.96 (design
// 2026-09-18-s8-business-case-evaluation REQ-W2-1..3, output_type
// target_cost_gap, skill target-costing-analysis).
//
// Method (skill target-costing-analysis §Method): anchor the market price →
// allowable_cost = price × (1 − target_margin) → record the gap against the
// estimated unit cost. Deterministic and pure: identical inputs produce an
// identical gap. A gap beyond GAP_THRESHOLD feeds the downside scenario's
// opex driver at generation time (REQ-W2-3) — see
// business-case-generator.ts's resolveTargetCostWiring.

import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";

/** Default materiality threshold — a gap beyond +10% of allowable cost is
 *  a downside-scenario input, not a footnote (REQ-W2-3). */
export const GAP_THRESHOLD = 0.10;

export interface TargetCostInput {
  marketPrice: number;
  targetMargin: number;
  estimatedUnitCost: number;
  levers?: string[];
  source?: "user" | "peer_benchmark";
  rationale?: string | null;
}

export interface TargetCostGap {
  marketPrice: number;
  targetMargin: number;
  allowableCost: number;
  estimatedUnitCost: number;
  gap: number;
  /** gap / allowable_cost — the threshold metric. */
  gapRatio: number;
  thresholdExceeded: boolean;
  levers: string[];
  source: "user" | "peer_benchmark";
  rationale: string | null;
}

export class TargetCostValidationError extends Error {}

/** Pure gap computation — exported for tests and the UI preview. */
export function computeTargetCostGap(input: TargetCostInput): TargetCostGap {
  const { marketPrice, targetMargin, estimatedUnitCost } = input;
  for (const [label, value] of [
    ["market_price", marketPrice],
    ["target_margin", targetMargin],
    ["estimated_unit_cost", estimatedUnitCost],
  ] as const) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TargetCostValidationError(`${label}는 유한한 숫자여야 합니다.`);
    }
  }
  if (marketPrice < 0) throw new TargetCostValidationError("market_price는 0 이상이어야 합니다.");
  if (targetMargin < 0 || targetMargin >= 1) throw new TargetCostValidationError("target_margin은 [0, 1) 구간이어야 합니다.");
  if (estimatedUnitCost < 0) throw new TargetCostValidationError("estimated_unit_cost는 0 이상이어야 합니다.");

  const allowableCost = marketPrice * (1 - targetMargin);
  const gap = estimatedUnitCost - allowableCost;
  const gapRatio = allowableCost > 0 ? gap / allowableCost : null;
  return {
    marketPrice,
    targetMargin,
    allowableCost,
    estimatedUnitCost,
    gap,
    gapRatio: gapRatio ?? Number.POSITIVE_INFINITY,
    thresholdExceeded: gapRatio !== null && gapRatio > GAP_THRESHOLD,
    levers: input.levers ?? [],
    source: input.source ?? "user",
    rationale: input.rationale?.trim() || null,
  };
}

export interface TargetCostRow extends TargetCostGap {
  id: string;
  created_by: string;
  created_at: string;
}

/** Persist one analysis run (the target_cost_gap artifact). */
export function recordTargetCostAnalysis(
  db: ReturnType<typeof getDb>,
  projectId: string,
  input: TargetCostInput,
  userId: string,
  now = new Date().toISOString(),
): TargetCostRow {
  const gap = computeTargetCostGap(input);
  const id = ulid();
  db.run(
    `INSERT INTO target_costing_analysis
       (id, project_id, market_price, target_margin, allowable_cost, estimated_unit_cost,
        gap, gap_ratio, threshold_exceeded, levers_json, source, rationale, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      projectId,
      gap.marketPrice,
      gap.targetMargin,
      gap.allowableCost,
      gap.estimatedUnitCost,
      gap.gap,
      gap.gapRatio === Number.POSITIVE_INFINITY ? null : gap.gapRatio,
      gap.thresholdExceeded ? 1 : 0,
      gap.levers.length > 0 ? JSON.stringify(gap.levers) : null,
      gap.source,
      gap.rationale,
      userId,
      now,
    ],
  );
  return { id, created_by: userId, created_at: now, ...gap };
}

/** The latest recorded analysis for a project (drives the S8 card). */
export function latestTargetCostAnalysis(db: ReturnType<typeof getDb>, projectId: string): TargetCostRow | null {
  const row = db
    .query(
      `SELECT id, project_id, market_price, target_margin, allowable_cost, estimated_unit_cost,
              gap, gap_ratio, threshold_exceeded, levers_json, source, rationale, created_by, created_at
       FROM target_costing_analysis WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(projectId) as
    | { id: string; project_id: string; market_price: number; target_margin: number; allowable_cost: number; estimated_unit_cost: number; gap: number; gap_ratio: number | null; threshold_exceeded: number; levers_json: string | null; source: string; rationale: string | null; created_by: string; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    marketPrice: row.market_price,
    targetMargin: row.target_margin,
    allowableCost: row.allowable_cost,
    estimatedUnitCost: row.estimated_unit_cost,
    gap: row.gap,
    gapRatio: row.gap_ratio ?? Number.POSITIVE_INFINITY,
    thresholdExceeded: row.threshold_exceeded === 1,
    levers: row.levers_json ? (JSON.parse(row.levers_json) as string[]) : [],
    source: row.source as "user" | "peer_benchmark",
    rationale: row.rationale,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

/** Downside wiring (REQ-W2-3): when the latest analysis breaches the
 *  threshold, the downside scenario's opex driver is uplifted by the gap
 *  ratio (capped at 2x) and the fact is reported for the snapshot warnings. */
export function resolveDownsideOpexUplift(db: ReturnType<typeof getDb>, projectId: string): { uplift: number; gapRatio: number } | null {
  const latest = latestTargetCostAnalysis(db, projectId);
  if (!latest || !latest.thresholdExceeded) return null;
  const uplift = Math.min(1 + Math.max(latest.gapRatio, 0), 2);
  return { uplift, gapRatio: latest.gapRatio === Number.POSITIVE_INFINITY ? 0 : latest.gapRatio };
}
