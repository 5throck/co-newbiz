#!/usr/bin/env bun
// @version 1.0.0
/**
 * governance-sync.ts — governance:sync (registry of the five-layer hierarchy).
 *
 * Scans the repo's governance documents (policy -> procedure -> guideline ->
 * checklist -> template), builds the committed manifest
 * docs/governance/governance-registry.generated.json and upserts it into
 * `governance_doc` (db/lib/governance-registry.ts owns the DB side).
 *
 *   newbiz.ts governance:sync              scan -> rewrite manifest -> apply to DB
 *   newbiz.ts governance:sync --dry-run    scan + plan against the DB; writes nothing
 *   newbiz.ts governance:sync --check      repo vs committed manifest; exit 1 on drift (no DB)
 *
 * Metadata is read from what each file already carries; nothing is invented:
 *   policy / template   YAML frontmatter (governance_doc_id, title, version,
 *                       enforceability, owner_agent, effective_from, review_cycle_months)
 *   checklist           the same keys at the top level of the YAML file
 *   procedure           procedure_id (key), title, version, owner_agent;
 *                       enforceability derived from `applicability`
 *                       (mandatory|unconditional -> mandatory, conditional -> mixed)
 *   guideline           frontmatter, same as policy (guidelines/ does not exist yet)
 * A file missing a REQUIRED field (key, title, version, enforceability, owner)
 * is not registered and is listed as an error finding. A missing effective date
 * is a warning: the document is registered with an empty date (never guessed).
 *
 * The separate `policy` table (policy:sync / policy:impact / project_policy_pin)
 * is intentionally NOT fed from this scan: it versions by content hash so any
 * edit re-pins in-flight projects, while governance_doc versions by the
 * declared version for waiver/rule anchoring.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as yaml from "js-yaml";
import {
  GOVERNANCE_LAYERS,
  type Enforceability,
  type GovernanceLayer,
  type GovernanceManifest,
  type ManifestDoc,
  type ManifestFinding,
} from "../../db/lib/governance-registry.ts";

const ROOT = join(import.meta.dirname, "..", "..");
export const MANIFEST_REL = "docs/governance/governance-registry.generated.json";
const GENERATED_BY = "scripts/co-newbiz/governance-sync.ts";

const ENFORCEABILITY = new Set<string>(["mandatory", "recommended", "mixed"]);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

function rel(root: string, p: string): string {
  return relative(root, p).replaceAll("\\", "/");
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === "" ? null : s;
}

function ymd(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function cycle(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseFrontmatter(text: string): { meta: Record<string, unknown>; body: string } | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  try {
    const meta = yaml.load(m[1]);
    return meta && typeof meta === "object" ? { meta: meta as Record<string, unknown>, body: m[2] } : null;
  } catch {
    return null;
  }
}

interface RawMeta {
  path: string;
  layer: GovernanceLayer;
  id: string | null;
  key: string | null;
  title: string | null;
  scope: ManifestDoc["scope"];
  entityCode: string | null;
  regionCode: string | null;
  version: string | null;
  enforceability: string | null;
  owner: string | null;
  effectiveFrom: string | null;
  reviewCycle: number | null;
  /** Fields whose value was derived (not declared) — reported as warnings. */
  derived: string[];
}

