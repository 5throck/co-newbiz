#!/usr/bin/env bun
// @version 1.4.0
/**
 * Region Profile Validator — co-newbiz
 *
 * Validates every region-profiles/<ISO2>.yaml against _schema.yaml (design
 * v1.0 section 2-6). Enforces the provenance rule from CLAUDE.md's Co
 * Newbiz Lifecycle Rules: source/verified_on/maintainer are mandatory on
 * every section, and an unsourced field is rejected rather than silently
 * accepted — an unsourced placeholder looks authoritative, which is worse
 * than a missing file.
 *
 * Usage:
 *   bun region-profiles/_validate.ts
 *   bun region-profiles/_validate.ts --verbose
 */

import * as yaml from "js-yaml";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const VERBOSE = process.argv.includes("--verbose");

// erp_references (ADR-0207): a guard band for transcription slips, not a judgment of the value.
export const ERP_VALUE_MIN_EXCLUSIVE = 0;
export const ERP_VALUE_MAX_EXCLUSIVE = 25;
const ERP_BASIS = ["implied", "historical", "survey", "recommended"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// corporate_tax_rates (ADR-0207 addendum): arithmetic tolerance for local/combined (percent points)
// and a transcription guard on the combined rate; neither judges the statute itself.
export const TAX_RATE_ARITHMETIC_TOLERANCE = 0.0005;
export const TAX_RATE_MAX_EXCLUSIVE = 50;

const REQUIRED_TOP_LEVEL = [
  "code",
  "name_ko",
  "merger_control",
  "foreign_investment_screening",
  "labor",
  "tax",
  "fx_and_repatriation",
  "anti_corruption",
  "sanctions_screening",
  "data_transfer",
  "environmental_liability_succession",
  "incentives",
  "typical_closing_weeks",
];

const REQUIRED_SOURCED_SECTIONS = REQUIRED_TOP_LEVEL.filter(
  (k) => !["code", "name_ko", "typical_closing_weeks"].includes(k)
);

// Optional sections are skipped when absent and held to the same provenance
// rules when present (see optional_top_level in _schema.yaml).
const OPTIONAL_SOURCED_SECTIONS = ["payment_practice", "erp_references", "corporate_tax_rates", "credit_rating_references"];

const SOURCED_SECTIONS = [...REQUIRED_SOURCED_SECTIONS, ...OPTIONAL_SOURCED_SECTIONS];

export interface Issue {
  file: string;
  message: string;
  severity: "error" | "warn";
}

async function findProfileFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".yaml") && !e.name.startsWith("_"))
    .map((e) => join(dir, e.name));
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** Valid ISO calendar date (YYYY-MM-DD), not in the future. Returns an error fragment or null. */
function dateProblem(v: unknown): string | null {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return "is not a valid ISO-8601 date (YYYY-MM-DD)";
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return "is not a valid ISO-8601 date (YYYY-MM-DD)";
  if (d.getTime() > Date.now()) return "is in the future";
  return null;
}

/**
 * erp_references (ADR-0207): section-level provenance is checked by the generic
 * loop; this adds the entry-level contract. The validator never fetches URLs.
 */
