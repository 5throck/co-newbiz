// Process flow spec drift + integrity gate (ADR-0074, Phase 0).
// flow.spec.yaml is the Process SSOT — this test enforces its internal
// integrity, its references into the real agents/skills/procedures trees,
// the completeness of the Gate definitions, and that docs/process-flow.md
// is the up-to-date regeneration of the spec.
import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const ROOT = join(import.meta.dirname, "..", "..");
const SPEC_PATH = join(ROOT, "process", "flow.spec.yaml");

interface Gate {
  id: string;
  name: string;
  decisionCriteria: string[];
  killCriteria: string[];
  fundingDecision: string;
}
interface Activity {
  id: string;
  agent: string;
  skills: string[];
  procedure: string[];
}
interface Stage {
  id: string;
  name: string;
  objective: string;
  inputs: string[];
  outputs: string[];
  entryCriteria: string[];
  activities: Activity[];
  requiredArtifacts: string[];
  completionCriteria: string[];
  applicableTracks: string[];
  stateTransitions: { onComplete: string; onHold: string; onKill: string };
  gates: string[];
}
interface FlowSpec {
  meta: { id: string; name: string; version: string; entity_lifecycles: Record<string, string[]> };
  gates: Gate[];
  stages: Stage[];
}

let spec: FlowSpec;

beforeAll(() => {
  expect(existsSync(SPEC_PATH)).toBe(true);
  spec = yaml.load(readFileSync(SPEC_PATH, "utf8")) as FlowSpec;
});

const VALID_TRACKS = ["greenfield", "brownfield", "rbd", "venture", "ma"];

describe("process flow spec integrity (ADR-0074)", () => {
  test("stage ids are unique and S-numbered", () => {
    const ids = spec.stages.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^S\d+$/);
  });

  test("gate ids are unique and every referenced gate is defined", () => {
    const gateIds = spec.gates.map((g) => g.id);
    expect(new Set(gateIds).size).toBe(gateIds.length);
    for (const s of spec.stages) {
      for (const g of s.gates) expect(gateIds).toContain(g);
    }
  });

  test("every stage defines required artifacts and completion criteria", () => {
    for (const s of spec.stages) {
      expect(s.requiredArtifacts.length).toBeGreaterThan(0);
      expect(s.completionCriteria.length).toBeGreaterThan(0);
      expect(s.objective.length).toBeGreaterThan(0);
    }
  });

  test("state transitions reference valid stages or terminal", () => {
    const ids = new Set(spec.stages.map((s) => s.id));
    for (const s of spec.stages) {
      const t = s.stateTransitions;
      expect(t).toBeDefined();
      expect(t.onComplete === "terminal" || ids.has(t.onComplete)).toBe(true);
      expect(t.onHold === s.id || ids.has(t.onHold)).toBe(true);
      expect(t.onKill === "terminal").toBe(true);
    }
  });

  test("activity agents exist in the roster", () => {
    const agentsDir = join(ROOT, "agents");
    for (const s of spec.stages) {
      for (const a of s.activities) {
        expect(existsSync(join(agentsDir, a.agent + ".md"))).toBe(true);
      }
    }
  });

  test("activity skills exist in skills/", () => {
    const skillsDir = join(ROOT, "skills");
    for (const s of spec.stages) {
      for (const a of s.activities) {
        for (const sk of a.skills) {
          expect(existsSync(join(skillsDir, sk))).toBe(true);
        }
      }
    }
  });

  test("activity procedures exist in procedures/_shared/", () => {
    const shared = join(ROOT, "procedures", "_shared");
    for (const s of spec.stages) {
      for (const a of s.activities) {
        for (const proc of a.procedure) {
          expect(existsSync(join(shared, proc, "schema.yaml"))).toBe(true);
        }
      }
    }
  });

  test("applicable tracks are valid", () => {
    for (const s of spec.stages) {
      for (const t of s.applicableTracks) expect(VALID_TRACKS).toContain(t);
    }
  });

  test("lifecycle chains are contiguous within each entity", () => {
    for (const [entity, chain] of Object.entries(spec.meta.entity_lifecycles)) {
      for (let i = 0; i < chain.length - 1; i++) {
        const stage = spec.stages.find((s) => s.id === chain[i]);
        expect(stage?.stateTransitions.onComplete).toBe(chain[i + 1]);
        void entity;
      }
    }
  });

  test("web stage-meta mirrors the spec stages (ADR-0086 StageFrame data source)", () => {
    // app/web-next/lib/stage-meta.ts는 flow.spec의 클라이언트 안전 발췌본이다 —
    // 단계 id·이름·게이트·트랙·전이가 스펙과 일치하는지 강제한다.
    const metaPath = join(ROOT, "app", "web-next", "lib", "stage-meta.ts");
    expect(existsSync(metaPath)).toBe(true);
    const src = readFileSync(metaPath, "utf-8");
    const specStages = (spec as { stages: Array<Stage> }).stages;
    expect(specStages.length).toBe(11);
    for (const st of specStages) {
      const row = src.match(new RegExp(`id: "${st.id}", sequence: [0-9]+, name: "${st.name}"`));
      expect(row).not.toBeNull();
      const block = src.slice(src.indexOf(`id: "${st.id}",`));
      const end = block.indexOf("},");
      const body = block.slice(0, end);
      for (const g of (st.gates ?? []) as string[]) expect(body).toContain(`"${g}"`);
      const on = st.stateTransitions?.onComplete as string;
      expect(body).toContain(`onComplete: "${on}"`);
    }
  });

  test("docs/process-flow.md is the up-to-date regeneration of the spec", () => {
    // Regenerate in-memory using the same generator entry and compare.
    const genPath = join(ROOT, "scripts", "co-newbiz", "generate-process-flow.ts");
    expect(existsSync(genPath)).toBe(true);
    // Run the generator with --check (exit 0 = fresh).
    const proc = Bun.spawnSync(["bun", genPath, "--check"], { cwd: ROOT });
    expect(proc.exitCode).toBe(0);
  });
});
