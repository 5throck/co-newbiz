// @version 1.0.0
/**
 * Published ERP reference registry reader (ADR-0207, design
 * 2026-11-26-wacc-erp-published-reference). READ-ONLY: the registry lives in
 * `region-profiles/KR.yaml` (`erp_references`, validated by
 * region-profiles/_validate.ts). A suggestion built here is a PROPOSAL for the
 * WACC session — the confirmed `wacc.erp` row stays kind='user'; nothing in
 * this module writes assumptions or raises an evidence tier.
 *
 * Fails soft: a missing file, YAML parse error or malformed section yields an
 * explicit `unavailable` result with a reason code, never a placeholder value.
 */
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { resolveRepoRoot } from "./repo-root.ts";

/** An entry whose as_of or verified_on is older than this many months is stale (not a per-entry setting). */
export const ERP_STALE_MONTHS = 12;

export type ErpBasis = "implied" | "historical" | "survey" | "recommended";

export interface ErpRegistryEntry {
  id: string;
  source: string;
  url: string;
  value_pct: number;
  basis: ErpBasis;
  as_of: string;
  verified_on: string;
  maintainer: string;
  published_on: string | null;
  note: string | null;
  superseded_by: string | null;
}

export interface ErpRegistry {
  default_source_id: string;
  entries: ErpRegistryEntry[];
}

export type ErpRegistryResult =
  | { ok: true; registry: ErpRegistry }
  | { ok: false; reason_code: "erp_no_registry" | "erp_registry_error"; reason: string };

/** One ERP reference as offered to the WACC panel. `value` is in percent points (like risk_free / credit_spread). */
export interface ErpSuggestion {
  key: "erp";
  value: number;
  as_of: string;
  anchor_ref: string;
  source_label: string;
  note: string | null;
  basis: ErpBasis;
  source_id: string;
  is_default: boolean;
  verified_on: string;
  age_months: number;
  stale: boolean;
  stale_reason: string | null;
  // Registry-shaped aliases (same data) so a consumer can read either vocabulary.
  id: string;
  source: string;
  url: string;
  value_pct: number;
}

export interface ErpNullSuggestion {
  key: "erp";
  value: null;
  reason: string;
  reason_code: "erp_market_not_kr" | "erp_no_registry" | "erp_registry_error";
}

