#!/usr/bin/env bun
// runbook-validate — registry hygiene for the operational documentation set
// (deal-deletion-playbook 관리 체계). Checks docs/runbooks/registry.yaml
// against the filesystem and the library projection:
//   1. registry parses, ids unique, required fields present
//   2. every en/ko file exists
//   3. frontmatter lang + counterpart pairs match the registry
//   4. no orphan .md files under docs/{runbooks,guidelines,manuals}
//   5. the library projection (app/web-next/lib/library.generated.ts) carries
//      an entry for every registered file
// Exit 1 with the issue list on any violation. tests/unit/
// runbook-registry.test.ts runs the same check inside the suite.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const ROOT = join(import.meta.dirname, "..", "..");

interface RegistryEntry {
  id: string;
  layer: string;
  title: string;
  audience: string;
  owner: string;
  screens?: string[];
  files: { en: string; ko: string };
  status: string;
  followups?: string;
}

interface RegistryFile {
  lang: string;
  counterpart: string;
}

const DOC_DIRS = ["docs/runbooks", "docs/guidelines", "docs/manuals"] as const;

function readFrontmatter(path: string): RegistryFile | null {
  if (!existsSync(path)) return null;
  const head = readFileSync(path, "utf8").split("---")[1] ?? "";
  const lang = head.match(/^lang:\s*(\S+)/m)?.[1];
  if (!lang) return null;
  // counterpart is optional — translation-zone files (_ko.md with sync_version
  // frontmatter) derive it from the registry's en/ko pair instead.
  const counterpart = head.match(/^counterpart:\s*(\S+)/m)?.[1];
  return { lang, counterpart };
}

export function validateRunbookRegistry(root: string = ROOT): string[] {
  const issues: string[] = [];
  const registryPath = join(root, "docs", "runbooks", "registry.yaml");
  if (!existsSync(registryPath)) return [`registry.yaml missing at ${registryPath}`];
  const registry = yaml.load(readFileSync(registryPath, "utf8")) as { entries?: RegistryEntry[] };
  const entries = registry.entries ?? [];
  if (entries.length === 0) issues.push("registry.yaml has no entries");

  // 1. ids unique, required fields
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) issues.push(`${e.id}: duplicate registry id`);
    seen.add(e.id);
    for (const field of ["layer", "title", "audience", "owner", "status"] as const) {
      if (!e[field]) issues.push(`${e.id}: missing field "${field}"`);
    }
    if (!["runbook", "guideline", "manual"].includes(e.layer)) {
      issues.push(`${e.id}: layer must be runbook | guideline | manual`);
    }
    if (!["active", "draft"].includes(e.status)) {
      issues.push(`${e.id}: status must be active | draft`);
    }
  }

  // 2/3. files exist + frontmatter pairs
  const registered = new Set<string>();
  for (const e of entries) {
    const en = e.files?.en;
    const ko = e.files?.ko;
    for (const [lang, file] of [["en", en], ["ko", ko]] as const) {
      if (!file) {
        issues.push(`${e.id}: missing ${lang} file`);
        continue;
      }
      registered.add(file);
      const abs = join(root, file);
      if (!existsSync(abs)) {
        issues.push(`${e.id}: ${lang} file not found: ${file}`);
        continue;
      }
      const fm = readFrontmatter(abs);
      if (!fm) {
        issues.push(`${file}: frontmatter must declare lang + counterpart`);
        continue;
      }
      if (fm.lang !== lang) issues.push(`${file}: frontmatter lang '${fm.lang}' != registry lang '${lang}'`);
    }
    if (en && ko) {
      const enName = en.split("/").pop();
      const koName = ko.split("/").pop();
      const enFm = readFrontmatter(join(root, en));
      const koFm = readFrontmatter(join(root, ko));
      // verify only when declared — translation-zone files derive the pair
      // from the registry instead of a counterpart field
      if (enFm?.counterpart && enFm.counterpart !== koName) issues.push(`${en}: counterpart '${enFm.counterpart}' != ${koName}`);
      if (koFm?.counterpart && koFm.counterpart !== enName) issues.push(`${ko}: counterpart '${koFm.counterpart}' != ${enName}`);
    }
  }

  // 4. no orphan docs in the managed directories
  for (const dir of DOC_DIRS) {
    const absDir = join(root, dir);
    if (!existsSync(absDir)) continue;
    for (const f of readdirSync(absDir)) {
      if (!f.endsWith(".md")) continue;
      const rel = `${dir}/${f}`;
      if (!registered.has(rel)) issues.push(`orphan doc (not in registry.yaml): ${rel}`);
    }
  }

  // 5. projection sync — every registered file must be viewable in the library
  const genPath = join(root, "app", "web-next", "lib", "library.generated.ts");
  if (existsSync(genPath)) {
    const gen = readFileSync(genPath, "utf8");
    for (const file of registered) {
      if (!gen.includes(`"file": "${file}"`)) {
        issues.push(`library projection has no entry for ${file} — regenerate/update app/web-next/lib/library.generated.ts`);
      }
    }
  }

  return issues;
}

if (import.meta.main) {
  const issues = validateRunbookRegistry();
  const entries = (yaml.load(readFileSync(join(ROOT, "docs", "runbooks", "registry.yaml"), "utf8")) as { entries: unknown[] }).entries.length;
  if (issues.length > 0) {
    for (const issue of issues) console.error("✗", issue);
    console.error(`runbook registry: FAILED (${entries} entries, ${issues.length} issue(s))`);
    process.exit(1);
  }
  console.log(`runbook registry: OK (${entries} entries)`);
}
