/**
 * Company-name canonicalization (design 2026-11-11-target-identity-resolution
 * §D1) — the canonical form both md_company.name_ko and
 * brownfield_target.company_name hold at every identity write boundary.
 *
 * Zero imports, pure and deterministic (name-similarity.ts extraction
 * precedent): trim + whitespace collapse, then repeated right-to-left
 * stripping of trailing parenthetical glosses (ASCII and fullwidth), then a
 * leading corporate-form marker strip. No transliteration, no case folding.
 * Idempotent by construction — canonical(canonical(x)) === canonical(x).
 *
 * The raw glossed string is never lost: it survives on the proposal card, in
 * the evidence/universe_note trail, and in DART's own corp_name once a code
 * is attached (design §3.2).
 */

/** One trailing parenthetical group — ASCII `(...)` or fullwidth `（...）`,
 *  with no nested parens inside (company glosses are flat). */
const TRAILING_PAREN_GROUP = /[()（）][^()（）]*[()（）]$/;

/** Leading corporate-form marker — `(주)` (stock), `(재)` (foundation),
 *  `(유)` (limited). */
const LEADING_CORPORATE_FORM = /^\((주|재|유)\)/;

/**
 * Canonical company name for identity storage and comparison.
 * `한전KPS(KEPCO KPS)` → `한전KPS`; `삼성에스원(주)(구원)` → `삼성에스원`;
 * `(주)한양` → `한양`. A name that is entirely parenthetical falls back to the
 * trimmed raw string (`(주)(구원)` → `(주)(구원)`).
 */
export function canonicalCompanyName(raw: string): string {
  // 1. Trim; collapse internal whitespace runs to single spaces.
  const trimmed = raw.trim().replace(/\s+/g, " ");
  // 2. Strip trailing parenthetical groups repeatedly, right-to-left.
  let s = trimmed;
  while (TRAILING_PAREN_GROUP.test(s)) {
    s = s.replace(TRAILING_PAREN_GROUP, "").trim();
  }
  // 3. Strip a leading corporate-form marker.
  s = s.replace(LEADING_CORPORATE_FORM, "").trim();
  // 4. Entirely parenthetical input keeps the trimmed raw string.
  return s === "" ? trimmed : s;
}
