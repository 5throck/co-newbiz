// @version 1.0.0
/**
 * ADR-0172 amendment 2026-10-14: the S3 AI proposal may DRAFT 필요도 (necessity) and 필요 수준
 * (required level) for rows where those fields are empty. Drafts are proposals only: a non-empty
 * human value is never overwritten, nothing is written to the DB, and every filled field carries a
 * short `basis` so the reviewer can see why. Kept apart from capability-gap.ts on purpose (pure helpers).
 */
import { NARRATIVE_CAP, NECESSITY_NOTE_CAP, normalizeHeldDraft, type CapabilityGapRow, type GapHeldStatus, type GapNecessity } from "./capability-gap.ts";

export const DRAFT_BASIS_CAP = 300;
export type NecessityDraftField = "necessity" | "necessityScopeNote" | "requiredLevel" | "heldStatus" | "currentLevel";

export interface NecessityDraft {
  necessity: GapNecessity;
  necessityScopeNote: string;
  requiredLevel: string;
  basis: { necessity: string; requiredLevel: string };
}

const KEYS: Array<Exclude<GapNecessity, "">> = ["essential", "partial_essential", "optional"];
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Normalizes one raw LLM entry. Valid keys only; a value without a basis is dropped (unsupported);
 * the scope note exists only with partial_essential, and partial_essential without a scope is
 * dropped (the scope is the whole point). Returns null when nothing usable remains.
 */
export function normalizeNecessityDraft(raw: unknown): NecessityDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const basisRaw = (r.basis && typeof r.basis === "object" ? r.basis : {}) as Record<string, unknown>;
  let necessity: GapNecessity = KEYS.includes(String(r.necessity ?? "").trim() as Exclude<GapNecessity, "">) ? (String(r.necessity).trim() as GapNecessity) : "";
  let scope = necessity === "partial_essential" ? text(r.necessityScopeNote, NECESSITY_NOTE_CAP) : "";
  const necBasis = text(basisRaw.necessity, DRAFT_BASIS_CAP);
  if (necessity && !necBasis) necessity = "";
  if (necessity === "partial_essential" && !scope) necessity = "";
  if (necessity !== "partial_essential") scope = "";
  let requiredLevel = text(r.requiredLevel, NARRATIVE_CAP);
  const levelBasis = text(basisRaw.requiredLevel, DRAFT_BASIS_CAP);
  if (requiredLevel && !levelBasis) requiredLevel = "";
  if (!necessity && !requiredLevel) return null;
  return { necessity, necessityScopeNote: scope, requiredLevel, basis: { necessity: necessity ? necBasis : "", requiredLevel: requiredLevel ? levelBasis : "" } };
}

export interface DraftSource { title: string; url: string }
export interface DraftMark {
  fields: NecessityDraftField[];
  basis: { necessity?: string; requiredLevel?: string; held?: string; currentLevel?: string };
  /** Web sources cited for the held / current-level draft (http/https only). */
  sources?: DraftSource[];
}

/** Fill-empty-only: a non-empty necessity / requiredLevel on the row is never replaced. */
export function applyNecessityDraft(row: CapabilityGapRow, draft: NecessityDraft | null): { row: CapabilityGapRow; mark: DraftMark | null } {
  if (!draft) return { row, mark: null };
  const next = { ...row };
  const fields: NecessityDraftField[] = [];
  const basis: DraftMark["basis"] = {};
  if (!row.necessity && draft.necessity) {
    next.necessity = draft.necessity;
    next.necessityScopeNote = draft.necessityScopeNote;
    fields.push("necessity");
    if (draft.necessityScopeNote) fields.push("necessityScopeNote");
    basis.necessity = draft.basis.necessity;
  }
  if (!row.requiredLevel.trim() && draft.requiredLevel) {
    next.requiredLevel = draft.requiredLevel;
    fields.push("requiredLevel");
    basis.requiredLevel = draft.basis.requiredLevel;
  }
  return fields.length > 0 ? { row: next, mark: { fields, basis } } : { row, mark: null };
}

/**
 * Client merge of a draft response onto the CURRENT local rows (which may hold unsaved human edits):
 * new rows are appended; existing rows keep every local value, and only empty 필요도 / 필요 수준 /
 * 보유 수준 / (unjudged) 보유 판정 are filled from the response.
 */
