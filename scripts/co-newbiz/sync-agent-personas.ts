#!/usr/bin/env bun
// @version 1.0.1
// sync-agent-personas — generate Claude Code subagent definitions
// (.claude/agents/<name>.md) from the canonical roster (agents/*.md).
//
// Until now harness dispatch had to paste each agents/<name>.md body into the
// Agent-tool prompt by hand (CLAUDE.md §6 example). The generated files let
// Claude Code load the persona natively via subagent_type — other harnesses
// keep inlining.
//
// Source of truth: agents/*.md (frontmatter name/description/tier.claude +
// body). This file is GENERATED — never edit .claude/agents/ by hand; rerun:
//   bun scripts/co-newbiz/sync-agent-personas.ts          (write)
//   bun scripts/co-newbiz/sync-agent-personas.ts --check  (CI drift gate)
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "agents");
const OUT = join(ROOT, ".claude", "agents");
const CHECK = process.argv.includes("--check");
if (!CHECK) mkdirSync(OUT, { recursive: true });

// Registry-tier → Claude Code Agent-tool model alias (CLAUDE.md "Registry
// name → model parameter mapping").
const TIER_MODEL: Record<string, string> = { high: "opus", medium: "sonnet", low: "haiku" };

interface Frontmatter { name: string; description: string; tierClaude?: string; status: string }

function parseAgent(file: string): { key: string; fm: Frontmatter; body: string } | null {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const end = text.indexOf("\n---", 3);
  if (!text.startsWith("---") || end === -1) return null;
  const raw = text.slice(3, end);
  const body = text.slice(end + 4).trim();
  const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  // description may be a single-line value or a YAML block scalar (> / |-style)
  let desc: string | undefined;
  const descLine = raw.match(/^description:\s*(.*)$/m);
  if (descLine) {
    const inline = descLine[1].trim().replace(/^['"]|['"]$/g, "");
    if (inline && inline !== ">" && inline !== "|" && !/^[>|][+-]$/.test(inline)) {
      desc = inline;
    } else {
      const lines = raw.split("\n");
      const start = lines.findIndex((l) => /^description:/.test(l));
      const block: string[] = [];
      for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].trim() === "") { block.push(""); continue; }
        if (!/^\s{2,}/.test(lines[i])) break;
        block.push(lines[i].replace(/^\s{2}/, ""));
      }
      desc = block.join(" ").trim();
    }
  }
  const tier = raw.match(/claude:\s*(high|medium|low)/)?.[1];
  const status = raw.match(/^status:\s*(.+)$/m)?.[1]?.trim() ?? "active";
  if (!name || !desc) return null;
  return { key: name, fm: { name, description: desc, tierClaude: tier, status }, body };
}

let created = 0, updated = 0, unchanged = 0, skipped = 0;
const drift: string[] = [];

for (const entry of readdirSync(SRC).sort()) {
  if (!entry.endsWith(".md") || entry === "README.md") continue;
  const parsed = parseAgent(join(SRC, entry));
  if (!parsed) { skipped++; continue; }
  const { key, fm, body } = parsed;
  const model = fm.tierClaude ? TIER_MODEL[fm.tierClaude] : undefined;
  const out = [
    "---",
    `name: ${key}`,
    `description: ${JSON.stringify(fm.description)}`,
    ...(model ? [`model: ${model}`] : []),
    "---",
    "",
    `<!-- GENERATED from agents/${entry} by scripts/co-newbiz/sync-agent-personas.ts — do not edit; rerun the script. -->`,
    "",
    body,
    "",
  ].join("\n");

  const target = join(OUT, `${key}.md`);
  if (!existsSync(target)) {
    if (CHECK) { drift.push(`missing: .claude/agents/${key}.md`); continue; }
    writeFileSync(target, out);
    created++;
  } else if (readFileSync(target, "utf8") !== out) {
    if (CHECK) { drift.push(`drifted: .claude/agents/${key}.md`); continue; }
    writeFileSync(target, out);
    updated++;
  } else {
    unchanged++;
  }
}

// Removed roster agents leave stale generated files behind — flag them too.
if (existsSync(OUT)) {
  for (const entry of readdirSync(OUT)) {
    if (!entry.endsWith(".md")) continue;
    if (!existsSync(join(SRC, entry))) {
      if (CHECK) drift.push(`stale: .claude/agents/${entry} (no agents/${entry})`);
      else console.log(`  STALE .claude/agents/${entry} — remove manually (source agent deleted)`);
    }
  }
}

if (CHECK) {
  if (drift.length > 0) {
    console.error(`sync-agent-personas --check: ${drift.length} divergence(s)`);
    for (const d of drift) console.error("  -", d);
    process.exit(1);
  }
  console.log(`sync-agent-personas --check: in sync (${unchanged} files).`);
} else {
  console.log(`sync-agent-personas: ${created} created, ${updated} updated, ${unchanged} unchanged, ${skipped} skipped.`);
}
