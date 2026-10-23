#!/usr/bin/env bun
/**
 * validate-model-registry.ts
 * Validates that all agents/*.md frontmatter model comments match docs/workspace-schema.json models block,
 * and that the tier→model mapping prose in AGENTS.md §3.6 / CLAUDE.md / GEMINI.md / CODEX.md
 * names exactly the models the registry declares for each tier,
 * and that the runtime catalog projections (agent-registry.generated.ts,
 * pm-catalog.generated.ts) stay consistent with the same agents/*.md frontmatter.
 * Level: L0 | Status: active | @version 1.6.0
 *
 * v1.6.0 (ADR-0183 D3, design 2026-09-15-runtime-pm-agent-orchestration §6.4):
 * runtime catalog parity — the web runtime derives its agent data from the
 * same agents/*.md SSOT the 7 harness platforms consume (it is the 8th
 * consumer), so the generated roster (agent-registry.generated.ts) and PM
 * catalog (pm-catalog.generated.ts) are now validated against that SSOT:
 * roster keys and per-entry name·role·domain must match the frontmatter this
 * script already parses, and every non-null catalog agentKey must resolve in
 * the roster. Both targets self-skip with a visible note in contexts that do
 * not deliver the web runtime projection. The 7-platform model-comment and
 * tier→model prose checks are unchanged.
 *
 * v1.5.0 (design 2026-10-23-zai-tier-floor-support): `hermes` and `zai` join
 * PLATFORMS (5 → 7) so both platforms' registry entries and agent frontmatter
 * model comments are validated; the AGENTS.md §3.6 "distinct" prose target
 * now expects the GLM ids. No validation logic changes.
 *
 * v1.4.0 (T-20260916-011): the CODEX.md prose target is now platform-delivery
 * aware. Projects scaffolded without the codex platform carry neither
 * CODEX.md nor .codex/ (new-project.ts §2.7 strips both), and the
 * unconditional read failed their audit with "could not read CODEX.md".
 * The codex target self-skips with a visible note when the platform is not
 * delivered (shared lib/platform-delivery.ts); L0/L1 contexts, where every
 * target file exists, are behaviorally unchanged.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { die } from "./lib/error-handling.ts";
import { partitionProseTargetsByDelivery } from "./lib/platform-delivery.ts";

const WORKSPACE_ROOT = fileURLToPath(new URL("..", import.meta.url))
  .replace(/\/$/, "")
  .replace(/^\/([A-Z]:)/, "$1");

interface ModelsBlock {
  [platform: string]: {
    [tier: string]: string;
  };
}

interface WorkspaceSchema {
  models?: ModelsBlock;
}

interface Mismatch {
  file: string;
  platform: string;
  tier: string;
  declaredModel: string;
  expectedModel: string;
}

const PLATFORMS = ["claude", "gemini", "antigravity", "gemini-cli", "codex", "hermes", "zai"] as const;
type Platform = typeof PLATFORMS[number];

/**
 * Extract frontmatter block (content between first --- markers).
 */
function extractFrontmatter(content: string): string | null {
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") return null;

  const endIdx = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (endIdx === -1) return null;

  return lines.slice(1, endIdx).join("\n");
}

/**
 * Parse the tier block from frontmatter.
 * Looks for:
 *   tier:
 *     claude: high        # claude-opus-4-7
 *     antigravity: high   # gemini-3.1-pro (thinking_level="medium")
 *     gemini-cli: high    # gemini-3.1-pro
 */
