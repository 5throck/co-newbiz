// S3-S8 required-capability linkage (ADR-0170, slice 1). Pure and client-safe
// (no node:crypto, so technical-lens.ts and S8 panels can import it).
//
// S3 owns the requirement (capability, requiredNote, held.*, requiredLevel,
// currentLevel); S8 owns the attainability judgement on that row. A versioned
// hash over the S3-owned fields is stamped into attainability.basisHash at
// judgement time; stale = judgement exists and the stamp differs from the row's
// current hash (derived on read, so every register writer triggers it). On a
// register write, stale judgements are moved to history, never deleted.
import {
  HISTORY_CAP,
  NARRATIVE_CAP,
  NECESSITY_LABEL,
  NECESSITY_UNSET_LABEL,
  REMOVED_CAP,
  HELD_STATUS_LABEL,
  parseGapRegister,
  parseRemovedCapabilities,
  type AttainabilityHistoryEntry,
  type CapabilityAttainability,
  type CapabilityGapRow,
  type RemovedCapability,
  type S3Snapshot,
} from "./capability-gap.ts";

export const ROW_HASH_VERSION = "v2";

// ── Pure SHA-256 (hex) ───────────────────────────────────────────────────────

const PRIMES = (() => {
  const out: number[] = [];
  for (let n = 2; out.length < 64; n++) if (out.every((p) => n % p !== 0)) out.push(n);
  return out;
})();
const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = PRIMES.map((p) => frac32(Math.cbrt(p)));
const H0 = PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p)));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = [...H0];
  const w = new Array<number>(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

// ── Row hash / stale ─────────────────────────────────────────────────────────

const t = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const sortedHolders = (row: CapabilityGapRow) => [...(row.held?.holders ?? [])].map(t).filter(Boolean).sort();

/**
 * v2 hash (ADR-0172) of the S3-owned fields (canonical JSON, fixed key order, trimmed,
 * holders sorted): capability, requiredNote, necessity (+ scope note), requiredLevel text,
 * held status, currentLevel text, holders, evidence. Excludes id, source, note, resolution,
 * attainability and register-level keys. Empty and missing are treated alike.
 */
export function capabilityRowHash(row: CapabilityGapRow): string {
  const canonical = JSON.stringify({
    capability: t(row.capability),
    requiredNote: t(row.requiredNote),
    necessity: t(row.necessity),
    necessityScopeNote: t(row.necessityScopeNote),
    requiredLevel: t(row.requiredLevel),
    heldStatus: row.held?.status ?? "unevaluated",
    currentLevel: t(row.currentLevel),
    holders: sortedHolders(row),
    heldEvidence: t(row.held?.evidence),
  });
  return `v2:${sha256Hex(canonical).slice(0, 16)}`;
}

/**
 * v1 recomputation (pre-ADR-0172): same fields without necessity, and the held key as
 * originally stored (a legacy met/unmet marker wins over its read-mapped key).
 */
export function capabilityRowHashV1(row: CapabilityGapRow): string {
  const canonical = JSON.stringify({
    capability: t(row.capability),
    requiredNote: t(row.requiredNote),
    heldStatus: row.held?.legacyStatus ?? row.held?.status ?? "unevaluated",
    holders: sortedHolders(row),
    heldEvidence: t(row.held?.evidence),
    requiredLevel: t(row.requiredLevel),
    currentLevel: t(row.currentLevel),
  });
  return `v1:${sha256Hex(canonical).slice(0, 16)}`;
}

/**
 * Does a stored basis stamp still describe this row? v2 stamps compare against the v2 hash.
 * v1 stamps compare against the v1 recomputation, so untouched rows do not go stale; a row
 * that has since gained 필요도 (which v1 could not contain) counts as changed (OD-4).
 */
export function basisMatches(basisHash: string, row: CapabilityGapRow): boolean {
  if (basisHash.startsWith("v1:")) {
    return basisHash === capabilityRowHashV1(row) && !t(row.necessity) && !t(row.necessityScopeNote);
  }
  return basisHash === capabilityRowHash(row);
}

export function s3SnapshotOf(row: CapabilityGapRow): S3Snapshot {
  return {
    capability: t(row.capability).slice(0, 200),
    requiredNote: t(row.requiredNote).slice(0, 300),
    heldStatus: row.held?.status ?? "unevaluated",
    requiredLevel: t(row.requiredLevel).slice(0, NARRATIVE_CAP),
    currentLevel: t(row.currentLevel).slice(0, NARRATIVE_CAP),
    ...(t(row.necessity) ? { necessity: row.necessity } : {}),
  };
}

/**
 * Stale = a judgement exists and its stamped basis differs from the row's current
 * hash. A judgement without a stamp (legacy, pre-ADR-0170) is NOT stale until the
 * one-off stamping (OD-4) or its next save/confirm gives it a basis.
 */
export function isStale(row: CapabilityGapRow): boolean {
  const a = row.attainability;
  if (!a || !a.basisHash) return false;
  return !basisMatches(a.basisHash, row);
}

export interface S3Change { field: string; label: string; before: string; after: string }

const levelText = (v: string) => (v === "" ? "미정" : v);

/** What changed in S3 since the judgement: stored snapshot (or latest history) vs the current row. */
export function s3Changes(row: CapabilityGapRow): S3Change[] {
  const a = row.attainability;
  if (!a) return [];
  const old = a.s3Snapshot ?? a.history?.[a.history.length - 1]?.s3Snapshot ?? null;
  if (!old) return [];
  const cur = s3SnapshotOf(row);
  const out: S3Change[] = [];
  if (old.capability !== cur.capability) out.push({ field: "capability", label: "필요 역량", before: old.capability, after: cur.capability });
  if (old.requiredNote !== cur.requiredNote) out.push({ field: "requiredNote", label: "요구 설명", before: old.requiredNote || "없음", after: cur.requiredNote || "없음" });
  if ((old.necessity ?? "") !== (cur.necessity ?? "")) out.push({ field: "necessity", label: "필요도", before: old.necessity ? NECESSITY_LABEL[old.necessity] : NECESSITY_UNSET_LABEL, after: cur.necessity ? NECESSITY_LABEL[cur.necessity] : NECESSITY_UNSET_LABEL });
  if (old.heldStatus !== cur.heldStatus) out.push({ field: "heldStatus", label: "보유 판정", before: HELD_STATUS_LABEL[old.heldStatus], after: HELD_STATUS_LABEL[cur.heldStatus] });
  if (old.requiredLevel !== cur.requiredLevel) out.push({ field: "requiredLevel", label: "필요 수준", before: levelText(old.requiredLevel), after: levelText(cur.requiredLevel) });
  if (old.currentLevel !== cur.currentLevel) out.push({ field: "currentLevel", label: "보유 수준", before: levelText(old.currentLevel), after: levelText(cur.currentLevel) });
  return out;
}

// ── Invalidation on a register write ─────────────────────────────────────────

export interface LinkageResult {
  rows: CapabilityGapRow[];
  removed: RemovedCapability[];
  /** Row ids whose judgement was invalidated by this write. */
  invalidated: string[];
  /** Row ids deleted in S3 whose judgement was archived. */
  archived: string[];
  /** Row ids whose history entry was dropped by the cap (history) or removed-entry row ids (removed list). */
  trimmed: string[];
}

function historyEntryOf(row: CapabilityGapRow, a: CapabilityAttainability, at: string): AttainabilityHistoryEntry {
  return {
    grade: a.grade,
    closingCostKrwM: a.closingCostKrwM,
    monthsToAttain: a.monthsToAttain,
    rationale: a.rationale,
    evidence: a.evidence,
    resolution: row.resolution,
    ...(a.expectedLevel ? { expectedLevel: a.expectedLevel } : {}),
    confirmedBy: a.confirmedBy,
    confirmedAt: a.confirmedAt,
    basisHash: a.basisHash ?? "",
    invalidatedAt: at,
    reason: "s3_changed",
    s3Snapshot: a.s3Snapshot ?? null,
  };
}

/**
 * Pure core of the register-write wrapper. `rows` are the rows about to be stored
 * (attainability already carried over); `storedJson` is the register being replaced.
 * - stale judgements move to attainability.history[] (cap 5), confirmation is
 *   cleared, staleSince is set; grade/cost/months/rationale stay as pre-fill;
 * - a row that matches its basis again drops the stale mark;
 * - judged rows that no longer exist go to removedCapabilities[] (cap 30).
 */
export function applyRegisterLinkage(rows: CapabilityGapRow[], storedJson: string | null | undefined, at: string, by: string): LinkageResult {
  const invalidated: string[] = [];
  const trimmed: string[] = [];
  const out = rows.map((r) => {
    const a = r.attainability;
    if (!a || !a.basisHash) return r;
    if (basisMatches(a.basisHash, r)) {
      // Lazy v1 -> v2 re-stamp: the row is unchanged, so only the stamp format moves.
      const restamped = a.basisHash.startsWith("v1:") ? { ...a, basisHash: capabilityRowHash(r), s3Snapshot: s3SnapshotOf(r) } : a;
      if (!restamped.staleSince) return restamped === a ? r : { ...r, attainability: restamped };
      const { staleSince: _drop, ...rest } = restamped;
      return { ...r, attainability: rest };
    }
    if (a.staleSince) return r; // already materialised
    let history = [...(a.history ?? []), historyEntryOf(r, a, at)];
    if (history.length > HISTORY_CAP) {
      trimmed.push(r.id);
      history = history.slice(-HISTORY_CAP);
    }
    invalidated.push(r.id);
    return { ...r, attainability: { ...a, confirmedBy: null, confirmedAt: null, staleSince: at, history } };
  });

  const keep = new Set(out.map((r) => r.id));
  const archived: string[] = [];
  const added: RemovedCapability[] = [];
  for (const old of parseGapRegister(storedJson).rows) {
    if (keep.has(old.id) || !old.attainability) continue;
    archived.push(old.id);
    added.push({ rowId: old.id, capability: old.capability, requiredLevel: old.requiredLevel, currentLevel: old.currentLevel, attainability: old.attainability, removedAt: at, removedBy: by });
  }
  let removed = [...parseRemovedCapabilities(storedJson), ...added];
  if (removed.length > REMOVED_CAP) {
    trimmed.push(...removed.slice(0, removed.length - REMOVED_CAP).map((x) => x.rowId));
    removed = removed.slice(-REMOVED_CAP);
  }
  return { rows: out, removed, invalidated, archived, trimmed };
}
