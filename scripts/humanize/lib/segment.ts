// @version 1.0.0
/**
 * segment.ts — protected-block / prose segmentation and unit packing.
 *
 * Design: docs/designs/2026-11-18-humanize-polish-integration-design.md
 * (spec humanize-polish), sections "Exclusions" (protected blocks) and
 * "prepare" step 2 (packing).
 *
 * Pure and clone-agnostic. Protection is structural (line patterns, no LLM):
 * a protected block is never part of any unit, so it cannot be reworded.
 * Every function is lossless: concatenating the output texts in order gives
 * back the input exactly (CRLF included).
 */

import { HANGUL_DOMINANCE_THRESHOLD, isHangulDominant } from "./eligibility";

/** Maximum characters (code points) of one polishing unit. */
export const MAX_UNIT_CHARS = 5000;

export type ProtectedReason =
  | "frontmatter"
  | "fenced-code"
  | "table"
  | "blockquote"
  | "html-comment"
  | "checklist"
  | "marked-section"
  | "blank"
  | "not-hangul-dominant";

export type Block = { type: "protected"; reason: ProtectedReason; text: string } | { type: "prose"; text: string };

export interface SegmentOptions {
  /** Headings (text without the leading #) whose section is protected (glossary definitions). */
  protectedHeadings?: string[];
  /** Hangul-dominance threshold for a prose paragraph. */
  threshold?: number;
}

