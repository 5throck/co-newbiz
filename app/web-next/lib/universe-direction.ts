// S6 evaluation-target direction — types and the pure server validator
// (design 2026-11-17-s6-universe-direction-review §5). This is the single
// place the frontend imports its types from. Pure module: no db, no I/O.
//
// Pipeline for an LLM draft: shape + clamp → citation check → number tracing
// against the field's OWN cited items → forbidden phrases → honest marker →
// worst-grade chip. A failing field is emptied, never rewritten into new
// claims (D4). The market support line is composed here from catalog items
// only (D3) — no LLM wording, no thresholds, no outlook labels.
import {
  CAPABILITY_PATTERN,
  DERIVATION_PATTERNS,
  GRADE_ORDER,
  NUMBER_UNITS,
  parseGrade,
  roundTo,
  SOURCE_LEAK_PATTERNS,
  tokenizeNumbers,
  UNVERIFIED_MARKER,
} from "./brownfield-universe.ts";

export type Grade = "A" | "B" | "B-" | "C" | "C-" | "D" | "U";
export type EvidenceKind =
  | "s1_identity"
  | "s1_anchor"
  | "s1_trend_cagr"
  | "s1_topdown_cagr"
  | "s1_external_forecast"
  | "s1_projection"
  | "s1_competitive"
  | "s1_chain"
  | "s1_region_mix"
  | "s1_segments"
  | "s1_opportunity_factor"
  | "s1_risk_factor"
  | "stage_financial"
  | "stage_financial_gap"
  | "s3_capability";
export type CiteField = "scope" | "value_chain" | "priority" | "exclude" | "basis" | "support";

/** One numbered catalog item (design old §4.1 + new §4.1 deltas). */
export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  ref: string;
  version_id: string | null;
  fact: string;
  grade: Grade | null;
  numbers: number[];
  years: number[];
  citeable_in: CiteField[];
  /** Server-formatted value the market support line shows (size, CAGR, stage metric). */
  support_value?: string;
}

/** The evidence item as the UI and the record see it. */
export interface EvidenceView {
  id: string;
  kind: EvidenceKind;
  ref: string;
  version_id: string | null;
  fact: string;
  grade: Grade | null;
}

export interface DirField {
  text: string;
  refs: string[];
  unverified: boolean;
}
export interface DirItem {
  type: string;
  why: string;
  refs: string[];
  unverified: boolean;
}
export type SupportKey = "size" | "growth" | "profitability";
/** `kind` lets the UI localize the segment: growth is `external_forecast |
 * topdown_cagr | trend_cagr | unrecorded`, profitability is `stage_financial |
 * unverified`, size is `anchor`. `value` is "" when nothing is recorded. */
export interface SupportSegment {
  key: SupportKey;
  label: string;
  kind: string;
  value: string;
  ref: string;
  grade: Grade | null;
}
export interface DirectionChecks {
  clamped: Array<{ field: string; from: number; to: number }>;
  dropped_refs: Array<{ field: string; ref: string; reason: "unknown_ref" | "not_citeable" }>;
  untraced_numbers: Array<{ field: string; token: string }>;
  forbidden_phrases: Array<{ field: string; match: string }>;
}
export interface DirectionCounts {
  emptied_fields: number;
  dropped_refs: number;
  clamped: number;
}
export interface UniverseDirectionView {
  direction_version: 1;
  origin: "ai" | "deterministic";
  headline: DirField;
  scope: { industry: DirField; region: DirField; size: DirField };
  value_chain: DirField;
  prioritise: DirItem[];
  exclude: DirItem[];
  basis: DirField;
  support: { segments: SupportSegment[] };
  evidence: EvidenceView[];
  grade: Grade | null;
  checks: DirectionChecks;
}
/** What `target_universe_json.direction` stores: the view without the
 * transient `checks`/`origin` and without `evidence` (own record key). */
