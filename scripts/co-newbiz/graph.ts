// @version 0.4.0
/**
 * Multi-element skill graph extractor — pilot per
 * docs/designs/2026-08-24-multi-element-skill-graph-pilot-design.md.
 *
 * v0.4.0: consumes inference promoted to DEFAULT (precision 1/1 vs pilots;
 *         the surviving edge is kill-criteria-corroborated). --no-consumes opts out.
 * v0.3.0: workspace-roster fallback resolves platform-skill owners cross-repo.` + [char]10 + ` * v0.2.0: honors the ADR-0053 human-role registry (procedures/
 * _human-roles.yaml) — agent_key values registered there are person-roles,
 * emitted as agent nodes with `human_role: true` instead of missing-file
 * warnings, mirroring graph-map.ts's exemption.
 *
 * Derives ONE committed projection (docs/graph/graph.json + graph.md) over
 * 7 node types (skill / agent / procedure / step / artifact / rule /
 * evidence-var / decision-adr) purely from existing SSOTs — no new registry,
 * no hand-maintained store. All edges are advisory and carry `source_ref`.
 *
 * Commands (wired in newbiz.ts):
 *   graph            Emit docs/graph/graph.{json,md}
 *   graph --check    Regenerate in memory and diff against committed files;
 *                    exit 1 on drift (byte-stable output, no timestamps).
 *   context --skill <name> | --gate <Name>
 *                    Session-time contextual bundle over the derived graph.
 *
 * Mutability discipline (design §3): derived edges regenerate from SSOTs;
 * decision relations are append-only supersession; consumes inference ships
 * suppressed behind --include-consumes until precision is reviewed against
 * pilots 001-010.
 */

import * as yaml from "js-yaml";
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(import.meta.dirname, "..", "..");
const SKILLS_DIR = join(ROOT, "skills");
const AGENTS_DIR = join(ROOT, "agents");
const PROCEDURES_SHARED = join(ROOT, "procedures", "_shared");
const RULES_DIR = join(ROOT, "procedures", "_kill-criteria");
const HUMAN_ROLES_PATH = join(ROOT, "procedures", "_human-roles.yaml");
const DECISIONS_DIR = join(ROOT, "docs", "decisions");
const ADRS_DIR = join(ROOT, "docs", "adr");
const OUT_DIR = join(ROOT, "docs", "graph");

interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  [key: string]: unknown;
}

type NodeType =
  | "agent"
  | "artifact"
  | "adr"
  | "decision"
  | "procedure"
  | "rule"
  | "skill"
  | "step"
  | "var";

interface GraphEdge {
  type: EdgeType;
  from: string;
  to: string;
  source_ref: string;
}

type EdgeType =
  | "activates_reverses"
  | "amends"
  | "anchored_by"
  | "consumes"
  | "evaluates"
  | "executes_agent"
  | "executes_skill"
  | "member_of"
  | "owns"
  | "produces"
  | "step_of"
  | "supersedes";

interface Warnings {
  stale_member_keys: string[];
  unknown_owner_agents: string[];
  unknown_step_agents: string[];
  unknown_step_skills: string[];
  undeclared_procedures: string[];
  unanchored_policy_ids: string[];
  decisions_citing_unknown_rules: string[];
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: Warnings;
}

interface SkillInfo {
  name: string;
  version: string;
  status: string;
  owner: string | undefined;
  procedureKeys: string[];
}

interface StepRec {
  procKey: string;
  procTitle: string;
  id: string;
  gate: string;
  agentKey?: string;
  skillKey?: string;
  outputType?: string;
  appliesWhen?: unknown;
  description?: string;
}

interface ProcedureInfo {
  key: string;
  procedureId?: string;
  title: string;
  version?: string;
  status?: string;
  steps: StepRec[];
}

interface RuleInfo {
  stem: string;
  procedure: string;
  criterionId: string;
  title: string;
  action: string;
  enabled: boolean;
  predicate: unknown;
  policyId?: string;
  thresholdsSource?: string;
  premiseLocked: boolean;
}

interface DocRef {
  id: string;
  kind: "decision" | "adr";
  path: string;
  text: string;
}

// ---------- generic helpers ----------

function parseFrontmatter(raw: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return {};
  try {
    return ((yaml.load(m[1]) as Record<string, unknown>) ?? {}) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectVars(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectVars(item, out);
    return;
  }
  if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if (typeof rec["var"] === "string") out.add(rec["var"]);
    for (const v of Object.values(rec)) collectVars(v, out);
  }
}

