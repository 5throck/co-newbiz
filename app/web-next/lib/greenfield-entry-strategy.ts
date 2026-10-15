// @version 1.0.0
/**
 * S5 entry strategy (ADR-0171 amendment 2026-10-15 (2)): the selectable modes (build|partner|hire|invest, several allowed,
 * exactly one main) and the free rationale share ONE stored text column (greenfield_assessment.entry_strategy) so no schema
 * change is needed. Encoding: an optional first line "[진출방식] build*,partner" (a "*" marks the main mode) followed by the
 * rationale. Legacy plain text (no header) reads as rationale-only with no modes. Pure and client-safe (no server imports).
 */
import type { GapResolution } from "./capability-gap.ts";

export type EntryMode = GapResolution;
export const ENTRY_MODES: EntryMode[] = ["build", "partner", "hire", "invest"];
export const ENTRY_MODE_LABEL: Record<EntryMode, string> = { build: "직접 구축", partner: "전략 제휴", hire: "인력 영입", invest: "지분 투자" };
export const ENTRY_MODE_HINT: Record<EntryMode, string> = {
  build: "자체 투자와 인력으로 직접 만든다",
  partner: "외부 파트너와 제휴·합작으로 확보한다",
  hire: "필요 인력·조직을 채용·영입해 갖춘다",
  invest: "공급·제휴·기술 기업의 지분(소수·전략 지분)을 취득해 역량을 확보한다",
};
export const ENTRY_RATIONALE_CAP = 600;
export const ENTRY_ALTERNATIVES_CAP = 600;
const HEADER_TAG = "[진출방식]";

export interface EntryModes { modes: EntryMode[]; main: EntryMode | null }
export interface ParsedEntryStrategy extends EntryModes { rationale: string }

const canonical = (list: EntryMode[]): EntryMode[] => ENTRY_MODES.filter((m) => list.includes(m));

/** Enforces: modes are valid and unique (canonical order); main is one of them; a single mode is automatically main. */
export function normalizeModes(modes: readonly string[], main: string | null | undefined): EntryModes {
  const valid = canonical(modes.filter((m): m is EntryMode => (ENTRY_MODES as string[]).includes(m)));
  if (valid.length === 0) return { modes: [], main: null };
  // Exactly one main: the given one when valid, else the first selected mode (a single mode is automatically main).
  return { modes: valid, main: valid.find((x) => x === main) ?? valid[0] };
}

/** True when the selection satisfies the rule: no modes, or the main mode is one of the selected modes. */
export function modesComplete(e: EntryModes): boolean {
  return e.modes.length === 0 ? e.main === null : e.main !== null && e.modes.includes(e.main);
}

export function toggleMode(e: EntryModes, mode: EntryMode): EntryModes {
  const has = e.modes.includes(mode);
  const next = has ? e.modes.filter((m) => m !== mode) : [...e.modes, mode];
  return normalizeModes(next, has && e.main === mode ? null : e.main);
}

export function parseEntryStrategy(raw: string | null | undefined): ParsedEntryStrategy {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (!text.startsWith(HEADER_TAG)) return { modes: [], main: null, rationale: text.trim() };
  const nl = text.indexOf("\n");
  const head = (nl === -1 ? text : text.slice(0, nl)).slice(HEADER_TAG.length);
  const rationale = nl === -1 ? "" : text.slice(nl + 1).trim();
  const tokens = head.split(",").map((t) => t.trim()).filter(Boolean);
  const main = tokens.find((t) => t.endsWith("*"))?.slice(0, -1) ?? null;
  const m = normalizeModes(tokens.map((t) => t.replace(/\*$/, "")), main);
  // A header that names no valid mode is not a header: keep the whole text as the rationale.
  if (m.modes.length === 0) return { modes: [], main: null, rationale: text.trim() };
  return { ...m, rationale };
}

