// @version 1.0.0
/**
 * KSIC (한국표준산업분류) helpers — shared input validation and curated
 * master-data search for the /market code picker (ADR-0111).
 *
 * Validation contract: a user-supplied KSIC code is 2–6 digits (중분류
 * through 세세분류 levels) or NULL ("미지정"). The seeded 'HYD-BRK' freeze
 * sentinel (insights bottom-up CAGR supplement, /market frozen banner) is
 * the one sanctioned non-numeric value and is accepted explicitly — the
 * seeded row must stay editable. Nothing else passes; in particular the
 * 'NEW-*' placeholders the create route used to fabricate are retired by
 * migration 0078 and rejected by this parser.
 */
import master from "./ksic-master.json";

export const HYD_BRK_SENTINEL = "HYD-BRK";

const KSIC_CODE_RE = /^\d{2,6}$/;

export type KsicParseResult =
  | { ok: true; code: string | null }
  | { ok: false; reason: string };

export function parseKsicInput(value: string | null | undefined): KsicParseResult {
  const code = value?.trim() ?? "";
  if (!code) return { ok: true, code: null };
  if (code === HYD_BRK_SENTINEL) return { ok: true, code };
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
}

const ENTRIES: KsicEntry[] = (master.codes as KsicEntry[])
  .slice()
  .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

/**
 * Search the curated KSIC master. Digit queries match by code prefix
 * (shorter codes first, exact match first); non-digit queries match by
 * 산업명·보조설명 substring. Empty query returns the full curated list —
 * the picker shows it on focus so the subset is discoverable.
 */
export function searchKsic(query: string, limit = 20): KsicEntry[] {
  const q = query.trim();
  if (!q) return ENTRIES.slice(0, limit);
  if (/^\d+$/.test(q)) {
    return ENTRIES.filter((e) => e.code.startsWith(q))
      .sort((a, b) => {
        if (a.code === q) return -1;
        if (b.code === q) return 1;
        return a.code.length - b.code.length || (a.code < b.code ? -1 : 1);
      })
      .slice(0, limit);
  }
  const needle = q.toLowerCase();
  return ENTRIES.filter(
    (e) => e.name_ko.toLowerCase().includes(needle) || (e.detail ?? "").toLowerCase().includes(needle),
  ).slice(0, limit);
}
