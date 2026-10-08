#!/usr/bin/env bun
// @version 1.0.0
/**
 * MCP coverage gate — ADR-0154 §4, design 2026-10-08-wave-m-mcp-parity §5.3.
 *
 * Loads process/flow.spec.yaml and the shared tool registry and fails (exit 1)
 * when:
 *   - a flow.spec S1-S12 activity has no tool listing it in stageActivities
 *     (excluded human-only activities aside),
 *   - a requiredArtifacts entry (`stage:S#:N`, 1-based) has no tool listing it
 *     in stageArtifacts,
 *   - a tool references an activity or artifact the spec does not define,
 *   - a human-only exclusion gained a tool (activity covered, route declared,
 *     tool name matching a forbidden pattern, or a mixed route's human-only
 *     body action not refused),
 *   - the in-process route guard does not refuse an excluded route,
 *   - a tool's scope disagrees with its kind, or a propose tool declares any
 *     route other than POST /api/proposals.
 *
 * Exclusions live in mcp-coverage.exclusions.yaml beside this script. Run by
 * scripts/co-newbiz/audit-variant.ts (the variant audit hook of scripts/audit.ts).
 *
 * Usage: bun scripts/co-newbiz/mcp-coverage.ts [--json]
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface SpecStage {
  id: string;
  activities?: Array<{ id: string }>;
  requiredArtifacts?: string[];
}
interface Exclusion {
  id: string;
  kind: "activity" | "tool_pattern" | "route" | "body_action";
  ref?: string;
  pattern?: string;
  route?: string;
  field?: string;
  value?: string;
  inprocess?: boolean;
  reason: string;
}

const wildcard = (route: string): string => route.replace(/\{[^}]*\}|:[A-Za-z]+/g, "{}");

export interface CoverageReport {
  errors: string[];
  activities: number;
  artifacts: number;
  tools: number;
  excluded: number;
}

export async function runCoverage(): Promise<CoverageReport> {
  const spec = yamlLoad(readFileSync(join(ROOT, "process", "flow.spec.yaml"), "utf8")) as { stages: SpecStage[] };
  const exclusionFile = yamlLoad(readFileSync(join(import.meta.dirname, "mcp-coverage.exclusions.yaml"), "utf8")) as {
    exclusions: Exclusion[];
  };
  const { REGISTRY } = await import("../../mcp/co-newbiz/registry.ts");
  const { HUMAN_ONLY_ROUTES } = await import("../../app/web-next/lib/mcp/in-process-port.ts");

  const errors: string[] = [];
  const activities = new Set<string>();
  const artifacts = new Set<string>();
  for (const stage of spec.stages) {
    for (const a of stage.activities ?? []) activities.add(a.id);
    (stage.requiredArtifacts ?? []).forEach((_name, i) => artifacts.add(`stage:${stage.id}:${i + 1}`));
  }

  const excludedActivities = new Set<string>();
  for (const ex of exclusionFile.exclusions) {
    if (ex.kind === "activity") {
      if (!ex.ref || !activities.has(ex.ref)) errors.push(`Exclusion '${ex.id}': activity '${ex.ref}' is not in flow.spec (stale exclusion).`);
      else excludedActivities.add(ex.ref);
    }
  }

  const coveredActivities = new Set<string>();
  const coveredArtifacts = new Set<string>();
  for (const tool of REGISTRY) {
    for (const a of tool.stageActivities) {
      if (!activities.has(a)) errors.push(`Tool '${tool.name}' references unknown activity '${a}'.`);
      else coveredActivities.add(a);
    }
    for (const a of tool.stageArtifacts) {
      if (!artifacts.has(a)) errors.push(`Tool '${tool.name}' references unknown artifact '${a}'.`);
      else coveredArtifacts.add(a);
    }
    // Scope/kind invariants: a propose tool can only create a proposal.
    const expectedScope = tool.kind === "read" ? "read" : tool.kind === "propose" ? "propose" : "write";
    if (tool.scope !== expectedScope) errors.push(`Tool '${tool.name}': kind '${tool.kind}' requires scope '${expectedScope}', found '${tool.scope}'.`);
    if (tool.kind === "propose" && tool.routes.some((r) => r !== "POST /api/proposals")) {
      errors.push(`Propose tool '${tool.name}' declares a route other than POST /api/proposals: ${tool.routes.join(", ")}.`);
    }
    if (tool.kind !== "read" && tool.routes.length === 0) errors.push(`Tool '${tool.name}' declares no REST route.`);
  }

  for (const a of activities) {
    if (excludedActivities.has(a)) continue;
    if (!coveredActivities.has(a)) errors.push(`Activity '${a}' has no MCP tool (add stageActivities to a tool or exclude it as human-only).`);
  }
  for (const a of artifacts) {
    if (!coveredArtifacts.has(a)) errors.push(`Artifact '${a}' has no MCP tool (add stageArtifacts to a tool).`);
  }

  for (const ex of exclusionFile.exclusions) {
    switch (ex.kind) {
      case "activity": {
        for (const tool of REGISTRY) {
          if (ref(ex) && tool.stageActivities.includes(ref(ex))) errors.push(`Excluded activity '${ex.ref}' gained a tool: '${tool.name}'.`);
        }
        break;
      }
      case "tool_pattern": {
        const re = new RegExp(ex.pattern ?? "$^");
        for (const tool of REGISTRY) if (re.test(tool.name)) errors.push(`Tool '${tool.name}' matches forbidden pattern '${ex.pattern}' (${ex.id}).`);
        break;
      }
      case "route":
      case "body_action": {
        const route = wildcard(ex.route ?? "");
        for (const tool of REGISTRY) {
          if (tool.routes.some((r) => wildcard(r) === route)) {
            if (ex.kind === "route") {
              errors.push(`Tool '${tool.name}' declares human-only route '${ex.route}' (${ex.id}).`);
            } else {
              const marker = `${tool.routes.find((r) => wildcard(r) === route)}#${ex.field}=`;
              const guarded = (tool.blockedBodyValues ?? []).some((b) => wildcard(b.split("#")[0]) === route && b.includes(`#${ex.field}=`) && b.slice(b.indexOf("#")).split("=")[1]?.split("|").includes(ex.value ?? ""));
              if (!guarded) errors.push(`Tool '${tool.name}' wraps '${ex.route}' without refusing ${ex.field}=${ex.value} (${ex.id}; expected blockedBodyValues ${marker}...).`);
            }
          }
        }
        if (ex.inprocess !== false) {
          const [method] = (ex.route ?? "").split(" ");
          const guarded = HUMAN_ONLY_ROUTES.some(
            (r) => r.method === method && wildcard(`${r.method} ${r.pattern}`) === route && (ex.kind === "route" ? !r.bodyField : r.bodyField?.field === ex.field && r.bodyField?.value === ex.value),
          );
          if (!guarded) errors.push(`Exclusion '${ex.id}': the in-process route guard (HUMAN_ONLY_ROUTES) does not refuse '${ex.route}'.`);
        }
        break;
      }
    }
  }

  return { errors, activities: activities.size, artifacts: artifacts.size, tools: REGISTRY.length, excluded: exclusionFile.exclusions.length };
}

function ref(ex: Exclusion): string {
  return ex.ref ?? "";
}

if (import.meta.main) {
  const report = await runCoverage();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.errors.length === 0) {
    console.log(`mcp-coverage: OK — ${report.tools} tools cover ${report.activities} activities and ${report.artifacts} artifacts (${report.excluded} human-only exclusions enforced).`);
  } else {
    console.error(`mcp-coverage: FAILED (${report.errors.length})`);
    for (const e of report.errors) console.error(`  - ${e}`);
  }
  process.exit(report.errors.length === 0 ? 0 : 1);
}
