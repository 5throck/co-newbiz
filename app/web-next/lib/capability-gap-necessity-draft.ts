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

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Key synonyms models actually emit (snake/camel/Korean). First non-empty wins. */
const pick = (r: Record<string, unknown>, ...names: string[]): unknown => {
  for (const n of names) if (r[n] !== undefined && r[n] !== null && r[n] !== "") return r[n];
  return undefined;
};

/** Row id of a raw LLM item (`id` | `rowId` | `row_id`). */
export function draftItemId(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  return String(pick(raw as Record<string, unknown>, "id", "rowId", "row_id", "rowID") ?? "").trim();
}

/** Korean / spaced / cased labels -> necessity key; "" when unknown. */
export function parseNecessityValue(v: unknown): GapNecessity {
  const t = String(v ?? "").trim().toLowerCase().replace(/[\s_\-]+/g, "");
  if (!t) return "";
  if (["essential", "필수", "필수역량", "필수적"].includes(t)) return "essential";
  if (["partialessential", "partial", "부분필수", "부분적필수", "일부필수"].includes(t)) return "partial_essential";
  if (["optional", "선택", "선택사항", "선택적", "있으면좋음"].includes(t)) return "optional";
  return "";
}

/**
 * Normalizes one raw LLM entry. Valid keys only (Korean labels and key synonyms are accepted); a value
 * without a basis is dropped (unsupported); the scope note exists only with partial_essential, and
 * partial_essential without a scope is dropped (the scope is the whole point). Returns null when nothing
 * usable remains. Per item: one bad item never affects the others.
 */
export function normalizeNecessityDraft(raw: unknown): NecessityDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const basisField = pick(r, "basis", "근거");
  const basisObj = (basisField && typeof basisField === "object" && !Array.isArray(basisField) ? basisField : {}) as Record<string, unknown>;
  const basisStr = typeof basisField === "string" ? text(basisField, DRAFT_BASIS_CAP) : "";
  let necessity: GapNecessity = parseNecessityValue(pick(r, "necessity", "필요도"));
  let scope = necessity === "partial_essential" ? text(pick(r, "necessityScopeNote", "necessity_scope_note", "scopeNote", "필수범위", "필수 범위"), NECESSITY_NOTE_CAP) : "";
  const necBasis = text(pick(basisObj, "necessity", "필요도") ?? pick(r, "necessityBasis", "necessity_basis"), DRAFT_BASIS_CAP) || basisStr;
  if (necessity && !necBasis) necessity = "";
  if (necessity === "partial_essential" && !scope) necessity = "";
  if (necessity !== "partial_essential") scope = "";
  let requiredLevel = text(pick(r, "requiredLevel", "required_level", "필요 수준", "필요수준"), NARRATIVE_CAP);
  const levelBasis = text(pick(basisObj, "requiredLevel", "required_level", "필요 수준", "필요수준") ?? pick(r, "requiredLevelBasis", "required_level_basis"), DRAFT_BASIS_CAP) || basisStr;
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

// ── Missing 필요도 / 필요 수준 detection (ADR-0172 amendment 2026-10-14 (2)) ──

export interface MissingCounts { necessity: number; requiredLevel: number; total: number; rows: number }

/** Which requirement cells of a row are empty: unset 필요도 and an empty 필요 수준 (on every row) are missing. */
export function missingRequirementCells(row: Pick<CapabilityGapRow, "necessity" | "requiredLevel">): { necessity: boolean; requiredLevel: boolean } {
  return { necessity: !row.necessity, requiredLevel: !String(row.requiredLevel ?? "").trim() };
}

export function countMissingRequirement(rows: Array<Pick<CapabilityGapRow, "necessity" | "requiredLevel">>): MissingCounts {
  let necessity = 0, requiredLevel = 0, withMissing = 0;
  for (const r of rows) {
    const m = missingRequirementCells(r);
    if (m.necessity) necessity++;
    if (m.requiredLevel) requiredLevel++;
    if (m.necessity || m.requiredLevel) withMissing++;
  }
  return { necessity, requiredLevel, total: necessity + requiredLevel, rows: withMissing };
}

/**
 * Note sentence for the requirement proposal: always reports how many missing cells were filled and how
 * many remain missing (with the reason), so the answer is never a bare "no changes" while cells are empty.
 * `startMissing` counts every missing cell before the call, including both cells of each proposed new row.
 */
