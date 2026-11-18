// @version 1.0.0
/**
 * anchors.ts — meaning anchors that must survive a rewrite unchanged.
 *
 * Design: docs/designs/2026-11-18-humanize-polish-integration-design.md
 * (spec humanize-polish), "finalize" step 4 (anchor gate).
 *
 * The anchor gate is independent of the LLM's self-report: the multiset of
 * numbers (with units/percentages), dates, statute and article references,
 * Latin-script tokens, glossary terms, inline code, link targets and heading
 * markers must be identical before and after, or the unit rolls back.
 * Pure and clone-agnostic.
 */

export type AnchorCategory = "number" | "date" | "statute" | "latin" | "glossary" | "code" | "link" | "heading";

export type AnchorBag = Map<string, number>;

export interface AnchorDiff {
  category: AnchorCategory;
  token: string;
  before: number;
  after: number;
}

const UNITS = [
  "백만원",
  "억원",
  "조원",
  "만원",
  "천원",
  "퍼센트",
  "개월",
  "분기",
  "%p",
  "원",
  "억",
  "조",
  "만",
  "천",
  "%",
  "배",
  "건",
  "명",
  "개",
  "년",
  "월",
  "일",
  "주",
  "시간",
  "분",
  "초",
  "톤",
  "평",
  "㎡",
  "달러",
  "kg",
  "ton",
  "TEU",
  "CGT",
  "BHP",
  "MW",
  "GW",
  "km",
  "mm",
  "cm",
  "USD",
  "KRW",
  "t",
  "m",
];
const NUMBER_RE = new RegExp(
  `[+\\-−]?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:${UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))?`,
  "gu",
);

const DATE_RES: RegExp[] = [
  /\d{4}\s?[-./]\s?\d{1,2}\s?[-./]\s?\d{1,2}/g,
  /\d{4}\s?년(?:\s?\d{1,2}\s?월)?(?:\s?\d{1,2}\s?일)?/g,
  /\d{1,2}\s?월\s?\d{1,2}\s?일/g,
];

// Article / paragraph / item references in Korean statutory spelling,
// e.g. "제12조", "제12조의2", "제12조 제3항 제2호".
const ARTICLE_RE = /제\s?\d+\s?조(?:\s?의\s?\d+)?(?:\s?제\s?\d+\s?항)?(?:\s?제\s?\d+\s?호)?/g;
// Law names: corner-bracketed titles, or a name ending in a statute suffix
// that is directly followed by an article reference.
const LAW_BRACKET_RE = /「[^」\n]+」/g;
const LAW_BEFORE_ARTICLE_RE = /[가-힣A-Za-z0-9·]{2,}(?:법률|시행령|시행규칙|법)(?=\s?제\s?\d)/g;

const LATIN_RE = /[A-Za-z][A-Za-z0-9]*(?:[-_.&/][A-Za-z0-9]+)*/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const LINK_RE = /\[[^\]\n]*\]\(([^)\s]+)[^)]*\)/g;
const BARE_URL_RE = /https?:\/\/[^\s)>\]]+/g;
const HEADING_LINE_RE = /^ {0,3}(#{1,6})\s/gm;

function add(bag: AnchorBag, category: AnchorCategory, token: string): void {
  const key = `${category}\u0000${token}`;
  bag.set(key, (bag.get(key) ?? 0) + 1);
}

function squash(s: string): string {
  return s.replace(/\s+/g, "");
}

/** Extract the anchor multiset of a text. */
export function extractAnchors(text: string, glossaryTerms: readonly string[] = []): AnchorBag {
  const bag: AnchorBag = new Map();
  for (const m of text.matchAll(NUMBER_RE)) add(bag, "number", squash(m[0]));
  for (const re of DATE_RES) for (const m of text.matchAll(re)) add(bag, "date", squash(m[0]));
  for (const m of text.matchAll(ARTICLE_RE)) add(bag, "statute", squash(m[0]));
  for (const m of text.matchAll(LAW_BRACKET_RE)) add(bag, "statute", m[0]);
  for (const m of text.matchAll(LAW_BEFORE_ARTICLE_RE)) add(bag, "statute", m[0]);
  for (const m of text.matchAll(LATIN_RE)) add(bag, "latin", m[0]);
  for (const m of text.matchAll(INLINE_CODE_RE)) add(bag, "code", m[0]);
  for (const m of text.matchAll(LINK_RE)) add(bag, "link", m[1]);
  for (const m of text.matchAll(BARE_URL_RE)) add(bag, "link", m[0]);
  for (const m of text.matchAll(HEADING_LINE_RE)) add(bag, "heading", m[1]);
  for (const term of glossaryTerms) {
    if (term.length < 2) continue;
    let n = 0;
    for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + term.length)) n++;
    if (n > 0) bag.set(`glossary\u0000${term}`, n);
  }
  return bag;
}

/** Differences between two anchor bags (order-insensitive). Empty array = identical. */
export function compareAnchors(before: AnchorBag, after: AnchorBag): AnchorDiff[] {
  const diffs: AnchorDiff[] = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const b = before.get(key) ?? 0;
    const a = after.get(key) ?? 0;
    if (a !== b) {
      const [category, token] = key.split("\u0000") as [AnchorCategory, string];
      diffs.push({ category, token, before: b, after: a });
    }
  }
  return diffs.sort((x, y) => (x.category + x.token).localeCompare(y.category + y.token));
}

/** Convenience: extract both sides and compare. */
export function anchorDiff(before: string, after: string, glossaryTerms: readonly string[] = []): AnchorDiff[] {
  return compareAnchors(extractAnchors(before, glossaryTerms), extractAnchors(after, glossaryTerms));
}