export function mergeDraftResponse(local: CapabilityGapRow[], response: CapabilityGapRow[]): CapabilityGapRow[] {
  const byId = new Map(response.map((r) => [r.id, r]));
  const merged = local.map((l) => {
    const s = byId.get(l.id);
    if (!s) return l;
    const out = { ...l };
    if (!l.necessity && s.necessity) { out.necessity = s.necessity; out.necessityScopeNote = s.necessityScopeNote; }
    if (!l.requiredLevel.trim()) out.requiredLevel = s.requiredLevel;
    if (!l.currentLevel.trim()) out.currentLevel = s.currentLevel;
    const unjudged = l.held.status === "unevaluated" && l.held.holders.length === 0 && !l.held.evidence.trim();
    if (unjudged) out.held = s.held;
    if (!l.note && s.note) out.note = s.note;
    return out;
  });
  // New rows are appended unless the id or the capability name (case/space-insensitive) already exists.
  const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
  const seen = new Set(local.map((l) => l.id));
  const names = new Set(local.map((l) => norm(l.capability)));
  const added: CapabilityGapRow[] = [];
  for (const r of response) {
    if (seen.has(r.id) || names.has(norm(r.capability))) continue;
    seen.add(r.id); names.add(norm(r.capability)); added.push(r);
  }
  return [...merged, ...added];
}

// ── Held status / current level draft with citations (amendment 2026-10-14, external search) ──

export interface WebSnippet { title: string; url: string; snippet: string }
export const SEARCH_ROW_CAP = 12;
export const SEARCH_QUERIES_PER_ROW = 2;
const SNIPPET_CAP = 300;

/**
 * Web text is untrusted DATA: tags and control characters are stripped, whitespace collapsed,
 * length capped, only http(s) URLs kept. The prompt additionally frames the block as data.
 */
