// PM 활동 카탈로그 무결성 (ADR-0183 D1) — 생성물(pm-catalog.generated.ts)이
// 3 SSOT(prompts.json × flow.spec.yaml × agents/*.md)와 계속 일치하는지
// 기계적으로 지킨다. generate-spec-activities의 mirrors-spec 검증과 동일 규율:
// 드리프트는 제너레이터 --check 실행으로 판정한다 (mcp-prompts.test.ts 패턴).
// design 2026-10-25-agent-assignment-prompt-standard §4.2/§11.3 (DEC-20261025-01/02):
//  - 프롬프트 agent = 활동 agent 규칙(문서화된 DUAL_ASSIGNMENTS 예외만 허용),
//  - SPECIALIST_TRACK_AFFINITY 4항목 집합·판정 기록·kind 분포,
//  - 제너레이터 die 경로(합성 불일치에서 exit 1)를 서브프로세스로 검증한다.
import { describe, expect, test, afterAll } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import {
  PM_CATALOG,
  DYNAMIC_AGENT_PROMPTS,
  CATALOG_VERSION,
  SPEC_VERSION,
  DUAL_ASSIGNMENTS,
  SPECIALIST_TRACK_AFFINITY,
} from "../../app/web-next/lib/pm-catalog.generated.ts";
import { PROMPTS } from "../../app/web-next/lib/prompts.generated.ts";
import { AGENT_REGISTRY } from "../../app/web-next/lib/agent-registry.generated.ts";
import { SPEC_STAGES } from "../../app/web-next/lib/spec-activities.generated.ts";

const ROOT = join(import.meta.dirname, "..", "..");

// flow.spec.yaml 원문 — applicableTracks는 spec-activities.generated.ts 투영에
// 없으므로 단계 트랙 범위 검증만 YAML에서 직접 읽는다.
const specStages = (yamlLoad(readFileSync(join(ROOT, "process", "flow.spec.yaml"), "utf8")) as {
  stages: Array<{ id: string; activities: Array<{ id: string; agent: string }>; applicableTracks?: string[] }>;
}).stages;

