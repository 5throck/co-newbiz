// Process flow spec drift + integrity gate (ADR-0074, Phase 0).
// flow.spec.yaml is the Process SSOT — this test enforces its internal
// integrity, its references into the real agents/skills/procedures trees,
// the completeness of the Gate definitions, and that docs/process-flow.md
// is the up-to-date regeneration of the spec.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
      "capability-dd:brownfield-agent", // 2026-10-20 (v2.10.0, design 2026-10-19-brownfield-capability-dd): brownfield-only
      // 2026-10-26 (ADR-0185 W1): the six M&A validators + ip-fto are stage-level brownfield-only activities
      "antitrust-dd:antitrust-agent",
      "region-labor-review:region-lead",
      "customer-retention-dd:customer-retention-agent",
      "incentive-dd:incentive-agent",
      "contingent-liability-dd:valuation-agent",
      "certification-transferability-dd:legal-counsel",
      "ip-fto-dd:ip-agent",
    ]);
    for (const a of s9.activities) {
      if (a.id === "capability-dd" || a.id === "ip-fto-dd" || /^(antitrust-dd|region-labor-review|customer-retention-dd|incentive-dd|contingent-liability-dd|certification-transferability-dd)$/.test(a.id)) { expect(a.procedure).toEqual(["brownfield-dd"]); continue; } // brownfield-only (greenfield answers capability at S5)
      expect(a.procedure).toEqual(["greenfield-dd", "brownfield-dd"]);
    }
    const skillsOf = (id: string) => s9.activities.find((a) => a.id === id)!.skills;
    expect(skillsOf("financial-dd")).toEqual(["quality-of-earnings", "historical-financial-analysis", "dd-to-valuation-bridge"]);
    expect(skillsOf("hr-dd")).toEqual(["org-readiness-assessment", "talent-pipeline-planning", "management-incentive-review", "compensation-harmonization-analysis"]); // ADR-0185 F-11
    expect(skillsOf("market-dd")).toEqual(["competitive-intelligence"]);
    expect(skillsOf("financing-dd")).toEqual(["financing-plan-review"]); // ADR-0185 F-11
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
    expect([gx.agent, gx.skills, gx.procedure]).toEqual(["greenfield-agent", ["greenfield-feasibility", "talent-pipeline-planning", "certification-roadmap", "financing-plan-review", "incentive-clawback-assessment"], ["greenfield-execution-baseline"]]);
    expect(act("S12").map((a) => `${a.id}:${a.agent}:${a.procedure.join(",")}`)).toEqual([
      "portfolio-monitoring:group-review-agent:portfolio-venture-monitoring",
      "integration-monitoring:pmi-agent:pmi-integration-execution",
      "partnership-monitoring:partnership-agent:jv-lifecycle-governance",
    ]);
    // Activity-level applicableTracks is not supported (ADR-0160 follow-up, ADR-0161 §5.5).
    for (const s of spec.stages) for (const a of s.activities) expect((a as unknown as Record<string, unknown>).applicableTracks).toBeUndefined();
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
    // 단계 id·이름·게이트·트랙·전이가 스펙과 일치하는지 강제한다. 게이트는
    // "포함"이 아닌 정확 일치로, applicableTracks도 정확 일치로 단언한다 —
    // 여분 게이트나 트랙 드리프트를 통과시키지 않기 위해서다 (deal-overview의
    // findNextGate가 stage-meta applicableTracks로 다음 게이트를 골라내는
    // load-bearing 값이므로, review 2026-10-22 script-gap M4의 래칫).
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
      const gatesField = body.match(/gateIds: \[([^\]]*)\]/)?.[1] ?? "";
      const gateIds = [...gatesField.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
      expect(gateIds).toEqual((st.gates ?? []) as string[]);
      const tracksField = body.match(/applicableTracks: \[([^\]]*)\]/)?.[1] ?? "";
      const tracks = [...tracksField.matchAll(/"(greenfield|brownfield)"/g)].map((m) => m[1]!);
      expect([...tracks].sort()).toEqual([...(st.applicableTracks as string[])].sort());
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
    // makes drift loud. Version string, every stage's activity list
    // (id·agent·skills·procedure, in order) and, since design
    // 2026-10-25-agent-assignment-prompt-standard §6.1, the stage name and
    // applicableTracks must match exactly.
    const gen = require(join(ROOT, "app", "web-next", "lib", "spec-activities.generated.ts")) as {
      SPEC_VERSION: string;
      SPEC_STAGES: Array<{ id: string; name: string; applicableTracks: string[]; activities: Array<{ id: string; agent: string; skills: string[]; procedure: string[] }> }>;
    };
    expect(gen.SPEC_VERSION).toBe(spec.meta.version);
    expect(gen.SPEC_STAGES.map((s) => s.id)).toEqual(spec.stages.map((s) => s.id));
    for (const sp of spec.stages) {
      const g = gen.SPEC_STAGES.find((s) => s.id === sp.id)!;
      expect(g.name).toBe(sp.name);
      expect(g.applicableTracks).toEqual(sp.applicableTracks);
      expect(g.activities).toEqual(sp.activities.map((a) => ({ id: a.id, agent: a.agent, skills: a.skills, procedure: a.procedure })));
    }
  });

  test("S8 subjectScope declares per-subject repetition with a closed vocabulary (v2.5.0, ADR-0143)", () => {
    // The machine-readable repetition declaration must not drift: a renamed
    // key or out-of-vocabulary value would silently turn the ADR-0143
    // per-target contract into dead prose (review 2026-09-22, script-gap).
    const allowed = ["single", "shortlist"];
    for (const stage of spec.stages as unknown as Array<Record<string, unknown>>) {
      if (!("subjectScope" in stage)) continue;
      const scope = stage.subjectScope as Record<string, unknown>;
      expect(Object.keys(scope).sort()).toEqual([...Object.keys(scope)].sort());
      for (const value of Object.values(scope)) expect(allowed).toContain(value);
    }
    const s8 = (spec.stages as unknown as Array<Record<string, unknown>>).find((s) => s.id === "S8")!;
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

// ── Engine behavior against a real scratch SQLite (review 2026-10-22) ──────
// Two fixes are exercised here through evaluateProcess and the full demo
// seeds (both tracks, structurally complete S1–S12):
//  - T-001: the S12 venture-scorecard demand is keyed on the track —
//    greenfield only (the sole track with a sanctioned write path and
//    portfolio-venture-monitoring applicability); brownfield treats a cycle
//    as optional but still requires the paired transition decision.
//  - T-014: ProcessEvaluation.carrierScopeFinished marks the un-promoted
//    opportunity whose S1–S7 carrier scope is done (its currentStage
//    otherwise misreads as the project-carrier stage S8).
const TEST_DB_PATH = "db/data/test-process-flow.sqlite";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { evaluateProcess } = await import("../../app/web-next/lib/process-flow.ts");
const { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } = await import("../../scripts/co-newbiz/seed-s1-s12-demo.ts");
const { trancheReconciliation, trancheSnapshotHash } = await import("../../app/web-next/lib/greenfield-execution.ts");
const { ulid } = await import("../../db/lib/ulid.ts");

const NOW = new Date().toISOString();

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

describe("opportunity carrier scope marker (review 2026-10-22, T-014)", () => {
  test("settled un-promoted greenfield opportunity: carrierScopeFinished true even though currentStage misreads S8", async () => {
    const gf = await seedGreenfieldS1ToS12Demo();
    db.run("UPDATE opportunity SET project_id = NULL WHERE id = ?", [gf.opportunityId]);
    const ev = evaluateProcess({ type: "opportunity", id: gf.opportunityId });
    // The ambiguity the marker disambiguates: the opportunity loop walks all
    // 12 stages, its default predicate leaves the project-carrier stage S8
    // "current" with no blockers, and nextStage advances to S9 — the S8–S12
    // work does not belong to this carrier (ADR-0095).
    expect(ev.track).toBe("greenfield");
    expect(ev.currentStage).toBe("S8");
    expect(ev.nextStage).toBe("S9");
    expect(ev.blockers).toEqual([]);
    expect(ev.projectId).toBeNull();
    expect(ev.carrierScopeFinished).toBe(true);
    db.run("UPDATE opportunity SET project_id = ? WHERE id = ?", [gf.projectId, gf.opportunityId]);
  });

  test("promoted opportunity: marker false — the project is the carrier now", async () => {
    const gf = await seedGreenfieldS1ToS12Demo();
    const ev = evaluateProcess({ type: "opportunity", id: gf.opportunityId });
    expect(ev.projectId).not.toBeNull();
    expect(ev.carrierScopeFinished).toBe(false);
  });

  test("mid-flight opportunity (no track, S1 incomplete): marker false", () => {
    const id = ulid();
    db.run(
      "INSERT INTO opportunity (id, name, market_scope, status, created_by, created_at) VALUES (?,?,?,?,?,?)",
      [id, "마커 테스트 기회", "마커 테스트 산업", "identified", "tester", NOW],
    );
    const ev = evaluateProcess({ type: "opportunity", id });
    expect(ev.currentStage).toBe("S1");
    expect(ev.track).toBeNull();
    expect(ev.carrierScopeFinished).toBe(false);
  });

  test("project entities never carry the marker", () => {
    const bf = seedS1ToS12Demo();
    const ev = evaluateProcess({ type: "project", id: bf.projectId });
    expect(ev.carrierScopeFinished).toBe(false);
  });
});

describe("S12 scorecard demand keyed on track (review 2026-10-22, T-001)", () => {
  test("brownfield demo completes S12 with its seeded cycle + transition decision (no regression)", () => {
    const bf = seedS1ToS12Demo();
    const ev = evaluateProcess({ type: "project", id: bf.projectId });
    expect(ev.completedStages).toContain("S12");
    expect(ev.currentStage).toBeNull();
  });

  test("brownfield with NO scorecard completes S12 — the cycle is optional off-greenfield", () => {
    const bf = seedS1ToS12Demo();
    db.run("DELETE FROM venture_scorecard WHERE project_id = ?", [bf.projectId]);
    const ev = evaluateProcess({ type: "project", id: bf.projectId });
    expect(ev.currentStage).toBeNull();
    expect(ev.completedStages).toContain("S12");
    expect(ev.blockers).toEqual([]);
  });

  test("brownfield WITH a recorded cycle still requires the paired human transition decision", () => {
    const bf = seedS1ToS12Demo();
    db.run("DELETE FROM venture_transition_decision WHERE project_id = ?", [bf.projectId]);
    const ev = evaluateProcess({ type: "project", id: bf.projectId });
    expect(ev.completedStages).not.toContain("S12");
    expect(ev.currentStage).toBe("S12");
    expect(ev.blockers.join("\n")).toContain("사람 전환 결정 기록이 필요합니다");
  });

  test("greenfield is NOT weakened: without a scorecard S12 stays blocked on the artifact", async () => {
    const gf = await seedGreenfieldS1ToS12Demo();
    db.run("DELETE FROM venture_scorecard WHERE project_id = ?", [gf.projectId]);
    // The greenfield twin leaves S11's establishment execution and the
    // execution-baseline human confirmation un-seeded — complete both so S12
    // is the current stage and its blockers actually surface.
    db.run("UPDATE md_project SET establishment_mode = 'new_entity' WHERE id = ?", [gf.projectId]);
    for (const n of [1, 2, 3, 4, 5]) {
      db.run(
        `INSERT OR IGNORE INTO entity_establishment_step (id, opportunity_id, step_no, status, mode, origin, checklist_item, owner, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [`t-gf-est-${n}`, gf.opportunityId, n, "done", "new_entity", "internal", `ef-0${n}`, "tester", NOW],
      );
    }
    const rec = db.run(
      `INSERT INTO process_run (id, entity_type, entity_id, project_id, spec_version, stage, status, started_by, started_at, meta_json)
       VALUES ('t-gf-baseline', 'project', ?, ?, 'test', 's11_execution_baseline', 'done', 'tester', ?, ?)`,
      [
        gf.projectId,
        gf.projectId,
        NOW,
        JSON.stringify({
          entries: {},
          confirmation: { rationale: "테스트 픽스처 실행 기준선 확인", tranche_hash: trancheSnapshotHash(trancheReconciliation(gf.projectId, db)) },
        }),
      ],
    );
    expect(rec.changes).toBe(1);
    const ev = evaluateProcess({ type: "project", id: gf.projectId });
    expect(ev.completedStages).toContain("S11");
    expect(ev.completedStages).not.toContain("S12");
    expect(ev.currentStage).toBe("S12");
    expect(ev.blockers.join("\n")).toContain("벤처 스코어카드가 필요합니다");
  });
});
