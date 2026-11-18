// @version 1.0.0
/**
 * eligibility.ts — default-deny exclusion rules for Korean polishing.
 *
 * Design: docs/designs/2026-11-18-humanize-polish-integration-design.md
 * (spec humanize-polish), section "Exclusions (default-deny)".
 *
 * Pure and clone-agnostic: no filesystem access, no knowledge of the
 * upstream clone. Everything here is deterministic string logic.
 */

import { isAbsolute, relative } from "node:path";

/** Deliverable kinds the caller may declare. Anything else is excluded. */
export const ELIGIBLE_KINDS = ["report", "summary", "document", "manual-ko", "wiki-ko"] as const;
export type EligibleKind = (typeof ELIGIBLE_KINDS)[number];

/** Directory prefixes (project-relative) that are never polished. */
export const DENY_DIRS: readonly string[] = [
  "policies",
  "procedures",
  "docs/adr",
  "docs/governance",
  "docs/runbooks", // operational procedures; *_ko.md runbooks stay excluded (user decision)
  "checklists",
  "glossary",
  "region-profiles",
  "industry-profiles",
  "skills",
  "agents",
  "memory",
];

/** File basenames never polished, wherever they sit. */
export const DENY_BASENAMES: readonly string[] = ["CHANGELOG.md"];

/** Extensions never polished (machine-readable or code). */
export const DENY_EXTENSIONS: readonly string[] = [".yaml", ".yml", ".json", ".ts", ".py"];

/** Default Hangul-dominance threshold for a prose block (share of letters). */
export const HANGUL_DOMINANCE_THRESHOLD = 0.3;

export interface Eligibility {
  eligible: boolean;
  /** Present when excluded: the rule that excluded the input. */
  rule?: string;
}

export interface ClassifyInput {
  text: string;
  kind: string | undefined;
  /** Origin path of the text, when it has one (project-relative or absolute). */
  path?: string;
  /** Project root used to relativize absolute paths. Defaults to process.cwd(). */
  root?: string;
  /** Override the Hangul-dominance threshold (fixtures/tests). */
  threshold?: number;
}

/** Hangul syllable count and total letter count of a string. */
export function letterStats(s: string): { hangul: number; letters: number } {
  let hangul = 0;
  let letters = 0;
  for (const ch of s) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      const c = ch.codePointAt(0) ?? 0;
      if (c >= 0xac00 && c <= 0xd7a3) hangul++;
    }
  }
  return { hangul, letters };
}

/** Share of letters that are Hangul syllables (0 when there are no letters). */
export function hangulRatio(s: string): number {
  const { hangul, letters } = letterStats(s);
  return letters === 0 ? 0 : hangul / letters;
}

export function isHangulDominant(s: string, threshold = HANGUL_DOMINANCE_THRESHOLD): boolean {
  return hangulRatio(s) >= threshold;
}

/** Normalize an origin path to a project-relative POSIX path when possible. */
export function normalizePath(path: string, root: string = process.cwd()): { rel: string; outside: boolean } {
  let p = path.replace(/\\/g, "/");
  if (isAbsolute(p)) {
    const rel = relative(root, p).replace(/\\/g, "/");
    if (rel === "" || rel.startsWith("..")) return { rel: p.replace(/^\/+/, ""), outside: true };
    p = rel;
  }
  p = p.replace(/^(\.\/)+/, "");
  return { rel: p, outside: false };
}

/** Which denylist rule (if any) matches this path. Default-deny on outside paths. */
export function matchDenylist(path: string, root: string = process.cwd()): string | undefined {
  const { rel, outside } = normalizePath(path, root);
  const parts = rel.split("/").filter((x) => x.length > 0);
  const base = parts[parts.length - 1] ?? "";
  if (DENY_BASENAMES.includes(base)) return `denylist: ${base}`;
  const lower = base.toLowerCase();
  for (const ext of DENY_EXTENSIONS) {
    if (lower.endsWith(ext)) return `denylist: *${ext}`;
  }
  for (const dir of DENY_DIRS) {
    const segs = dir.split("/");
    if (outside) {
      // Cannot anchor an outside path to the project root: deny when the
      // segment run appears anywhere (default-deny).
      for (let i = 0; i + segs.length <= parts.length; i++) {
        if (segs.every((s, j) => parts[i + j] === s)) return `denylist: ${dir}/**`;
      }
    } else if (segs.length < parts.length && segs.every((s, j) => parts[j] === s)) {
      return `denylist: ${dir}/**`;
    }
  }
  return undefined;
}

/** Minimal frontmatter reader: top-level `key: value` lines of a leading --- block. */
export function parseFrontmatter(text: string): Record<string, string> | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return undefined;
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Decide whether a deliverable may be polished at all. Every rule must hold;
 * the first violated rule is reported. Order: kind, path, frontmatter,
 * legal-opinion, then script (Hangul presence).
 */
export function classify(input: ClassifyInput): Eligibility {
  const kind = (input.kind ?? "").trim();
  if (!kind) return { eligible: false, rule: "kind: not declared (default-deny)" };
  if (kind === "legal-opinion") return { eligible: false, rule: "kind: legal-opinion" };
  if (!(ELIGIBLE_KINDS as readonly string[]).includes(kind)) {
    return { eligible: false, rule: `kind: '${kind}' is not an eligible kind` };
  }
  if (input.path) {
    const hit = matchDenylist(input.path, input.root);
    if (hit) return { eligible: false, rule: hit };
  }
  const fm = parseFrontmatter(input.text);
  if (fm) {
    // Korean docs carry lang_reason by policy; only source-material is polishable.
    // legal / proper-noun / unknown values are default-denied (text must not drift).
    if ("lang_reason" in fm && fm.lang_reason.toLowerCase() !== "source-material") {
      return { eligible: false, rule: `frontmatter: lang_reason: ${fm.lang_reason || "(empty)"}` };
    }
    if ((fm.humanize ?? "").toLowerCase() === "skip") return { eligible: false, rule: "frontmatter: humanize: skip" };
    const k = (fm.kind ?? "").toLowerCase();
    if (k === "legal-opinion") return { eligible: false, rule: "frontmatter: kind: legal-opinion" };
    if (k === "glossary") return { eligible: false, rule: "frontmatter: kind: glossary" };
    for (const key of ["owner", "author", "agent"]) {
      if ((fm[key] ?? "").toLowerCase().includes("legal-counsel")) {
        return { eligible: false, rule: "ownership: legal-counsel output" };
      }
    }
  }
  const { hangul } = letterStats(input.text);
  if (hangul === 0) return { eligible: false, rule: "script: no Hangul text" };
  return { eligible: true };
}
