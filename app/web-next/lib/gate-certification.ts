// bf-03 at the Pre-FS gate - ADR-0186 D1 (owner decision O-3), neb-policy 2.4 / 4.5.
//
// Rule: where certification change-of-control transferability is load-bearing to the deal thesis, it must be
// CONFIRMED from the certifying body's own rules (never inferred) by Pre-FS gate close. An unconfirmed
// load-bearing certification is a HARD BLOCK (409 certification_unconfirmed) on a brownfield `pre_fs` GO:
// binding and non-waivable like bf-01 / bf-02. HOLD and KILL are never blocked.
//
// Data (existing, migration 0011/0012/0019): `certification` rows carry `load_bearing` (0/1),
// `transferability_basis` ('verified' | 'inferred'), `transferable_on_coc` ('yes' | 'no' | NULL),
// `transferability_evidence_ref` and `confirmed_at`. "Load-bearing" is the row's own flag - this module does
// not invent a second definition. A row is CONFIRMED when basis = 'verified', a yes/no position is taken, an
// evidence reference is present and confirmed_at is set. Confirmed non-transferable counts as confirmed (the
// confirmation is what the rule asks for; the consequence is a RAG / kill-criteria matter, not this block).
//
// GAP (reported to the caller): `certification` is keyed by project_id only and Pre-FS is an OPPORTUNITY gate
// that runs before a project exists. The only link available is md_project.source_opportunity_id, so the check
// reads the certifications of projects promoted from the opportunity; an opportunity with no project yet has
// no load-bearing record and passes vacuously. A pre-project certification register would need a new table
// (an ADR-0186 follow-up, not invented here).
import type { Database } from "bun:sqlite";
import type { IntegrityFailure } from "./gate-integrity.ts";

export interface CertificationGap {
  id: string;
  name: string;
  project_id: string;
  /** not_verified | no_position | no_evidence | not_confirmed */
  problem: string;
}

interface CertRow {
  id: string;
  name: string;
  project_id: string;
  transferability_basis: string | null;
  transferable_on_coc: string | null;
  transferability_evidence_ref: string | null;
  confirmed_at: string | null;
}

export function certificationProblem(r: Pick<CertRow, "transferability_basis" | "transferable_on_coc" | "transferability_evidence_ref" | "confirmed_at">): string | null {
  if (r.transferability_basis !== "verified") return "not_verified";
  if (r.transferable_on_coc !== "yes" && r.transferable_on_coc !== "no") return "no_position";
  if (!r.transferability_evidence_ref?.trim()) return "no_evidence";
  if (!r.confirmed_at) return "not_confirmed";
  return null;
}

/** Load-bearing certifications of the opportunity's projects whose change-of-control transferability is not confirmed. */
export function unconfirmedLoadBearingCertifications(db: Database, opportunityId: string): CertificationGap[] {
  const rows = db
    .query(
      `SELECT c.id, c.name, c.project_id, c.transferability_basis, c.transferable_on_coc, c.transferability_evidence_ref, c.confirmed_at
       FROM certification c JOIN md_project p ON p.id = c.project_id
       WHERE p.source_opportunity_id = ? AND c.load_bearing = 1 ORDER BY c.id`,
    )
    .all(opportunityId) as CertRow[];
  const gaps: CertificationGap[] = [];
  for (const r of rows) {
    const problem = certificationProblem(r);
    if (problem) gaps.push({ id: r.id, name: r.name, project_id: r.project_id, problem });
  }
  return gaps;
}

export function certificationFailure(db: Database, opportunityId: string): IntegrityFailure | null {
  const gaps = unconfirmedLoadBearingCertifications(db, opportunityId);
  if (gaps.length === 0) return null;
  return {
    status: 409,
    code: "certification_unconfirmed",
    message: `GO is not allowed at Pre-FS - change-of-control transferability of ${gaps.length} load-bearing certification(s) is not confirmed from the certifying body's own rules (neb-policy 2.4): ${gaps.map((g) => g.name).join(", ")}. HOLD or KILL can be recorded at any time.`,
    details: { certifications: gaps },
  };
}
