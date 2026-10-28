// @version 1.1.0
/**
 * Base rates and benchmark-case provenance (ADR-0187 D2, migration 0181).
 *
 * Every base_rate row carries source, verified_on (YYYY-MM-DD), maintainer and
 * evidence_kind; the database enforces it (NOT NULL + CHECK) and this module
 * rejects an unsourced row before it reaches SQL, with a reason per row. No
 * row is ever defaulted or invented: a reference class without a row reads as
 * `not_available`, never as a mid value (design principle 2).
 *
 * Consumers are read-only: assumption-audit (S3), the S8 valuation sanity
 * check and the risk-officer red-team call lookupBaseRates(). Writes come only
 * through the import scripts (scripts/co-newbiz/import-base-rates.ts and
 * import-benchmark-cases.ts), attributed to the person who runs them.
 */
import type { Database } from "bun:sqlite";
import { ulid } from "./ulid.ts";
import { appendAudit } from "./access-control.ts";

export const EVIDENCE_KINDS = ["internal_post_mortem", "public_study", "regulatory_statistic", "industry_dataset"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface Provenance {
  source: string;
  verified_on: string;
  maintainer: string;
  evidence_kind: EvidenceKind;
}

export interface BaseRateInput extends Provenance {
  reference_class_key: string;
  metric: string;
  unit: string | null;
  sample_size: number | null;
  p10: number | null;
  p50: number;
  p90: number | null;
  note: string | null;
}

export interface BenchmarkCaseInput extends Provenance {
  title: string;
  industry: string | null;
  region: string | null;
  deal_type: "greenfield" | "brownfield" | "license-in" | "jv" | "partnership";
  deal_year: number | null;
  /** INTEGER KRW millions (ADR-0061). */
  deal_size_krw_m: number | null;
  summary_ko: string;
  key_metrics_json: string | null;
  reference_class_key: string | null;
}

export type RowCheck<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEAL_TYPES = ["greenfield", "brownfield", "license-in", "jv", "partnership"] as const;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const optStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const optNum = (v: unknown): number | null | undefined =>
  v === undefined || v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * An internal post-mortem is aggregated organisation knowledge: it must not
 * carry a project or opportunity identifier (need-to-know, boundary 1), since
 * base_rate is readable by every authenticated user. Rejected patterns:
 * project numbers (PRJ-..., NP-...) and ULID-shaped record ids (26 Crockford
 * base32 characters, the opportunity / project id format).
 */
export const PROJECT_IDENTIFIER_PATTERNS: readonly RegExp[] = [/\bPRJ-/i, /\bNP-/i, /\b[0-9A-HJKMNP-TV-Z]{26}\b/];
export function projectIdentifierErrors(kind: string, fields: Record<string, unknown>): string[] {
  if (kind !== "internal_post_mortem") return [];
  return Object.entries(fields)
    .filter(([, v]) => typeof v === "string" && PROJECT_IDENTIFIER_PATTERNS.some((re) => re.test(v)))
    .map(([k]) => `${k} must not contain a project or opportunity identifier for an internal_post_mortem row (PRJ-, NP-, record id)`);
}

/** Provenance check shared by both row kinds. A blank or missing field is an error, never a default. */
export function checkProvenance(raw: Record<string, unknown>, todayIso: string): { errors: string[]; value: Provenance | null } {
  const errors: string[] = [];
  const source = str(raw.source);
  const verified = str(raw.verified_on);
  const maintainer = str(raw.maintainer);
  const kind = str(raw.evidence_kind);
  if (!source) errors.push("source is required");
  if (!verified) errors.push("verified_on is required");
  else if (!DATE_RE.test(verified) || Number.isNaN(Date.parse(`${verified}T00:00:00Z`))) errors.push("verified_on must be a YYYY-MM-DD date");
  else if (verified > todayIso.slice(0, 10)) errors.push("verified_on cannot be in the future");
  if (!maintainer) errors.push("maintainer is required");
  if (!kind) errors.push("evidence_kind is required");
  else if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) errors.push(`evidence_kind must be one of ${EVIDENCE_KINDS.join(" | ")}`);
  return { errors, value: errors.length ? null : { source, verified_on: verified, maintainer, evidence_kind: kind as EvidenceKind } };
}