function validateErpReferences(file: string, section: unknown): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ file, message: `erp_references: ${message}`, severity: "error" });
  if (typeof section !== "object" || section === null || Array.isArray(section)) return issues; // reported by the generic loop
  const data = (section as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return issues; // reported by the generic loop (empty/missing data)
  const d = data as Record<string, unknown>;

  const entries = d.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    err("data.entries must be a non-empty list");
    return issues;
  }

  const byId = new Map<string, Record<string, unknown>>();
  entries.forEach((raw, i) => {
    const at = `entries[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      err(`${at} must be a mapping`);
      return;
    }
    const e = raw as Record<string, unknown>;
    const label = isNonEmptyString(e.id) ? `entry '${e.id}'` : at;
    if (!isNonEmptyString(e.id)) err(`${at} is missing required field 'id'`);
    else if (byId.has(e.id)) err(`duplicate entry id '${e.id}'`);
    else byId.set(e.id, e);
    for (const f of ["source", "verified_on", "maintainer", "url", "as_of"]) {
      if (!isNonEmptyString(e[f])) err(`${label} is missing required field '${f}'`);
    }
    if (isNonEmptyString(e.url) && !e.url.startsWith("https://")) err(`${label}.url must start with https://`);
    if (isNonEmptyString(e.url) && e.url.startsWith("https://") && e.url.length <= "https://".length) err(`${label}.url has no host`);
    if (typeof e.value_pct !== "number" || !Number.isFinite(e.value_pct)) {
      err(`${label}.value_pct must be a number (percent points)`);
    } else if (!(e.value_pct > ERP_VALUE_MIN_EXCLUSIVE && e.value_pct < ERP_VALUE_MAX_EXCLUSIVE)) {
      err(`${label}.value_pct ${e.value_pct} is outside the sanity band (${ERP_VALUE_MIN_EXCLUSIVE}, ${ERP_VALUE_MAX_EXCLUSIVE}) percent points`);
    }
    if (typeof e.basis !== "string" || !ERP_BASIS.includes(e.basis)) {
      err(`${label}.basis must be one of ${ERP_BASIS.join(" | ")}`);
    }
    for (const f of ["as_of", "verified_on", "published_on"]) {
      if (e[f] === undefined) continue; // required ones already reported; published_on is optional
      if (f !== "published_on" && !isNonEmptyString(e[f])) continue;
      const problem = dateProblem(e[f]);
      if (problem) err(`${label}.${f} ${problem}`);
    }
  });

  for (const [id, e] of byId) {
    if (e.superseded_by === undefined) continue;
    if (!isNonEmptyString(e.superseded_by) || !byId.has(e.superseded_by)) {
      err(`entry '${id}'.superseded_by does not resolve to an entry id`);
    } else if (e.superseded_by === id) {
      err(`entry '${id}'.superseded_by points at itself`);
    }
  }

  const def = d.default_source_id;
  if (!isNonEmptyString(def)) {
    err("data.default_source_id is required");
  } else {
    const matches = entries.filter((x) => typeof x === "object" && x !== null && (x as Record<string, unknown>).id === def);
    if (matches.length !== 1) err(`data.default_source_id '${def}' must match exactly one entry (matched ${matches.length})`);
    else if ((matches[0] as Record<string, unknown>).superseded_by !== undefined) {
      err(`data.default_source_id '${def}' names a superseded entry`);
    }
  }
  return issues;
}

/**
 * corporate_tax_rates (ADR-0207 addendum): section-level provenance is checked by the generic
 * loop; this adds the schedule/bracket contract. The validator never fetches URLs and cannot
 * re-verify the statute - it guards structure, contiguity and arithmetic.
 */
