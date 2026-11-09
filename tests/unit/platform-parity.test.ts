// Full-platform harness↔runtime parity guards (ADR-0183 D3, design
// 2026-09-15-runtime-pm-agent-orchestration §6.4). The 7 harness platforms
// (claude, gemini, antigravity, gemini-cli, codex, hermes, zai) each consume
// the agents/*.md SSOT their own way; the web runtime derives its agent data
// from the SAME SSOT as the 8th consumer via generated projections. These
// tests prove all 8 consumers stay in lockstep:
//   (a) agent-registry.generated.ts mirrors agents/*.md frontmatter exactly
//       (key/name/role/domain) — plus the generator --check drift gate,
//       following the process-flow.test.ts idiom for generated projections;
//   (b) pm-catalog.generated.ts agentKeys resolve in the roster
//       (also asserted in tests/unit/pm-catalog.test.ts — re-asserted here so
//       the parity suite is self-contained; single source: the generated file);
//   (c) every flow.spec activity agent exists in the runtime roster — the
//       roster-set extension of process-flow.test.ts:90-97's filesystem check
//       (design §6.9), not a duplicate of it;
//   (d) the 7-platform list in validate-model-registry.ts matches the
//       docs/workspace-schema.json models block (the script source is the
//       single source — extracted by regex, never hardcoded here).
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { AGENT_REGISTRY, AGENT_KEYS } from "../../app/web-next/lib/agent-registry.generated.ts";
import { PM_CATALOG } from "../../app/web-next/lib/pm-catalog.generated.ts";

const ROOT = join(import.meta.dirname, "..", "..");

// Frontmatter parsing mirrors scripts/co-newbiz/generate-agent-registry.ts
// exactly (top-level word keys only, quotes stripped, CRLF normalized) so the
// test compares the projection against the same derivation the generator does.
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

function expectedRoster(): Map<string, { name: string; role: string; domain: string | null }> {
  const roster = new Map<string, { name: string; role: string; domain: string | null }>();
  for (const f of readdirSync(join(ROOT, "agents"))) {
    const fm = parseScalarFrontmatter(readFileSync(join(ROOT, "agents", f), "utf-8"));
    if (!fm.name) continue;
    roster.set(fm.name, {
      name: fm.formal_name ?? fm.name,
      role: fm.role ?? "",
      domain: fm.domain ?? null,
    });
  }
  return roster;
}

describe("platform parity: agent-registry.generated.ts vs agents/*.md (ADR-0183 D3)", () => {
  test("generated file is the up-to-date regeneration of the roster (generator --check is clean)", () => {
    // Same drift-gate idiom as process-flow.test.ts's generate-process-flow /
    // generate-spec-activities checks and pm-catalog.test.ts's catalog check.
    const proc = Bun.spawnSync(["bun", join(ROOT, "scripts", "co-newbiz", "generate-agent-registry.ts"), "--check"], {
      cwd: ROOT,
    });
    if (proc.exitCode !== 0) {
      console.error(new TextDecoder().decode(proc.stderr));
    }
    expect(proc.exitCode).toBe(0);
  });

  test("projected keys and per-entry name/role/domain mirror the frontmatter exactly", () => {
    const roster = expectedRoster();
    expect(AGENT_REGISTRY.length).toBe(roster.size);
    for (const entry of AGENT_REGISTRY) {
      const expected = roster.get(entry.key);
      expect(expected, entry.key).toBeDefined();
      if (!expected) continue;
      expect(entry.name).toBe(expected.name);
      expect(entry.role).toBe(expected.role);
      expect(entry.domain).toBe(expected.domain);
    }
    for (const key of roster.keys()) {
      expect(AGENT_KEYS.has(key)).toBeTrue();
    }
  });
});