function pathScope(path: string): Pick<RawMeta, "scope" | "entityCode" | "regionCode"> {
  const e = path.match(/\/entities\/([^/]+)\//);
  if (e) return { scope: "entity", entityCode: e[1], regionCode: null };
  const r = path.match(/\/regions\/([^/]+)\//);
  if (r) return { scope: "region", entityCode: null, regionCode: r[1] };
  return { scope: "shared", entityCode: null, regionCode: null };
}

function fromMarkdown(root: string, abs: string, layer: GovernanceLayer): RawMeta {
  const path = rel(root, abs);
  const text = readFileSync(abs, "utf8");
  const fm = parseFrontmatter(text);
  const meta = fm?.meta ?? {};
  const derived: string[] = [];
  let title = str(meta.title);
  if (!title) {
    const h1 = (fm?.body ?? text).match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
    if (h1) {
      title = h1;
      derived.push("title");
    }
  }
  const declaredScope = str(meta.scope);
  const ps = pathScope(path);
  return {
    path,
    layer,
    id: str(meta.governance_doc_id),
    key: str(meta.governance_doc_id),
    title,
    scope: ps.scope !== "shared" ? ps.scope : declaredScope === "entity" || declaredScope === "region" ? declaredScope : "shared",
    entityCode: ps.entityCode,
    regionCode: ps.regionCode,
    version: str(meta.version),
    enforceability: str(meta.enforceability),
    owner: str(meta.owner_agent),
    effectiveFrom: ymd(meta.effective_from),
    reviewCycle: cycle(meta.review_cycle_months),
    derived,
  };
}

function fromChecklist(root: string, abs: string): RawMeta {
  const path = rel(root, abs);
  let meta: Record<string, unknown> = {};
  try {
    const d = yaml.load(readFileSync(abs, "utf8"));
    if (d && typeof d === "object") meta = d as Record<string, unknown>;
  } catch {
    // unparseable -> every field missing -> error finding
  }
  const ps = pathScope(path);
  return {
    path,
    layer: "checklist",
    id: str(meta.governance_doc_id),
    key: str(meta.governance_doc_id),
    title: str(meta.title),
    ...ps,
    version: str(meta.version),
    enforceability: str(meta.enforceability),
    owner: str(meta.owner_agent),
    effectiveFrom: ymd(meta.effective_from),
    reviewCycle: cycle(meta.review_cycle_months),
    derived: [],
  };
}

function fromProcedure(root: string, abs: string): RawMeta {
  const path = rel(root, abs);
  let meta: Record<string, unknown> = {};
  try {
    const d = yaml.load(readFileSync(abs, "utf8"));
    if (d && typeof d === "object") meta = d as Record<string, unknown>;
  } catch {
    // see fromChecklist
  }
  const derived: string[] = [];
  let enforceability = str(meta.enforceability);
  if (!enforceability) {
    const a = str(meta.applicability);
    if (a === "mandatory" || a === "unconditional") enforceability = "mandatory";
    else if (a === "conditional") enforceability = "mixed";
  }
  const pid = str(meta.procedure_id);
  const ps = pathScope(path);
  return {
    path,
    layer: "procedure",
    id: pid ? `proc-${pid}` : null,
    key: pid,
    title: str(meta.title),
    ...ps,
    version: str(meta.version),
    enforceability,
    owner: str(meta.owner_agent),
    effectiveFrom: ymd(meta.effective_from),
    reviewCycle: cycle(meta.review_cycle_months),
    derived,
  };
}

export interface ScanResult {
  docs: ManifestDoc[];
  findings: ManifestFinding[];
}

/** Scan a repo root. Pure with respect to the DB; deterministic ordering. */
export function scanGovernanceDocs(root: string = ROOT): ScanResult {
  const raws: RawMeta[] = [];
  const isPair = (p: string) => /_ko\.md$/.test(p);
  const isReadme = (p: string) => /(^|\/)README\.md$/i.test(p);

  for (const f of walk(join(root, "policies"))) {
    if (f.endsWith(".md") && !isPair(f) && !isReadme(f)) raws.push(fromMarkdown(root, f, "policy"));
  }
  for (const f of walk(join(root, "procedures"))) {
    const r = rel(root, f);
    // _template is the authoring scaffold, _kill-criteria / _shared helpers are not documents.
    if (/\/schema\.yaml$/.test(r) && !r.startsWith("procedures/_template/")) raws.push(fromProcedure(root, f));
  }
  for (const f of walk(join(root, "guidelines"))) {
    if (f.endsWith(".md") && !isPair(f) && !isReadme(f)) raws.push(fromMarkdown(root, f, "guideline"));
  }
  for (const f of walk(join(root, "checklists"))) {
    if (/\.ya?ml$/.test(f) && !/\/_validate/.test(f)) raws.push(fromChecklist(root, f));
  }
  for (const f of walk(join(root, "templates"))) {
    if (f.endsWith(".md") && !isPair(f) && !isReadme(f)) raws.push(fromMarkdown(root, f, "template"));
  }

  const docs: ManifestDoc[] = [];
  const findings: ManifestFinding[] = [];
  const seen = new Map<string, string>();
  for (const r of raws) {
    const missing: string[] = [];
    if (!r.key) missing.push("key");
    if (!r.title) missing.push("title");
    if (!r.version) missing.push("version");
    if (!r.enforceability) missing.push("enforceability");
    else if (!ENFORCEABILITY.has(r.enforceability)) missing.push("enforceability(invalid)");
    if (!r.owner) missing.push("owner_agent");
    if (missing.length > 0) {
      findings.push({ path: r.path, layer: r.layer, severity: "error", missing });
      continue;
    }
    const dupKey = `${r.layer}\u0000${r.key}`;
    if (seen.has(dupKey)) {
      findings.push({ path: r.path, layer: r.layer, severity: "error", missing: [`key(duplicate of ${seen.get(dupKey)})`] });
      continue;
    }
    seen.set(dupKey, r.path);

    const warn: string[] = [...r.derived.map((d) => `${d}(derived)`)];
    if (!r.effectiveFrom) warn.push("effective_from");
    if (warn.length > 0) findings.push({ path: r.path, layer: r.layer, severity: "warn", missing: warn });

    docs.push({
      id: r.id as string,
      layer: r.layer,
      key: r.key as string,
      title: r.title as string,
      scope: r.scope,
      entity_code: r.entityCode,
      region_code: r.regionCode,
      version: r.version as string,
      enforceability: r.enforceability as Enforceability,
      owner_agent: r.owner as string,
      doc_path: r.path,
      effective_from: r.effectiveFrom,
      review_cycle_months: r.reviewCycle,
    });
  }

  const layerOrder = (l: string) => GOVERNANCE_LAYERS.indexOf(l as GovernanceLayer);
  docs.sort((a, b) => layerOrder(a.layer) - layerOrder(b.layer) || a.key.localeCompare(b.key));
  findings.sort((a, b) => a.path.localeCompare(b.path));
  return { docs, findings };
}

export function buildManifest(scan: ScanResult): GovernanceManifest {
  const by_layer: Record<string, number> = {};
  for (const l of GOVERNANCE_LAYERS) by_layer[l] = scan.docs.filter((d) => d.layer === l).length;
  return {
    schema: 1,
    generated_by: GENERATED_BY,
    counts: {
      docs: scan.docs.length,
      findings_error: scan.findings.filter((f) => f.severity === "error").length,
      findings_warn: scan.findings.filter((f) => f.severity === "warn").length,
      by_layer,
    },
    docs: scan.docs,
    findings: scan.findings,
  };
}

export function serializeManifest(m: GovernanceManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

export interface DriftReport {
  drift: boolean;
  message: string;
}

/** Repo vs the committed manifest. Pure file comparison — no DB. */
export function checkManifestDrift(root: string = ROOT): DriftReport {
  const fresh = serializeManifest(buildManifest(scanGovernanceDocs(root)));
  const path = join(root, MANIFEST_REL);
  if (!existsSync(path)) return { drift: true, message: `${MANIFEST_REL} is missing — run: bun scripts/co-newbiz/newbiz.ts governance:sync` };
  const committed = readFileSync(path, "utf8");
  if (committed === fresh) return { drift: false, message: `governance registry manifest is current (${JSON.parse(fresh).counts.docs} documents).` };
  let detail = "";
  try {
    const a = new Map((JSON.parse(committed) as GovernanceManifest).docs.map((d) => [`${d.layer}/${d.key}`, `${d.version}|${d.title}|${d.enforceability}|${d.owner_agent}|${d.effective_from}|${d.review_cycle_months}|${d.doc_path}`]));
    const b = new Map((JSON.parse(fresh) as GovernanceManifest).docs.map((d) => [`${d.layer}/${d.key}`, `${d.version}|${d.title}|${d.enforceability}|${d.owner_agent}|${d.effective_from}|${d.review_cycle_months}|${d.doc_path}`]));
    const changed = [...b.keys()].filter((k) => a.get(k) !== b.get(k));
    const removed = [...a.keys()].filter((k) => !b.has(k));
    detail = ` (changed/new: ${changed.slice(0, 8).join(", ") || "none"}${changed.length > 8 ? ", ..." : ""}; removed: ${removed.slice(0, 8).join(", ") || "none"})`;
  } catch {
    detail = " (committed manifest is unreadable)";
  }
  return { drift: true, message: `governance registry manifest is stale${detail} — run: bun scripts/co-newbiz/newbiz.ts governance:sync` };
}

export function writeManifest(root: string = ROOT): GovernanceManifest {
  const manifest = buildManifest(scanGovernanceDocs(root));
  writeFileSync(join(root, MANIFEST_REL), serializeManifest(manifest));
  return manifest;
}

export function readCommittedManifest(root: string = ROOT): GovernanceManifest {
  return JSON.parse(readFileSync(join(root, MANIFEST_REL), "utf8")) as GovernanceManifest;
}

// ---------------------------------------------------------------------------
// CLI entry (also callable from newbiz.ts)
// ---------------------------------------------------------------------------

export async function runGovernanceSync(args: string[]): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const check = args.includes("--check");

  if (check) {
    const r = checkManifestDrift();
    console.log(`governance:sync --check — ${r.message}`);
    return r.drift ? 1 : 0;
  }

  const manifest = dryRun ? buildManifest(scanGovernanceDocs()) : writeManifest();
  const { getDb } = await import("../../db/client.ts");
  const { applyGovernanceManifest } = await import("../../db/lib/governance-registry.ts");
  const result = applyGovernanceManifest(getDb(), manifest, {
    dryRun,
    actor: "cli:governance-sync",
    via: "cli",
    now: new Date().toISOString(),
  });

  console.log(
    `governance:sync${dryRun ? " (dry run — nothing written)" : ""} — ${result.inserted} inserted, ${result.superseded} superseded, ${result.updated} updated, ${result.unchanged} unchanged.`,
  );
  console.log(`  scanned: ${GOVERNANCE_LAYERS.map((l) => `${l}=${manifest.counts.by_layer[l]}`).join(" ")} (${manifest.counts.docs} registrable)`);
  for (const d of result.docs.filter((x) => x.action !== "unchanged")) {
    console.log(`  ${d.action.padEnd(10)} ${d.layer}/${d.key} ${d.fromVersion ? `${d.fromVersion} -> ` : ""}${d.toVersion}`);
  }
  for (const f of result.findings) console.log(`  [${f.severity}] ${f.path}: missing ${f.missing.join(", ")}`);
  for (const o of result.orphans) console.log(`  [orphan] ${o.layer}/${o.key} (${o.doc_path}) is registered but no longer in the repo — kept.`);
  return 0;
}

// Direct invocation is the manifest generator (no DB): `--check` gates drift,
// otherwise the manifest is rewritten. The DB sync is `newbiz.ts governance:sync`.
if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("--check")) {
    process.exit(await runGovernanceSync(argv));
  }
  const m = writeManifest();
  console.log(`wrote ${MANIFEST_REL} — ${m.counts.docs} documents, ${m.counts.findings_error} errors, ${m.counts.findings_warn} warnings.`);
}