describe("pm catalog (ADR-0183 D1)", () => {
  test("generated file is in sync with the SSOTs (generator --check is clean)", () => {
    const proc = Bun.spawnSync(["bun", join(ROOT, "scripts", "co-newbiz", "generate-pm-catalog.ts"), "--check"], { cwd: ROOT });
    if (proc.exitCode !== 0) {
      console.error(new TextDecoder().decode(proc.stderr));
    }
    expect(proc.exitCode).toBe(0);
  });

  test("catalog covers every prompt key and mirrors the prompt registry metadata", () => {
    expect(Object.keys(PM_CATALOG).sort()).toEqual(Object.keys(PROMPTS).sort());
    for (const [key, entry] of Object.entries(PM_CATALOG)) {
      expect(entry.promptKey as string).toBe(key);
      expect(entry.agentKey).toBe(PROMPTS[key as keyof typeof PROMPTS].agent);
      expect(entry.purpose).toBe(PROMPTS[key as keyof typeof PROMPTS].purpose);
    }
  });

  test("every non-null catalog agentKey exists in the agents/ roster", () => {
    const roster = new Set(AGENT_REGISTRY.map((a) => a.key));
    for (const entry of Object.values(PM_CATALOG)) {
      if (entry.agentKey !== null) expect(roster.has(entry.agentKey)).toBeTrue();
    }
  });

  test("dynamic entries are exactly the two known agent=null prompts", () => {
    const nullAgentKeys = Object.values(PM_CATALOG).filter((e) => e.agentKey === null).map((e) => e.promptKey).sort();
    expect(nullAgentKeys).toEqual(["committee.position", "s8.business_case_prose"]);
    expect([...DYNAMIC_AGENT_PROMPTS].sort()).toEqual(nullAgentKeys);
  });

  test("activity mappings resolve to real flow.spec activities with a matching agent and track scope", () => {
    const roster = new Set(AGENT_REGISTRY.map((a) => a.key));
    for (const entry of Object.values(PM_CATALOG)) {
      if (entry.activityId === null) {
        expect(entry.stageId).toBeNull();
        expect(entry.trackScope).toEqual([]);
        continue;
      }
      const stage = specStages.find((s) => s.id === entry.stageId);
      expect(stage).toBeDefined();
      const activity = stage!.activities?.find((a) => a.id === entry.activityId);
      expect(activity).toBeDefined();
      // 활동 에이전트는 로스터에 있어야 한다 — 프롬프트 에이전트 일치는 아래
      // 전용 테스트(D2 규칙)가 검증한다.
      expect(roster.has(activity!.agent)).toBeTrue();
      // trackScope는 단계 applicableTracks의 결정론 투영이다.
      expect(entry.trackScope).toEqual(stage!.applicableTracks ?? []);
    }
  });

  test("prompt agent equals the spec activity agent unless dual-assigned (D2)", () => {
    // flow.spec이 지배한다(프로세스 권위 위계) — 프롬프트 agent ≠ 활동 agent는
    // DUAL_ASSIGNMENTS의 (promptKey, activity) 쌍으로만 허용된다. 기존의
    // "다를 수 있지만(보조 관점)" 허용 주석은 이 테스트로 대체되었다(허용 →
    // 문서화된 예외 목록으로만 허용).
    const dual = new Set(DUAL_ASSIGNMENTS.map((d) => `${d.promptKey}\u0000${d.activity}`));
    for (const entry of Object.values(PM_CATALOG)) {
      if (entry.activityId === null || entry.agentKey === null) continue;
      const stage = specStages.find((s) => s.id === entry.stageId);
      expect(stage).toBeDefined();
      const activity = stage!.activities?.find((a) => a.id === entry.activityId);
      expect(activity).toBeDefined();
      const specRef = `${entry.stageId}.${entry.activityId}`;
      if (!dual.has(`${entry.promptKey}\u0000${specRef}`)) {
        expect(entry.agentKey).toBe(activity!.agent);
      }
    }
    // 유일한 이중 배정은 실제로 어긋난다 — 예외가 유명무실하지 않음을 보장.
    const insight = PM_CATALOG["s11.integrated_insight"];
    const icOwner = specStages.find((s) => s.id === "S11")!.activities?.find((a) => a.id === "ic-preparation")!.agent;
    expect(insight.agentKey).not.toBe(icOwner);
  });

  test("dual assignments are exactly the documented set with rationales", () => {
    expect(DUAL_ASSIGNMENTS.map((d) => d.promptKey as string)).toEqual(["s3.synergy_fa", "s11.integrated_insight", "s3.attractiveness_recommendation", "company_profile.competitor_web_search", "s12.milestone_suggest"]); // ADR-0185; s3.synergy_fa left the set under ADR-0187 D6 and returned under D6' (2026-10-28) as financial-analyst's quantification support lens on the market-intelligence-agent-led synergy-analysis
    for (const d of DUAL_ASSIGNMENTS) {
      expect(d.rationale.trim().length).toBeGreaterThan(0);
      expect(d.activity).toMatch(/^S\d+\.[a-z-]+$/);
      const stage = specStages.find((s) => s.id === "S11");
      expect(stage!.activities?.some((a) => a.id === "ic-preparation")).toBeTrue();
    }
  });

  test("specialist track affinity is exactly the four DEC-20261025-02 sites and passes the die rules", () => {
    // DEC-20261025-02 §11.3 — 배열은 스펙 위의 엄격한 주석 계층이다: ref 실재,
    // 활동 agent 일치, 트랙 전문가 로스터, 양트랙 공통 단계, note·decision 공백 금지.
    expect(SPECIALIST_TRACK_AFFINITY.length).toBe(4);
    expect([...new Set(SPECIALIST_TRACK_AFFINITY.map((e) => e.ref))].sort()).toEqual(
      ["S2.business-model-sketch", "S4.deal-shape-evaluation", "S9.capability-dd", "S11.investment-structuring"].sort(),
    );
    for (const e of SPECIALIST_TRACK_AFFINITY) {
      const dot = e.ref.indexOf(".");
      const stage = specStages.find((s) => s.id === e.ref.slice(0, dot));
      expect(stage).toBeDefined();
      const activity = stage!.activities?.find((a) => a.id === e.ref.slice(dot + 1));
      expect(activity).toBeDefined();
      expect(activity!.agent).toBe(e.agent);
      expect(["greenfield-agent", "brownfield-agent"]).toContain(e.agent);
      expect([...(stage!.applicableTracks ?? [])].sort()).toEqual(["brownfield", "greenfield"]);
      expect(e.note.trim().length).toBeGreaterThan(0);
      expect(e.decision.trim().length).toBeGreaterThan(0);
    }
  });

  test("every specialist affinity entry cites DEC-20261025-02", () => {
    for (const e of SPECIALIST_TRACK_AFFINITY) expect(e.decision).toBe("DEC-20261025-02");
  });

  test("specialist affinity kinds are 2 affinity + 1 scoped + 1 override", () => {
    const counts = { affinity: 0, scoped: 0, override: 0 };
    for (const e of SPECIALIST_TRACK_AFFINITY) counts[e.kind] += 1;
    expect(counts).toEqual({ affinity: 2, scoped: 1, override: 1 });
  });

  test("mapped activities exist in the spec-activities projection ids", () => {
    const specActivityIds = new Set(SPEC_STAGES.flatMap((s) => (s.activities ?? []).map((a) => `${s.id}.${a.id}`)));
    const mapped = Object.values(PM_CATALOG).filter((e) => e.activityId !== null);
    expect(mapped.length).toBeGreaterThan(0);
    for (const entry of mapped) {
      expect(specActivityIds.has(`${entry.stageId}.${entry.activityId}`)).toBeTrue();
    }
  });

  test("catalog version and spec version are recorded", () => {
    expect(CATALOG_VERSION.length).toBeGreaterThan(0);
    expect(SPEC_VERSION.length).toBeGreaterThan(0);
  });
});

