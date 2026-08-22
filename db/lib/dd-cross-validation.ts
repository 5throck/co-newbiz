// @version 1.0.0
/**
 * DD cross-validation (PR-5c spec §2.5; design Decisions 5f/5g, ADR-0047
 * cross-validation section, ADR-0048) — the classification-vs-DD-evidence
 * check that runs alongside the six-validator completeness evaluation at
 * brownfield-dd step 14.
 *
 * DECISION 5f — PRIMARY SIGNAL (classification-INDEPENDENT evidence): the
 * old idea (origin vs dd_finding.rbd_source) goes blind exactly when it
 * matters — a project misclassified as internal skips the R&BD step, so no
 * rbd_source row is ever written and there is nothing to compare. The
 * primary signal is therefore evidence that is generated REGARDLESS of
 * classification:
 *   certification_coc     certification rows carrying a change-of-control
 *                         transferability position (transferable_on_coc /
 *                         transferability_basis — 0012 columns) — somebody
 *                         assessed whether a certification survives a CoC
 *                         event, which only an acquisition has.
 *   antitrust_finding     any market-combination analysis row — contradicts
 *                         "no market-combination exposure".
 *   legal_coc_scan        step-5 legal-DD CoC/anti-assignment contract-scan
 *                         dd_finding rows — contradicts "no acquired
 *                         contracts". DETECTION CONTRACT (flagged heuristic):
 *                         dd_finding has no step column, so step-5 rows are
 *                         identified as category='legal' (the kebab-domain
 *                         convention every dd_finding writer uses) with a
 *                         description matching LEGAL_COC_PATTERNS below.
 *
 * MISMATCH = live classification origin='internal' (the acquisition-denying
 * origin) while any primary signal has rows. external/hybrid/joint origins
 * all involve or permit acquisition — no contradiction is possible there.
 *
 * DECISION 5g — CONDITIONAL BLOCK, warn-level default: a mismatch blocks
 * ONLY when the classification row has weak provenance — rationale absent,
 * or under RATIONALE_SUBSTANCE_FLOOR_CHARS with no evidence_ref-bearing
 * dimension_input linkage (a live dimension_input row for the project).
 * A well-founded classification honestly overturned by DD evidence is the
 * NON-BLOCKING correction path: reclassify via PR-5b supersede() (full
 * Decision-5a approval asymmetry) — the same-transaction invalidation sweep
 * retires the skips, and the correction object enumerates exactly which
 * validators re-enter the required set.
 *
 * SECONDARY SIGNAL (advisory, never blocks): origin vs dd_finding.rbd_source
 * on rows that exist (i.e. the R&BD step actually ran), per
 * CONTRADICTORY_RBD_SOURCES. Logged in the audit row and returned; it can
 * never affect the verdict — that is what "demoted" means.
 *
 * WRITE DISCIPLINE: read-only over every domain table (same static-SQL,
 * binding-only doctrine as the completeness engine); the ONE write is a
 * single audit_log row recording the run and its outcome — the check runs
 * under a named member (FR-SEC-08, FR-SEC-06 on MNPI projects) precisely so
 * that "we looked and saw the contradiction" is itself auditable.
 */

import type { Database } from "bun:sqlite";
import { getDb } from "../client.ts";
import { appendAudit, requireActiveMember, requireInsiderIfMnpi } from "./access-control.ts";
import { getLiveClassification, type ClassificationRow } from "../repositories/classification.repository.ts";
import { maValidatorRuleKey, type MaValidatorKey } from "./validator-applicability.ts";
import { SIX_VALIDATOR_GATE } from "./validator-completeness.ts";

/**
 * Decision 5g substance floor (spec: "set N in the validator"). A rationale
 * this short is weak provenance UNLESS the project carries live
 * evidence_ref-bearing dimension_input rows the classification can rest on.
 * 80 chars ≈ one substantive sentence naming the structural reason.
 */
export const RATIONALE_SUBSTANCE_FLOOR_CHARS = 80;

/**
 * CoC-scan phrase patterns for legal dd_finding descriptions. Word-boundary
 * on the short token so "protocol"-shaped substrings cannot match.
 */
export const LEGAL_COC_PATTERNS: readonly RegExp[] = [
  /change[- ]of[- ]control/i,
  /\bcoc\b/i,
  /anti-assignment/i,
  /assignment\s+consent/i,
];

/**
 * The demoted secondary signal: rbd_source values that contradict the live
 * origin. Data, not code branches — same doctrine as the applicability
 * registry. Only origins with at least one contradictory source are listed.
 */
export const CONTRADICTORY_RBD_SOURCES: Readonly<Record<string, readonly string[]>> = {
  internal: ["external_technology_acquisition", "accelerator_partnered"],
  external: ["internal_only"],
};

export type CrossValidationSignalKey = "certification_coc" | "antitrust_finding" | "legal_coc_scan";