export function sanitizeWebSources(raw: unknown, max = 40): WebSnippet[] {
  if (!Array.isArray(raw)) return [];
  const clean = (v: unknown, cap: number) =>
    String(v ?? "").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, cap);
  const out: WebSnippet[] = [];
  const seen = new Set<string>();
  for (const r of raw as Array<Record<string, unknown>>) {
    const url = String(r?.url ?? "").trim().slice(0, 300);
    if (!/^https?:\/\/[^\s<>"]+$/i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: clean(r.title, 120) || url, url, snippet: clean(r.snippet, SNIPPET_CAP) });
    if (out.length >= max) break;
  }
  return out;
}

/** At most 2 queries per row: the first scoped company's position, then the industry level. */
export function buildHeldQueries(capability: string, companyNames: string[], marketScope: string | null): string[] {
  const cap = capability.trim().slice(0, 60);
  if (!cap) return [];
  const q: string[] = [];
  if (companyNames[0]) q.push(`${companyNames[0]} ${cap} 업계 수준 실적`);
  q.push(`${cap}${marketScope ? ` ${marketScope.slice(0, 30)}` : ""} 업계 수준 주요 기업`);
  return q.slice(0, SEARCH_QUERIES_PER_ROW);
}

export interface CitedHeldCtx {
  /** 1-based source numbers the LLM was allowed to cite for THIS row. */
  allowedSources: number[];
  /** All sanitized sources, 1-based by position. */
  sources: WebSnippet[];
  /** Names of the scoped group/affiliate companies whose profiles were provided. */
  profileNames: string[];
}
export interface CitedHeld {
  status: GapHeldStatus;
  holders: string[];
  evidence: string;
  currentLevel: string;
  basis: { held: string; currentLevel: string };
  web: DraftSource[];
  origins: Array<"profile" | "web">;
}

/**
 * Held-status draft that MUST carry its citations: a judged status survives only when it is backed
 * by a valid web source number (one the row was given) or by the provided profiles (a scoped
 * company named as holder AND basis.heldSource includes "profile"), and has a basis sentence.
 * Anything unsupported is dropped (the row stays 미판정). Holders are limited to scoped companies;
 * evidence gets the citations appended so the saved text keeps them.
 */
export function normalizeCitedHeldDraft(raw: unknown, ctx: CitedHeldCtx): CitedHeld | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const heldRaw = (r.held && typeof r.held === "object" ? r.held : {}) as Record<string, unknown>;
  const d = normalizeHeldDraft({ ...heldRaw, currentLevel: heldRaw.currentLevel ?? r.currentLevel });
  if (!d || d.status === "unevaluated") return null;
  const basisRaw = (r.basis && typeof r.basis === "object" ? r.basis : {}) as Record<string, unknown>;
  const basisHeld = text(basisRaw.held, DRAFT_BASIS_CAP);
  if (!basisHeld) return null;
  const names = new Map(ctx.profileNames.map((n) => [n.toLowerCase(), n]));
  const holders = d.holders.map((h) => names.get(h.toLowerCase())).filter((h): h is string => Boolean(h));
  const srcRaw = Array.isArray(r.sources) ? r.sources : Array.isArray(heldRaw.sources) ? heldRaw.sources : [];
  const idx = [...new Set((srcRaw as unknown[]).map((v) => (typeof v === "number" ? Math.floor(v) : -1)).filter((v) => ctx.allowedSources.includes(v) && v >= 1 && v <= ctx.sources.length))].slice(0, 2);
  const heldSource = String(basisRaw.heldSource ?? r.heldSource ?? "").toLowerCase();
  const profileOk = heldSource.includes("profile") && holders.length > 0;
  if (idx.length === 0 && !profileOk) return null;
  const web = idx.map((i) => ({ title: ctx.sources[i - 1].title, url: ctx.sources[i - 1].url }));
  const origins: CitedHeld["origins"] = [...(profileOk ? ["profile" as const] : []), ...(web.length > 0 ? ["web" as const] : [])];
  const cite = `출처: ${[...(profileOk ? ["그룹/계열사 프로필"] : []), ...web.map((w) => w.url)].join(", ")}`;
  let evidence = d.evidence;
  // `leading` needs comparative evidence text; a bare citation is not enough.
  if (d.status === "leading" && !evidence) return { ...toCited(d, "average", holders, "", cite, basisHeld, basisRaw, web, origins) };
  evidence = `${evidence.slice(0, Math.max(0, 400 - cite.length - 2))}${evidence ? " " : ""}${cite}`.slice(0, 400);
  return toCited(d, d.status, holders, evidence, cite, basisHeld, basisRaw, web, origins);
}

function toCited(d: { currentLevel: string }, status: GapHeldStatus, holders: string[], evidence: string, cite: string, basisHeld: string, basisRaw: Record<string, unknown>, web: DraftSource[], origins: CitedHeld["origins"]): CitedHeld {
  const ev = evidence || cite.slice(0, 400);
  return {
    status, holders, evidence: ev, currentLevel: d.currentLevel.slice(0, NARRATIVE_CAP),
    basis: { held: basisHeld, currentLevel: text(basisRaw.currentLevel, DRAFT_BASIS_CAP) || basisHeld },
    web, origins,
  };
}

/** Fill-empty-only for 보유 판정 (+holders/evidence) and 보유 수준; merges into an existing mark. */
export function applyHeldDraft(row: CapabilityGapRow, cited: CitedHeld | null, prior: DraftMark | null): { row: CapabilityGapRow; mark: DraftMark | null } {
  if (!cited) return { row, mark: prior };
  const next = { ...row, held: { ...row.held } };
  const fields: NecessityDraftField[] = [...(prior?.fields ?? [])];
  const basis: DraftMark["basis"] = { ...(prior?.basis ?? {}) };
  const unjudged = row.held.status === "unevaluated" && row.held.holders.length === 0 && !row.held.evidence.trim();
  if (unjudged) {
    next.held = { status: cited.status, holders: cited.holders, evidence: cited.evidence };
    fields.push("heldStatus");
    basis.held = cited.basis.held;
  }
  if (!row.currentLevel.trim() && cited.currentLevel) {
    next.currentLevel = cited.currentLevel;
    fields.push("currentLevel");
    basis.currentLevel = cited.basis.currentLevel;
  }
  if (fields.length === (prior?.fields.length ?? 0)) return { row, mark: prior };
  return { row: next, mark: { fields, basis, sources: cited.web.length > 0 ? cited.web : prior?.sources } };
}
