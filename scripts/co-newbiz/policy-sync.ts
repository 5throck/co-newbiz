#!/usr/bin/env bun
// @version 1.0.0
/**
 * policy-sync.ts — policy:sync + policy:impact (Wave A3).
 *
 * policy:sync   — scans the policies/ tree and upserts the `policy` registry
 *                 (migration 0011): scope derives from the path (group →
 *                 shared, entities/<code> → entity, regions/<code> →
 *                 region); idempotent by doc_path. An EDITED policy is not
 *                 overwritten in place — the previous row is superseded
 *                 (superseded_by) and a new version row is inserted, the
 *                 same append-mostly lifecycle ADRs use.
 *
 * policy:impact — the mechanical core of the policy-change-impact-analysis
 *                 skill: for one policy, list every referencing surface
 *                 (skills/, procedures/, checklists/, docs/ by name or key)
 *                 plus the in-flight projects pinned to it
 *                 (project_policy_pin). The skill owns the human judgment;
 *                 this is the reference index it reads.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { getDb } from "../../db/client.ts";
import { ulid } from "../../db/lib/ulid.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const POLICIES_DIR = join(ROOT, "policies");

export interface PolicyDoc {
  path: string; // repo-relative doc_path
  name: string;
  scope: "shared" | "entity" | "region";
  entityCode: string | null;
  contentHash: string;
}

function titleFrom(markdown: string, fallback: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return h1 ?? fallback;
}

async function hashAsync(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).slice(0, 8).join("");
}

export function scanPolicyDocs(): PolicyDoc[] {
  const docs: PolicyDoc[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!name.endsWith(".md")) continue;
      const rel = relative(ROOT, p).replaceAll("\\", "/");
      const text = readFileSync(p, "utf8");
      const relNoExt = rel.replace(/\.md$/, "");
      const isKo = relNoExt.endsWith("_ko");
      if (isKo) continue; // the no-suffix doc is the registry entry; _ko is its pair
      let scope: PolicyDoc["scope"] = "shared";
      let entityCode: string | null = null;
      const m = relNoExt.match(/^policies\/entities\/([^/]+)/);
      if (m) {
        scope = "entity";
        entityCode = m[1];
      }
      const regionMatch = relNoExt.match(/^policies\/regions\/([^/]+)/);
      if (regionMatch) scope = "region";
      docs.push({
        path: rel,
        name: titleFrom(text, relNoExt),
        scope,
        entityCode,
        contentHash: "", // filled by the caller (async)
      });
    }
  };
  if (existsSync(POLICIES_DIR)) walk(POLICIES_DIR);
  return docs;
}

export interface PolicySyncResult {
  inserted: number;
  superseded: number;
  unchanged: number;
  docs: Array<{ path: string; policyId: string; version: string; action: "inserted" | "superseded" | "unchanged" }>;
}

export async function syncPolicies(): Promise<PolicySyncResult> {
  const db = getDb();
  const result: PolicySyncResult = { inserted: 0, superseded: 0, unchanged: 0, docs: [] };
  const docs = scanPolicyDocs();
  for (const doc of docs) {
    const text = readFileSync(join(ROOT, doc.path), "utf8");
    doc.contentHash = await hashAsync(text);
    const existing = db
      .query("SELECT id, version FROM policy WHERE doc_path = ? AND superseded_by IS NULL")
      .get(doc.path) as { id: string; version: string } | undefined;

    let policyId: string;
    let action: PolicySyncResult["docs"][number]["action"];
    if (!existing) {
      policyId = insertPolicy(db, doc, null);
      action = "inserted";
      result.inserted++;
    } else if (existing.version === doc.contentHash) {
      policyId = existing.id;
      action = "unchanged";
      result.unchanged++;
    } else {
      // Append-mostly lifecycle: insert the new version row, then point the
      // old row's superseded_by at it.
      policyId = insertPolicy(db, doc, existing.id);
      db.run("UPDATE policy SET superseded_by = ? WHERE id = ?", [policyId, existing.id]);
      action = "superseded";
      result.superseded++;
    }
    result.docs.push({ path: doc.path, policyId, version: doc.contentHash, action });
  }
  return result;
}

function insertPolicy(db: ReturnType<typeof getDb>, doc: PolicyDoc, supersededBy: string | null): string {
  const id = ulid();
  let entityId: string | null = null;
  if (doc.entityCode) {
    entityId = (db.query("SELECT id FROM md_entity WHERE entity_code = ?").get(doc.entityCode) as { id: string } | undefined)?.id ?? null;
  }
  db.run(
    "INSERT INTO policy (id, scope, entity_id, region_code, name, version, effective_from, superseded_by, doc_path) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, doc.scope, entityId, null, doc.name, doc.contentHash, new Date().toISOString().slice(0, 10), supersededBy, doc.path],
  );
  return id;
}

export interface PolicyImpactReport {
  policy: { id: string; name: string; docPath: string; version: string };
  referencingFiles: string[];
  pinnedProjects: Array<{ projectId: string; policyVersion: string; pinnedAt: string; pinnedBy: string }>;
  supersededBy: string | null;
}

/** Reference index for one policy — grep over the surfaces a policy change touches. */
export function policyImpact(policyIdOrPath: string): PolicyImpactReport {
  const db = getDb();
  const policy = db
    .query("SELECT id, name, doc_path, version, superseded_by FROM policy WHERE id = ? OR doc_path = ? ORDER BY effective_from DESC LIMIT 1")
    .get(policyIdOrPath, policyIdOrPath) as
    | { id: string; name: string; doc_path: string; version: string; superseded_by: string | null }
    | undefined;
  if (!policy) throw new Error(`policy '${policyIdOrPath}' not found — run policy:sync first.`);

  const nameKey = policy.name.split("—")[0].trim();
  const searchRoots = ["skills", "procedures", "checklists", "docs"];
  const referencing = new Set<string>();
  for (const root of searchRoots) {
    const rootPath = join(ROOT, root);
    if (!existsSync(rootPath)) continue;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "node_modules" || name === ".next") continue;
          walk(p);
          continue;
        }
        if (!/\.(md|ya?ml|ts)$/.test(name)) continue;
        const text = readFileSync(p, "utf8");
        if (text.includes(policy.doc_path) || text.includes(nameKey)) {
          referencing.add(relative(ROOT, p).replaceAll("\\", "/"));
        }
      }
    };
    walk(rootPath);
  }

  // 0015 rebuilt the table: policy_doc_id + pinned_version (pins bind
  // document versions — ADR-0055). Match on both the policy id and its
  // doc_path since historic rows carried the pre-0015 id shape.
  const pins = db
    .query(
      `SELECT p.project_id AS projectId, p.pinned_version AS policyVersion, p.pinned_at AS pinnedAt, p.pinned_by AS pinnedBy
       FROM project_policy_pin p
       WHERE p.policy_doc_id = ? OR p.policy_doc_id = ?
       ORDER BY p.pinned_at DESC`,
    )
    .all(policy.id, policy.doc_path) as PolicyImpactReport["pinnedProjects"];

  return {
    policy: { id: policy.id, name: policy.name, docPath: policy.doc_path, version: policy.version },
    referencingFiles: [...referencing].sort(),
    pinnedProjects: pins,
    supersededBy: policy.superseded_by,
  };
}