function validateCorporateTaxRates(file: string, section: unknown): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ file, message: `corporate_tax_rates: ${message}`, severity: "error" });
  if (typeof section !== "object" || section === null || Array.isArray(section)) return issues; // generic loop reports it
  const data = (section as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return issues; // generic loop reports it
  const d = data as Record<string, unknown>;

  const eff = dateProblem(d.effective_from);
  if (d.effective_from === undefined) err("data.effective_from is required");
  else if (eff) err(`data.effective_from ${eff}`);

  const ratio = d.local_rate_ratio;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || !(ratio > 0 && ratio <= 1)) {
    err("data.local_rate_ratio must be a number in (0, 1]");
  }

  const schedules = d.schedules;
  if (!Array.isArray(schedules) || schedules.length === 0) {
    err("data.schedules must be a non-empty list");
    return issues;
  }

  const ids = new Set<string>();
  schedules.forEach((raw, i) => {
    const at = `schedules[${i}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      err(`${at} must be a mapping`);
      return;
    }
    const sc = raw as Record<string, unknown>;
    const label = isNonEmptyString(sc.id) ? `schedule '${sc.id}'` : at;
    if (!isNonEmptyString(sc.id)) err(`${at} is missing required field 'id'`);
    else if (ids.has(sc.id)) err(`duplicate schedule id '${sc.id}'`);
    else ids.add(sc.id);
    for (const f of ["statute_ref", "local_statute_ref", "url"]) {
      if (!isNonEmptyString(sc[f])) err(`${label} is missing required field '${f}'`);
    }
    if (isNonEmptyString(sc.url) && (!sc.url.startsWith("https://") || sc.url.length <= "https://".length)) {
      err(`${label}.url must be an https:// URL with a host`);
    }

    const brackets = sc.brackets;
    if (!Array.isArray(brackets) || brackets.length === 0) {
      err(`${label}.brackets must be a non-empty list`);
      return;
    }
    let prevUpper: number | null = 0;
    let prevCombined = 0;
    brackets.forEach((b, j) => {
      const bt = `${label}.brackets[${j}]`;
      if (typeof b !== "object" || b === null || Array.isArray(b)) {
        err(`${bt} must be a mapping`);
        prevUpper = null;
        return;
      }
      const br = b as Record<string, unknown>;
      const lower = br.lower_krw;
      const upper = br.upper_krw;
      if (typeof lower !== "number" || !Number.isInteger(lower) || lower < 0) {
        err(`${bt}.lower_krw must be a non-negative integer`);
        prevUpper = null;
        return;
      }
      if (prevUpper === null || lower !== prevUpper) {
        err(`${bt}.lower_krw ${lower} must equal ${j === 0 ? "0" : "the previous bracket's upper_krw"} (brackets must be contiguous from 0)`);
      }
      const isLast = j === brackets.length - 1;
      if (upper === null) {
        if (!isLast) err(`${bt}.upper_krw is null (open bracket) but is not the last bracket`);
        prevUpper = null;
      } else if (typeof upper !== "number" || !Number.isInteger(upper) || upper <= lower) {
        err(`${bt}.upper_krw must be an integer greater than lower_krw, or null for the open top bracket`);
        prevUpper = null;
      } else {
        if (isLast) err(`${bt}.upper_krw must be null - the last bracket must be open`);
        prevUpper = upper;
      }
      const nat = br.national_rate_pct;
      const loc = br.local_rate_pct;
      const comb = br.combined_rate_pct;
      const nums = [nat, loc, comb];
      if (nums.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
        err(`${bt} national_rate_pct, local_rate_pct and combined_rate_pct must all be numbers (percent points)`);
        return;
      }
      const [n, l, c] = nums as number[];
      if (!(c > 0 && c < TAX_RATE_MAX_EXCLUSIVE)) {
        err(`${bt}.combined_rate_pct ${c} is outside the sanity band (0, ${TAX_RATE_MAX_EXCLUSIVE}) percent points`);
      }
      if (typeof ratio === "number" && Math.abs(l - n * ratio) > TAX_RATE_ARITHMETIC_TOLERANCE) {
        err(`${bt}.local_rate_pct ${l} does not equal national_rate_pct ${n} x local_rate_ratio ${ratio}`);
      }
      if (Math.abs(c - (n + l)) > TAX_RATE_ARITHMETIC_TOLERANCE) {
        err(`${bt}.combined_rate_pct ${c} does not equal national_rate_pct + local_rate_pct (${n + l})`);
      }
      if (c < prevCombined) err(`${bt}.combined_rate_pct ${c} is lower than the previous bracket's (rates must be non-decreasing)`);
      prevCombined = c;
    });
  });

  const def = d.default_schedule_id;
  if (!isNonEmptyString(def)) err("data.default_schedule_id is required");
  else if (!ids.has(def)) err(`data.default_schedule_id '${def}' must match exactly one schedule id`);
  return issues;
}