// ── 제너레이터 hard-fail 경로 (D2 · DEC-20261025-02 die 검증) ────────────────
// 실제 스크립트를 임시 트리(node_modules 아래 — 감시 산출물 밖, js-yaml 해석
// 가능)에 복사해 합성 불일치를 주입하고 exit 1 + die 문언을 검증한다. die는
// process.exit를 부르므로 프로세스 내 직접 호출이 아니라 서브프로세스로 본다.
describe("pm catalog generator hard-fail (D2 / specialist affinity die validation)", () => {
  const FIXTURE = join(ROOT, "node_modules", ".pm-catalog-fixture");

  function buildFixture(): void {
    rmSync(FIXTURE, { recursive: true, force: true });
    for (const d of [
      join(FIXTURE, "scripts", "co-newbiz"),
      join(FIXTURE, "scripts", "lib"),
      join(FIXTURE, "process"),
      join(FIXTURE, "agents"),
      join(FIXTURE, "app", "web-next", "prompts"),
      join(FIXTURE, "app", "web-next", "lib"),
    ]) {
      mkdirSync(d, { recursive: true });
    }
    copyFileSync(join(ROOT, "scripts", "co-newbiz", "generate-pm-catalog.ts"), join(FIXTURE, "scripts", "co-newbiz", "generate-pm-catalog.ts"));
    copyFileSync(join(ROOT, "scripts", "lib", "error-handling.ts"), join(FIXTURE, "scripts", "lib", "error-handling.ts"));
    copyFileSync(join(ROOT, "process", "flow.spec.yaml"), join(FIXTURE, "process", "flow.spec.yaml"));
    copyFileSync(join(ROOT, "app", "web-next", "prompts", "prompts.json"), join(FIXTURE, "app", "web-next", "prompts", "prompts.json"));
    for (const f of readdirSync(join(ROOT, "agents"))) {
      if (f.endsWith(".md")) copyFileSync(join(ROOT, "agents", f), join(FIXTURE, "agents", f));
    }
  }

  function runGenerator(): { code: number; stderr: string } {
    const proc = Bun.spawnSync(["bun", join(FIXTURE, "scripts", "co-newbiz", "generate-pm-catalog.ts")], { cwd: ROOT });
    return { code: proc.exitCode, stderr: new TextDecoder().decode(proc.stderr) };
  }

  function overwrite(path: string, from: string, to: string): void {
    const text = readFileSync(path, "utf8");
    expect(text.includes(from)).toBeTrue();
    writeFileSync(path, text.replace(from, to), "utf8");
  }

  afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }));

  test("dies on a synthetic prompt-agent mismatch outside DUAL_ASSIGNMENTS", () => {
    buildFixture();
    overwrite(
      join(FIXTURE, "app", "web-next", "prompts", "prompts.json"),
      `"key": "s4.route_recommendation",\n      "agent": "pm"`,
      `"key": "s4.route_recommendation",\n      "agent": "legal-counsel"`,
    );
    const { code, stderr } = runGenerator();
    expect(code).toBe(1);
    expect(stderr).toContain("spec이 지배합니다");
    expect(stderr).toContain("DUAL_ASSIGNMENTS");
  });

  test("passes end-to-end with the documented dual assignment (writes the catalog)", () => {
    buildFixture();
    const { code, stderr } = runGenerator();
    expect(code).toBe(0);
    expect(stderr).toEqual("");
    expect(existsSync(join(FIXTURE, "app", "web-next", "lib", "pm-catalog.generated.ts"))).toBeTrue();
  });

  test("dies when a SPECIALIST_TRACK_AFFINITY ref no longer matches the spec agent", () => {
    buildFixture();
    // S4.deal-shape-evaluation은 매핑된 프롬프트가 없어 D2 검증을 건드리지
    // 않는다 — 어필리티 die 규칙만 깨진다.
    overwrite(
      join(FIXTURE, "process", "flow.spec.yaml"),
      `- id: deal-shape-evaluation\n        agent: brownfield-agent`,
      `- id: deal-shape-evaluation\n        agent: pm`,
    );
    const { code, stderr } = runGenerator();
    expect(code).toBe(1);
    expect(stderr).toContain("SPECIALIST_TRACK_AFFINITY");
  });

  test("dies on a rationale-less dual assignment", () => {
    buildFixture();
    overwrite(
      join(FIXTURE, "scripts", "co-newbiz", "generate-pm-catalog.ts"),
      `rationale: "Cross-domain integrated insight is the process-governance-manager charter (auxiliary review lens) layered on the pm-owned ic-preparation activity; procedure schema supports one agent_key per step (ADR-0161 Q6 pattern).",`,
      `rationale: "",`,
    );
    const { code, stderr } = runGenerator();
    expect(code).toBe(1);
    expect(stderr).toContain("rationale이 비어");
  });
});