// ---------- extractors ----------

function extractSkills(warn: Warnings): {
  skills: Map<string, SkillInfo>;
  order: string[];
} {
  const skills = new Map<string, SkillInfo>();
  const order: string[] = [];
  for (const dir of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const mdPath = join(SKILLS_DIR, dir.name, "SKILL.md");
    if (!existsSync(mdPath)) continue;
    const fm = parseFrontmatter(readFileSync(mdPath, "utf-8"));
    const info: SkillInfo = {
      name: asString(fm["name"]) ?? dir.name,
      version: asString(fm["version"]) ?? "0.0.0",
      status: asString(fm["status"]) ?? "unknown",
      owner: asString(fm["owner"]),
      procedureKeys: [],
    };
    const meta = fm["metadata"] as Record<string, unknown> | undefined;
    if (meta && typeof meta === "object") {
      info.procedureKeys = asStringArray(meta["procedure_keys"]);
    }
    skills.set(info.name, info);
    order.push(info.name);
  }
  order.sort();
  // Stale member_of keys are resolved against procedures later (in buildGraph),
  // because the procedure set is not loaded yet here.
  void warn;
  return { skills, order };
}

function extractAgents(): Set<string> {
  const agents = new Set<string>();
  for (const f of readdirSync(AGENTS_DIR)) {
    if (!f.endsWith(".md")) continue;
    if (/^README/i.test(f)) continue;
    agents.add(f.replace(/\.md$/, ""));
  }
  return agents;
}

/**
 * Workspace-root roster fallback (ADR-0057 country-scoped copies et al):
 * platform-common skills shipped from templates/common keep their upstream
 * `owner:` names, which legitimately live in OTHER rosters (workspace root,
 * sibling variants). Resolving them turns false missing-owner warnings into
 * real cross-repo provenance. Guarded: a standalone clone of this repo has
 * no parent workspace, and the fallback simply stays empty.
 */
function extractWorkspaceRoster(): Set<string> {
  const roster = new Set<string>();
  const rootAgentsDir = join(ROOT, "..", "..", "agents");
  if (!existsSync(rootAgentsDir)) return roster;
  try {
    for (const f of readdirSync(rootAgentsDir)) {
      if (!f.endsWith(".md")) continue;
      if (/^README/i.test(f)) continue;
      roster.add(f.replace(/\.md$/, ""));
    }
  } catch {
    // unreadable parent — treat as standalone
  }
  return roster;
}

/**
 * Human-authority roles (ADR-0053, boundary #2): agent_key values registered
 * in procedures/_human-roles.yaml name PERSON-ROLES, not AI agents — the
 * missing agents/<key>.md is the point. Mirrors graph-map.ts's exemption so
 * the projection does not re-flag what the integrity gate already blessed.
 */
function extractHumanRoles(): Set<string> {
  const roles = new Set<string>();
  if (!existsSync(HUMAN_ROLES_PATH)) return roles;
  try {
    const doc = yaml.load(readFileSync(HUMAN_ROLES_PATH, "utf-8")) as
      | Record<string, unknown>
      | undefined;
    const hr = doc?.["human_roles"];
    if (hr && typeof hr === "object") {
      for (const key of Object.keys(hr as Record<string, unknown>)) {
        roles.add(key);
      }
    }
  } catch {
    // fail-open here would reintroduce false warnings; fail-closed instead:
    // an unreadable registry yields no exemptions and the warnings surface it.
  }
  return roles;
}