export type StoredDirection = Omit<UniverseDirectionView, "checks" | "origin" | "evidence">;
export type OriginValue = "ai" | "deterministic" | "person";
export interface DirectionOrigin {
  headline?: OriginValue;
  scope?: OriginValue;
  value_chain?: OriginValue;
  prioritise?: OriginValue;
  exclude?: OriginValue;
}
export interface DirectionDrafted {
  prompt_version: string;
  generated_at: string;
}
/** Legacy `criteria` projection kept for one release (MCP tool, old tests). */
export interface CriteriaProjection {
  industry: string;
  region: string;
  size: string;
  viability: string;
  rationale: string;
}

// ── caps (design §5.1) ──
const CAPS = { headline: 90, scope: 120, value_chain: 100, type: 60, why: 80, basis: 140 } as const;
const MAX_LIST = 3;
const MAX_REFS = 4;
const MAX_EVIDENCE = 16;

const idNo = (id: string): number => Number(id.slice(1));

function clampWord(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const cut = text.slice(0, cap);
  if (/\s/.test(text[cap] ?? "")) return cut.trim();
  const at = cut.lastIndexOf(" ");
  return (at > 0 ? cut.slice(0, at) : cut).trim();
}

const toEvidenceView = (i: EvidenceItem): EvidenceView => ({
  id: i.id,
  kind: i.kind,
  ref: i.ref,
  version_id: i.version_id,
  fact: i.fact,
  grade: i.grade,
});

interface Ctx {
  byId: Map<string, EvidenceItem>;
  checks: DirectionChecks;
}

const asRec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function clampText(raw: unknown, cap: number, label: string, ctx: Ctx): string {
  if (typeof raw !== "string") return "";
  const t = raw.replace(/\s+/g, " ").trim();
  const out = clampWord(t, cap);
  if (out.length < t.length) ctx.checks.clamped.push({ field: label, from: t.length, to: out.length });
  return out;
}

/** Citation check: the ref must exist and be citeable in the field. */
function cleanRefs(raw: unknown, cite: CiteField | "headline", label: string, ctx: Ctx): string[] {
  const list = Array.isArray(raw) ? [...new Set(raw.filter((r): r is string => typeof r === "string"))] : [];
  if (list.length > MAX_REFS) ctx.checks.clamped.push({ field: `${label}.refs`, from: list.length, to: MAX_REFS });
  const out: string[] = [];
  for (const ref of list.slice(0, MAX_REFS)) {
    const item = ctx.byId.get(ref);
    if (!item) {
      ctx.checks.dropped_refs.push({ field: label, ref, reason: "unknown_ref" });
      continue;
    }
    const ok =
      cite === "headline"
        ? item.citeable_in.some((c) => c !== "basis" && c !== "support") && item.kind !== "s3_capability"
        : item.citeable_in.includes(cite);
    if (!ok) ctx.checks.dropped_refs.push({ field: label, ref, reason: "not_citeable" });
    else if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

/** Number tracing against the field's own cited items (design §5.2.3). */
function untracedTokens(text: string, own: EvidenceItem[]): string[] {
  const bad: string[] = [];
  for (const t of tokenizeNumbers(text)) {
    const prev = text[t.start - 1] ?? "";
    if (t.decimals === 0 && t.token.length === 4 && t.value >= 1990 && t.value <= 2100) {
      if (!own.some((i) => i.years.includes(t.value))) bad.push(t.token);
      continue;
    }
    if (prev === "v" || prev === "E" || text.slice(Math.max(0, t.start - 5), t.start) === "hops ") continue;
    if (t.decimals === 0 && t.value <= 12 && !NUMBER_UNITS.includes(text[t.end] ?? "")) continue;
    const traced = own.some((i) => i.numbers.some((v) => Math.abs(roundTo(v, t.decimals) - t.value) < 1e-9));
    if (!traced) bad.push(t.token);
  }
  return bad;
}

interface TextRules {
  capability: boolean;
  derivation: boolean;
}

/** Forbidden phrases + number tracing. Records every failure; true = passes. */
function passes(text: string, refs: string[], label: string, rules: TextRules, ctx: Ctx): boolean {
  const patterns = [...(rules.derivation ? DERIVATION_PATTERNS : []), ...SOURCE_LEAK_PATTERNS];
  if (rules.capability) patterns.push(CAPABILITY_PATTERN);
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      ctx.checks.forbidden_phrases.push({ field: label, match: m[0] });
      return false;
    }
  }
  const own = refs.map((r) => ctx.byId.get(r)).filter((i): i is EvidenceItem => Boolean(i));
  const bad = untracedTokens(text, own);
  for (const token of bad) ctx.checks.untraced_numbers.push({ field: label, token });
  return bad.length === 0;
}