export function checkBaseRateRow(raw: unknown, todayIso: string): RowCheck<BaseRateInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["row must be an object"] };
  const o = raw as Record<string, unknown>;
  const prov = checkProvenance(o, todayIso);
  const errors = [...prov.errors];
  const key = str(o.reference_class_key);
  const metric = str(o.metric);
  if (!key) errors.push("reference_class_key is required");
  if (!metric) errors.push("metric is required");
  errors.push(...projectIdentifierErrors(str(o.evidence_kind), { source: o.source, note: o.note }));
  const p10 = optNum(o.p10);
  const p90 = optNum(o.p90);
  const p50 = typeof o.p50 === "number" && Number.isFinite(o.p50) ? o.p50 : undefined;
  if (p50 === undefined) errors.push("p50 must be a finite number");
  if (p10 === undefined) errors.push("p10 must be a finite number or null");
  if (p90 === undefined) errors.push("p90 must be a finite number or null");
  if (p50 !== undefined && typeof p10 === "number" && p10 > p50) errors.push("p10 must be <= p50");
  if (p50 !== undefined && typeof p90 === "number" && p50 > p90) errors.push("p50 must be <= p90");
  const n = o.sample_size;
  if (n !== undefined && n !== null && (typeof n !== "number" || !Number.isInteger(n) || n <= 0)) errors.push("sample_size must be a positive integer or null");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...prov.value!, reference_class_key: key, metric, unit: optStr(o.unit),
      sample_size: (n as number | null | undefined) ?? null, p10: p10 ?? null, p50: p50!, p90: p90 ?? null, note: optStr(o.note),
    },
  };
}

export function checkBenchmarkCaseRow(raw: unknown, todayIso: string): RowCheck<BenchmarkCaseInput> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["row must be an object"] };
  const o = raw as Record<string, unknown>;
  const prov = checkProvenance(o, todayIso);
  const errors = [...prov.errors];
  const title = str(o.title);
  const summary = str(o.summary_ko);
  const dealType = str(o.deal_type);
  if (!title) errors.push("title is required");
  if (!summary) errors.push("summary_ko is required");
  if (!(DEAL_TYPES as readonly string[]).includes(dealType)) errors.push(`deal_type must be one of ${DEAL_TYPES.join(" | ")}`);
  errors.push(...projectIdentifierErrors(str(o.evidence_kind), { source: o.source, summary_ko: o.summary_ko, title: o.title }));
  const year = o.deal_year;
  if (year !== undefined && year !== null && (typeof year !== "number" || !Number.isInteger(year))) errors.push("deal_year must be an integer or null");
  const size = o.deal_size_krw_m;
  if (size !== undefined && size !== null && (typeof size !== "number" || !Number.isInteger(size))) errors.push("deal_size_krw_m must be an INTEGER in KRW millions (ADR-0061) or null");
  let metrics: string | null = null;
  if (o.key_metrics !== undefined && o.key_metrics !== null) {
    if (typeof o.key_metrics !== "object" || Array.isArray(o.key_metrics)) errors.push("key_metrics must be an object or null");
    else metrics = JSON.stringify(o.key_metrics);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...prov.value!, title, industry: optStr(o.industry), region: optStr(o.region), deal_type: dealType as BenchmarkCaseInput["deal_type"],
      deal_year: (year as number | null | undefined) ?? null, deal_size_krw_m: (size as number | null | undefined) ?? null,
      summary_ko: summary, key_metrics_json: metrics, reference_class_key: optStr(o.reference_class_key),
    },
  };
}

export interface ImportReport {
  accepted: number;
  rejected: Array<{ index: number; errors: string[] }>;
  duplicates: number;
  dryRun: boolean;
}

/**
 * Validate every row first; if ANY row is rejected nothing is written (an
 * import is all-or-nothing, so a partially sourced file never lands half-way).
 * Duplicate (reference_class_key, metric, source, verified_on) rows are skipped.
 */