export function missingReport(startMissing: number, after: MissingCounts, reason: string): string {
  const filled = Math.max(0, startMissing - after.total);
  if (startMissing === 0 && after.total === 0) return "누락된 필요도·필요 수준이 없습니다.";
  if (after.total === 0) return `누락 ${filled}건을 모두 채웠습니다(초안).`;
  return `누락 ${startMissing}건 중 ${filled}건을 채웠고, ${after.total}건(필요도 ${after.necessity}·필요 수준 ${after.requiredLevel})은 ${reason} 비워 뒀습니다 — 해당 칸에 "누락" 표시가 남으니 직접 입력하세요.`;
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
    const unjudged = l.held.status === "unevaluated" && !l.held.evidence.trim();
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

// ── Unsaved AI drafts survive refetches (decider report 2026-10-14: "잠깐 나타났다가 사라졌다") ──
//
// Root cause: useSynergyResult.loadGap() did `setGapRows(server.rows); setGapDrafts({})` and its effect also ran
// `setGapNote(null)` whenever loadGap re-ran, so ANY refetch (a late first load, the opportunity id resolving
// after the detail payload arrives, the parent re-fetching) replaced the draft rows, the AI chips and the result
// note with the stored register. Drafts only live in local state until a person saves, so they vanished.
// A refetch must MERGE: rows a person (or the AI) changed locally are kept, untouched rows take the server value.

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge a freshly loaded register into the local rows without losing unsaved work.
 * `base` = the previously loaded server rows. A local row equal to its base row is untouched (takes the server
 * version); a differing one carries unsaved edits or AI drafts (kept). Rows added locally (not in base) are kept;
 * rows deleted locally (in base, absent locally) stay deleted; rows that are new on the server are appended.
 */
export function mergeServerRows(local: CapabilityGapRow[], base: CapabilityGapRow[], server: CapabilityGapRow[]): CapabilityGapRow[] {
  if (local.length === 0 && base.length === 0) return server;
  const baseById = new Map(base.map((r) => [r.id, r]));
  const serverById = new Map(server.map((r) => [r.id, r]));
  const localIds = new Set(local.map((r) => r.id));
  const out: CapabilityGapRow[] = [];
  for (const l of local) {
    const b = baseById.get(l.id);
    const sv = serverById.get(l.id);
    if (!b) { out.push(l); continue; } // added locally (manual or AI), not saved yet
    if (same(l, b)) { if (sv) out.push(sv); continue; } // untouched: follow the server (dropped if deleted there)
    out.push(l); // unsaved edits / AI drafts win
  }
  for (const sv of server) if (!localIds.has(sv.id) && !baseById.has(sv.id)) out.push(sv);
  return out;
}

/** Number of unsaved AI-drafted cells (scope notes ride along with their 필요도 and are not counted). */
export function countDraftFields(drafts: Record<string, DraftMark>): number {
  return Object.values(drafts).reduce((n, m) => n + m.fields.filter((f) => f !== "necessityScopeNote").length, 0);
}

/** Drop marks for rows that no longer exist (after a merge or delete); marks never outlive their row. */
export function pruneDrafts(drafts: Record<string, DraftMark>, rows: CapabilityGapRow[]): Record<string, DraftMark> {
  const ids = new Set(rows.map((r) => r.id));
  return Object.fromEntries(Object.entries(drafts).filter(([id]) => ids.has(id)));
}

/**
 * Discard unsaved AI drafts: marked cells go back to the stored (base) values, rows the AI added are removed.
 * Marks exist only while a cell is untouched since the AI filled it, so a person's edits are never reverted.
 */
export function discardAiDrafts(rows: CapabilityGapRow[], drafts: Record<string, DraftMark>, base: CapabilityGapRow[]): CapabilityGapRow[] {
  const baseById = new Map(base.map((r) => [r.id, r]));
  const out: CapabilityGapRow[] = [];
  for (const r of rows) {
    const m = drafts[r.id];
    if (!m) { out.push(r); continue; }
    const b = baseById.get(r.id);
    if (!b) continue; // proposed row that was never saved
    const next = { ...r, held: { ...r.held } };
    for (const f of m.fields) {
      if (f === "necessity") next.necessity = b.necessity;
      else if (f === "necessityScopeNote") next.necessityScopeNote = b.necessityScopeNote;
      else if (f === "requiredLevel") next.requiredLevel = b.requiredLevel;
      else if (f === "currentLevel") next.currentLevel = b.currentLevel;
      else if (f === "heldStatus") next.held = { ...next.held, status: b.held.status, evidence: b.held.evidence };
    }
    out.push(next);
  }
  return out;
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

const KEYWORD_CAP = 24;
const SUFFIX_RE = /(역량|체계|능력|관리|운영|구축|수준|보유|확보)\s*$/;

/** Short search keyword from a capability name: parentheticals and trailing 역량/체계/능력/관리/운영/구축-style suffixes dropped, capped at ~24 chars. */
export function distillCapabilityKeyword(capability: string): string {
  let k = capability.replace(/[(（\[][^)）\]]*[)）\]]/g, " ").replace(/\s+/g, " ").trim();
  for (let n = 0; n < 4; n++) {
    const next = k.replace(SUFFIX_RE, "").trim();
    // A suffix glued to a very short stem ("품질관리") is part of the term itself, not a generic suffix.
    if (next === k || !next || (next.length < 3 && !/\s(역량|체계|능력|관리|운영|구축|수준|보유|확보)\s*$/.test(k))) break;
    k = next;
  }
  if (!k) k = capability.trim();
  if (k.length > KEYWORD_CAP) {
    const cut = k.slice(0, KEYWORD_CAP);
    const sp = cut.lastIndexOf(" ");
    k = (sp >= 8 ? cut.slice(0, sp) : cut).trim();
  }
  return k;
}