/**
 * credit_rating_references (ADR-0208): section-level provenance is checked by the generic loop; this
 * adds the data contract. Required: rating_scale, default, disclosed, spread_map, kd_crosscheck.
 * Optional (validated when present, added by later slices): agencies, synthetic. Every rating named
 * anywhere must resolve in rating_scale. The validator never fetches URLs and cannot re-verify a
 * transcribed table - verified_on / maintainer stay the human attestation.
 */
function validateCreditRatingReferences(file: string, section: unknown): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) =>
    issues.push({ file, message: `credit_rating_references: ${message}`, severity: "error" });
  if (typeof section !== "object" || section === null || Array.isArray(section)) return issues; // generic loop reports it
  const data = (section as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return issues; // generic loop reports it
  const d = data as Record<string, unknown>;
  const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

  // rating_scale: best to worst, notch = index + 1
  const scale: string[] = [];
  if (!Array.isArray(d.rating_scale) || d.rating_scale.length === 0) {
    err("data.rating_scale must be a non-empty list (best rating first)");
  } else {
    const seen = new Set<string>();
    d.rating_scale.forEach((r, i) => {
      if (!isNonEmptyString(r)) err(`data.rating_scale[${i}] must be a non-empty string`);
      else if (seen.has(r)) err(`data.rating_scale has a duplicate rating '${r}'`);
      else {
        seen.add(r);
        scale.push(r);
      }
    });
  }
  const notch = (r: unknown): number => (typeof r === "string" ? scale.indexOf(r) : -1);
  const resolves = (r: unknown, at: string) => {
    if (!isNonEmptyString(r)) err(`${at} is required`);
    else if (scale.length > 0 && notch(r) < 0) err(`${at} '${r}' is not in data.rating_scale`);
  };

  // default
  if (!isMap(d.default)) err("data.default must be a mapping { rating, reason }");
  else {
    resolves(d.default.rating, "data.default.rating");
    if (!isNonEmptyString(d.default.reason)) err("data.default.reason is required");
  }

  // disclosed
  if (!isMap(d.disclosed)) err("data.disclosed must be a mapping { instrument, stale_months, aggregate }");
  else {
    if (!isNonEmptyString(d.disclosed.instrument)) err("data.disclosed.instrument is required");
    const sm = d.disclosed.stale_months;
    if (typeof sm !== "number" || !Number.isFinite(sm) || sm <= 0) err("data.disclosed.stale_months must be a positive number");
    if (d.disclosed.aggregate !== "lowest") err("data.disclosed.aggregate must be 'lowest'");
  }

  // spread_map
  if (!isMap(d.spread_map)) err("data.spread_map must be a mapping");
  else {
    const sm = d.spread_map;
    resolves(sm.upper_anchor, "data.spread_map.upper_anchor");
    resolves(sm.lower_anchor, "data.spread_map.lower_anchor");
    if (notch(sm.upper_anchor) >= 0 && notch(sm.lower_anchor) >= 0 && notch(sm.upper_anchor) >= notch(sm.lower_anchor)) {
      err("data.spread_map.upper_anchor must be a better rating than lower_anchor");
    }
    if (sm.between !== "geometric") err("data.spread_map.between must be 'geometric'");
    if (sm.above_upper !== "clamp") err("data.spread_map.above_upper must be 'clamp'");
    if (sm.below_lower !== "clamp_flagged") err("data.spread_map.below_lower must be 'clamp_flagged'");
  }

  // kd_crosscheck
  if (!isMap(d.kd_crosscheck)) err("data.kd_crosscheck must be a mapping { warn_gap_pp }");
  else {
    const g = d.kd_crosscheck.warn_gap_pp;
    if (typeof g !== "number" || !Number.isFinite(g) || g <= 0) err("data.kd_crosscheck.warn_gap_pp must be a positive number");
  }

  // agencies (optional)
  if (d.agencies !== undefined) {
    if (!Array.isArray(d.agencies) || d.agencies.length === 0) err("data.agencies must be a non-empty list when present");
    else {
      const ids = new Set<string>();
      d.agencies.forEach((a, i) => {
        if (!isMap(a)) {
          err(`data.agencies[${i}] must be a mapping`);
          return;
        }
        if (!isNonEmptyString(a.id)) err(`data.agencies[${i}] is missing required field 'id'`);
        else if (ids.has(a.id)) err(`duplicate agency id '${a.id}'`);
        else ids.add(a.id);
        if (!Array.isArray(a.aliases) || a.aliases.length === 0 || !a.aliases.every(isNonEmptyString)) {
          err(`data.agencies[${i}].aliases must be a non-empty list of non-empty strings`);
        }
        if (a.home_url !== undefined && (!isNonEmptyString(a.home_url) || !a.home_url.startsWith("https://") || a.home_url.length <= "https://".length)) {
          err(`data.agencies[${i}].home_url must be an https:// URL with a host`);
        }
      });
    }
  }

  // synthetic (optional): coverage-to-rating tables
  if (d.synthetic !== undefined) {
    if (!isMap(d.synthetic)) err("data.synthetic must be a mapping when present");
    else {
      const syn = d.synthetic;
      const tables = syn.tables;
      const tableIds = new Set<string>();
      if (!Array.isArray(tables) || tables.length === 0) err("data.synthetic.tables must be a non-empty list");
      else {
        tables.forEach((t, i) => {
          const at = `data.synthetic.tables[${i}]`;
          if (!isMap(t)) {
            err(`${at} must be a mapping`);
            return;
          }
          if (!isNonEmptyString(t.id)) err(`${at} is missing required field 'id'`);
          else if (tableIds.has(t.id)) err(`duplicate synthetic table id '${t.id}'`);
          else tableIds.add(t.id);
          for (const f of ["source", "url", "basis", "maintainer"]) {
            if (!isNonEmptyString(t[f])) err(`${at} is missing required field '${f}'`);
          }
          if (isNonEmptyString(t.url) && (!t.url.startsWith("https://") || t.url.length <= "https://".length)) {
            err(`${at}.url must be an https:// URL with a host`);
          }
          for (const f of ["as_of", "verified_on"]) {
            const p = dateProblem(t[f]);
            if (t[f] === undefined) err(`${at} is missing required field '${f}'`);
            else if (p) err(`${at}.${f} ${p}`);
          }
          const rows = t.rows;
          if (!Array.isArray(rows) || rows.length === 0) {
            err(`${at}.rows must be a non-empty list`);
            return;
          }
          let prevUpper: number | null | undefined;
          let prevNotch = Number.POSITIVE_INFINITY;
          rows.forEach((r, j) => {
            const rt = `${at}.rows[${j}]`;
            if (!isMap(r)) {
              err(`${rt} must be a mapping`);
              prevUpper = undefined;
              return;
            }
            const lo = r.lower_x;
            const up = r.upper_x;
            if (typeof lo !== "number" || !Number.isFinite(lo)) {
              err(`${rt}.lower_x must be a finite number`);
              prevUpper = undefined;
              return;
            }
            if (j === 0) {
              if (lo > 0) err(`${rt}.lower_x ${lo} must be <= 0 (the first row must cover zero and below)`);
            } else if (prevUpper === undefined || prevUpper === null || lo !== prevUpper) {
              err(`${rt}.lower_x ${lo} must equal the previous row's upper_x (rows must be contiguous)`);
            }
            const isLast = j === rows.length - 1;
            if (up === null) {
              if (!isLast) err(`${rt}.upper_x is null (open row) but is not the last row`);
              prevUpper = null;
            } else if (typeof up !== "number" || !Number.isFinite(up) || up <= lo) {
              err(`${rt}.upper_x must be a number greater than lower_x, or null for the open top row`);
              prevUpper = undefined;
            } else {
              if (isLast) err(`${rt}.upper_x must be null - the last row must be open`);
              prevUpper = up;
            }
            resolves(r.rating, `${rt}.rating`);
            const n = notch(r.rating);
            if (n >= 0) {
              if (n > prevNotch) err(`${rt}.rating '${r.rating}' is worse than the previous row's (ratings must not worsen as coverage rises)`);
              prevNotch = n;
            }
          });
        });
      }
      if (!isNonEmptyString(syn.default_table_id)) err("data.synthetic.default_table_id is required");
      else if (!tableIds.has(syn.default_table_id)) err(`data.synthetic.default_table_id '${syn.default_table_id}' must match exactly one table id`);
    }
  }
  return issues;
}

