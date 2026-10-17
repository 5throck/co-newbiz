// ADR-0181 slice 1 — the entry-market repository. The person-set entry-market
// inputs (target scope, ratio-factor chain, market brief, anchor currency,
// entry-market growth, per-currency FX, scoped competitive rows) live in the
// FK tables of migration 0151; ALL reads and writes go through this module.
// The legacy JSON columns (opportunity.target_scope_json /
// entry_market_derivation_json, frozen by 0151's backfill) remain as
// read-only FALLBACKS for rows that could not migrate (a chain whose link was
// cleared — conditional freeze, ADR-0181 §2).
//
// Layering: this module imports the pure functions of lib/entry-market.ts;
// resolveDerivedEntryMarket lives HERE (it reads the DB) — lib/entry-market.ts
// stays pure. Every write is transactional; callers keep the audit trail.

import type { Database } from "bun:sqlite";
import { ulid } from "../lib/ulid.ts";
import {
  compareReachedScope,
  computeEntryMarketChain,
  derivationHash,
  parseEntryMarketDerivationJson,
  readS1AnchorYear1,
  reachedScopeOf,
  type EntryMarketDerivation,
  type EntryMarketScopeStatus,
  type EntryMarketStep,
} from "../../app/web-next/lib/entry-market.ts";
import { readSizingAnchorTotal } from "../../app/web-next/lib/sizing-payload.ts";
import { parseTargetScopeJsonSafe } from "../../app/web-next/lib/entry-market.ts";
import type { TargetScope } from "../../app/web-next/lib/target-scope.ts";

export class EntryMarketRepositoryError extends Error {}

type Db = Database;

// ── Target scope ─────────────────────────────────────────────────────────────

/** The person-set target scope: the 0151 table first, the frozen
 *  target_scope_json column as fallback. Null = unset. */
export function readTargetScope(db: Db, opportunityId: string): TargetScope | null {
  try {
    const row = db
      .query("SELECT unit_basis, set_by, set_at FROM opportunity_target_scope WHERE opportunity_id = ?")
      .get(opportunityId) as { unit_basis: string | null; set_by: string; set_at: string } | undefined;
    if (row) {
      const regions = db
        .query("SELECT code FROM target_scope_region WHERE scope_id = (SELECT id FROM opportunity_target_scope WHERE opportunity_id = ?) ORDER BY position")
        .all(opportunityId) as Array<{ code: string }>;
      const segments = db
        .query("SELECT code FROM target_scope_segment WHERE scope_id = (SELECT id FROM opportunity_target_scope WHERE opportunity_id = ?) ORDER BY position")
        .all(opportunityId) as Array<{ code: string }>;
      if (regions.length === 0) return null; // corrupt row degrades to the fallback
      return {
        regions: regions.map((r) => r.code),
        segments: segments.map((s) => s.code),
        unit_basis: (row.unit_basis ?? "krw_m_year") as TargetScope["unit_basis"],
        set_by: row.set_by,
        set_at: row.set_at,
      };
    }
  } catch {
    // table read failure degrades to the frozen column, never a throw
  }
  try {
    const col = db.query("SELECT target_scope_json AS j FROM opportunity WHERE id = ?").get(opportunityId) as
      | { j: string | null }
      | undefined;
    return parseTargetScopeJsonSafe(col?.j ?? null);
  } catch {
    return null;
  }
}

export function writeTargetScope(
  db: Db,
  opportunityId: string,
  scope: { regions: readonly string[]; segments: readonly string[]; unit_basis: string },
  actor: string,
  now: string,
): void {
  db.transaction(() => {
    const existing = db.query("SELECT id FROM opportunity_target_scope WHERE opportunity_id = ?").get(opportunityId) as
      | { id: string }
      | undefined;
    const id = existing?.id ?? ulid();
    if (existing) {
      db.run("DELETE FROM target_scope_region WHERE scope_id = ?", [id]);
      db.run("DELETE FROM target_scope_segment WHERE scope_id = ?", [id]);
      db.run("UPDATE opportunity_target_scope SET unit_basis = ?, set_by = ?, set_at = ? WHERE id = ?", [
        scope.unit_basis, actor, now, id,
      ]);
    } else {
      db.run("INSERT INTO opportunity_target_scope (id, opportunity_id, unit_basis, set_by, set_at) VALUES (?,?,?,?,?)", [
        id, opportunityId, scope.unit_basis, actor, now,
      ]);
    }
    scope.regions.forEach((code, i) =>
      db.run("INSERT INTO target_scope_region (id, scope_id, code, position) VALUES (?,?,?,?)", [ulid(), id, code, i]));
    scope.segments.forEach((code, i) =>
      db.run("INSERT INTO target_scope_segment (id, scope_id, code, position) VALUES (?,?,?,?)", [ulid(), id, code, i]));
  })();
}