const unverifiedOf = (text: string, refs: string[]): boolean =>
  text !== "" && (refs.length === 0 || text.includes(UNVERIFIED_MARKER));

const EMPTY_FIELD: DirField = { text: "", refs: [], unverified: false };

function buildField(
  raw: unknown,
  cap: number,
  cite: CiteField | "headline",
  label: string,
  rules: TextRules,
  ctx: Ctx,
): DirField {
  const r = asRec(raw);
  const text = clampText(r.text, cap, label, ctx);
  const refs = cleanRefs(r.refs, cite, label, ctx);
  if (!text || !passes(text, refs, label, rules, ctx)) return { ...EMPTY_FIELD, refs: [] };
  return { text, refs, unverified: unverifiedOf(text, refs) };
}

function buildItems(raw: unknown, cite: "priority" | "exclude", label: string, ctx: Ctx): DirItem[] {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_LIST) ctx.checks.clamped.push({ field: label, from: list.length, to: MAX_LIST });
  const out: DirItem[] = [];
  list.slice(0, MAX_LIST).forEach((entry, i) => {
    const r = asRec(entry);
    const name = `${label}[${i}]`;
    const type = clampText(r.type, CAPS.type, `${name}.type`, ctx);
    const why = clampText(r.why, CAPS.why, `${name}.why`, ctx);
    const refs = cleanRefs(r.refs, cite, name, ctx);
    if (!type) return;
    const rules = { capability: cite === "exclude", derivation: true };
    if (!passes(`${type} ${why}`.trim(), refs, name, rules, ctx)) return;
    out.push({ type, why, refs, unverified: unverifiedOf(`${type} ${why}`, refs) });
  });
  return out;
}

const allRefs = (
  v: Pick<UniverseDirectionView, "headline" | "scope" | "value_chain" | "prioritise" | "exclude" | "basis">,
): string[] => [
  ...v.headline.refs,
  ...v.scope.industry.refs,
  ...v.scope.region.refs,
  ...v.scope.size.refs,
  ...v.value_chain.refs,
  ...v.prioritise.flatMap((i) => i.refs),
  ...v.exclude.flatMap((i) => i.refs),
  ...v.basis.refs,
];

/** Worst grade among the kept refs (old §4.2 order); a confidence chip, never a RAG grade. */
export function worstGrade(grades: Array<Grade | null>): Grade | null {
  let worst = -1;
  for (const g of grades) if (g) worst = Math.max(worst, GRADE_ORDER.indexOf(g));
  return worst < 0 ? null : GRADE_ORDER[worst];
}