function extractProcedures(): Map<string, ProcedureInfo> {
  const procs = new Map<string, ProcedureInfo>();
  for (const dir of readdirSync(PROCEDURES_SHARED, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const schemaPath = join(PROCEDURES_SHARED, dir.name, "schema.yaml");
    if (!existsSync(schemaPath)) continue;
    let doc: Record<string, unknown>;
    try {
      doc = (yaml.load(readFileSync(schemaPath, "utf-8")) ??
        {}) as Record<string, unknown>;
    } catch {
      continue;
    }
    const steps: StepRec[] = [];
    const rawSteps = Array.isArray(doc["steps"]) ? doc["steps"] : [];
    let idx = 0;
    for (const rs of rawSteps) {
      idx += 1;
      const rec = (rs ?? {}) as Record<string, unknown>;
      steps.push({
        procKey: dir.name,
        procTitle: asString(doc["title"]) ?? dir.name,
        id: String(rec["id"] ?? idx),
        gate: asString(rec["gate"]) ?? asString(doc["gate"]) ?? "",
        agentKey: asString(rec["agent_key"]),
        skillKey: asString(rec["skill_key"]),
        outputType: asString(rec["output_type"]),
        appliesWhen: rec["applies_when"],
        description: asString(rec["description"]),
      });
    }
    procs.set(dir.name, {
      key: dir.name,
      procedureId: asString(doc["procedure_id"]),
      title: asString(doc["title"]) ?? dir.name,
      version: asString(doc["version"]),
      status: asString(doc["status"]),
      steps,
    });
  }
  return procs;
}

function extractRules(): Map<string, RuleInfo> {
  const rules = new Map<string, RuleInfo>();
  if (!existsSync(RULES_DIR)) return rules;
  for (const f of readdirSync(RULES_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(
        readFileSync(join(RULES_DIR, f), "utf-8"),
      ) as Record<string, unknown>;
      const procedure = asString(entry["procedure"]) ?? "";
      const criterionId = asString(entry["criterion_id"]) ?? "";
      const notes = asString(entry["notes"]) ?? "";
      rules.set(`${procedure}__${criterionId}`, {
        stem: `${procedure}__${criterionId}`,
        procedure,
        criterionId,
        title: asString(entry["title"]) ?? criterionId,
        action: asString(entry["action"]) ?? "unknown",
        enabled: entry["enabled"] === true,
        predicate: entry["predicate"] ?? null,
        policyId: asString(entry["policy_id"]),
        thresholdsSource: asString(entry["thresholds_source"]),
        premiseLocked: /premise-lock/i.test(notes),
      });
    } catch {
      // Unparsable registry entries are runtime-rejected anyway; skip here.
    }
  }
  return rules;
}

function extractDocs(): DocRef[] {
  const docs: DocRef[] = [];
  if (existsSync(DECISIONS_DIR)) {
    for (const f of readdirSync(DECISIONS_DIR, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith(".md")) continue;
      const p = join(DECISIONS_DIR, f.name);
      docs.push({
        id: `dec:${f.name.replace(/\.md$/, "")}`,
        kind: "decision",
        path: p,
        text: readFileSync(p, "utf-8"),
      });
    }
  }
  if (existsSync(ADRS_DIR)) {
    for (const f of readdirSync(ADRS_DIR, { withFileTypes: true })) {
      if (!f.isFile() || !/^\d{4}-.*\.md$/.test(f.name)) continue;
      const p = join(ADRS_DIR, f.name);
      docs.push({
        id: `adr:${f.name.slice(0, 4)}`,
        kind: "adr",
        path: p,
        text: readFileSync(p, "utf-8"),
      });
    }
  }
  return docs;
}

// ---------- graph assembly ----------

function buildGraph(includeConsumes: boolean): Graph {
  const warnings: Warnings = {
    stale_member_keys: [],
    unknown_owner_agents: [],
    unknown_step_agents: [],
    unknown_step_skills: [],
    undeclared_procedures: [],
    unanchored_policy_ids: [],
    decisions_citing_unknown_rules: [],
  };

  const { skills, order: skillOrder } = extractSkills(warnings);
  const agents = extractAgents();
  const workspaceRoster = extractWorkspaceRoster();
  const humanRoles = extractHumanRoles();
  const procs = extractProcedures();
  const rules = extractRules();
  const docs = extractDocs();

  const nodes = new Map<string, GraphNode>();
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];

  function addNode(node: GraphNode): void {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  function addEdge(
    type: EdgeType,
    from: string,
    to: string,
    sourceRef: string,
  ): void {
    const key = `${type}|${from}|${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ type, from, to, source_ref: sourceRef });
  }

  // --- skills ---
  for (const name of skillOrder) {
    const s = skills.get(name)!;
    addNode({
      id: `skill:${s.name}`,
      type: "skill",
      label: s.name,
      version: s.version,
      status: s.status,
    });
    if (s.owner) {
      if (agents.has(s.owner)) {
        addNode({ id: `agent:${s.owner}`, type: "agent", label: s.owner });
        addEdge("owns", `agent:${s.owner}`, `skill:${s.name}`, `skills/${s.name}/SKILL.md`);
      } else if (workspaceRoster.has(s.owner)) {
        // Platform-common skill owned by a workspace-root roster name — real
        // cross-repo provenance, surfaced as an attribute instead of a warning.
        addNode({
          id: `agent:${s.owner}`,
          type: "agent",
          label: s.owner,
          roster: "workspace-root",
        });
        addEdge("owns", `agent:${s.owner}`, `skill:${s.name}`, `skills/${s.name}/SKILL.md`);
      } else {
        warnings.unknown_owner_agents.push(`${s.name}: ${s.owner}`);
      }
    }
    for (const key of s.procedureKeys) {
      if (!procs.has(key)) {
        warnings.stale_member_keys.push(`${s.name}: ${key}`);
        continue;
      }
      addNode({ id: `proc:${key}`, type: "procedure", label: key });
      addEdge("member_of", `skill:${s.name}`, `proc:${key}`, `skills/${s.name}/SKILL.md`);
    }
  }
  for (const a of [...agents].sort()) {
    addNode({ id: `agent:${a}`, type: "agent", label: a });
  }

  // --- procedures / steps / artifacts ---
  const declaredProcKeys = new Set<string>();
  for (const name of skillOrder) declaredKeysInto(declaredProcKeys, skills.get(name)!);
  for (const [key, proc] of [...procs.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    addNode({
      id: `proc:${key}`,
      type: "procedure",
      label: proc.title,
      procedure_id: proc.procedureId,
      version: proc.version,
      status: proc.status,
    });
    if (!declaredProcKeys.has(key)) warnings.undeclared_procedures.push(key);
    for (const st of proc.steps) {
      const stepId = `proc:${key}#${st.id}`;
      addNode({
        id: stepId,
        type: "step",
        label: `${key} step ${st.id}`,
        gate: st.gate,
      });
      addEdge("step_of", stepId, `proc:${key}`, `procedures/_shared/${key}/schema.yaml`);
      if (st.agentKey) {
        if (agents.has(st.agentKey)) {
          addNode({ id: `agent:${st.agentKey}`, type: "agent", label: st.agentKey });
          addEdge(
            "executes_agent",
            stepId,
            `agent:${st.agentKey}`,
            `procedures/_shared/${key}/schema.yaml#steps[${st.id}]`,
          );
        } else if (humanRoles.has(st.agentKey)) {
          // Human-authority step (ADR-0053): the person-role is the executor
          // by design; node carries the marker, no missing-file warning.
          addNode({
            id: `agent:${st.agentKey}`,
            type: "agent",
            label: st.agentKey,
            human_role: true,
          });
          addEdge(
            "executes_agent",
            stepId,
            `agent:${st.agentKey}`,
            `procedures/_shared/${key}/schema.yaml#steps[${st.id}]`,
          );
        } else {
          warnings.unknown_step_agents.push(`${key}#${st.id}: ${st.agentKey}`);
        }
      }
      if (st.skillKey) {
        if (skills.has(st.skillKey)) {
          addEdge(
            "executes_skill",
            stepId,
            `skill:${st.skillKey}`,
            `procedures/_shared/${key}/schema.yaml#steps[${st.id}]`,
          );
        } else {
          warnings.unknown_step_skills.push(`${key}#${st.id}: ${st.skillKey}`);
        }
      }
      if (st.outputType) {
        addNode({
          id: `artifact:${st.outputType}`,
          type: "artifact",
          label: st.outputType,
        });
        addEdge(
          "produces",
          stepId,
          `artifact:${st.outputType}`,
          `procedures/_shared/${key}/schema.yaml#steps[${st.id}]`,
        );
      }
    }
  }

  // --- consumes (inference; suppressed unless requested) ---
  if (includeConsumes) {
    for (const [key, proc] of procs) {
      for (let i = 0; i < proc.steps.length; i++) {
        const producer = proc.steps[i];
        if (!producer.outputType) continue;
        const tokenRe = new RegExp(`\\b${escapeRegExp(producer.outputType)}\\b`);
        for (let j = i + 1; j < proc.steps.length; j++) {
          const consumer = proc.steps[j];
          const haystack = `${consumer.description ?? ""} ${JSON.stringify(consumer.appliesWhen ?? "")}`;
          if (tokenRe.test(haystack)) {
            addEdge(
              "consumes",
              `proc:${key}#${consumer.id}`,
              `artifact:${producer.outputType}`,
              `procedures/_shared/${key}/schema.yaml#steps[${consumer.id}] (inferred: exact token)`,
            );
          }
        }
      }
    }
  }

  // --- rules ---
  for (const [stem, rule] of [...rules.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    addNode({
      id: `rule:${stem}`,
      type: "rule",
      label: rule.title,
      action: rule.action,
      enabled: rule.enabled,
      policy_id: rule.policyId,
      premise_locked: rule.premiseLocked,
      dormant: !rule.enabled || rule.predicate === null,
    });
    if (procs.has(rule.procedure)) {
      addNode({ id: `proc:${rule.procedure}`, type: "procedure", label: rule.procedure });
    }
    const vars = new Set<string>();
    collectVars(rule.predicate, vars);
    for (const v of [...vars].sort()) {
      addNode({ id: `var:${v}`, type: "var", label: v });
      addEdge("evaluates", `rule:${stem}`, `var:${v}`, `procedures/_kill-criteria/${stem}.json`);
    }
  }

  // --- decisions / ADRs ---
  const ruleTokenRe = /\b([a-z][a-z0-9-]*__[a-z0-9_]+)\b/g;
  for (const d of docs.sort((a, b) => a.id.localeCompare(b.id))) {
    const kindLabel = d.kind === "adr" ? "ADR" : "Decision";
    const titleMatch = /^#\s+(.+)$/m.exec(d.text);
    addNode({
      id: d.id,
      type: d.kind,
      label: titleMatch ? titleMatch[1].trim() : d.id,
    });

    // supersedes / amends
    for (const [edgeType, re] of [
      ["supersedes", /supersedes\s*:\s*([^\n]*)/gi],
      ["amends", /amends\s*:\s*([^\n]*)/gi],
    ] as const) {
      for (const m of d.text.matchAll(re)) {
        const targetLine = m[1];
        for (const adrM of targetLine.matchAll(/\bADR-(\d{4})\b/g)) {
          const targetId = `adr:${adrM[1]}`;
          if (targetId !== d.id) addEdge(edgeType, d.id, targetId, d.path.replace(ROOT + "\\", ""));
        }
        for (const other of docs) {
          if (other.id === d.id || other.kind !== "decision") continue;
          const stem = other.id.slice(4);
          if (stem.length > 6 && targetLine.includes(stem)) {
            addEdge(edgeType, d.id, other.id, d.path.replace(ROOT + "\\", ""));
          }
        }
      }
    }

    // activates_reverses — verbatim rule-id citations
    for (const m of d.text.matchAll(ruleTokenRe)) {
      const stem = m[1];
      if (/^procedure__/.test(stem)) continue; // prose placeholder, not a rule id
      if (!rules.has(stem)) {
        warnings.decisions_citing_unknown_rules.push(`${d.id}: ${stem}`);
        continue;
      }
      addEdge("activates_reverses", d.id, `rule:${stem}`, d.path.replace(ROOT + "\\", ""));
    }

    // anchored_by — policy_id resolves into this document?
    for (const [stem, rule] of rules) {
      if (!rule.policyId) continue;
      if (d.text.includes(rule.policyId)) {
        addEdge("anchored_by", `rule:${stem}`, d.id, `procedures/_kill-criteria/${stem}.json`);
      }
    }
  }
  // Report policy ids that never resolved to any document.
  for (const [, rule] of rules) {
    if (!rule.policyId) continue;
    const resolved = edges.some(
      (e) => e.type === "anchored_by" && e.from === `rule:${rule.stem}`,
    );
    if (!resolved) warnings.unanchored_policy_ids.push(`${rule.stem}: ${rule.policyId}`);
  }

  const nodeList = [...nodes.values()].sort(
    (a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id),
  );
  const edgeList = edges.sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to),
  );
  return { nodes: nodeList, edges: edgeList, warnings };
}