export function clearTargetScope(db: Db, opportunityId: string): void {
  db.run("DELETE FROM opportunity_target_scope WHERE opportunity_id = ?", [opportunityId]);
}

// ── Derivation chain ─────────────────────────────────────────────────────────

function stepsFromTable(db: Db, entryMarketId: string): EntryMarketStep[] {
  const rows = db
    .query("SELECT seq, base, factor, source, as_of, note, origin, region_tags_json, segment_tags_json FROM entry_market_step WHERE entry_market_id = ? ORDER BY seq")
    .all(entryMarketId) as Array<{
    seq: number; base: string; factor: number; source: string; as_of: string;
    note: string | null; origin: string | null; region_tags_json: string | null; segment_tags_json: string | null;
  }>;
  return rows.map((r) => {
    const step: EntryMarketStep = {
      base: r.base as EntryMarketStep["base"],
      factor: r.factor,
      source: r.source,
      as_of: r.as_of,
    };
    if (r.note != null) step.note = r.note;
    if (r.origin === "ai_suggested") step.origin = "ai_suggested";
    const parseTags = (j: string | null): string[] | undefined => {
      if (j == null) return undefined;
      try {
        const arr = JSON.parse(j) as unknown;
        return Array.isArray(arr) && arr.every((t) => typeof t === "string") ? (arr as string[]) : undefined;
      } catch {
        return undefined;
      }
    };
    const rt = parseTags(r.region_tags_json);
    if (rt) step.region_tags = rt;
    const st = parseTags(r.segment_tags_json);
    if (st) step.segment_tags = st;
    return step;
  });
}

/** The stored derivation chain: the 0151 tables first, the frozen
 *  entry_market_derivation_json column as fallback (covers NULL-link chains —
 *  conditional freeze). Null when unset on both. */
export function readChain(db: Db, opportunityId: string): EntryMarketDerivation | null {
  try {
    const row = db
      .query("SELECT id, set_by, set_at FROM entry_market WHERE opportunity_id = ?")
      .get(opportunityId) as { id: string; set_by: string; set_at: string } | undefined;
    if (row) {
      const steps = stepsFromTable(db, row.id);
      if (steps.length === 0) return null; // row present but chain cleared
      return { steps, set_by: row.set_by, set_at: row.set_at };
    }
  } catch {
    // degrade to the frozen column
  }
  try {
    const col = db.query("SELECT entry_market_derivation_json AS j FROM opportunity WHERE id = ?").get(opportunityId) as
      | { j: string | null }
      | undefined;
    return col?.j ? parseEntryMarketDerivationJson(col.j) : null;
  } catch {
    return null;
  }
}

/** Replace the whole chain atomically. Requires a pinned S1 version — the
 *  write path guards this before calling (409 not_linked upstream). */
export function writeChain(db: Db, opportunityId: string, steps: readonly EntryMarketStep[], actor: string, now: string): void {
  const link = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opportunityId) as
    | { v: string | null }
    | undefined;
  if (!link?.v) throw new EntryMarketRepositoryError("entry_market은 S1 시장규모 버전 연결이 필요합니다 (sizing_version_id NULL).");
  db.transaction(() => {
    const existing = db.query("SELECT id FROM entry_market WHERE opportunity_id = ?").get(opportunityId) as
      | { id: string }
      | undefined;
    const id = existing?.id ?? ulid();
    if (!existing) {
      db.run("INSERT INTO entry_market (id, opportunity_id, sizing_version_id, set_by, set_at) VALUES (?,?,?,?,?)", [
        id, opportunityId, link.v, actor, now,
      ]);
    } else {
      db.run("DELETE FROM entry_market_step WHERE entry_market_id = ?", [id]);
    }
    steps.forEach((s, i) =>
      db.run(
        "INSERT INTO entry_market_step (id, entry_market_id, seq, base, factor, source, as_of, note, origin, region_tags_json, segment_tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
          ulid(), id, i, s.base, s.factor, s.source, s.as_of, s.note ?? null, s.origin ?? null,
          s.region_tags ? JSON.stringify(s.region_tags) : null,
          s.segment_tags ? JSON.stringify(s.segment_tags) : null,
        ],
      ));
  })();
}