/** Market support line (design §4.3): size, growth, stage profitability — catalog items only. */
export function buildSupportLine(catalog: EvidenceItem[]): SupportSegment[] {
  const out: SupportSegment[] = [];
  const first = (kind: EvidenceKind) => catalog.find((i) => i.kind === kind);
  const anchor = first("s1_anchor");
  if (anchor?.support_value) {
    out.push({
      key: "size",
      label: "Market size",
      kind: "anchor",
      value: anchor.support_value,
      ref: anchor.id,
      grade: anchor.grade,
    });
  }
  if (catalog.some((i) => i.kind === "s1_identity")) {
    const growth: Array<[EvidenceKind, string]> = [
      ["s1_external_forecast", "external_forecast"],
      ["s1_topdown_cagr", "topdown_cagr"],
      ["s1_trend_cagr", "trend_cagr"],
    ];
    const hit = growth.map(([k, kind]) => ({ item: first(k), kind })).find((g) => g.item?.support_value);
    out.push(
      hit?.item
        ? {
            key: "growth",
            label: "Growth rate",
            kind: hit.kind,
            value: hit.item.support_value ?? "",
            ref: hit.item.id,
            grade: hit.item.grade,
          }
        : { key: "growth", label: "Growth rate", kind: "unrecorded", value: "", ref: "", grade: null },
    );
    const stage =
      catalog.find((i) => i.kind === "stage_financial" && /margin/.test(i.support_value ?? "")) ??
      first("stage_financial");
    const gap = first("stage_financial_gap");
    if (stage) {
      out.push({
        key: "profitability",
        label: "Stage profitability",
        kind: "stage_financial",
        value: stage.support_value ?? "",
        ref: stage.id,
        grade: stage.grade,
      });
    } else if (gap) {
      out.push({
        key: "profitability",
        label: "Stage profitability",
        kind: "unverified",
        value: "",
        ref: gap.id,
        grade: null,
      });
    }
  }
  return out;
}

/** `[E3] S1 v7 · {fact} · confidence U` — the catalog as the user message shows it. */
export function catalogPromptLines(catalog: EvidenceItem[]): string[] {
  return catalog.map((i) => `[${i.id}] ${i.ref} · ${i.fact} · confidence ${i.grade ?? "-"}`);
}

function assemble(
  origin: "ai" | "deterministic",
  parts: Pick<UniverseDirectionView, "headline" | "scope" | "value_chain" | "prioritise" | "exclude" | "basis">,
  catalog: EvidenceItem[],
  checks: DirectionChecks,
): UniverseDirectionView {
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const support = buildSupportLine(catalog);
  const cited = new Set([...allRefs(parts), ...support.map((s) => s.ref).filter(Boolean)]);
  let evidence = [...cited]
    .map((id) => byId.get(id))
    .filter((i): i is EvidenceItem => Boolean(i))
    .sort((a, b) => idNo(a.id) - idNo(b.id))
    .map(toEvidenceView);
  if (evidence.length > MAX_EVIDENCE) {
    evidence = evidence.slice(0, MAX_EVIDENCE);
    const keep = new Set(evidence.map((e) => e.id));
    const only = (refs: string[]) => refs.filter((r) => keep.has(r));
    const fld = (f: DirField): DirField => ({ ...f, refs: only(f.refs) });
    parts = {
      headline: fld(parts.headline),
      scope: { industry: fld(parts.scope.industry), region: fld(parts.scope.region), size: fld(parts.scope.size) },
      value_chain: fld(parts.value_chain),
      prioritise: parts.prioritise.map((i) => ({ ...i, refs: only(i.refs) })),
      exclude: parts.exclude.map((i) => ({ ...i, refs: only(i.refs) })),
      basis: fld(parts.basis),
    };
    for (const s of support) if (!keep.has(s.ref)) s.ref = "";
  }
  return {
    direction_version: 1,
    origin,
    ...parts,
    support: { segments: support },
    evidence,
    grade: worstGrade(allRefs(parts).map((r) => byId.get(r)?.grade ?? null)),
    checks,
  };
}

export const emptyChecks = (): DirectionChecks => ({
  clamped: [],
  dropped_refs: [],
  untraced_numbers: [],
  forbidden_phrases: [],
});

/**
 * Validate and normalize the model's `direction` object against the catalog.
 * Returns null when neither the headline nor any scope field survives (the
 * route then answers with the parse-failure envelope).
 */