function declaredKeysInto(into: Set<string>, s: SkillInfo): void {
  for (const k of s.procedureKeys) into.add(k);
}

// ---------- rendering ----------

function renderJson(g: Graph): string {
  return (
    JSON.stringify(
      {
        meta: {
          generator: "scripts/co-newbiz/graph.ts",
          generator_version: "0.4.0",
          design_doc:
            "docs/designs/2026-08-24-multi-element-skill-graph-pilot-design.md",
          node_count: g.nodes.length,
          edge_count: g.edges.length,
        },
        nodes: g.nodes,
        edges: g.edges,
      },
      null,
      2,
    ) + "\n"
  );
}

function renderMarkdown(g: Graph, includeConsumes: boolean): string {
  const by = <T>(items: T[], key: (t: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const it of items) {
      const k = key(it);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return m;
  };
  const nodesByType = by(g.nodes, (n) => n.type);
  const lines: string[] = [];
  lines.push("# Multi-Element Graph");
  lines.push("");
  lines.push("> Generated by `scripts/co-newbiz/graph.ts` — do not edit.");
  lines.push("> All edges advisory; every edge carries `source_ref` back to its SSOT.");
  lines.push("");
  lines.push(
    `Nodes: ${g.nodes.length} (${[...nodesByType.keys()].sort().map((t) => `${t} ${nodesByType.get(t)!.length}`).join(", ")}) · Edges: ${g.edges.length}`,
  );
  lines.push("");

  // Per-procedure step tables
  lines.push("## Procedures");
  lines.push("");
  for (const n of nodesByType.get("procedure") ?? []) {
    lines.push(`### ${n.label} (\`${n.id}\`)`);
    const steps = (nodesByType.get("step") ?? []).filter((s) =>
      s.id.startsWith(`${n.id}#`),
    );
    if (steps.length === 0) {
      lines.push("");
      lines.push("_No shared-layer steps parsed._");
      lines.push("");
      continue;
    }
    lines.push("");
    lines.push("| Step | Gate | Agent | Skill | Output |");
    lines.push("|---|---|---|---|---|");
    for (const s of steps) {
      const agentE = g.edges.find(
        (e) => e.type === "executes_agent" && e.from === s.id,
      );
      const skillE = g.edges.find(
        (e) => e.type === "executes_skill" && e.from === s.id,
      );
      const prodE = g.edges.find(
        (e) => e.type === "produces" && e.from === s.id,
      );
      lines.push(
        `| ${s.id.split("#")[1]} | ${s.gate ?? ""} | ${agentE?.to.replace("agent:", "") ?? ""} | ${skillE?.to.replace("skill:", "") ?? ""} | ${prodE?.to.replace("artifact:", "") ?? ""} |`,
      );
    }
    lines.push("");
  }

  // Skills relation rows
  lines.push("## Skills");
  lines.push("");
  lines.push("| Skill | Status | Owner | Member-of |");
  lines.push("|---|---|---|---|");
  for (const n of nodesByType.get("skill") ?? []) {
    const ownerE = g.edges.find((e) => e.type === "owns" && e.to === n.id);
    const members = g.edges
      .filter((e) => e.type === "member_of" && e.from === n.id)
      .map((e) => e.to.replace("proc:", ""))
      .join(", ");
    lines.push(
      `| \`${n.label}\` | ${n.status ?? ""} | ${ownerE?.from.replace("agent:", "") ?? "—"} | ${members || "—"} |`,
    );
  }
  lines.push("");

  // Rules
  lines.push("## Rules (kill-criteria)");
  lines.push("");
  lines.push("| Rule | Action | Enabled | Premise-locked | Evaluates | Anchored-by |");
  lines.push("|---|---|---|---|---|---|");
  for (const n of nodesByType.get("rule") ?? []) {
    const vars = g.edges
      .filter((e) => e.type === "evaluates" && e.from === n.id)
      .map((e) => `\`${e.to.replace("var:", "")}\``)
      .join(", ");
    const anchors = g.edges
      .filter((e) => e.type === "anchored_by" && e.from === n.id)
      .map((e) => e.to)
      .join(", ");
    lines.push(
      `| \`${n.label}\` | ${n.action} | ${n.enabled ? "yes" : "no"} | ${n.premise_locked ? "yes" : "no"} | ${vars || "—"} | ${anchors || "—"} |`,
    );
  }
  lines.push("");

  // Decision chains
  lines.push("## Decision relations");
  lines.push("");
  const rel = g.edges.filter(
    (e) => e.type === "supersedes" || e.type === "amends" || e.type === "activates_reverses",
  );
  if (rel.length === 0) lines.push("_None extracted._");
  for (const e of rel) {
    lines.push(`- \`${e.from}\` —${e.type}→ \`${e.to}\``);
  }
  lines.push("");

  if (includeConsumes) {
    const cons = g.edges.filter((e) => e.type === "consumes");
    lines.push("## Consumes (inferred, exact-token)");
    lines.push("");
    for (const e of cons) lines.push(`- \`${e.from}\` → \`${e.to}\``);
    lines.push("");
  }

  // Warnings
  lines.push("## Orphans & warnings");
  lines.push("");
  const w = g.warnings;
  const sections: [string, string[]][] = [
    ["Stale member_of keys", w.stale_member_keys],
    ["Unknown owner agents", w.unknown_owner_agents],
    ["Unknown step agents", w.unknown_step_agents],
    ["Unknown step skills", w.unknown_step_skills],
    ["Procedures declared by zero skills", w.undeclared_procedures],
    ["Unresolved policy ids", w.unanchored_policy_ids],
    ["Citations to unknown rules", w.decisions_citing_unknown_rules],
  ];
  let any = false;
  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    any = true;
    lines.push(`### ${title} (${items.length})`);
    lines.push("");
    for (const it of items.slice(0, 50)) lines.push(`- ${it}`);
    if (items.length > 50) lines.push(`- …and ${items.length - 50} more`);
    lines.push("");
  }
  if (!any) lines.push("_None._");
  lines.push("");
  return lines.join("\n");
}

