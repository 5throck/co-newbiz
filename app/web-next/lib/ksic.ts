// @version 1.2.0
/**
 * KSIC (한국표준산업분류) helpers — shared input validation and curated
 * master-data search for the /market code picker (ADR-0111).
 *
 * Validation contract: a user-supplied KSIC code is 2–6 digits (중분류
 * through 세세분류 levels) or NULL ("미지정"). The historical 'HYD-BRK'
 * freeze sentinel was retired in ADR-0112 (migration 0080 remapped the row,
 * the report matrix is persisted as a regular version) — it is no longer a
 * valid value, and the 'NEW-*' placeholders the create route used to
 * fabricate are equally rejected.
 */
import master from "./ksic-master.json";
import aliasData from "./ksic-aliases.json";

const KSIC_CODE_RE = /^\d{2,6}$/;

export type KsicParseResult =
  | { ok: true; code: string | null }
  | { ok: false; reason: string };

export function parseKsicInput(value: string | null | undefined): KsicParseResult {
  const code = value?.trim() ?? "";
  if (!code) return { ok: true, code: null };
  if (!KSIC_CODE_RE.test(code)) {
    return { ok: false, reason: "KSIC 코드는 2~6자리 숫자여야 합니다 (예: 28121)." };
  }
  return { ok: true, code };
}

export interface KsicEntry {
  code: string;
  name_ko: string;
  detail: string | null;
  profile: boolean;
  /** Set only on non-digit queries: how this entry was found. */
  matched_by?: "alias" | "name";
  /** The curated alias term that matched (matched_by === "alias"). */
  alias?: string;
}

interface KsicAlias {
  terms: string[];
  codes: string[];
  basis: string;
}
export const KSIC_ALIASES: KsicAlias[] = (aliasData as { aliases: KsicAlias[] }).aliases;

const squash = (v: string) => v.toLowerCase().replace(/\s+/g, "");

const ENTRIES: KsicEntry[] = (master.codes as KsicEntry[])
  .slice()
  .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

/**
 * Search the KSIC master (정식 10차 전체 2,000코드 + 프로젝트 프로필 산업).
 * Digit queries match by code prefix (exact match first, then profile
 * entries, shorter codes first); non-digit queries match by 산업명·보조설명
 * substring. Empty query returns the profile (curated) entries only —
 * the picker shows them on focus so the subset stays discoverable.
 */
export function searchKsic(query: string, limit = 20): KsicEntry[] {
  const q = query.trim();
  const profileFirst = (a: KsicEntry, b: KsicEntry) =>
    Number(b.profile) - Number(a.profile) ||
    (a.code === b.code ? 0 : a.code < b.code ? -1 : 1);
  if (!q) return ENTRIES.filter((e) => e.profile).slice(0, limit);
  if (/^\d+$/.test(q)) {
    return ENTRIES.filter((e) => e.code.startsWith(q))
      .sort((a, b) => {
        if (a.code === q) return -1;
        if (b.code === q) return 1;
        if (a.profile !== b.profile) return Number(b.profile) - Number(a.profile);
        return a.code.length - b.code.length || profileFirst(a, b);
      })
      .slice(0, limit);
  }
  const needle = squash(q);
  const seen = new Set<string>();
  const out: KsicEntry[] = [];
  // Alias hits first: the alias term contains the query, or the query contains
  // the alias term (e.g. "조선업체"). Single-character queries are too noisy.
  if (needle.length >= 2) {
    for (const a of KSIC_ALIASES) {
      const term = a.terms.find((t) => {
        const n = squash(t);
        return n.includes(needle) || needle.includes(n);
      });
      if (!term) continue;
      for (const code of a.codes) {
        const e = ENTRIES.find((x) => x.code === code);
        if (!e || seen.has(code)) continue;
        seen.add(code);
        out.push({ ...e, matched_by: "alias", alias: term });
      }
    }
  }
  const nameHits = ENTRIES.filter(
    (e) => !seen.has(e.code) && (squash(e.name_ko).includes(needle) || squash(e.detail ?? "").includes(needle)),
  ).sort(profileFirst);
  for (const e of nameHits) out.push({ ...e, matched_by: "name" });
  return out.slice(0, limit);
}