export function normalizeDirection(raw: unknown, catalog: EvidenceItem[]): UniverseDirectionView | null {
  const r = asRec(raw);
  if (Object.keys(r).length === 0) return null;
  const ctx: Ctx = { byId: new Map(catalog.map((i) => [i.id, i])), checks: emptyChecks() };
  const scope = asRec(r.scope);
  const scopeRules = { capability: true, derivation: true };
  const parts = {
    headline: buildField(
      r.headline,
      CAPS.headline,
      "headline",
      "headline",
      { capability: false, derivation: true },
      ctx,
    ),
    scope: {
      industry: buildField(scope.industry, CAPS.scope, "scope", "scope.industry", scopeRules, ctx),
      region: buildField(scope.region, CAPS.scope, "scope", "scope.region", scopeRules, ctx),
      size: buildField(scope.size, CAPS.scope, "scope", "scope.size", scopeRules, ctx),
    },
    value_chain: buildField(
      r.value_chain,
      CAPS.value_chain,
      "value_chain",
      "value_chain",
      { capability: false, derivation: true },
      ctx,
    ),
    prioritise: buildItems(r.prioritise, "priority", "prioritise", ctx),
    exclude: buildItems(r.exclude, "exclude", "exclude", ctx),
    // The basis line may narrate its grounding; source naming and leakage stay banned.
    basis: buildField(r.basis, CAPS.basis, "basis", "basis", { capability: false, derivation: false }, ctx),
  };
  const alive = parts.headline.text || parts.scope.industry.text || parts.scope.region.text || parts.scope.size.text;
  if (!alive) return null;
  return assemble("ai", parts, catalog, ctx.checks);
}

/** LLM unavailable: the support line and evidence only; every direction field empty (§5.2.8). */
export function deterministicDirection(catalog: EvidenceItem[]): UniverseDirectionView {
  const empty = (): DirField => ({ ...EMPTY_FIELD, refs: [] });
  return assemble(
    "deterministic",
    {
      headline: empty(),
      scope: { industry: empty(), region: empty(), size: empty() },
      value_chain: empty(),
      prioritise: [],
      exclude: [],
      basis: empty(),
    },
    catalog,
    emptyChecks(),
  );
}

export function directionCounts(checks: DirectionChecks): DirectionCounts {
  const emptied = new Set([...checks.untraced_numbers, ...checks.forbidden_phrases].map((c) => c.field));
  return { emptied_fields: emptied.size, dropped_refs: checks.dropped_refs.length, clamped: checks.clamped.length };
}

export function criteriaProjection(view: UniverseDirectionView): CriteriaProjection {
  return {
    industry: view.scope.industry.text,
    region: view.scope.region.text,
    size: view.scope.size.text,
    viability: "",
    rationale: "",
  };
}

// ── record writer (PUT targets) — design §5.4 ──

const ORIGIN_VALUES: readonly string[] = ["ai", "deterministic", "person"];
const EVIDENCE_KINDS: readonly string[] = [
  "s1_identity",
  "s1_anchor",
  "s1_trend_cagr",
  "s1_topdown_cagr",
  "s1_external_forecast",
  "s1_projection",
  "s1_competitive",
  "s1_chain",
  "s1_region_mix",
  "s1_segments",
  "s1_opportunity_factor",
  "s1_risk_factor",
  "stage_financial",
  "stage_financial_gap",
  "s3_capability",
];
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function sanitizeEvidence(raw: unknown): EvidenceView[] {
  if (!Array.isArray(raw)) return [];
  const out: EvidenceView[] = [];
  for (const e of raw) {
    if (out.length >= MAX_EVIDENCE) break;
    const r = asRec(e);
    const id = str(r.id, 4);
    if (!/^E\d{1,2}$/.test(id) || out.some((o) => o.id === id)) continue;
    const kind = str(r.kind, 40);
    out.push({
      id,
      kind: (EVIDENCE_KINDS.includes(kind) ? kind : "s1_identity") as EvidenceKind,
      ref: str(r.ref, 60),
      version_id: typeof r.version_id === "string" ? r.version_id.slice(0, 40) : null,
      fact: str(r.fact, 200),
      grade: parseGrade(r.grade),
    });
  }
  return out;
}

