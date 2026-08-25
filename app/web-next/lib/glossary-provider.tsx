"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, memo, type ReactNode } from "react";
import { api, type GlossaryTermSummary } from "./api.ts";
import { useAuth } from "./auth-client.tsx";
import { GlossaryTerm } from "../components/GlossaryTerm.tsx";

// In-context glossary auto-linking — ui-spec §1 FR-SYS-04's missing half.
// Registered terms occurring in body text are wrapped in the existing
// GlossaryTerm tooltip (dashed underline + popover) automatically.
//
// Matching contract (deliberate, documented):
//   - The lookup map is built from the fields GET /api/glossary actually
//     returns: key / en / ko. Aliases exist only on the per-term detail
//     endpoint — alias auto-detection stays gated until the list endpoint
//     carries them (no N+1 fetching to work around it).
//   - Latin forms (anything containing [A-Za-z0-9]) match case-insensitively
//     with word boundaries, so "CGT" does not fire inside a longer token.
//   - Korean forms match the exact term string — Hangul is not a \w class in
//     JS regex, so \b is meaningless there, and particle attachment makes
//     boundary heuristics unreliable; exact presence is the honest rule.
//   - Alternatives are ordered longest-first so a longer registered term
//     (e.g. "Green Field") wins over a shorter one at the same position.
//
// The list is fetched once per session (module-level promise shared across
// mounts; a failed fetch resets so a later mount can retry). Per-text
// segmentation is memoized in a bounded module cache plus React.memo, so a
// table of rationale rows does not rescan on every render.

interface GlossaryIndex {
  /** False until the (non-blocking) list fetch resolves. */
  ready: boolean;
  matcher: RegExp | null;
  lookup: Map<string, GlossaryTermSummary>;
}

const EMPTY_INDEX: GlossaryIndex = { ready: false, matcher: null, lookup: new Map() };

const GlossaryContext = createContext<GlossaryIndex>(EMPTY_INDEX);

let sessionFetch: Promise<GlossaryTermSummary[]> | null = null;

function fetchTermsOnce(): Promise<GlossaryTermSummary[]> {
  if (!sessionFetch) {
    sessionFetch = api
      .get<GlossaryTermSummary[]>("/api/glossary")
      .then((res) => res.data)
      .catch((err) => {
        sessionFetch = null; // allow a retry on a later mount
        throw err;
      });
  }
  return sessionFetch;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HAS_LATIN = /[A-Za-z0-9]/;

function buildIndex(terms: GlossaryTermSummary[] | null): GlossaryIndex {
  if (!terms || terms.length === 0) return { ready: terms !== null, matcher: null, lookup: new Map() };
  const lookup = new Map<string, GlossaryTermSummary>();
  const forms: string[] = [];
  for (const term of terms) {
    for (const form of [term.key, term.en, term.ko]) {
      const trimmed = form.trim();
      if (trimmed === "") continue;
      const key = trimmed.toLowerCase();
      if (!lookup.has(key)) {
        lookup.set(key, term);
        forms.push(trimmed);
      }
    }
  }
  if (forms.length === 0) return { ready: true, matcher: null, lookup };
  // Longest-first alternation: at the same start position the engine
  // prefers the longer term — the partial-overlap guard.
  forms.sort((a, b) => b.length - a.length);
  const alternation = forms
    .map((form) => (HAS_LATIN.test(form) ? `\\b${escapeRegExp(form)}\\b` : escapeRegExp(form)))
    .join("|");
  let matcher: RegExp | null;
  try {
    matcher = new RegExp(alternation, "gi");
  } catch {
    matcher = null; // defensive: a malformed form never breaks rendering
  }
  return { ready: true, matcher, lookup };
}

type Segment = string | { term: GlossaryTermSummary; matched: string };

// Bounded per-text segment cache, invalidated when the index is rebuilt
// (generation counter — a fresh glossary list invalidates every entry).
let generation = 0;
let cachedGeneration = -1;
const segmentCache = new Map<string, Segment[]>();
const SEGMENT_CACHE_MAX = 500;

function segmentByGlossary(text: string, index: GlossaryIndex): Segment[] {
  if (!index.matcher || text.trim() === "") return [text];
  if (cachedGeneration !== generation) {
    segmentCache.clear();
    cachedGeneration = generation;
  }
  const cached = segmentCache.get(text);
  if (cached) return cached;
  const segments: Segment[] = [];
  let last = 0;
  // matchAll iterates over a spec-level clone of the regex, so the shared
  // index.matcher's lastIndex is never mutated across calls.
  for (const m of text.matchAll(index.matcher)) {
    if (m[0].length === 0) continue;
    const term = index.lookup.get(m[0].toLowerCase());
    if (term) {
      if (m.index > last) segments.push(text.slice(last, m.index));
      segments.push({ term, matched: m[0] });
      last = m.index + m[0].length;
    }
  }
  if (last < text.length) segments.push(text.slice(last));
  const result = segments.length > 0 ? segments : [text];
  if (segmentCache.size >= SEGMENT_CACHE_MAX) {
    const oldest = segmentCache.keys().next().value;
    if (oldest !== undefined) segmentCache.delete(oldest);
  }
  segmentCache.set(text, result);
  return result;
}

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [terms, setTerms] = useState<GlossaryTermSummary[] | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!me || attempted.current) return;
    attempted.current = true;
    fetchTermsOnce()
      .then(setTerms)
      .catch(() => setTerms([]));
  }, [me]);

  const index = useMemo(() => {
    generation += 1;
    return buildIndex(terms);
  }, [terms]);

  return <GlossaryContext.Provider value={index}>{children}</GlossaryContext.Provider>;
}

export function useGlossaryTerms(): GlossaryIndex {
  return useContext(GlossaryContext);
}

/**
 * The withGlossary(text) renderer: renders free text with every registered
 * term auto-wrapped in the existing GlossaryTerm tooltip. Memoized per text
 * (React.memo + the module-level segment cache), so applying it across a
 * table of descriptions stays cheap. Use for prose fields only — never for
 * keys, numbers, or labels.
 */
export const GlossaryText = memo(function GlossaryText({ text }: { text: string }) {
  const index = useGlossaryTerms();
  const segments = useMemo(() => segmentByGlossary(text, index), [text, index]);
  return (
    <>
      {segments.map((segment, i) =>
        typeof segment === "string" ? (
          segment
        ) : (
          <GlossaryTerm key={i} term={segment.term.key}>
            {segment.matched}
          </GlossaryTerm>
        ),
      )}
    </>
  );
});