export interface CrossValidationSignal {
  key: CrossValidationSignalKey;
  row_count: number;
  /** Up to three evidence row ids — enough for an auditor to start pulling. */
  evidence_ids: string[];
  description_en: string;
}

export interface CrossValidationProvenance {
  rationale_chars: number;
  /** A live dimension_input row exists for the project (evidence_ref is NOT NULL by schema). */
  has_evidence_linkage: boolean;
  /** Decision 5g: absent rationale, or under-floor with no evidence linkage. */
  weak: boolean;
  floor_chars: number;
}

export type CrossValidationSeverity = "clear" | "correction" | "block";

export interface CrossValidationCorrection {
  /** The only legal re-classification path (PR-5b, Decision 5a asymmetry in full). */
  reclassify: true;
  /** Live not_applicable validators the supersede sweep retires — these re-enter the required set. */
  re_run_validators: MaValidatorKey[];
}

export interface CrossValidationAdvisory {
  kind: "origin_vs_rbd_source";
  detail_en: string;
  origin: string;
  rbd_source: string;
  dd_finding_id: string;
}

export interface DdCrossValidationReport {
  project_id: string;
  run_id: string | null;
  evaluated_at: string;
  classification: Pick<ClassificationRow, "id" | "case_type" | "origin" | "technology_track"> | null;
  primary: {
    mismatched: boolean;
    contradicted_origin: "internal" | null;
    signals: CrossValidationSignal[];
  };
  provenance: CrossValidationProvenance | null;
  verdict: {
    blocked: boolean;
    severity: CrossValidationSeverity;
    message_en: string;
    correction: CrossValidationCorrection | null;
  };
  advisories: CrossValidationAdvisory[];
}

// ---------------------------------------------------------------------------
// Readers — static SQL, binding only
// ---------------------------------------------------------------------------

const SQL_CERT_COC =
  "SELECT id FROM certification WHERE project_id = ? AND (transferable_on_coc IS NOT NULL OR transferability_basis IS NOT NULL)";
const SQL_ANTITRUST = "SELECT id FROM antitrust_finding WHERE project_id = ?";
const SQL_LEGAL_DD = "SELECT id, description FROM dd_finding WHERE project_id = ? AND category = 'legal'";
const SQL_LIVE_DIMENSION_INPUT =
  "SELECT id FROM dimension_input WHERE project_id = ? AND superseded_by IS NULL LIMIT 1";
const SQL_RBD_FINDINGS =
  "SELECT id, rbd_source FROM dd_finding WHERE project_id = ? AND rbd_source IS NOT NULL";
const SQL_LIVE_SKIPS =
  "SELECT rule_key FROM compliance_check WHERE project_id = ? AND gate = ? AND result = 'not_applicable' AND invalidated_at IS NULL AND rule_key LIKE 'ma-validator-%'";

/** Map a ma-validator rule_key back to its registry key, null when foreign. */
function ruleKeyToValidator(ruleKey: string): MaValidatorKey | null {
  const key = ruleKey.replace(/^ma-validator-/, "") as MaValidatorKey;
  return ruleKey === maValidatorRuleKey(key) ? key : null;
}

function isLegalCocScan(description: string): boolean {
  return LEGAL_COC_PATTERNS.some((p) => p.test(description));
}

/**
 * Run the DD cross-validation for one project. Reads the live classification
 * and the classification-independent evidence set, applies the Decision-5g
 * conditional block, and writes exactly ONE audit row (action
 * 'dd_cross_validation') recording the outcome — advisory entries included,
 * so "the check ran and saw only advisory noise" is as auditable as a block.
 */
