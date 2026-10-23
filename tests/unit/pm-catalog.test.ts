// PM 활동 카탈로그 무결성 (ADR-0183 D1) — 생성물(pm-catalog.generated.ts)이
// 3 SSOT(prompts.json × flow.spec.yaml × agents/*.md)와 계속 일치하는지
// 기계적으로 지킨다. generate-spec-activities의 mirrors-spec 검증과 동일 규율:
// 드리프트는 제너레이터 --check 실행으로 판정한다 (mcp-prompts.test.ts 패턴).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { PM_CATALOG, DYNAMIC_AGENT_PROMPTS, CATALOG_VERSION, SPEC_VERSION } from "../../app/web-next/lib/pm-catalog.generated.ts";
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
      // 프롬프트 소유 에이전트가 활동 소유 에이전트와 다를 수 있지만(보조 관점),
      // 활동 에이전트도 로스터에 있어야 한다 — 프롬프트 에이전트는 위 테스트가 검증한다.
      expect(roster.has(activity!.agent)).toBeTrue();
      // trackScope는 단계 applicableTracks의 결정론 투영이다.
      expect(entry.trackScope).toEqual(stage!.applicableTracks ?? []);
    }
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
