// @version 1.0.0
/**
 * Pure view helpers for the admin master-data screen: the KSIC browser (read-only, file-managed
 * reference list) and the human-readable SI factor. Kept free of React so the search and the
 * formatting are unit-testable.
 */
import master from "./ksic-master.json";
import { searchKsic, type KsicEntry } from "./ksic.ts";

export const MD_TABS = ["ksic", "md_currency", "md_country", "md_source", "md_unit", "md_company"] as const;
export type MdTab = (typeof MD_TABS)[number];

/** Code tables edited through /api/admin/master-data (the source table is shown read-only). */
export const EDITABLE_MD_TABLES = ["md_currency", "md_country", "md_unit", "md_company"] as const;

export type KsicLevel = "mid" | "sub" | "detail" | "leaf" | "other";

/** KSIC 10th revision: 2 digits = 중분류, 3 = 소분류, 4 = 세분류, 5 = 세세분류. */
export function ksicLevel(code: string): KsicLevel {
  switch (code.length) {
    case 2: return "mid";
    case 3: return "sub";
    case 4: return "detail";
    case 5: return "leaf";
    default: return "other";
  }
}

const ALL_KSIC: KsicEntry[] = (master.codes as KsicEntry[])
  .slice()
  .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

/**
 * Browser search over the full KSIC list. An empty query lists every code in code order; a digit
 * query matches code prefixes; any other query matches 산업명, 보조설명 and the curated aliases
 * (an alias hit carries `matched_by: "alias"` and the matching `alias` term).
 */
export function browseKsic(query: string): KsicEntry[] {
  const q = query.trim();
  if (!q) return ALL_KSIC;
  return searchKsic(q, ALL_KSIC.length);
}

export interface SiMagnitudeNames {
  man: string;
  eok: string;
  jo: string;
}

/**
 * "1억", "3.6조", "0.01", "1,000" — the multiplier of one unit in the base unit of its dimension.
 * Korean magnitude words (만/억/조) come from the catalog via `names`; without them (or in a non-Korean
 * locale) the number is written out.
 */
export function formatSiFactor(value: number, locale: string, names?: SiMagnitudeNames): string {
  if (!Number.isFinite(value)) return "—";
  const ko = locale.startsWith("ko");
  if (ko && names && Math.abs(value) >= 1e4) {
    const steps: Array<[number, string]> = [[1e12, names.jo], [1e8, names.eok], [1e4, names.man]];
    for (const [size, name] of steps) {
      if (Math.abs(value) >= size) return `${Number((value / size).toPrecision(6)).toLocaleString("ko-KR")}${name}`;
    }
  }
  return Number(value.toPrecision(10)).toLocaleString(ko ? "ko-KR" : "en-US", { maximumFractionDigits: 10 });
}