// ---------- commands ----------

function generateAll(includeConsumes: boolean): {
  json: string;
  md: string;
  graph: Graph;
} {
  const graph = buildGraph(includeConsumes);
  return { json: renderJson(graph), md: renderMarkdown(graph, includeConsumes), graph };
}

export function runGraphCommand(args: string[]): void {
  const includeConsumes = !args.includes("--no-consumes");
  const check = args.includes("--check");
  const { json, md, graph } = generateAll(includeConsumes);

  if (check) {
    const problems = checkGraphDrift(json, md);
    if (problems.length > 0) {
      console.error("[FAIL] graph drift:");
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(
      `[PASS] graph in sync (${graph.nodes.length} nodes, ${graph.edges.length} edges)`,
    );
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "graph.json"), json, "utf-8");
  writeFileSync(join(OUT_DIR, "graph.md"), md, "utf-8");
  console.log(
    `✅ graph emitted: docs/graph/graph.json + graph.md (${graph.nodes.length} nodes, ${graph.edges.length} edges)`,
  );
  const w = graph.warnings;
  const totalWarn =
    w.stale_member_keys.length +
    w.unknown_owner_agents.length +
    w.unknown_step_agents.length +
    w.unknown_step_skills.length +
    w.undeclared_procedures.length +
    w.unanchored_policy_ids.length +
    w.decisions_citing_unknown_rules.length;
  console.log(
    `   warnings: ${totalWarn} item(s) — see docs/graph/graph.md "Orphans & warnings"`,
  );
}