/** Code point length (Hangul is BMP, but emoji etc. are not). */
export function charLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function splitLines(text: string): string[] {
  // Keep terminators so the split is lossless.
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_RE = /^\s*\|/;
const QUOTE_RE = /^ {0,3}>/;
const CHECK_RE = /^\s*[-*+]\s+\[[ xX]\]/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * Structural pass: split the document into protected blocks and raw prose runs
 * (a run may still contain several paragraphs and blank lines).
 */
function structuralPass(text: string, opts: SegmentOptions): Block[] {
  const lines = splitLines(text);
  const blocks: Block[] = [];
  const pushProt = (reason: ProtectedReason, t: string) => {
    if (!t) return;
    const last = blocks[blocks.length - 1];
    if (last && last.type === "protected" && last.reason === reason) last.text += t;
    else blocks.push({ type: "protected", reason, text: t });
  };
  const pushProse = (t: string) => {
    if (!t) return;
    const last = blocks[blocks.length - 1];
    if (last && last.type === "prose") last.text += t;
    else blocks.push({ type: "prose", text: t });
  };

  const protectedHeadings = new Set((opts.protectedHeadings ?? []).map((h) => h.trim()));
  let i = 0;

  // Frontmatter: only at the very start.
  if (lines.length > 0 && /^---[ \t]*\r?\n?$/.test(lines[0])) {
    let j = 1;
    while (j < lines.length && !/^---[ \t]*\r?\n?$/.test(lines[j])) j++;
    if (j < lines.length) {
      pushProt("frontmatter", lines.slice(0, j + 1).join(""));
      i = j + 1;
    }
  }

  let sectionLevel = 0; // >0 while inside a protected-heading section
  while (i < lines.length) {
    const line = lines[i];
    const h = HEADING_RE.exec(line.replace(/\r?\n$/, ""));
    if (h) {
      const level = h[1].length;
      if (sectionLevel > 0 && level <= sectionLevel) sectionLevel = 0;
      if (sectionLevel === 0 && protectedHeadings.has(h[2].trim())) sectionLevel = level;
    }
    if (sectionLevel > 0) {
      pushProt("marked-section", line);
      i++;
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      let j = i + 1;
      const closeRe = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*\\r?\\n?$`);
      while (j < lines.length && !closeRe.test(lines[j])) j++;
      const end = j < lines.length ? j + 1 : lines.length;
      pushProt("fenced-code", lines.slice(i, end).join(""));
      i = end;
      continue;
    }
    if (/^\s*<!--/.test(line)) {
      let j = i;
      while (j < lines.length && !lines[j].includes("-->")) j++;
      const end = j < lines.length ? j + 1 : lines.length;
      pushProt("html-comment", lines.slice(i, end).join(""));
      i = end;
      continue;
    }
    if (TABLE_RE.test(line)) {
      pushProt("table", line);
      i++;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      pushProt("blockquote", line);
      i++;
      continue;
    }
    if (CHECK_RE.test(line)) {
      pushProt("checklist", line);
      i++;
      continue;
    }
    pushProse(line);
    i++;
  }
  return blocks;
}

/** Split a prose run into paragraphs: content lines plus their trailing blank lines. */
function splitParagraphs(run: string): string[] {
  const out: string[] = [];
  let cur = "";
  let lastBlank = false;
  for (const line of splitLines(run)) {
    const blank = line.trim() === "";
    if (!blank && lastBlank) {
      out.push(cur);
      cur = "";
    }
    cur += line;
    lastBlank = blank;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Segment a document into protected and prose blocks. Prose is split into
 * paragraphs; a paragraph that is blank or not Hangul-dominant becomes a
 * protected passthrough block.
 */
export function segmentDocument(text: string, opts: SegmentOptions = {}): Block[] {
  const threshold = opts.threshold ?? HANGUL_DOMINANCE_THRESHOLD;
  const out: Block[] = [];
  for (const b of structuralPass(text, opts)) {
    if (b.type === "protected") {
      out.push(b);
      continue;
    }
    for (const para of splitParagraphs(b.text)) {
      if (para.trim() === "") out.push({ type: "protected", reason: "blank", text: para });
      else if (!isHangulDominant(para, threshold)) {
        out.push({ type: "protected", reason: "not-hangul-dominant", text: para });
      } else out.push({ type: "prose", text: para });
    }
  }
  return out;
}

/** Cut one over-long paragraph at sentence ends (then whitespace, then hard). */
export function splitOversized(text: string, max: number = MAX_UNIT_CHARS): string[] {
  if (charLength(text) <= max) return [text];
  const pieces: string[] = [];
  // Sentence end: terminal punctuation (+ closing quotes/brackets) + whitespace.
  const re = /[.!?…。]["'”’)\]」』]*\s+/g;
  const sentences: string[] = [];
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    sentences.push(text.slice(last, m.index + m[0].length));
    last = m.index + m[0].length;
  }
  if (last < text.length) sentences.push(text.slice(last));
  let cur = "";
  const flush = () => {
    if (cur) pieces.push(cur);
    cur = "";
  };
  for (const s of sentences) {
    if (charLength(s) > max) {
      flush();
      // A single sentence beyond the limit: cut at whitespace, else hard.
      let rest = s;
      while (charLength(rest) > max) {
        const chars = Array.from(rest);
        const head = chars.slice(0, max).join("");
        const ws = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
        const cut = ws > 0 ? ws + 1 : head.length;
        pieces.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      cur = rest;
    } else if (charLength(cur) + charLength(s) > max) {
      flush();
      cur = s;
    } else cur += s;
  }
  flush();
  return pieces;
}

export type PlanItem =
  | { type: "protected"; reason: ProtectedReason; text: string; start: number; end: number }
  | { type: "unit"; id: string; text: string; start: number; end: number };

/**
 * Pack consecutive prose paragraphs into units of at most `max` characters,
 * cutting only on paragraph boundaries (sentence ends for an oversized
 * paragraph) and never across a protected block. Returns the ordered plan with
 * source offsets, and checks the concatenation round-trip before returning.
 */
export function buildPlan(blocks: Block[], max: number = MAX_UNIT_CHARS): PlanItem[] {
  const plan: PlanItem[] = [];
  let offset = 0;
  let unitNo = 0;
  let curText = "";
  let curStart = 0;

  const flush = () => {
    if (!curText) return;
    unitNo++;
    plan.push({
      type: "unit",
      id: String(unitNo).padStart(3, "0"),
      text: curText,
      start: curStart,
      end: curStart + curText.length,
    });
    curText = "";
  };

  for (const b of blocks) {
    if (b.type === "protected") {
      flush();
      plan.push({ type: "protected", reason: b.reason, text: b.text, start: offset, end: offset + b.text.length });
      offset += b.text.length;
      continue;
    }
    for (const piece of splitOversized(b.text, max)) {
      if (curText && charLength(curText) + charLength(piece) > max) flush();
      if (!curText) curStart = offset;
      curText += piece;
      offset += piece.length;
    }
  }
  flush();

  const rebuilt = plan.map((p) => p.text).join("");
  const original = blocks.map((b) => b.text).join("");
  if (rebuilt !== original) throw new Error("segment: packing round-trip failed (lossless check)");
  return plan;
}

/** Leading and trailing whitespace of a unit (restored after the LLM edit). */
export function edgeWhitespace(s: string): { lead: string; trail: string } {
  return { lead: /^\s*/.exec(s)?.[0] ?? "", trail: /\s*$/.exec(s)?.[0] ?? "" };
}
