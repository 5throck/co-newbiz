#!/usr/bin/env bun
// @version 1.0.0
/**
 * adr:new — scaffold docs/adr/NNNN-<slug>.md with the workspace ADR
 * format (design §4-8 CLI catalog; ADR authoring support).
 *
 * Takes the next free number by scanning existing ADR filenames, so two
 * authors never collide on the same number by hand-counting. The scaffold
 * carries the fixed section skeleton every ADR here shares — Status /
 * Date / Deciders / Context / Decision / Consequences (see any recent
 * ADR, e.g. 0045) — with TODO bodies; filling them is the author's work.
 * The ONLY refusal is an existing target file: re-running with the same
 * title is a no-op error, never a silent overwrite.
 *
 * The docs/adr/README.md index is NOT touched — it is curated prose, so
 * the script prints a reminder instead of appending an entry itself.
 *
 * Usage:
 *   bun scripts/co-newbiz/adr-new.ts --title "..." [--status proposed]
 *       [--date YYYY-MM-DD] [--dir docs/adr]
 *
 * Also wired as the `adr:new` case of newbiz.ts.
 */

import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Project root = two levels up from scripts/co-newbiz/. */
const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

const SLUG_MAX = 60;

export interface AdrNewOptions {
  title: string;
  /** Defaults to "Proposed". */
  status?: string;
  /** ISO-8601 date; defaults to today. */
  date?: string;
  /** ADR directory; defaults to docs/adr. Test hook for temp dirs. */
  dir?: string;
}

export interface AdrNewResult {
  number: number;
  slug: string;
  /** Absolute path of the created file. */
  file: string;
}

/** lowercase, non-alphanumeric runs collapse to single hyphens, capped at 60. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** Next free ADR number = highest existing NNNN prefix + 1 (0001 when the dir is empty). */
export function nextAdrNumber(dir: string): number {
  let max = 0;
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const match = name.match(/^(\d{4})-/);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return max + 1;
}

/**
 * ADR filenames already in the dir that carry the given slug — i.e. this
 * title has been scaffolded before (any number). Re-running the command
 * must refuse on these, not auto-bump to the next number: a double
 * invocation silently minting ADR-0047 as a duplicate of ADR-0046 is
 * exactly the overwrite-class accident the refusal exists for.
 */
export function existingSlugFiles(dir: string, slug: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => new RegExp(`^\\d{4}-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`).test(name));
}

function adrTemplate(number: number, title: string, status: string, date: string): string {
  return `# ADR-${String(number).padStart(4, "0")}: ${title}

**Status**: ${status}
**Date**: ${date}
**Deciders**: TBD

## Context

TODO: The problem forcing this decision — the forces at play and the constraint that makes the choice non-obvious.

## Decision

TODO: The decision stated in the present tense, in one or two sentences.

## Consequences

TODO: What becomes easier, what becomes harder, and what this decision now requires (skills / checklists / procedures touched).
`;
}

/** Business function imported directly by tests — mirrors model.ts's shape. */
export function scaffoldAdr(options: AdrNewOptions): AdrNewResult {
  const title = options.title.trim();
  if (!title) throw new Error("adr:new requires a non-empty --title.");
  const slug = slugifyTitle(title);
  if (!slug) throw new Error("adr:new could not derive a slug from the title (needs a letter or digit).");
  const dir = options.dir ? resolve(options.dir) : join(PROJECT_ROOT, "docs", "adr");
  const prior = existingSlugFiles(dir, slug);
  if (prior.length > 0) {
    throw new Error(`refusing to overwrite: an ADR with this title already exists (${prior.join(", ")}).`);
  }
  const number = nextAdrNumber(dir);
  const file = join(dir, `${String(number).padStart(4, "0")}-${slug}.md`);
  if (existsSync(file)) {
    // Race guard: the file appeared between the scan and this check.
    throw new Error(`refusing to overwrite: ${file} already exists.`);
  }
  const status = options.status?.trim() || "Proposed";
  const date = options.date?.trim() || new Date().toISOString().slice(0, 10);
  writeFileSync(file, adrTemplate(number, title, status, date), "utf8");
  return { number, slug, file };
}

function flag(args: readonly string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    const title = flag(args, "--title");
    if (!title) {
      console.error('adr:new requires --title "..."  (--status and --date default to Proposed / today)');
      process.exit(1);
    }
    const result = scaffoldAdr({ title, status: flag(args, "--status"), date: flag(args, "--date"), dir: flag(args, "--dir") });
    console.log(`Created ${result.file} (ADR-${String(result.number).padStart(4, "0")})`);
    console.log("Reminder: add the entry to docs/adr/README.md once the ADR content is written.");
  } catch (err) {
    console.error(`adr:new failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
