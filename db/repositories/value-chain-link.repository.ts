// value-chain-link repository — ADR-0116 Phase 5. The FIRST writer for
// value_chain_link (created by 0011, zero writers until now; quant-methodologist
// skills describe producing rows but had no landing path, and ADR-0011's
// REST-only rule means agents need this REST surface too).
//
// Governance: a link is a JUDGED claim (elasticity, switching cost, threat
// grades) — the caller must be an analyst and every row carries its evidence
// ref + assessed_at. Statistical numbers (β/R²) belong to proxy_link via
// calibrate.ts, NOT here (ADR-0025: the two answer different questions).
import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";
import { appendAudit } from "../../db/lib/access-control.ts";
import { isValidEvidenceRef } from "../lib/evidence-ref.ts";

export interface ValueChainLinkRow {
  id: string;
  project_id: string;
  from_industry_id: string;
  to_industry_id: string;
  direction: "upstream" | "downstream";
  elasticity: number | null;
  lag_months: number | null;
  correlation: number | null;
  r2: number | null;
  pass_through_rate: number | null;
  pass_through_lag_months: number | null;
  concentration_hhi: number | null;
  switching_cost_grade: string | null;
  substitution_threat: string | null;
  evidence_ref: string | null;
  assessed_at: string;
}

export interface CreateLinkInput {
  project_id: string;
  from_industry_id: string;
  to_industry_id: string;
  direction: "upstream" | "downstream";
  elasticity?: number | null;
  lag_months?: number | null;
  correlation?: number | null;
  r2?: number | null;
  pass_through_rate?: number | null;
  pass_through_lag_months?: number | null;
  concentration_hhi?: number | null;
  switching_cost_grade?: string | null;
  substitution_threat?: string | null;
  evidence_ref?: string | null;
  assessed_by: string;
}

const GRADES = new Set(["negligible", "low", "moderate", "high", "very_high"]);

/** Validate a link payload; returns an error message or null. Numeric sanity:
 *  r2/correlation ranges, non-negative lags, grades in enum, evidence_ref in
 *  doc:/src:/https:// form when present (ADR-0058). */
export function validateLinkInput(input: CreateLinkInput): string | null {
  if (input.from_industry_id === input.to_industry_id) {
    return "from_industry_id와 to_industry_id가 동일합니다.";
  }
  for (const [name, v, lo, hi] of [
    ["r2", input.r2, 0, 1],
    ["correlation", input.correlation, -1, 1],
    ["pass_through_rate", input.pass_through_rate, 0, 1],
  ] as const) {
    if (v != null && (!Number.isFinite(v) || v < lo || v > hi)) {
      return `${name} 값이 허용 범위 [${lo}, ${hi}]를 벗어납니다.`;
    }
  }
  if (input.lag_months != null && (!Number.isInteger(input.lag_months) || input.lag_months < 0)) {
    return "lag_months는 0 이상 정수여야 합니다.";
  }
  if (input.pass_through_lag_months != null && (!Number.isInteger(input.pass_through_lag_months) || input.pass_through_lag_months < 0)) {
    return "pass_through_lag_months는 0 이상 정수여야 합니다.";
  }
  if (input.concentration_hhi != null && (!Number.isFinite(input.concentration_hhi) || input.concentration_hhi < 0)) {
    return "concentration_hhi는 0 이상이어야 합니다.";
  }
  if (input.switching_cost_grade != null && !GRADES.has(input.switching_cost_grade)) {
    return `switching_cost_grade는 negligible|low|moderate|high|very_high 중 하나입니다.`;
  }
  if (input.substitution_threat != null && !GRADES.has(input.substitution_threat)) {
    return `substitution_threat는 negligible|low|moderate|high|very_high 중 하나입니다.`;
  }
  if (input.evidence_ref != null && input.evidence_ref.trim() !== "" && !isValidEvidenceRef(input.evidence_ref)) {
    return "evidence_ref는 doc:<id> · src:<code> · https://… 형식이어야 합니다 (ADR-0058).";
  }
  return null;
}

export function createValueChainLink(db: ReturnType<typeof getDb>, input: CreateLinkInput): ValueChainLinkRow {
  const err = validateLinkInput(input);
  if (err) throw new Error(`value_chain_link_write_rejected: ${err}`);
  // Both endpoint industries must exist — FK enforces it, but the friendly
  // error here avoids a raw SQLiteError bubbling to the UI.
  for (const [label, id] of [["from", input.from_industry_id], ["to", input.to_industry_id]] as const) {
    if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(id)) {
      throw new Error(`value_chain_link_write_rejected: ${label} 산업 '${id}'를 md_industry에서 찾을 수 없습니다.`);
    }
  }
  const id = ulid();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO value_chain_link (id, project_id, from_industry_id, to_industry_id, direction,
       elasticity, lag_months, correlation, r2, pass_through_rate, pass_through_lag_months,
       concentration_hhi, switching_cost_grade, substitution_threat, evidence_ref, assessed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.project_id, input.from_industry_id, input.to_industry_id, input.direction,
      input.elasticity ?? null, input.lag_months ?? null, input.correlation ?? null, input.r2 ?? null,
      input.pass_through_rate ?? null, input.pass_through_lag_months ?? null, input.concentration_hhi ?? null,
      input.switching_cost_grade ?? null, input.substitution_threat ?? null, input.evidence_ref ?? null, now],
  );
  appendAudit(db, { actor: input.assessed_by, action: "value_chain_link_create", target: `${input.project_id}:${id}`, now });
  return listLinks(db, input.project_id).find((l) => l.id === id)!;
}

export function listLinks(db: ReturnType<typeof getDb>, projectId: string): ValueChainLinkRow[] {
  return db
    .query("SELECT * FROM value_chain_link WHERE project_id = ? ORDER BY assessed_at DESC, id DESC")
    .all(projectId) as ValueChainLinkRow[];
}
