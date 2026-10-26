// validateRationale — ADR-0186 D2 / design 3.2 + 3.13 (script-aware profile).
// A deterministic FORM check, no model call: it never judges whether the
// reasoning is sound (that stays with the human reviewers and the AI review
// stages). Pure and client-safe except for the optional `otherRationales`
// list the caller supplies for the cross-gate duplicate rule.
//
// Dominant script = the script with the most letters/digits after NFKC
// normalization; ties go to Hangul.
//   Hangul : decision >= 12 syllables and >= 3 eojeol; ack >= 8 and >= 2
//   Latin+ : decision >= 20 letters/digits and >= 4 words; ack >= 12 and >= 3
// Common caps: jamo-only fails; one character repeated for more than 70
// percent of the letters fails (so does a single token repeated); the
// denylist is matched after ending normalization; a decision rationale equal
// (normalized) to another gate's rationale for the same entity fails.
// The wire contract is the reason code; user-facing text comes from the
// next-intl catalogs (errors.rationale.<reason>), never from this file.
import denylist from "./rationale-denylist.json";

export type RationaleProfile = "decision" | "ack";
export type RationaleReason =
  | "too_short"
  | "too_few_words"
  | "placeholder"
  | "repetitive"
  | "jamo_only"
  | "duplicate_of_other_gate";
export type RationaleResult = { ok: true } | { ok: false; reason: RationaleReason };

const THRESHOLDS = {
  decision: { hangulSyllables: 12, hangulWords: 3, otherChars: 20, otherWords: 4 },
  ack: { hangulSyllables: 8, hangulWords: 2, otherChars: 12, otherWords: 3 },
} as const;

const HANGUL_SYLLABLE = /[\uAC00-\uD7A3]/;
const HANGUL_JAMO = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const REPEAT_SHARE_MAX = 0.7;

// Longest first; one ending is removed once. Polite and plain forms fold onto the stem.
const ENDINGS = [...denylist.ko_endings].sort((a, b) => b.length - a.length);

export function normalizeForDenylist(raw: string): string {
  let s = raw.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}/]/gu, "");
  for (const ending of ENDINGS) {
    if (s.length > ending.length && s.endsWith(ending)) {
      s = s.slice(0, -ending.length);
      break;
    }
  }
  return s;
}

const DENY_STEMS: Set<string> = new Set(
  [...denylist.ko, ...denylist.en].map((e) => normalizeForDenylist(e)).filter((e) => e.length > 0),
);
// Entries that are themselves endings must also match unstripped.
for (const e of [...denylist.ko, ...denylist.en]) {
  const bare = e.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}/]/gu, "");
  if (bare) DENY_STEMS.add(bare);
}

function isDenied(token: string): boolean {
  const bare = token.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}/]/gu, "");
  return DENY_STEMS.has(bare) || DENY_STEMS.has(normalizeForDenylist(token));
}

/** Normalized comparison key for the cross-gate duplicate rule. */
export function rationaleKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function validateRationale(
  text: string,
  profile: RationaleProfile,
  opts: { otherRationales?: readonly string[] } = {},
): RationaleResult {
  const t = text.normalize("NFKC").trim();
  const chars = [...t];
  const letters = chars.filter((c) => LETTER_OR_DIGIT.test(c));
  if (letters.length === 0) return { ok: false, reason: "too_short" };

  const tokens = t.split(/\s+/).filter((w) => LETTER_OR_DIGIT.test(w));

  // Placeholder: the whole text, or every token, is a denylisted stem.
  if (isDenied(t) || tokens.every(isDenied)) return { ok: false, reason: "placeholder" };

  const syllables = letters.filter((c) => HANGUL_SYLLABLE.test(c)).length;
  const jamo = letters.filter((c) => HANGUL_JAMO.test(c)).length;
  const hangulScript = syllables + jamo;
  const otherScript = letters.length - hangulScript;
  const hangulDominant = hangulScript >= otherScript;

  if (hangulDominant && syllables === 0) return { ok: false, reason: "jamo_only" };

  // Repetition: one character above the share cap, or one token said over and over.
  const freq = new Map<string, number>();
  for (const c of letters) freq.set(c, (freq.get(c) ?? 0) + 1);
  if (Math.max(...freq.values()) / letters.length > REPEAT_SHARE_MAX && letters.length > 1) {
    return { ok: false, reason: "repetitive" };
  }
  if (tokens.length > 1 && new Set(tokens.map(rationaleKey)).size === 1) return { ok: false, reason: "repetitive" };

  const th = THRESHOLDS[profile];
  if (hangulDominant) {
    if (syllables < th.hangulSyllables) return { ok: false, reason: "too_short" };
    if (tokens.length < th.hangulWords) return { ok: false, reason: "too_few_words" };
  } else {
    if (letters.length < th.otherChars) return { ok: false, reason: "too_short" };
    if (tokens.length < th.otherWords) return { ok: false, reason: "too_few_words" };
  }

  if (profile === "decision" && opts.otherRationales) {
    const key = rationaleKey(t);
    if (opts.otherRationales.some((o) => rationaleKey(o) === key)) return { ok: false, reason: "duplicate_of_other_gate" };
  }
  return { ok: true };
}