/** Header (only when modes exist) + rationale. No modes => plain rationale (identical to the legacy form). */
export function serializeEntryStrategy(e: EntryModes, rationale: string): string {
  const n = normalizeModes(e.modes, e.main);
  const body = rationale.trim();
  if (n.modes.length === 0) return body;
  const main = n.main;
  const header = `${HEADER_TAG} ${n.modes.map((m) => (m === main ? `${m}*` : m)).join(",")}`;
  return body ? `${header}\n${body}` : header;
}

/** Canonical form of a posted value (header re-normalized; legacy text only trimmed). */
export function normalizeStoredEntryStrategy(raw: string | null | undefined): string {
  const p = parseEntryStrategy(raw);
  return serializeEntryStrategy(p, p.rationale);
}

/** Labelled one-line text for downstream consumers: "진출방식: 직접 구축(주), 전략 제휴 — 근거: …". Legacy text passes through unchanged. */
export function entryStrategyText(raw: string | null | undefined): string {
  const p = parseEntryStrategy(raw);
  if (p.modes.length === 0) return p.rationale;
  const main = p.main;
  const modes = p.modes.map((m) => `${ENTRY_MODE_LABEL[m]}${p.modes.length > 1 && m === main ? "(주)" : ""}`).join(", ");
  return p.rationale ? `진출방식: ${modes} — 근거: ${p.rationale}` : `진출방식: ${modes}`;
}

// ── caution: judgement 해소 방식 outside the selected modes ───────────────────

export interface CautionRow { capability: string; resolution: EntryMode | null }

/** Capabilities whose 해소 방식 is not among the selected modes (empty when no mode is selected). Decision support only. */
export function strategyMismatches(e: EntryModes, rows: readonly CautionRow[]): string[] {
  if (e.modes.length === 0) return [];
  return rows.filter((r) => r.resolution && !e.modes.includes(r.resolution)).map((r) => r.capability.trim() || "(이름 없음)");
}

export function cautionText(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max).join(", ");
  return `진출전략에 없는 방식: ${shown}${names.length > max ? ` 외 ${names.length - max}건` : ""}`;
}

// ── AI proposal merge (fill-empty-only) ───────────────────────────────────────

export interface EntryStrategyProposal {
  modes: Array<{ mode: EntryMode; main: boolean; reason: string }>;
  rationale: string;
  alternatives: string;
  basis: { modes?: string; rationale?: string; alternatives?: string; assumption?: string };
  cautions: string[];
  confidence?: "low" | "medium" | "high";
}
export interface EntryFormState { modes: EntryModes; rationale: string; alternatives: string }
export type EntryAiField = "modes" | "rationale" | "alternatives";
export const ENTRY_AI_FIELD_LABEL: Record<EntryAiField, string> = { modes: "진출 방식 선택", rationale: "선택 근거", alternatives: "검토했으나 선택하지 않은 대안" };

/** Fills ONLY the empty parts (no mode selected / empty text). Human-entered values are never overwritten. */
export function mergeEntryProposal(current: EntryFormState, p: EntryStrategyProposal): { state: EntryFormState; marks: EntryAiField[] } {
  const state: EntryFormState = { modes: { ...current.modes, modes: [...current.modes.modes] }, rationale: current.rationale, alternatives: current.alternatives };
  const marks: EntryAiField[] = [];
  if (current.modes.modes.length === 0 && p.modes.length > 0) {
    const main = p.modes.find((m) => m.main)?.mode ?? null;
    state.modes = normalizeModes(p.modes.map((m) => m.mode), main);
    if (state.modes.modes.length > 0) marks.push("modes");
  }
  if (!current.rationale.trim() && p.rationale.trim()) { state.rationale = p.rationale.trim().slice(0, ENTRY_RATIONALE_CAP); marks.push("rationale"); }
  if (!current.alternatives.trim() && p.alternatives.trim()) { state.alternatives = p.alternatives.trim().slice(0, ENTRY_ALTERNATIVES_CAP); marks.push("alternatives"); }
  return { state, marks };
}