describe("platform parity: pm-catalog.generated.ts vs the roster (ADR-0183 D3)", () => {
  test("every non-null catalog agentKey exists in the runtime roster", () => {
    for (const [promptKey, entry] of Object.entries(PM_CATALOG)) {
      if (entry.agentKey !== null) {
        expect(AGENT_KEYS.has(entry.agentKey)).toBeTrue();
      } else {
        // Dynamic entries are allowed only as the explicitly-known agent=null pairs
        // (committee.position seats the agent at call time; ADR-0196 phase B adds
        // the chair passes, which seat the process-governance-manager chair voice).
        expect(["committee.position", "committee.agenda", "committee.minutes", "s8.business_case_prose"]).toContain(
          promptKey,
        );
      }
    }
  });
});

describe("platform parity: flow.spec activities vs the runtime roster (design §6.9)", () => {
  test("every flow.spec activity agent exists in the runtime roster", () => {
    // process-flow.test.ts:90-97 checks the filesystem side (agents/<key>.md
    // exists); this extends the same cross-validation to the runtime
    // projection so a flow.spec edit cannot outrun the generated roster.
    const spec = yamlLoad(readFileSync(join(ROOT, "process", "flow.spec.yaml"), "utf8")) as {
      stages: Array<{ activities: Array<{ agent: string }> }>;
    };
    const activityAgents = spec.stages.flatMap((s) => s.activities.map((a) => a.agent));
    expect(activityAgents.length).toBeGreaterThan(0);
    for (const agent of activityAgents) {
      expect(AGENT_KEYS.has(agent)).toBeTrue();
    }
  });
});

describe("platform parity: variant audit hook wiring (ADR-0183 D3)", () => {
  test("variant.json declares the audit-variant hook and the declared path exists", () => {
    // The runtime projection drift gates (agent-registry --check, pm-catalog
    // --check) live in the pluggable variant audit hook, NOT in core
    // scripts/audit.ts — audit.ts is a core script that must stay identical
    // to templates/common (Core Script Standardization). This pins the
    // corrected wiring: variant.json → script_manifest.local must declare
    // 'audit-variant' and the declared path must resolve (an undeclared or
    // dangling declaration makes audit.ts §27 skip/warn and the gates go dark).
    const manifest = JSON.parse(readFileSync(join(ROOT, "variant.json"), "utf-8")) as {
      script_manifest?: { local?: Array<{ name?: string; path?: string }> };
    };
    const declared = (manifest.script_manifest?.local ?? []).filter(
      (e): e is { name: string; path: string } =>
        e?.name === "audit-variant" && typeof e.path === "string" && e.path !== "",
    );
    expect(declared.length).toBe(1);
    expect(readFileSync(join(ROOT, declared[0].path), "utf-8")).toContain("@version");
  });
});

describe("platform parity: validate-model-registry.ts PLATFORMS vs workspace-schema.json models (ADR-0183 D3)", () => {
  test("the 8-platform list matches the models registry block exactly (both directions)", () => {
    // The script source is the single source for the platform list — extract
    // it instead of hardcoding a second copy here.
    const src = readFileSync(join(ROOT, "scripts", "validate-model-registry.ts"), "utf-8");
    const m = src.match(/const PLATFORMS = \[([^\]]+)\] as const/);
    expect(m).not.toBeNull();
    if (!m) return;
    const scriptPlatforms = (m[1]?.match(/"([^"]+)"/g) ?? []).map((s) => s.replaceAll('"', ""));

    const schema = JSON.parse(readFileSync(join(ROOT, "docs", "workspace-schema.json"), "utf-8")) as {
      models?: Record<string, unknown>;
    };
    expect(schema.models).toBeDefined();
    if (!schema.models) return;
    const schemaPlatforms = Object.keys(schema.models);

    expect([...scriptPlatforms].sort()).toEqual([...schemaPlatforms].sort());
    // The known harness count is a floor guard: if a platform joins the list
    // without a registry entry (or vice versa) the equality above already
    // fails — this pins the design's "8 platforms" vocabulary so a silent
    // single-platform addition is a conscious test change. 8th entry `zcode`
    // joined via template 0.26.0 (2026-11-01 upgrade delivery).
    expect(scriptPlatforms.length).toBe(8);
  });
});
