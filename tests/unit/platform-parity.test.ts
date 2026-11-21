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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
        expect([
          "committee.position",
          "committee.agenda",
          "committee.minutes",
          "committee.minutes_turns",
          "committee.turn",
          "committee.consensus",
          "s8.business_case_prose",
        ]).toContain(promptKey);
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

describe("variant audit hook: generated projection drift gate (PRs #913/#936/#946)", () => {
  // docs/runbooks/** and the other projected sources drifted three times
  // (PRs #913, #936, #946) because a forgotten sync run surfaced only as a
  // RED CI coverage job after landing. The hook (audit-variant.ts v1.10.0)
  // now carries one combined blocking check over the three projection
  // generators' --check (library, wiki, glossary — the glossary gate was
  // declared in the v1.8.0 header but never wired until here), so dev-sync
  // fails locally before push. These tests pin the wiring and the drift
  // signal itself — the hook's subprocess behavior, not its internals. The
  // glossary generator's own drift behavior is pinned by
  // tests/unit/glossary-data-sync.test.ts, so the fixture drift simulation
  // stays on the library generator.
  const HOOK_PATH = join(ROOT, "scripts", "co-newbiz", "audit-variant.ts");
  const GENERATORS = [
    { script: "sync-library-projection.ts", refresh: "bun scripts/co-newbiz/sync-library-projection.ts" },
    { script: "sync-wiki-projection.ts", refresh: "bun scripts/co-newbiz/sync-wiki-projection.ts" },
    { script: "generate-glossary-data.ts", refresh: "bun scripts/co-newbiz/generate-glossary-data.ts" },
  ];

  test("the hook declares the combined drift check, registers it, and names all refresh commands", () => {
    const hook = readFileSync(HOOK_PATH, "utf-8");
    expect(hook).toContain("Generated projection drift");
    // Registered, not just declared — a gate that is documented in the header
    // but never invoked would pass here and block nothing (exactly the
    // v1.8.0 glossary header rot).
    expect(hook).toContain("runProjectionDriftGate()");
    for (const g of GENERATORS) {
      expect(hook).toContain(`scripts/co-newbiz/${g.script}`);
      expect(hook).toContain(`"--check"`);
      expect(hook).toContain(g.refresh);
    }
  });

  test("fresh tree: both projections pass --check through the gate's subprocesses", () => {
    for (const g of GENERATORS) {
      const proc = Bun.spawnSync(["bun", join(ROOT, "scripts", "co-newbiz", g.script), "--check"], {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (proc.exitCode !== 0) console.error(new TextDecoder().decode(proc.stderr));
      expect(proc.exitCode, `${g.script} --check on a fresh tree`).toBe(0);
    }
  });

  test("simulated drift in a fixture temp tree fails --check and names the refresh command", () => {
    // The generators read fixed repo-relative paths, so drift is simulated in
    // a fixture tree that mirrors the generator's layout: a copy of the REAL
    // generator (the exact script the hook spawns) plus a projected file
    // whose content is regenerated from a fixture source. The fixture lives
    // outside the repo — no tracked file is touched — with node_modules
    // symlinked so the copied generator resolves bare imports (js-yaml).
    const fixtureRoot = mkdtempSync(join(tmpdir(), "co-newbiz-projection-drift-"));
    try {
      symlinkSync(join(ROOT, "node_modules"), join(fixtureRoot, "node_modules"), "dir");
      mkdirSync(join(fixtureRoot, "scripts", "co-newbiz"), { recursive: true });
      mkdirSync(join(fixtureRoot, "app", "web-next", "lib"), { recursive: true });
      mkdirSync(join(fixtureRoot, "docs"), { recursive: true });

      const generatorSrc = readFileSync(join(ROOT, "scripts", "co-newbiz", "sync-library-projection.ts"), "utf-8");
      const fixtureGenerator = join(fixtureRoot, "scripts", "co-newbiz", "sync-library-projection.ts");
      writeFileSync(fixtureGenerator, generatorSrc);

      const source = join(fixtureRoot, "docs", "drift-fixture-source.md");
      const run = (args: string[]) =>
        Bun.spawnSync(["bun", fixtureGenerator, ...args], { cwd: fixtureRoot, stdout: "pipe", stderr: "pipe" });

      // Seed a source file and a projection that carries stale content for
      // it, then regenerate once so the projection is canonical.
      writeFileSync(source, "fixture source v1\n");
      writeFileSync(
        join(fixtureRoot, "app", "web-next", "lib", "library.generated.ts"),
        [
          "// fixture projection — head is preserved verbatim by the generator",
          `export const LIBRARY_DOCS = [];`,
          `export const LIBRARY_CONTENT = {`,
          `  "drift-fixture-doc": { id: "drift-fixture-doc", file: "docs/drift-fixture-source.md", content: "OUTDATED\\n" },`,
          `};`,
          `export const LIBRARY_CHECKLIST_ITEMS = {};`,
          ``,
        ].join("\n"),
      );
      expect(run([]).exitCode).toBe(0); // regenerate → "refreshed."

      // Fresh fixture: --check passes (the "fresh passes" half).
      expect(run(["--check"]).exitCode).toBe(0);

      // Edit the source WITHOUT re-syncing — exactly the PR #913/#936/#946
      // failure mode — and the drift gate must fail naming the refresh
      // command.
      writeFileSync(source, "fixture source v2 — drifted\n");
      const drifted = run(["--check"]);
      expect(drifted.exitCode).toBe(1);
      const err = new TextDecoder().decode(drifted.stderr);
      expect(err).toContain("is stale");
      expect(err).toContain(GENERATORS[0].refresh);

      // Restore the source: fresh again.
      writeFileSync(source, "fixture source v1\n");
      expect(run(["--check"]).exitCode).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
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