function storedField(raw: unknown, cap: number, ids: Set<string>): DirField {
  const r = asRec(raw);
  const refs = (Array.isArray(r.refs) ? r.refs : []).filter((x): x is string => typeof x === "string" && ids.has(x));
  return { text: str(r.text, cap), refs: [...new Set(refs)].slice(0, MAX_REFS), unverified: r.unverified === true };
}

function storedItems(raw: unknown, ids: Set<string>): DirItem[] {
  return (Array.isArray(raw) ? raw : []).slice(0, MAX_LIST).flatMap((e) => {
    const r = asRec(e);
    const f = storedField({ text: "x", refs: r.refs, unverified: r.unverified }, 1, ids);
    const type = str(r.type, CAPS.type);
    return type ? [{ type, why: str(r.why, CAPS.why), refs: f.refs, unverified: f.unverified }] : [];
  });
}

/** Re-apply clamps and drop refs outside the evidence list; hand edits are NOT re-traced (boundary 2). */
function sanitizeDirection(raw: unknown, evidence: EvidenceView[]): StoredDirection {
  const r = asRec(raw);
  const ids = new Set(evidence.map((e) => e.id));
  const scope = asRec(r.scope);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const segments = (Array.isArray(asRec(r.support).segments) ? (asRec(r.support).segments as unknown[]) : [])
    .slice(0, 4)
    .flatMap((s) => {
      const x = asRec(s);
      const key = x.key === "size" || x.key === "growth" || x.key === "profitability" ? x.key : null;
      if (!key) return [];
      const ref = typeof x.ref === "string" && ids.has(x.ref) ? x.ref : "";
      return [
        {
          key,
          label: str(x.label, 40),
          kind: str(x.kind, 40),
          value: str(x.value, 60),
          ref,
          grade: parseGrade(x.grade),
        } as SupportSegment,
      ];
    });
  const view = {
    direction_version: 1 as const,
    headline: storedField(r.headline, CAPS.headline, ids),
    scope: {
      industry: storedField(scope.industry, CAPS.scope, ids),
      region: storedField(scope.region, CAPS.scope, ids),
      size: storedField(scope.size, CAPS.scope, ids),
    },
    value_chain: storedField(r.value_chain, CAPS.value_chain, ids),
    prioritise: storedItems(r.prioritise, ids),
    exclude: storedItems(r.exclude, ids),
    basis: storedField(r.basis, CAPS.basis, ids),
    support: { segments },
    grade: null as Grade | null,
  };
  view.grade = worstGrade(allRefs(view).map((id) => byId.get(id)?.grade ?? null));
  return view;
}

/**
 * The additive record keys for a PUT (design §5.4). Preserve-when-absent,
 * `null` clears; the returned object holds only keys that should exist, so the
 * caller spreads it AFTER `definition` and the legacy keys.
 */
export function directionRecordKeys(
  existing: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pick = (key: string, sanitize: (v: unknown) => unknown): void => {
    if (body[key] === null) return;
    const value = body[key] !== undefined ? sanitize(body[key]) : existing[key];
    if (value !== undefined && value !== null) out[key] = value;
  };
  pick("evidence", sanitizeEvidence);
  const evidence = (out.evidence as EvidenceView[] | undefined) ?? [];
  pick("direction", (v) => sanitizeDirection(v, evidence));
  if (out.direction !== undefined) out.direction_version = 1;
  pick("origin", (v) => {
    const r = asRec(v);
    const o: Record<string, OriginValue> = {};
    for (const k of ["headline", "scope", "value_chain", "prioritise", "exclude"]) {
      if (ORIGIN_VALUES.includes(r[k] as string)) o[k] = r[k] as OriginValue;
    }
    return o;
  });
  pick("drafted", (v) => {
    const r = asRec(v);
    return { prompt_version: str(r.prompt_version, 60), generated_at: str(r.generated_at, 40) };
  });
  return out;
}