/**
 * Regenerate-in-memory comparison used by BOTH `graph --check` and the
 * variant audit hook (scripts/audit-variant.ts). Returns problem strings —
 * empty means the committed files match the SSOT-derived projection.
 */
export function checkGraphDrift(
  json?: string,
  md?: string,
  includeConsumes = true,
): string[] {
  const jsonPath = join(OUT_DIR, 'graph.json');
  const mdPath = join(OUT_DIR, 'graph.md');
  if (json === undefined || md === undefined) {
    ({ json, md } = generateAll(includeConsumes));
  }
  const problems: string[] = [];
  if (!existsSync(jsonPath) || !existsSync(mdPath)) {
    problems.push("committed graph files missing");
    return problems;
  }
  if (readFileSync(jsonPath, "utf-8") !== json) {
    problems.push("graph.json drifted from SSOTs — run `newbiz.ts graph` and commit");
  }
  if (readFileSync(mdPath, "utf-8") !== md) {
    problems.push("graph.md drifted from SSOTs — run `newbiz.ts graph` and commit");
  }
  return problems;
}


export function runContextCommand(args: string[]): void {
  const skillIdx = args.indexOf("--skill");
  const gateIdx = args.indexOf("--gate");
  const includeConsumes = true; // bundles may use inferred consumers
  const g = buildGraph(includeConsumes);

  if (skillIdx >= 0) {
    const name = args[skillIdx + 1];
    if (!name) {
      console.error("context requires --skill <name> or --gate <Gate>");
      process.exit(1);
    }
    printSkillBundle(g, name);
    return;
  }
  if (gateIdx >= 0) {
    const gate = args[gateIdx + 1];
    if (!gate) {
      console.error("context requires --skill <name> or --gate <Gate>");
      process.exit(1);
    }
    printGateBundle(g, gate);
    return;
  }
  console.error("context requires --skill <name> or --gate <Gate>");
  process.exit(1);
}

