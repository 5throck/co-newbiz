// review_audit_sample store (migration 0038) — the measurement mechanism for
// the "AI 검토 신뢰도" governance KPI (design of record §6.6, ADR-0153 §4.6).
// A human samples an ai_2nd review row and records agree/disagree; the KPI is
// the agreement rate. agreed is NOT NULL: a sample is always agree or
// disagree, never ambiguous. No PASS stamp lives here — this measures the
// AI reviewer's calibration, it never approves anything.
import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { ulid } from "../lib/ulid.ts";

export class AuditSampleError extends Error {
  constructor(
    public code: "not_found" | "not_ai_2nd" | "not_performed" | "agent_forbidden" | "invalid_input",
    message: string,
  ) {
    super(message);
  }
}

export interface InsertAuditSampleInput {
  reviewStageId: string;
  sampledBy: string;
  agreed: boolean;
  note?: string | null;
  /** Agent persona ids — never a valid human sampler (boundary #1/#2). */
  agentIds: ReadonlySet<string>;
  db?: Database;
  now?: string;
}

/** Record a human agree/disagree on one ai_2nd review row. */
export function insertAuditSample(input: InsertAuditSampleInput): string {
  if (!input.sampledBy.trim() || input.agentIds.has(input.sampledBy)) {
    throw new AuditSampleError(
      "agent_forbidden",
      "an audit sample must be recorded by a human user, never an agent id (boundary #1/#2).",
    );
  }
  if (typeof input.agreed !== "boolean") {
    throw new AuditSampleError("invalid_input", "agreed must be a boolean.");
  }
  const db = input.db ?? getDb();
  const row = db.query("SELECT stage, performed FROM review_stage WHERE id = ?").get(input.reviewStageId) as
    | { stage: string; performed: number }
    | undefined;
  if (!row) throw new AuditSampleError("not_found", `review_stage row '${input.reviewStageId}' does not exist.`);
  if (row.stage !== "ai_2nd") throw new AuditSampleError("not_ai_2nd", "only ai_2nd rows can be sampled.");
  if (row.performed !== 1) throw new AuditSampleError("not_performed", "a review that was not performed cannot be sampled.");
  const id = ulid();
  db.run(
    "INSERT INTO review_audit_sample (id, review_stage_id, sampled_by, agreed, note, created_at) VALUES (?,?,?,?,?,?)",
    [id, input.reviewStageId, input.sampledBy, input.agreed ? 1 : 0, input.note?.trim() || null, input.now ?? new Date().toISOString()],
  );
  return id;
}

export interface AgreementRate {
  /** Denominator key: "overall", a reviewer domain, or a YYYY-Qn quarter. */
  key: string;
  sampled: number;
  agreed: number;
  rate: number | null;
}

const rate = (agreed: number, sampled: number): number | null => (sampled === 0 ? null : agreed / sampled);

/** Agreement rate overall, per reviewer domain, and per quarter (UTC). */
export function auditAgreementSummary(db: Database = getDb()): {
  overall: AgreementRate;
  by_domain: AgreementRate[];
  by_quarter: AgreementRate[];
} {
  const rows = db
    .query(
      `SELECT s.reviewer_domain AS domain, substr(a.created_at, 1, 4) AS year,
              CAST((CAST(substr(a.created_at, 6, 2) AS INTEGER) - 1) / 3 + 1 AS INTEGER) AS quarter,
              COUNT(*) AS sampled, SUM(a.agreed) AS agreed
       FROM review_audit_sample a JOIN review_stage s ON s.id = a.review_stage_id
       GROUP BY 1, 2, 3`,
    )
    .all() as Array<{ domain: string | null; year: string; quarter: number; sampled: number; agreed: number }>;
  const overallAgreed = rows.reduce((n, r) => n + (r.agreed ?? 0), 0);
  const overallSampled = rows.reduce((n, r) => n + r.sampled, 0);
  const byKey = (keyOf: (r: (typeof rows)[number]) => string) => {
    const map = new Map<string, { sampled: number; agreed: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      const cur = map.get(k) ?? { sampled: 0, agreed: 0 };
      cur.sampled += r.sampled;
      cur.agreed += r.agreed ?? 0;
      map.set(k, cur);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({ key, sampled: v.sampled, agreed: v.agreed, rate: rate(v.agreed, v.sampled) }));
  };
  return {
    overall: { key: "overall", sampled: overallSampled, agreed: overallAgreed, rate: rate(overallAgreed, overallSampled) },
    by_domain: byKey((r) => r.domain ?? "unknown"),
    by_quarter: byKey((r) => `${r.year}-Q${r.quarter}`),
  };
}