export function importBaseRates(
  db: Database,
  rows: unknown[],
  opts: { actor: string; now?: string; dryRun?: boolean },
): ImportReport {
  const now = opts.now ?? new Date().toISOString();
  const checked = rows.map((r) => checkBaseRateRow(r, now));
  const rejected = checked.flatMap((c, index) => (c.ok ? [] : [{ index, errors: c.errors }]));
  const report: ImportReport = { accepted: 0, rejected, duplicates: 0, dryRun: !!opts.dryRun };
  if (rejected.length || opts.dryRun) {
    if (!rejected.length) report.accepted = checked.length;
    return report;
  }
  db.transaction(() => {
    for (const c of checked) {
      if (!c.ok) continue;
      const v = c.value;
      const dup = db
        .query("SELECT id FROM base_rate WHERE reference_class_key = ? AND metric = ? AND source = ? AND verified_on = ?")
        .get(v.reference_class_key, v.metric, v.source, v.verified_on);
      if (dup) { report.duplicates++; continue; }
      const id = ulid();
      db.run(
        `INSERT INTO base_rate (id, reference_class_key, metric, unit, sample_size, p10, p50, p90, source, verified_on, maintainer, evidence_kind, note, imported_by, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, v.reference_class_key, v.metric, v.unit, v.sample_size, v.p10, v.p50, v.p90, v.source, v.verified_on, v.maintainer, v.evidence_kind, v.note, opts.actor, now],
      );
      report.accepted++;
    }
    appendAudit(db, { actor: opts.actor, action: "base_rate.imported", target: `base_rate|accepted=${report.accepted};duplicates=${report.duplicates}`, now });
  }).immediate();
  return report;
}

/** Same all-or-nothing contract for benchmark_case; duplicates are (title, deal_year, source). */
export function importBenchmarkCases(
  db: Database,
  rows: unknown[],
  opts: { actor: string; now?: string; dryRun?: boolean },
): ImportReport {
  const now = opts.now ?? new Date().toISOString();
  const checked = rows.map((r) => checkBenchmarkCaseRow(r, now));
  const rejected = checked.flatMap((c, index) => (c.ok ? [] : [{ index, errors: c.errors }]));
  const report: ImportReport = { accepted: 0, rejected, duplicates: 0, dryRun: !!opts.dryRun };
  if (rejected.length || opts.dryRun) {
    if (!rejected.length) report.accepted = checked.length;
    return report;
  }
  db.transaction(() => {
    for (const c of checked) {
      if (!c.ok) continue;
      const v = c.value;
      const dup = db
        .query("SELECT id FROM benchmark_case WHERE title = ? AND deal_year IS ? AND source_ref = ?")
        .get(v.title, v.deal_year, v.source);
      if (dup) { report.duplicates++; continue; }
      db.run(
        `INSERT INTO benchmark_case (id, title, industry, region, deal_type, deal_year, deal_size_krw_m, summary_ko, key_metrics_json, source_ref,
                                     created_by, created_at, reference_class_key, verified_on, maintainer, evidence_kind)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [ulid(), v.title, v.industry, v.region, v.deal_type, v.deal_year, v.deal_size_krw_m, v.summary_ko, v.key_metrics_json, v.source,
         opts.actor, now, v.reference_class_key, v.verified_on, v.maintainer, v.evidence_kind],
      );
      report.accepted++;
    }
    appendAudit(db, { actor: opts.actor, action: "benchmark_case.imported", target: `benchmark_case|accepted=${report.accepted};duplicates=${report.duplicates}`, now });
  }).immediate();
  return report;
}

export interface BaseRateRow extends BaseRateInput {
  id: string;
  imported_by: string;
  imported_at: string;
}

export type BaseRateLookup =
  | { status: "available"; reference_class_key: string; metric: string | null; rows: BaseRateRow[] }
  | { status: "not_available"; reference_class_key: string; metric: string | null; reason: "no_sourced_row" | "table_absent" };

/**
 * Read-only reference-class lookup for assumption-audit (S3), the S8 valuation
 * sanity check and the risk-officer red-team. Returns live (not superseded)
 * rows with their provenance; an empty class is `not_available`, never a
 * defaulted value.
 */
export function lookupBaseRates(db: Database, referenceClassKey: string, metric?: string | null): BaseRateLookup {
  const key = referenceClassKey.trim();
  const m = metric?.trim() || null;
  let rows: BaseRateRow[];
  try {
    rows = db
      .query(
        `SELECT id, reference_class_key, metric, unit, sample_size, p10, p50, p90, source, verified_on, maintainer, evidence_kind, note, imported_by, imported_at
         FROM base_rate WHERE reference_class_key = ? AND superseded_by IS NULL ${m ? "AND metric = ?" : ""}
         ORDER BY metric, verified_on DESC, id`,
      )
      .all(...(m ? [key, m] : [key])) as BaseRateRow[];
  } catch {
    return { status: "not_available", reference_class_key: key, metric: m, reason: "table_absent" };
  }
  return rows.length
    ? { status: "available", reference_class_key: key, metric: m, rows }
    : { status: "not_available", reference_class_key: key, metric: m, reason: "no_sourced_row" };
}

/** Distinct reference classes with at least one live row (for discovery). */
export function listReferenceClasses(db: Database): Array<{ reference_class_key: string; metrics: number; rows: number }> {
  try {
    return db
      .query(
        `SELECT reference_class_key, COUNT(DISTINCT metric) AS metrics, COUNT(*) AS rows FROM base_rate
         WHERE superseded_by IS NULL GROUP BY reference_class_key ORDER BY reference_class_key`,
      )
      .all() as Array<{ reference_class_key: string; metrics: number; rows: number }>;
  } catch {
    return [];
  }
}