/** Clear the chain (steps) but KEEP the aggregate row — market_brief / FX /
 *  growth are independent person inputs that survive a chain clear. */
export function clearChain(db: Db, opportunityId: string): void {
  db.run("DELETE FROM entry_market_step WHERE entry_market_id = (SELECT id FROM entry_market WHERE opportunity_id = ?)", [opportunityId]);
}

// ── Aggregate record (brief / currency / growth) ────────────────────────────

export interface EntryMarketRecord {
  market_brief: string | null;
  currency: string | null;
  growth_rate: number | null;
  set_by: string;
  set_at: string;
}

export function readEntryMarketRecord(db: Db, opportunityId: string): EntryMarketRecord | null {
  const row = db
    .query("SELECT market_brief, currency, growth_rate, set_by, set_at FROM entry_market WHERE opportunity_id = ?")
    .get(opportunityId) as EntryMarketRecord | undefined;
  return row ?? null;
}

export function writeEntryMarketMeta(
  db: Db,
  opportunityId: string,
  patch: { market_brief?: string | null; currency?: string | null; growth_rate?: number | null },
  actor: string,
  now: string,
): void {
  const link = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opportunityId) as
    | { v: string | null }
    | undefined;
  if (!link?.v) throw new EntryMarketRepositoryError("entry_market은 S1 시장규모 버전 연결이 필요합니다 (sizing_version_id NULL).");
  const existing = db.query("SELECT id FROM entry_market WHERE opportunity_id = ?").get(opportunityId) as
    | { id: string }
    | undefined;
  if (existing) {
    db.run(
      "UPDATE entry_market SET " +
        (patch.market_brief !== undefined ? "market_brief = ?, " : "") +
        (patch.currency !== undefined ? "currency = ?, " : "") +
        (patch.growth_rate !== undefined ? "growth_rate = ?, " : "") +
        "set_by = ?, set_at = ? WHERE id = ?",
      [
        ...(patch.market_brief !== undefined ? [patch.market_brief] : []),
        ...(patch.currency !== undefined ? [patch.currency] : []),
        ...(patch.growth_rate !== undefined ? [patch.growth_rate] : []),
        actor, now, existing.id,
      ],
    );
  } else {
    db.run("INSERT INTO entry_market (id, opportunity_id, sizing_version_id, market_brief, currency, growth_rate, set_by, set_at) VALUES (?,?,?,?,?,?,?,?)", [
      ulid(), opportunityId, link.v, patch.market_brief ?? null, patch.currency ?? null, patch.growth_rate ?? null, actor, now,
    ]);
  }
}

// ── FX (per-currency reference rates, ADR-0181 slice 3) ─────────────────────

export interface EntryMarketFxRow {
  currency: string;
  rate: number;
  volatility: number | null;
  set_by: string;
  set_at: string;
}

export function readFx(db: Db, opportunityId: string): EntryMarketFxRow[] {
  try {
    return db
      .query("SELECT currency, rate, volatility, set_by, set_at FROM entry_market_fx WHERE entry_market_id = (SELECT id FROM entry_market WHERE opportunity_id = ?) ORDER BY currency")
      .all(opportunityId) as EntryMarketFxRow[];
  } catch {
    return [];
  }
}

