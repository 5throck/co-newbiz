// @version 1.0.0
/**
 * Evidence-ref citation vocabulary — the v1.1 hardening of the 2026-08-22
 * design (Decision 2's flagged debt: `requires_evidence_ref` was decoration
 * while `evidence_ref` columns were format-free TEXT). ADR-0058 §2.
 *
 * The vocabulary (a citation must be RESOLVABLE — a free-text string like
 * "cim.pdf#p12" or "expert-interview-3" names evidence only the author can
 * find again, which is unauditable):
 *
 *   doc:<document-id>     — pointer at a `document` table artifact (the id,
 *                           or a stable file/section qualifier of it)
 *   src:<md_source.code>  — pointer at a registered source (md_source.code,
 *                           e.g. src:KIS-2025)
 *   https://<url>         — external citation (canonical scheme only; plain
 *                           http is not accepted — v1.1 chooses one shape)
 *
 * NOT chosen for v1.1: a hard FK to `document`. That table is a
 * content-addressed stub (id/run/version/hash — no readers, no seeds); an FK
 * to an unused table would itself be decoration, the exact failure mode
 * ADR-0046 records for `requires_evidence_ref`. The `doc:` shape keeps the
 * pointer honest today and makes a future FK tightening a data migration,
 * not a convention break.
 *
 * Enforcement surface (ADR-0058 §2): `dimension_input.assert()` for
 * `requires_evidence_ref = 1` vars — every assertable var today. Deliberately
 * OUT of scope: the snapshot filler's computed evidence_refs (md_source.code
 * values written as computed provenance — that is machine provenance, not a
 * human citation) and tables with no governed write path yet
 * (value_chain_link.evidence_ref — its future repository adopts this
 * validator; raw SQL in tests is not a write path).
 */

/** The accepted citation shapes, for error messages and docs. */
export const EVIDENCE_REF_SHAPES: readonly string[] = ["doc:<document-id>", "src:<md_source.code>", "https://<url>"];

/** No whitespace anywhere; prefix + non-empty remainder. */
export function isValidEvidenceRef(ref: string): boolean {
  const t = ref.trim();
  if (t.length === 0 || /\s/.test(t)) return false;
  if (t.startsWith("doc:")) return t.length > "doc:".length;
  if (t.startsWith("src:")) return t.length > "src:".length;
  if (t.startsWith("https://")) return t.length > "https://".length;
  return false;
}
