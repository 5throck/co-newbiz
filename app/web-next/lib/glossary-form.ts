// Pure helpers behind the admin glossary registration form (key suggestion,
// alias chips, live duplicate check, production write block). Kept free of
// React and node:fs so the unit tests and the API route share one definition.

export interface GlossaryIdentity {
  key: string;
  ko: string;
  en: string;
  aliases?: string[];
}

export type GlossaryIdentityField = "key" | "ko" | "en" | "alias";

export interface GlossaryDuplicateHit {
  /** Which candidate value clashed. */
  field: GlossaryIdentityField;
  value: string;
  /** Key of the existing entry it clashes with, and which of its fields matched. */
  entryKey: string;
  entryField: GlossaryIdentityField;
}

/** Existing registry keys read like the English term itself ("Stage Gate", "Pre-FS", "WACC"). */
export function suggestKey(en: string): string {
  return en
    .replace(/[^A-Za-z0-9 _+-]+/g, " ")
    .split(/[\s_]+/)
    .filter(Boolean)
    // Title-case plain lowercase words only; words with digits or internal
    // capitals ("v2", "Pre-FS", "WACC") keep their form, like existing keys.
    .map((word) => (/^[a-z]+$/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function norm(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Split pasted or typed alias text on commas/newlines; drops blanks and duplicates (case-insensitive). */
export function addAliases(current: readonly string[], raw: string): string[] {
  const out = [...current];
  for (const piece of raw.split(/[,\n]/)) {
    const alias = piece.trim().replace(/\s+/g, " ");
    if (alias && !out.some((a) => norm(a) === norm(alias))) out.push(alias);
  }
  return out;
}

export function findGlossaryDuplicates(candidate: GlossaryIdentity, existing: readonly GlossaryIdentity[]): GlossaryDuplicateHit[] {
  const mineAll: Array<{ field: GlossaryIdentityField; value: string }> = [
    { field: "key", value: candidate.key },
    { field: "ko", value: candidate.ko },
    { field: "en", value: candidate.en },
    ...(candidate.aliases ?? []).map((value) => ({ field: "alias" as const, value })),
  ];
  const mine = mineAll.filter((m) => norm(m.value) !== "");
  const hits: GlossaryDuplicateHit[] = [];
  for (const entry of existing) {
    const theirs: Array<{ field: GlossaryIdentityField; value: string }> = [
      { field: "key", value: entry.key },
      { field: "ko", value: entry.ko },
      { field: "en", value: entry.en },
      ...(entry.aliases ?? []).map((value): { field: GlossaryIdentityField; value: string } => ({ field: "alias", value })),
    ];
    for (const m of mine) {
      const match = theirs.find((t) => norm(t.value) === norm(m.value));
      if (match) hits.push({ field: m.field, value: m.value, entryKey: entry.key, entryField: match.field });
    }
  }
  return hits;
}

/**
 * Terms are added through the repo in a deployed build: the YAML registry is a
 * source file, and the Docker image's copy is not the checked-in one.
 */
export function isGlossaryWriteBlocked(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" || Boolean(env.DOCKER_CONTAINER) || env.GLOSSARY_READ_ONLY === "1";
}

/** Registry owners offered by the form (roster agent keys that own glossary terms or lead a domain). */
export const GLOSSARY_OWNER_KEYS = [
  "glossary-curator",
  "process-governance-manager",
  "platform-lead",
  "industry-lead",
  "region-lead",
  "compliance-officer",
  "docs-writer",
  "security-engineer",
  "risk-officer",
  "brownfield-agent",
  "greenfield-agent",
  "hr-integration-agent",
  "legal-counsel",
  "financial-analyst",
  "partnership-agent",
  "commercial-dd-agent",
  "technical-dd-agent",
  "market-intelligence-agent",
  "valuation-agent",
  "pmi-agent",
  "group-review-agent",
  "antitrust-agent",
  "certification-agent",
  "data-architect",
  "quant-methodologist",
] as const;