/**
 * Short, clean queries: (1) first scoped company + distilled keyword, (2) keyword + market scope for the
 * industry-level comparison (no company name), (3) an English variant only when the capability has Latin tokens.
 */
export function buildHeldQueries(capability: string, companyNames: string[], marketScope: string | null): string[] {
  const kw = distillCapabilityKeyword(capability);
  if (!kw) return [];
  const q: string[] = [];
  if (companyNames[0]) q.push(`${companyNames[0].trim()} ${kw}`);
  const scope = marketScope?.replace(/\s+/g, " ").trim().slice(0, 20);
  q.push(scope ? `${kw} ${scope} 업계 주요 기업` : `${kw} 업계 주요 기업`);
  const latin = [...new Set(capability.match(/[A-Za-z][A-Za-z0-9+\-]{1,}/g) ?? [])].slice(0, 4);
  if (latin.length > 0) q.push(`${latin.join(" ")} industry leading companies`);
  return q.slice(0, latin.length > 0 ? 3 : SEARCH_QUERIES_PER_ROW);
}

export interface CitedHeldCtx {
  /** 1-based source numbers the LLM was allowed to cite for THIS row. */
  allowedSources: number[];
  /** All sanitized sources, 1-based by position. */
  sources: WebSnippet[];
  /** Names of the scoped group/affiliate companies whose profiles were provided. */
  profileNames: string[];
  /** Companies whose stored DART/financial facts were provided as "[공시·재무 근거]" (disclosure-class evidence). */
  disclosureNames?: string[];
}
export interface CitedHeld {
  status: GapHeldStatus;
  evidence: string;
  currentLevel: string;
  basis: { held: string; currentLevel: string };
  web: DraftSource[];
  origins: Array<"profile" | "dart" | "web">;
}

export type HeldDropReason = "no_item" | "unevaluated" | "no_basis" | "no_citation";
export const HELD_DROP_LABEL: Record<HeldDropReason, string> = {
  no_item: "LLM이 이 행에 답하지 않음", unevaluated: "LLM이 미판정으로 답함", no_basis: "판단 이유(basis) 없음", no_citation: "인용할 프로필·출처 없음",
};

/** Source numbers an LLM may write as 1, "1", "[1]" or "출처 1" — anything with a clean integer is accepted. */
function sourceNumber(v: unknown): number {
  if (typeof v === "number") return Math.floor(v);
  if (typeof v === "string") { const m = v.match(/\d+/); return m ? parseInt(m[0], 10) : -1; }
  return -1;
}

/**
 * Held-status draft that MUST carry its citations: a judged status survives only when it is backed
 * by a valid web source number (one the row was given) or by the provided profiles (basis.heldSource
 * includes "profile", or the basis/evidence names a provided profile company), and has a basis sentence.
 * Anything unsupported is dropped (the row stays 미판정) with a specific reason, so the caller can say why.
 * No holders are proposed (ADR-0172 amendment 2026-10-14 (2)); evidence gets the citations appended.
 */