export function writeFx(
  db: Db,
  opportunityId: string,
  rows: ReadonlyArray<{ currency: string; rate: number; volatility: number | null }>,
  actor: string,
  now: string,
): void {
  db.transaction(() => {
    // Upsert the aggregate row: an FX save alone (link + rates, chain unset)
    // is the LINKED_SCOPED-adjacent state the design explicitly supports.
    let em = db.query("SELECT id FROM entry_market WHERE opportunity_id = ?").get(opportunityId) as { id: string } | undefined;
    if (!em) {
      const link = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opportunityId) as
        | { v: string | null }
        | undefined;
      if (!link?.v) throw new EntryMarketRepositoryError("entry_market은 S1 시장규모 버전 연결이 필요합니다 (sizing_version_id NULL).");
      const id = ulid();
      db.run("INSERT INTO entry_market (id, opportunity_id, sizing_version_id, set_by, set_at) VALUES (?,?,?,?,?)", [
        id, opportunityId, link.v, actor, now,
      ]);
      em = { id };
    }
    db.run("DELETE FROM entry_market_fx WHERE entry_market_id = ?", [em.id]);
    for (const r of rows) {
      db.run("INSERT INTO entry_market_fx (id, entry_market_id, currency, rate, volatility, set_by, set_at) VALUES (?,?,?,?,?,?,?)", [
        ulid(), em.id, r.currency, r.rate, r.volatility, actor, now,
      ]);
    }
  })();
}

// ── Competitive (scoped re-analysis rows, ADR-0181 slice 2) ─────────────────

export interface EntryMarketCompetitiveRow {
  player: string;
  tier: string | null;
  region: string | null;
  source: string | null;
  set_by: string;
  set_at: string;
}

export function readCompetitive(db: Db, opportunityId: string): EntryMarketCompetitiveRow[] {
  try {
    return db
      .query("SELECT player, tier, region, source, set_by, set_at FROM entry_market_competitive WHERE entry_market_id = (SELECT id FROM entry_market WHERE opportunity_id = ?) ORDER BY rowid")
      .all(opportunityId) as EntryMarketCompetitiveRow[];
  } catch {
    return [];
  }
}

export function writeCompetitive(
  db: Db,
  opportunityId: string,
  rows: ReadonlyArray<{ player: string; tier: string | null; region: string | null; source: string | null }>,
  actor: string,
  now: string,
): void {
  db.transaction(() => {
    const em = db.query("SELECT id FROM entry_market WHERE opportunity_id = ?").get(opportunityId) as { id: string } | undefined;
    if (!em) throw new EntryMarketRepositoryError("경쟁 재분석 결과는 진입시장 레코드가 있을 때만 저장됩니다 (S1 연결 후 시도).");
    db.run("DELETE FROM entry_market_competitive WHERE entry_market_id = ?", [em.id]);
    for (const r of rows) {
      db.run("INSERT INTO entry_market_competitive (id, entry_market_id, player, tier, region, source, set_by, set_at) VALUES (?,?,?,?,?,?,?,?)", [
        ulid(), em.id, r.player, r.tier, r.region, r.source, actor, now,
      ]);
    }
  })();
}

// ── Consumption read-model (moved from lib/entry-market.ts, ADR-0181) ───────

/** When the opportunity has BOTH a pinned S1 link AND a derivation chain,
 *  returns the DERIVED entry-market value for the pinned version's year-1
 *  baseline plus provenance and the scope verdict. Tolerant: null on any
 *  missing piece → the caller keeps the legacy bare anchor (bit-identical). */
export function resolveDerivedEntryMarket(
  db: Db,
  opportunityId: string,
): { entry_market_krw_m: number; steps: number; hash: string; factor_product: number; scope_status: EntryMarketScopeStatus } | null {
  try {
    const link = db.query("SELECT sizing_version_id AS v FROM opportunity WHERE id = ?").get(opportunityId) as
      | { v: string | null }
      | undefined;
    if (!link?.v) return null;
    const derivation = readChain(db, opportunityId);
    if (!derivation) return null;
    const payload = db
      .query("SELECT payload FROM market_sizing_version WHERE id = ?")
      .get(link.v) as { payload: string | null } | undefined;
    const anchor = readSizingAnchorTotal(payload?.payload ?? null);
    if (anchor == null || !Number.isFinite(anchor) || anchor <= 0) return null;
    const computed = computeEntryMarketChain(anchor, derivation.steps);
    const targetScope = readTargetScope(db, opportunityId);
    const reached = reachedScopeOf(derivation.steps);
    return {
      entry_market_krw_m: computed.entry_market_krw_m,
      steps: derivation.steps.length,
      hash: derivationHash(derivation.steps),
      factor_product: computed.factor_product,
      scope_status: compareReachedScope(reached, targetScope).status,
    };
  } catch {
    return null; // any read failure degrades to the legacy anchor, never blocks
  }
}