function printSkillBundle(g: Graph, name: string): void {
  const skillId = `skill:${name}`;
  const node = g.nodes.find((n) => n.id === skillId);
  if (!node) {
    console.error(`unknown skill '${name}'`);
    process.exit(1);
  }
  const lines: string[] = [];
  lines.push(`## Context bundle — skill \`${name}\``);
  lines.push("");
  lines.push(
    `- Version/status: ${node.version ?? "?"} / ${node.status ?? "?"}`,
  );
  const owner = g.edges.find((e) => e.type === "owns" && e.to === skillId);
  lines.push(`- Owner agent: ${owner ? owner.from.replace("agent:", "") : "—"}`);

  const memberEdges = g.edges.filter(
    (e) => e.type === "member_of" && e.from === skillId,
  );
  if (memberEdges.length === 0) {
    lines.push("- Member of: — (no procedure_keys declared)");
  }
  const producedArtifacts = new Set<string>();
  for (const me of memberEdges) {
    const procId = me.to;
    const procNode = g.nodes.find((n) => n.id === procId);
    const steps = g.edges
      .filter((e) => e.type === "executes_skill" && e.to === skillId)
      .map((e) => e.from)
      .filter((sid) => sid.startsWith(`${procId}#`));
    lines.push(
      `- Procedure: ${procNode?.label ?? procId} — steps ${steps.map((s) => "#" + s.split("#")[1]).join(", ") || "(none)"}`,
    );
    for (const sid of steps) {
      const prod = g.edges.find(
        (e) => e.type === "produces" && e.from === sid,
      );
      if (prod) producedArtifacts.add(prod.to);
    }
  }

  if (producedArtifacts.size > 0) {
    lines.push(
      `- Produces: ${[...producedArtifacts].sort().map((a) => `\`${a.replace("artifact:", "")}\``).join(", ")}`,
    );
    const downstream: string[] = [];
    for (const e of g.edges.filter(
      (x) => x.type === "consumes" && producedArtifacts.has(x.to),
    )) {
      downstream.push(`${e.from} ← ${e.to.replace("artifact:", "")}`);
    }
    if (downstream.length > 0) {
      lines.push(`- Downstream consumers (inferred): ${downstream.join(", ")}`);
    }
  }

  // Governing rules over the member procedures
  const memberProcIds = new Set(memberEdges.map((e) => e.to));
  const rulesForProcs = g.nodes
    .filter((n) => n.type === "rule")
    .filter((rn) =>
      memberProcIds.has(`proc:${String(rn.id).replace("rule:", "").split("__")[0]}`),
    );
  if (rulesForProcs.length > 0) {
    const enabled = rulesForProcs.filter((r) => r.enabled === true);
    const dormant = rulesForProcs.filter((r) => r.enabled !== true);
    lines.push(
      `- Governing rules: ${enabled.length} enabled, ${dormant.length} dormant/premise-locked`,
    );
    for (const r of enabled.slice(0, 8)) {
      const anchor = g.edges.find(
        (e) => e.type === "anchored_by" && e.from === r.id,
      );
      lines.push(
        `  - \`${String(r.id).replace("rule:", "")}\` action=${r.action}${anchor ? ` anchor=${anchor.to}` : ""}`,
      );
    }
  }

  lines.push("");
  console.log(lines.join("\n"));
}

