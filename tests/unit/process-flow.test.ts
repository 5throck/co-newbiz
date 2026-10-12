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

  test("S9 dispatches every ADR-0148 DD domain as a stage-level activity (v2.7.0, ADR-0160 addendum c)", () => {
    const s9 = spec.stages.find((s) => s.id === "S9")!;
    expect(s9.activities.map((a) => `${a.id}:${a.agent}`)).toEqual([
      "commercial-dd:commercial-dd-agent",
      "technical-dd:technical-dd-agent",
      "legal-dd:legal-counsel",
      "financial-dd:financial-analyst",
      "hr-dd:hr-integration-agent",
      "market-dd:market-intelligence-agent",
      "financing-dd:financing-agent",
      "dd-waiver-review:compliance-officer",
    ]);
    for (const a of s9.activities) expect(a.procedure).toEqual(["greenfield-dd", "brownfield-dd"]);
    const skillsOf = (id: string) => s9.activities.find((a) => a.id === id)!.skills;
    expect(skillsOf("financial-dd")).toEqual(["quality-of-earnings", "historical-financial-analysis"]);
    expect(skillsOf("hr-dd")).toEqual(["org-readiness-assessment", "talent-pipeline-planning"]);
    expect(skillsOf("market-dd")).toEqual(["competitive-intelligence"]);
    expect(skillsOf("financing-dd")).toEqual([]);
  });

  test("S11/S12 track-scoped execution and monitoring activities (v2.8.0, ADR-0161)", () => {
    const act = (stage: string) => spec.stages.find((s) => s.id === stage)!.activities;
    expect(act("S11").map((a) => a.id)).toEqual([
      "ic-preparation", "charter-baseline", "investment-structuring", "risk-review", "group-review",
      "entity-establishment-execution", "pmi-kickoff", "greenfield-execution-baseline",
    ]);
    // Q6: one activity id, owner unchanged; the greenfield owner lives in entity-ic-review step 3.1.
    expect(act("S11").find((a) => a.id === "investment-structuring")!.agent).toBe("brownfield-agent");
    const gx = act("S11").find((a) => a.id === "greenfield-execution-baseline")!;
    expect([gx.agent, gx.skills, gx.procedure]).toEqual(["greenfield-agent", [], ["greenfield-execution-baseline"]]);
    expect(act("S12").map((a) => `${a.id}:${a.agent}:${a.procedure.join(",")}`)).toEqual([
      "portfolio-monitoring:group-review-agent:portfolio-venture-monitoring",
      "integration-monitoring:pmi-agent:pmi-integration-execution",
      "partnership-monitoring:partnership-agent:jv-lifecycle-governance",
    ]);
    // Activity-level applicableTracks is not supported (ADR-0160 follow-up, ADR-0161 §5.5).
    for (const s of spec.stages) for (const a of s.activities) expect((a as Record<string, unknown>).applicableTracks).toBeUndefined();
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
    expect(specStages.length).toBe(12);
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

  test("web process-flow STAGES mirrors the spec verbatim (engine data source)", () => {
    // app/web-next/lib/process-flow.ts의 STAGES는 완료 술어·프로세스 API의
    // 데이터원이다. id·순서·이름·목표·게이트·필수산출물이 스펙과 문자열 단위로
    // 일치하는지 강제한다 (applicableTracks는 엔진 정규화 ["all"] == [gf, bf]).
    const { STAGES } = require(join(ROOT, "app", "web-next", "lib", "process-flow.ts")) as {
      STAGES: Array<{ id: string; name: string; sequence: number; objective: string; applicableTracks: string[]; gateIds: string[]; requiredArtifacts: string[] }>;
    };
    expect(STAGES.length).toBe(spec.stages.length);
    for (let i = 0; i < spec.stages.length; i++) {
      const sp = spec.stages[i];
      const co = STAGES[i];
      expect(co.id).toBe(sp.id);
      expect(co.sequence).toBe(i + 1);
      expect(co.name).toBe(sp.name);
      expect(co.objective).toBe(sp.objective);
      expect(co.gateIds).toEqual(sp.gates);
      const normalizedTracks = co.applicableTracks.includes("all") ? ["greenfield", "brownfield"] : co.applicableTracks;
      expect([...normalizedTracks].sort()).toEqual([...sp.applicableTracks].sort());
      expect(co.requiredArtifacts).toEqual(sp.requiredArtifacts);
    }
  });

  test("spec-activities.generated.ts mirrors the spec (loader projection)", () => {
    // The generated projection is hand-regenerated from the YAML — this gate
    // makes drift loud. Version string and every stage's activity list
    // (id·agent·skills·procedure, in order) must match exactly.
    const gen = require(join(ROOT, "app", "web-next", "lib", "spec-activities.generated.ts")) as {
      SPEC_VERSION: string;
      SPEC_STAGES: Array<{ id: string; activities: Array<{ id: string; agent: string; skills: string[]; procedure: string[] }> }>;
    };
    expect(gen.SPEC_VERSION).toBe(spec.meta.version);
    expect(gen.SPEC_STAGES.map((s) => s.id)).toEqual(spec.stages.map((s) => s.id));
    for (const sp of spec.stages) {
      const g = gen.SPEC_STAGES.find((s) => s.id === sp.id)!;
      expect(g.activities).toEqual(sp.activities.map((a) => ({ id: a.id, agent: a.agent, skills: a.skills, procedure: a.procedure })));
    }
  });

  test("S8 subjectScope declares per-subject repetition with a closed vocabulary (v2.5.0, ADR-0143)", () => {
    // The machine-readable repetition declaration must not drift: a renamed
    // key or out-of-vocabulary value would silently turn the ADR-0143
    // per-target contract into dead prose (review 2026-09-22, script-gap).
    const allowed = ["single", "shortlist"];
    for (const stage of spec.stages as Array<Record<string, unknown>>) {
      if (!("subjectScope" in stage)) continue;
      const scope = stage.subjectScope as Record<string, unknown>;
      expect(Object.keys(scope).sort()).toEqual([...Object.keys(scope)].sort());
      for (const value of Object.values(scope)) expect(allowed).toContain(value);
    }
    const s8 = (spec.stages as Array<Record<string, unknown>>).find((s) => s.id === "S8")!;
    expect(s8.subjectScope).toEqual({ greenfield: "single", brownfield: "shortlist" });
  });

  test("docs/process-flow.md is the up-to-date regeneration of the spec", () => {
    // Regenerate in-memory using the same generator entry and compare.
    const genPath = join(ROOT, "scripts", "co-newbiz", "generate-process-flow.ts");
    expect(existsSync(genPath)).toBe(true);
    // Run the generator with --check (exit 0 = fresh).
    const proc = Bun.spawnSync(["bun", genPath, "--check"], { cwd: ROOT });
    expect(proc.exitCode).toBe(0);
  });

  test("spec-activities.generated.ts is the up-to-date regeneration of the spec", () => {
    // Same drift gate as docs/process-flow.md above: the generator's --check
    // mode exits 0 only when the projection matches the current spec.
    const genPath = join(ROOT, "scripts", "co-newbiz", "generate-spec-activities.ts");
    expect(existsSync(genPath)).toBe(true);
    const proc = Bun.spawnSync(["bun", genPath, "--check"], { cwd: ROOT });
    expect(proc.exitCode).toBe(0);
  });
});