export function crossValidateClassification(
  projectId: string,
  actor: string,
  opts: { run_id?: string | null; now?: Date; db?: Database } = {}
): DdCrossValidationReport {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const evaluatedAt = now.toISOString();

  requireActiveMember(db, projectId, actor);
  requireInsiderIfMnpi(db, projectId, actor);

  const classification = getLiveClassification(projectId, db);

  // ── Decision 5f primary signals (read regardless of classification) ──────
  const certIds = (db.query(SQL_CERT_COC).all(projectId) as { id: string }[]).map((r) => r.id);
  const antitrustIds = (db.query(SQL_ANTITRUST).all(projectId) as { id: string }[]).map((r) => r.id);
  const legalRows = db.query(SQL_LEGAL_DD).all(projectId) as { id: string; description: string }[];
  const legalCocIds = legalRows.filter((r) => isLegalCocScan(r.description)).map((r) => r.id);

  const signals: CrossValidationSignal[] = [
    {
      key: "certification_coc",
      row_count: certIds.length,
      evidence_ids: certIds.slice(0, 3),
      description_en: "certification rows carrying a change-of-control transferability position",
    },
    {
      key: "antitrust_finding",
      row_count: antitrustIds.length,
      evidence_ids: antitrustIds.slice(0, 3),
      description_en: "antitrust_finding rows — market-combination analysis exists",
    },
    {
      key: "legal_coc_scan",
      row_count: legalCocIds.length,
      evidence_ids: legalCocIds.slice(0, 3),
      description_en: "step-5 legal dd_finding rows matching the CoC/anti-assignment contract-scan patterns",
    },
  ];

  const contradicted = classification !== null && classification.origin === "internal";
  const mismatched = contradicted && signals.some((s) => s.row_count > 0);
  const hitSignals = signals.filter((s) => s.row_count > 0).map((s) => s.key);

  // ── Decision 5g provenance (only meaningful against a live row) ──────────
  let provenance: CrossValidationProvenance | null = null;
  if (classification) {
    const rationaleChars = classification.rationale.trim().length;
    const linkage = db.query(SQL_LIVE_DIMENSION_INPUT).get(projectId) !== null;
    provenance = {
      rationale_chars: rationaleChars,
      has_evidence_linkage: linkage,
      weak: rationaleChars === 0 || (rationaleChars < RATIONALE_SUBSTANCE_FLOOR_CHARS && !linkage),
      floor_chars: RATIONALE_SUBSTANCE_FLOOR_CHARS,
    };
  }

  // ── verdict: warn-level default, block only on weak provenance ───────────
  let severity: CrossValidationSeverity = "clear";
  let message_en = "No contradiction between the live classification and classification-independent DD evidence.";
  let correction: CrossValidationCorrection | null = null;

  if (mismatched) {
    const reRun = (db.query(SQL_LIVE_SKIPS).all(projectId, SIX_VALIDATOR_GATE) as { rule_key: string }[])
      .map((r) => ruleKeyToValidator(r.rule_key))
      .filter((k): k is MaValidatorKey => k !== null);
    if (provenance!.weak) {
      severity = "block";
      message_en =
        `Classification ${classification!.id} claims origin='internal' but classification-independent DD evidence ` +
        `(${hitSignals.join(", ")}) shows an acquired business, and the classification's provenance is weak ` +
        `(rationale ${provenance!.rationale_chars} chars vs floor ${provenance!.floor_chars}, evidence linkage ` +
        `${provenance!.has_evidence_linkage}) — DD exit is blocked until the project is reclassified through ` +
        `supersede() with the full Decision-5a approval asymmetry (Decision 5g).`;
    } else {
      severity = "correction";
      correction = { reclassify: true, re_run_validators: reRun };
      message_en =
        `Classification ${classification!.id} claims origin='internal' but classification-independent DD evidence ` +
        `(${hitSignals.join(", ")}) shows an acquired business. Provenance is sound — this is an honest overturn, ` +
        `not a governance failure: correct via supersede() (full approval asymmetry). The invalidation sweep will ` +
        `retire ${reRun.length} live skip row(s) (${reRun.join(", ") || "none"}), returning those validators to ` +
        `the required set (Decision 5g).`;
    }
  }

  // ── secondary signal: advisory only, never touches the verdict ───────────
  const advisories: CrossValidationAdvisory[] = [];
  if (classification) {
    const contradictory = CONTRADICTORY_RBD_SOURCES[classification.origin];
    if (contradictory) {
      for (const row of db.query(SQL_RBD_FINDINGS).all(projectId) as { id: string; rbd_source: string }[]) {
        if (contradictory.includes(row.rbd_source)) {
          advisories.push({
            kind: "origin_vs_rbd_source",
            origin: classification.origin,
            rbd_source: row.rbd_source,
            dd_finding_id: row.id,
            detail_en:
              `origin='${classification.origin}' vs dd_finding ${row.id} rbd_source='${row.rbd_source}' — ` +
              `secondary signal, logged only (Decision 5f demoted it: it goes blind when the R&BD step was skipped)`,
          });
        }
      }
    }
  }

  appendAudit(db, {
    actor,
    action: "dd_cross_validation",
    target:
      `${projectId}:${severity}` +
      (hitSignals.length > 0 ? `:signals=${hitSignals.join("+")}` : "") +
      (advisories.length > 0 ? `:advisory=origin_vs_rbd_source x${advisories.length}` : ""),
    now: evaluatedAt,
  });

  return {
    project_id: projectId,
    run_id: opts.run_id ?? null,
    evaluated_at: evaluatedAt,
    classification: classification
      ? {
          id: classification.id,
          case_type: classification.case_type,
          origin: classification.origin,
          technology_track: classification.technology_track,
        }
      : null,
    primary: {
      mismatched,
      contradicted_origin: mismatched ? "internal" : null,
      signals,
    },
    provenance,
    verdict: { blocked: severity === "block", severity, message_en, correction },
    advisories,
  };
}