function printGateBundle(g: Graph, gate: string): void {
  const lines: string[] = [];
  lines.push(`## Context bundle — gate \`${gate}\``);
  lines.push("");
  const stepToProc = new Map<string, string>();
  for (const e of g.edges.filter((e) => e.type === "step_of")) {
    stepToProc.set(e.from, e.to);
  }
  const steps = g.nodes
    .filter((n) => n.type === "step" && n.gate === gate)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (steps.length === 0) {
    lines.push(`_No steps found at gate '${gate}'._`);
    console.log(lines.join("\n"));
    return;
  }
  const procIds = new Set<string>();
  lines.push("| Procedure | Step | Agent | Skill | Output |");
  lines.push("|---|---|---|---|---|");
  for (const s of steps) {
    const procId = stepToProc.get(s.id) ?? "";
    procIds.add(procId);
    const agentE = g.edges.find((e) => e.type === "executes_agent" && e.from === s.id);
    const skillE = g.edges.find((e) => e.type === "executes_skill" && e.from === s.id);
    const prodE = g.edges.find((e) => e.type === "produces" && e.from === s.id);
    lines.push(
      `| ${procId.replace("proc:", "")} | ${s.id.split("#")[1]} | ${agentE?.to.replace("agent:", "") ?? ""} | ${skillE?.to.replace("skill:", "") ?? ""} | ${prodE?.to.replace("artifact:", "") ?? ""} |`,
    );
  }
  lines.push("");
  const rulesForProcs = g.nodes
    .filter((n) => n.type === "rule")
    .filter((rn) => procIds.has(`proc:${String(rn.id).replace("rule:", "").split("__")[0]}`));
  const enabled = rulesForProcs.filter((r) => r.enabled === true);
  lines.push(
    `Kill-criteria over these procedures: ${enabled.length} enabled / ${rulesForProcs.length - enabled.length} dormant.`,
  );
  lines.push("");
  console.log(lines.join("\n"));
}