function parseTierBlock(frontmatter: string): Map<string, { tier: string; modelComment: string | null }> {
  const result = new Map<string, { tier: string; modelComment: string | null }>();
  const lines = frontmatter.split("\n");

  let inTierBlock = false;
  for (const line of lines) {
    if (/^tier\s*:/.test(line)) {
      inTierBlock = true;
      continue;
    }

    if (inTierBlock) {
      // Stop at next top-level key (non-indented, non-empty line)
      if (line.trim() !== "" && !/^\s/.test(line)) {
        inTierBlock = false;
        continue;
      }

      // Match platform line: "  claude: high        # claude-opus-4-7"
      const match = line.match(/^\s+([\w-]+)\s*:\s*(\w+)\s*(?:#\s*(.+))?$/);
      if (match) {
        const platform = match[1];
        const tier = match[2];
        const rawComment = match[3]?.trim() ?? null;

        // Extract just the model name from comment (strip parenthetical annotations)
        let modelComment: string | null = null;
        if (rawComment && rawComment.toLowerCase() !== "inherit") {
          // Grab the first token before any space/parenthesis
          const modelMatch = rawComment.match(/^([\w.-]+)/);
          modelComment = modelMatch ? modelMatch[1] : null;
        }

        result.set(platform, { tier, modelComment });
      }
    }
  }

  return result;
}

// --- Main ---

// Step 1: Load and validate workspace-schema.json
const schemaPath = join(WORKSPACE_ROOT, "docs", "workspace-schema.json");
// Definite-assignment assertions: `die()` exits in main mode; in module mode the
// else-branch only logs and falls through exactly as before (a later property
// access throws, unchanged from the prior runtime behavior).
let schema!: WorkspaceSchema;
try {
  schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
} catch (err) {
  if (import.meta.main) {
    die(`Could not read docs/workspace-schema.json at ${schemaPath}`, 1);
  } else {
    console.error(`ERROR: Could not read docs/workspace-schema.json at ${schemaPath}`);
  }
}

if (!schema.models) {
  if (import.meta.main) {
    die("docs/workspace-schema.json is missing the 'models' block.", 1);
  } else {
    console.error("ERROR: docs/workspace-schema.json is missing the 'models' block.");
  }
}

const missingPlatforms = PLATFORMS.filter((p) => !schema.models![p]);
if (missingPlatforms.length > 0) {
  if (import.meta.main) {
    die(`workspace-schema.json models block is missing platforms: ${missingPlatforms.join(", ")}`, 1);
  } else {
    console.error(`ERROR: workspace-schema.json models block is missing platforms: ${missingPlatforms.join(", ")}`);
  }
}

const models = schema.models as ModelsBlock;

// Step 2: Read all agents/*.md files
const agentsDir = join(WORKSPACE_ROOT, "agents");
let agentFiles!: string[]; // see note above on definite-assignment assertions
try {
  agentFiles = readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(agentsDir, f));
} catch (err) {
  if (import.meta.main) {
    die(`Could not read agents directory at ${agentsDir}`, 1);
  } else {
    console.error(`ERROR: Could not read agents directory at ${agentsDir}`);
  }
}

if (agentFiles.length === 0) {
  console.log("✓ No agent files found. Nothing to validate.");
  if (import.meta.main) {
    process.exit(0);
  }
}

// Step 3-7: Validate each agent
const mismatches: Mismatch[] = [];

for (const filePath of agentFiles) {
  const content = readFileSync(filePath, "utf-8");
  const frontmatter = extractFrontmatter(content);

  if (!frontmatter) continue;

  const tierBlock = parseTierBlock(frontmatter);
  if (tierBlock.size === 0) continue;

  for (const platform of PLATFORMS) {
    const entry = tierBlock.get(platform);
    if (!entry) continue;

    const { tier, modelComment } = entry;

    // Skip if no model comment or uses inherit keyword
    if (!modelComment || modelComment.toLowerCase() === "inherit") continue;

    const expectedModel = models[platform]?.[tier];
    if (!expectedModel) {
      console.warn(`WARN: No model defined in registry for platform=${platform} tier=${tier} (${filePath})`);
      continue;
    }

    if (modelComment !== expectedModel) {
      mismatches.push({
        file: filePath,
        platform,
        tier,
        declaredModel: modelComment,
        expectedModel,
      });
    }
  }
}

// Step 8: Tier→model mapping prose blocks (AGENTS.md §3.6 / CLAUDE.md / GEMINI.md / CODEX.md)
// vs the registry. AGENTS.md lists the deduped model set per tier across all
// platforms; the platform docs each list their own column. This closes the
// drift class where a registry model rename leaves the prose behind — the
// exact failure that made the PM tier change non-atomic.
interface ProseTarget {
  file: string;
  label: string;
  platform: Platform | "distinct";
  pattern: RegExp;
  extract?: (region: string) => string[];
}

const TIER_TO_KEY: Record<string, string> = { High: "high", Medium: "medium", Low: "low" };

const proseTargets: ProseTarget[] = [
  {
    file: "AGENTS.md",
    label: "§3.6 tier-model-mapping",
    platform: "distinct",
    pattern: /^- \*\*(High|Medium|Low)-tier\*\*.*\(([^)]+)\)$/gm,
    extract: (region) => region.split("/").map((t) => t.trim()),
  },
  {
    file: "CLAUDE.md",
    label: "3-Tier mapping",
    platform: "claude",
    pattern: /^- \*\*(High|Medium|Low)-tier\*\* → ([^\s(]+)/gm,
  },
  {
    file: "GEMINI.md",
    label: "3-Tier mapping",
    platform: "gemini",
    pattern: /^- \*\*(High|Medium|Low)-tier\*\* → ([^\s(]+)/gm,
  },
  {
    file: "CODEX.md",
    label: "3-Tier mapping",
    platform: "codex",
    pattern: /^- \*\*(High|Medium|Low)-tier\*\* → ([^\s(]+)/gm,
  },
];

interface ProseMismatch {
  file: string;
  message: string;
}
const proseMismatches: ProseMismatch[] = [];

// T-20260916-011: skip targets whose platform/file was not delivered into this
// context (a codex-opt-out project has neither CODEX.md nor .codex/). Skipped
// targets are surfaced, never silent.
const { active: deliveredTargets, skipped: skippedTargets } =
  partitionProseTargetsByDelivery(proseTargets, (rel) => existsSync(join(WORKSPACE_ROOT, rel)));
for (const s of skippedTargets) {
  console.log(`ℹ️  ${s.file} ${s.label}: skipped (${s.reason})`);
}

for (const target of deliveredTargets) {
  const filePath = join(WORKSPACE_ROOT, target.file);
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    proseMismatches.push({ file: target.file, message: `could not read ${target.file}` });
    continue;
  }

  const declared: Record<string, string[]> = {};
  for (const match of content.matchAll(target.pattern)) {
    const tierKey = TIER_TO_KEY[match[1]];
    const ids = target.extract
      ? target.extract(match[2]).filter((t) => /^[\w.-]+$/.test(t))
      : [match[2].replace(/`/g, "").trim()];
    declared[tierKey] = ids;
  }

  for (const tier of ["high", "medium", "low"]) {
    const declaredIds = declared[tier];
    if (!declaredIds || declaredIds.length === 0) {
      proseMismatches.push({
        file: target.file,
        message: `no tier→model line found for ${tier} tier (${target.label})`,
      });
      continue;
    }
    const expectedIds =
      target.platform === "distinct"
        ? [...new Set(PLATFORMS.map((p) => models[p]?.[tier]).filter(Boolean))].sort()
        : [models[target.platform]?.[tier]].filter((m): m is string => Boolean(m)).sort();
    const declaredSorted = [...declaredIds].sort();
    const matches =
      declaredSorted.length === expectedIds.length &&
      declaredSorted.every((id, i) => id === expectedIds[i]);
    if (!matches) {
      proseMismatches.push({
        file: target.file,
        message: `${tier} tier declares [${declaredIds.join(", ")}] but registry says [${expectedIds.join(", ")}] (${target.label})`,
      });
    }
  }
}

// Step 9: Runtime catalog parity (ADR-0183 D3 — harness↔runtime parity guard)
// The web runtime (app/web-next) consumes the same agents/*.md SSOT the 7
// harness platforms consume — it is the 8th consumer, and its data is a
// generated projection (scripts/co-newbiz/generate-agent-registry.ts,
// generate-pm-catalog.ts). This step proves the projection derives from the
// same frontmatter validated above: roster keys and per-entry
// name·formal_name·role·domain must match exactly, and every non-null PM
// catalog agentKey must resolve in the roster. Targets self-skip (visible
// note, never a silent pass) in contexts that do not deliver the web runtime.
interface CatalogMismatch {
  file: string;
  message: string;
}
const catalogMismatches: CatalogMismatch[] = [];

/**
 * Parse scalar (word-key, single-line) frontmatter entries — the exact
 * matching rules generate-agent-registry.ts applies to the roster SSOT
 * (top-level word keys only, so nested blocks like `tier:` contribute only
 * their own key; CRLF normalized).
 */
function parseScalarFrontmatter(content: string): Record<string, string> {
  const normalized = content.replace(/\r\n/g, "\n");
  const m = normalized.match(/^---\n([\s\S]*?)\n---/);
  const fm: Record<string, string> = {};
  if (!m) return fm;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return fm;
}

const registryGenPath = join(WORKSPACE_ROOT, "app", "web-next", "lib", "agent-registry.generated.ts");
const catalogGenPath = join(WORKSPACE_ROOT, "app", "web-next", "lib", "pm-catalog.generated.ts");
const registryDelivered = existsSync(registryGenPath);
const catalogDelivered = existsSync(catalogGenPath);
if (!registryDelivered) {
  console.log(`ℹ️  app/web-next/lib/agent-registry.generated.ts: skipped (web runtime roster projection not delivered in this context)`);
}
if (!catalogDelivered) {
  console.log(`ℹ️  app/web-next/lib/pm-catalog.generated.ts: skipped (web runtime catalog projection not delivered in this context)`);
}

if (registryDelivered) {
  // Expected roster, derived with the generator's own rules from the same
  // agent files Step 3-7 just validated.
  const expectedRoster = new Map<string, { name: string; role: string; domain: string | null }>();
  for (const filePath of agentFiles) {
    const fm = parseScalarFrontmatter(readFileSync(filePath, "utf-8"));
    if (!fm.name) continue;
    expectedRoster.set(fm.name, {
      name: fm.formal_name ?? fm.name,
      role: fm.role ?? "",
      domain: fm.domain ?? null,
    });
  }

  try {
    const { AGENT_REGISTRY } = (await import(
      `file://${registryGenPath.replace(/\\/g, "/")}`
    )) as { AGENT_REGISTRY: Array<{ key: string; name: string; role: string; domain: string | null }> };

    const projectedKeys = new Set(AGENT_REGISTRY.map((a) => a.key));
    for (const [key, expected] of expectedRoster) {
      const actual = AGENT_REGISTRY.find((a) => a.key === key);
      if (!actual) {
        catalogMismatches.push({
          file: "app/web-next/lib/agent-registry.generated.ts",
          message: `roster key '${key}' present in agents/*.md frontmatter but missing from the runtime projection — regenerate with: bun scripts/co-newbiz/generate-agent-registry.ts`,
        });
        continue;
      }
      if (actual.name !== expected.name || actual.role !== expected.role || actual.domain !== expected.domain) {
        catalogMismatches.push({
          file: "app/web-next/lib/agent-registry.generated.ts",
          message: `entry '${key}' drifted: projected name="${actual.name}" role="${actual.role}" domain=${JSON.stringify(actual.domain)} but frontmatter says name="${expected.name}" role="${expected.role}" domain=${JSON.stringify(expected.domain)} — regenerate with: bun scripts/co-newbiz/generate-agent-registry.ts`,
        });
      }
    }
    for (const key of projectedKeys) {
      if (!expectedRoster.has(key)) {
        catalogMismatches.push({
          file: "app/web-next/lib/agent-registry.generated.ts",
          message: `projected key '${key}' has no agents/*.md frontmatter counterpart — stale projection; regenerate with: bun scripts/co-newbiz/generate-agent-registry.ts`,
        });
      }
    }
  } catch (err) {
    catalogMismatches.push({
      file: "app/web-next/lib/agent-registry.generated.ts",
      message: `could not load the runtime roster projection: ${String(err)}`,
    });
  }
}

if (registryDelivered && catalogDelivered) {
  try {
    const { PM_CATALOG } = (await import(
      `file://${catalogGenPath.replace(/\\/g, "/")}`
    )) as { PM_CATALOG: Record<string, { agentKey: string | null }> };

    const roster = new Set(
      agentFiles
        .map((f) => parseScalarFrontmatter(readFileSync(f, "utf-8")).name)
        .filter((n): n is string => Boolean(n)),
    );
    for (const [promptKey, entry] of Object.entries(PM_CATALOG)) {
      if (entry.agentKey !== null && !roster.has(entry.agentKey)) {
        catalogMismatches.push({
          file: "app/web-next/lib/pm-catalog.generated.ts",
          message: `prompt '${promptKey}' owns agent '${entry.agentKey}' which is not in the agents/*.md roster — regenerate with: bun scripts/co-newbiz/generate-pm-catalog.ts`,
        });
      }
    }
  } catch (err) {
    catalogMismatches.push({
      file: "app/web-next/lib/pm-catalog.generated.ts",
      message: `could not load the runtime PM catalog projection: ${String(err)}`,
    });
  }
}

if (mismatches.length === 0 && proseMismatches.length === 0 && catalogMismatches.length === 0) {
  console.log("✓ All agent model names + tier→model mapping prose match registry");
  if (registryDelivered && catalogDelivered && catalogMismatches.length === 0) {
    console.log("✓ Runtime catalog projections (agent-registry, pm-catalog) match agents/*.md frontmatter");
  }
  if (import.meta.main) {
    process.exit(0);
  }
} else {
  for (const m of mismatches) {
    console.error(
      `ERROR: ${m.file}\n  platform=${m.platform} tier=${m.tier}: declared="${m.declaredModel}" expected="${m.expectedModel}"`
    );
  }
  for (const p of proseMismatches) {
    console.error(`ERROR: ${p.file}: ${p.message}`);
  }
  for (const c of catalogMismatches) {
    console.error(`ERROR: ${c.file}: ${c.message}`);
  }
  if (import.meta.main) {
    process.exit(1);
  }
}