export function judgeCitedHeldDraft(raw: unknown, ctx: CitedHeldCtx): { cited: CitedHeld | null; reason: HeldDropReason | null } {
  const drop = (reason: HeldDropReason) => ({ cited: null, reason });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return drop("no_item");
  const r = raw as Record<string, unknown>;
  const heldRaw = (r.held && typeof r.held === "object" ? r.held : {}) as Record<string, unknown>;
  const d = normalizeHeldDraft({ ...heldRaw, currentLevel: heldRaw.currentLevel ?? r.currentLevel, evidence: heldRaw.evidence ?? r.evidence, status: heldRaw.status ?? r.status });
  if (!d || d.status === "unevaluated") return drop("unevaluated");
  const basisField = r.basis;
  const basisRaw = (basisField && typeof basisField === "object" && !Array.isArray(basisField) ? basisField : {}) as Record<string, unknown>;
  const basisHeld = text(basisRaw.held ?? (typeof basisField === "string" ? basisField : undefined) ?? heldRaw.basis, DRAFT_BASIS_CAP);
  if (!basisHeld) return drop("no_basis");
  const srcRaw = Array.isArray(r.sources) ? r.sources : Array.isArray(heldRaw.sources) ? heldRaw.sources : [];
  const idx = [...new Set((srcRaw as unknown[]).map(sourceNumber).filter((v) => ctx.allowedSources.includes(v) && v >= 1 && v <= ctx.sources.length))].slice(0, 2);
  const heldSource = String(basisRaw.heldSource ?? r.heldSource ?? "").toLowerCase();
  const mentioned = `${basisHeld} ${d.evidence}`.toLowerCase();
  const profileOk = ctx.profileNames.length > 0 && (heldSource.includes("profile") || heldSource.includes("both") || (heldSource === "" && ctx.profileNames.some((n) => n.trim() && mentioned.includes(n.trim().toLowerCase()))));
  const disclosureNames = ctx.disclosureNames ?? [];
  const dartOk = disclosureNames.length > 0 && heldSource.includes("dart");
  if (idx.length === 0 && !profileOk && !dartOk) return drop("no_citation");
  const web = idx.map((i) => ({ title: ctx.sources[i - 1].title, url: ctx.sources[i - 1].url }));
  const origins: CitedHeld["origins"] = [...(profileOk ? ["profile" as const] : []), ...(dartOk ? ["dart" as const] : []), ...(web.length > 0 ? ["web" as const] : [])];
  const cite = `출처: ${[...(profileOk ? ["그룹/계열사 프로필"] : []), ...(dartOk ? ["공시·재무"] : []), ...web.map((w) => w.url)].join(", ")}`;
  let evidence = d.evidence;
  // `leading` needs comparative evidence text; a bare citation is not enough.
  if (d.status === "leading" && !evidence) return { cited: toCited(d, "average", "", cite, basisHeld, basisRaw, web, origins), reason: null };
  evidence = `${evidence.slice(0, Math.max(0, 400 - cite.length - 2))}${evidence ? " " : ""}${cite}`.slice(0, 400);
  return { cited: toCited(d, d.status, evidence, cite, basisHeld, basisRaw, web, origins), reason: null };
}

export function normalizeCitedHeldDraft(raw: unknown, ctx: CitedHeldCtx): CitedHeld | null {
  return judgeCitedHeldDraft(raw, ctx).cited;
}

function toCited(d: { currentLevel: string }, status: GapHeldStatus, evidence: string, cite: string, basisHeld: string, basisRaw: Record<string, unknown>, web: DraftSource[], origins: CitedHeld["origins"]): CitedHeld {
  const ev = evidence || cite.slice(0, 400);
  return {
    status, evidence: ev, currentLevel: d.currentLevel.slice(0, NARRATIVE_CAP),
    basis: { held: basisHeld, currentLevel: text(basisRaw.currentLevel, DRAFT_BASIS_CAP) || basisHeld },
    web, origins,
  };
}

/** Fill-empty-only for 보유 판정 (+evidence) and 보유 수준; merges into an existing mark. */
export function applyHeldDraft(row: CapabilityGapRow, cited: CitedHeld | null, prior: DraftMark | null): { row: CapabilityGapRow; mark: DraftMark | null } {
  if (!cited) return { row, mark: prior };
  const next = { ...row, held: { ...row.held } };
  const fields: NecessityDraftField[] = [...(prior?.fields ?? [])];
  const basis: DraftMark["basis"] = { ...(prior?.basis ?? {}) };
  const unjudged = row.held.status === "unevaluated" && !row.held.evidence.trim();
  if (unjudged) {
    next.held = { ...row.held, status: cited.status, evidence: cited.evidence };
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