export function validateProfile(file: string, doc: unknown): Issue[] {
  const issues: Issue[] = [];
  if (typeof doc !== "object" || doc === null) {
    return [{ file, message: "Document is not a YAML mapping", severity: "error" }];
  }
  const p = doc as Record<string, unknown>;

  for (const field of REQUIRED_TOP_LEVEL) {
    if (p[field] === undefined) {
      issues.push({ file, message: `Missing required top-level key '${field}'`, severity: "error" });
    }
  }

  for (const section of SOURCED_SECTIONS) {
    const val = p[section];
    if (val === undefined) continue; // already reported above
    if (typeof val !== "object" || val === null || Array.isArray(val)) {
      issues.push({ file, message: `Section '${section}' must be a mapping with source/verified_on/maintainer/data`, severity: "error" });
      continue;
    }
    const s = val as Record<string, unknown>;
    for (const f of ["source", "verified_on", "maintainer"]) {
      if (typeof s[f] !== "string" || (s[f] as string).trim() === "") {
        issues.push({ file, message: `Section '${section}' is missing required provenance field '${f}'`, severity: "error" });
      }
    }
    if (typeof s.data !== "object" || s.data === null || Object.keys(s.data as object).length === 0) {
      issues.push({ file, message: `Section '${section}'.data is missing or empty — an unsourced placeholder is not allowed`, severity: "error" });
    }
    if (typeof s.verified_on === "string") {
      const d = new Date(s.verified_on);
      if (Number.isNaN(d.getTime())) {
        issues.push({ file, message: `Section '${section}'.verified_on is not a valid ISO-8601 date`, severity: "error" });
      } else if (d.getTime() > Date.now()) {
        issues.push({ file, message: `Section '${section}'.verified_on is in the future`, severity: "error" });
      }
    }
  }

  if (p.erp_references !== undefined) issues.push(...validateErpReferences(file, p.erp_references));
  if (p.corporate_tax_rates !== undefined) issues.push(...validateCorporateTaxRates(file, p.corporate_tax_rates));
  if (p.credit_rating_references !== undefined) issues.push(...validateCreditRatingReferences(file, p.credit_rating_references));

  const closing = p.typical_closing_weeks;
  if (closing !== undefined && (typeof closing !== "number" || closing <= 0)) {
    issues.push({ file, message: "'typical_closing_weeks' must be a positive number", severity: "error" });
  }

  return issues;
}

async function main() {
  const files = await findProfileFiles(ROOT);
  if (files.length === 0) {
    console.error("No region-profiles/*.yaml files found.");
    process.exit(1);
  }

  const allIssues: Issue[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf-8");
    let doc: unknown;
    try {
      doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      allIssues.push({ file, message: `YAML parse error: ${(e as Error).message}`, severity: "error" });
      continue;
    }
    allIssues.push(...validateProfile(file, doc));
  }

  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warn");

  if (VERBOSE || errors.length > 0) {
    for (const i of allIssues) {
      console.log(`[${i.severity === "error" ? "ERROR" : "WARN"}] ${i.file} — ${i.message}`);
    }
  }

  console.log(`\nRegion profile validation: ${files.length} profile(s), ${errors.length} error(s), ${warnings.length} warning(s).`);
  if (errors.length > 0) {
    console.error("❌ Region profile validation failed.");
    process.exit(1);
  }
  console.log("✅ Region profile validation passed.");
}

if (import.meta.main) main();