export interface ErpOffer {
  erp: ErpSuggestion | ErpNullSuggestion;
  erp_alternatives: ErpSuggestion[];
  /** Items excluded from "apply all applicable", with a machine-readable reason (the missing-item mechanism). */
  apply_all_excluded: Array<{ key: "erp"; reason_code: "erp_reference_stale"; reason: string }>;
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Absolute path of region-profiles/KR.yaml (shared with the tax-rate registry reader). */
export function registryPath(): string {
  const root =
    resolveRepoRoot({ cwd: process.cwd(), here: MODULE_DIR, exists: existsSync }) ?? join(MODULE_DIR, "..", "..");
  return join(root, "region-profiles", "KR.yaml");
}

const BASES = new Set<string>(["implied", "historical", "survey", "recommended"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function parseEntry(raw: unknown): ErpRegistryEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const id = str(e.id);
  const source = str(e.source);
  const url = str(e.url);
  const asOf = str(e.as_of);
  const verifiedOn = str(e.verified_on);
  const maintainer = str(e.maintainer);
  if (!id || !source || !url || !asOf || !verifiedOn || !maintainer) return null;
  if (typeof e.value_pct !== "number" || !Number.isFinite(e.value_pct)) return null;
  if (typeof e.basis !== "string" || !BASES.has(e.basis)) return null;
  if (!ISO_DATE.test(asOf) || !ISO_DATE.test(verifiedOn)) return null;
  return {
    id,
    source,
    url,
    value_pct: e.value_pct,
    basis: e.basis as ErpBasis,
    as_of: asOf,
    verified_on: verifiedOn,
    maintainer,
    published_on: str(e.published_on),
    note: str(e.note),
    superseded_by: str(e.superseded_by),
  };
}

/** Parse the `erp_references` section of one region profile document. */
export function parseErpRegistry(doc: unknown): ErpRegistryResult {
  const section = (doc as { erp_references?: unknown } | null)?.erp_references;
  if (section === undefined)
    return {
      ok: false,
      reason_code: "erp_no_registry",
      reason: "No erp_references section is registered for this region.",
    };
  const data = (section as { data?: unknown } | null)?.data as
    | { default_source_id?: unknown; entries?: unknown }
    | undefined;
  if (!data || typeof data !== "object" || !Array.isArray(data.entries)) {
    return {
      ok: false,
      reason_code: "erp_registry_error",
      reason: "erp_references.data.entries is missing or malformed.",
    };
  }
  const entries: ErpRegistryEntry[] = [];
  for (const raw of data.entries) {
    const e = parseEntry(raw);
    if (!e)
      return {
        ok: false,
        reason_code: "erp_registry_error",
        reason: "An erp_references entry is malformed (see region-profiles validator).",
      };
    entries.push(e);
  }
  const defaultId = str(data.default_source_id);
  const def = entries.find((e) => e.id === defaultId);
  if (!defaultId || !def || def.superseded_by) {
    return {
      ok: false,
      reason_code: "erp_registry_error",
      reason: "erp_references.data.default_source_id does not name a current entry.",
    };
  }
  return { ok: true, registry: { default_source_id: defaultId, entries } };
}

/** Load the KR registry from region-profiles/KR.yaml. Never throws. */
export function loadKrErpRegistry(path: string = registryPath()): ErpRegistryResult {
  try {
    if (!existsSync(path))
      return { ok: false, reason_code: "erp_no_registry", reason: "Region profile KR.yaml was not found." };
    const doc = yaml.load(readFileSync(path, "utf-8"), { schema: yaml.JSON_SCHEMA });
    return parseErpRegistry(doc);
  } catch (e) {
    return {
      ok: false,
      reason_code: "erp_registry_error",
      reason: `KR.yaml could not be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Whole calendar months from `iso` to `now` (UTC), floored; never negative. */
export function monthsBetween(iso: string, now: Date): number {
  const d = utcDate(iso);
  let months = (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
  if (now.getUTCDate() < d.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** True when `iso` is strictly more than ERP_STALE_MONTHS before `now` (exactly 12 months old is still fresh). */
export function isOlderThanStaleWindow(iso: string, now: Date): boolean {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - ERP_STALE_MONTHS, now.getUTCDate()));
  return utcDate(iso).getTime() < cutoff.getTime();
}

function toSuggestion(e: ErpRegistryEntry, isDefault: boolean, now: Date): ErpSuggestion {
  const asOfStale = isOlderThanStaleWindow(e.as_of, now);
  const verifiedStale = isOlderThanStaleWindow(e.verified_on, now);
  const reasons: string[] = [];
  if (asOfStale) reasons.push(`as_of ${e.as_of} is more than ${ERP_STALE_MONTHS} months old`);
  if (verifiedStale) reasons.push(`verified_on ${e.verified_on} is more than ${ERP_STALE_MONTHS} months old`);
  return {
    key: "erp",
    value: e.value_pct,
    as_of: e.as_of,
    anchor_ref: e.url,
    source_label: e.source,
    note: e.note,
    basis: e.basis,
    source_id: e.id,
    is_default: isDefault,
    verified_on: e.verified_on,
    age_months: monthsBetween(e.as_of, now),
    stale: reasons.length > 0,
    stale_reason: reasons.length > 0 ? reasons.join("; ") : null,
    id: e.id,
    source: e.source,
    url: e.url,
    value_pct: e.value_pct,
  };
}

/** Build the ERP offer for a market. Non-KR (or a missing/broken registry) gives a null entry with a reason. */
export function buildErpOffer(market: "KR" | string, now: Date = new Date(), loaded?: ErpRegistryResult): ErpOffer {
  if (market !== "KR") {
    return {
      erp: {
        key: "erp",
        value: null,
        reason: "Non-KR market - no published ERP reference is registered.",
        reason_code: "erp_market_not_kr",
      },
      erp_alternatives: [],
      apply_all_excluded: [],
    };
  }
  const result = loaded ?? loadKrErpRegistry();
  if (!result.ok) {
    return {
      erp: { key: "erp", value: null, reason: result.reason, reason_code: result.reason_code },
      erp_alternatives: [],
      apply_all_excluded: [],
    };
  }
  const { registry } = result;
  const def = registry.entries.find((e) => e.id === registry.default_source_id);
  if (!def) {
    return {
      erp: { key: "erp", value: null, reason: "Default ERP entry is missing.", reason_code: "erp_registry_error" },
      erp_alternatives: [],
      apply_all_excluded: [],
    };
  }
  const erp = toSuggestion(def, true, now);
  const alternatives = registry.entries
    .filter((e) => e.id !== def.id && !e.superseded_by)
    .map((e) => toSuggestion(e, false, now));
  return {
    erp,
    erp_alternatives: alternatives,
    apply_all_excluded: erp.stale
      ? [
          {
            key: "erp",
            reason_code: "erp_reference_stale",
            reason: `Default ERP reference is stale (${erp.stale_reason}) - confirm individually before applying.`,
          },
        ]
      : [],
  };
}

/**
 * The market a project's WACC reference applies to. The project has no market
 * column; the declared scope on its source opportunity (target_scope_json
 * regions, ADR-0179) is the only structured source. Exactly ["kr"] -> KR; no
 * declared scope -> KR (every WACC reference series here is Korean — ECOS, DART
 * — so an undeclared scope is the domestic case); any other declared scope ->
 * "OTHER" (never a silent KR default for a project that declared otherwise).
 */
export function resolveProjectMarket(db: Database, projectId: string): "KR" | "OTHER" {
  const row = db
    .query(
      `SELECT o.target_scope_json AS scope
       FROM md_project p
       LEFT JOIN opportunity o ON o.id = p.source_opportunity_id
       WHERE p.id = ?`,
    )
    .get(projectId) as { scope: string | null } | undefined;
  let scope = row?.scope ?? null;
  if (!scope) {
    scope =
      (
        db
          .query(
            "SELECT target_scope_json AS scope FROM opportunity WHERE project_id = ? AND target_scope_json IS NOT NULL ORDER BY created_at DESC LIMIT 1",
          )
          .get(projectId) as { scope: string } | undefined
      )?.scope ?? null;
  }
  if (!scope) return "KR";
  try {
    const regions = (JSON.parse(scope) as { regions?: unknown }).regions;
    if (!Array.isArray(regions) || regions.length === 0) return "KR";
    return regions.length === 1 && regions[0] === "kr" ? "KR" : "OTHER";
  } catch {
    return "KR";
  }
}

const REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Shape check for a client-sent erp_reference_id (the registry lookup is separate). */
export function isValidErpReferenceId(v: unknown): v is string {
  return typeof v === "string" && REFERENCE_ID.test(v);
}

export interface ErpReferenceAudit {
  id: string | null;
  isDefault: boolean;
  stale: boolean;
}

/**
 * Server-side truth for the confirmation audit: look the cited id up in the KR
 * registry and derive default/stale at confirmation time. Null id (manual
 * entry) -> {null,false,false}. Returns null when the id is not a registered
 * entry — the caller rejects it (a citation must resolve).
 */
export function resolveErpReferenceAudit(
  id: string | null,
  now: Date = new Date(),
  loaded?: ErpRegistryResult,
): ErpReferenceAudit | null {
  if (id === null) return { id: null, isDefault: false, stale: false };
  const result = loaded ?? loadKrErpRegistry();
  if (!result.ok) return null;
  const e = result.registry.entries.find((x) => x.id === id);
  if (!e) return null;
  return {
    id: e.id,
    isDefault: e.id === result.registry.default_source_id,
    stale: isOlderThanStaleWindow(e.as_of, now) || isOlderThanStaleWindow(e.verified_on, now),
  };
}
