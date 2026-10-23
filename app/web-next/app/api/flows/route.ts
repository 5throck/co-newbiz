// 2026-09-15-runtime-pm-agent-orchestration-design §6.5 (D4 플로우 콘솔) —
// GET /api/flows: S1–S12 → 활동 → 에이전트 → 프롬프트 키·스킬 블루프린트.
// 전부 생성 프러젝션(spec-activities / pm-catalog / prompts /
// agent-registry .generated.ts)에서 렌더한다 — 런타임에 flow.spec.yaml /
// prompts.json 을 직접 읽지 않는다(SSOT 소비자는 생성 스크립트뿐, §6.4).
// 읽기 전용 — appendAudit 은 쓰기 경로 전용(기존 GET 라우트 선례 준수).
import { authenticate, requireBusinessActor } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";
import { isLlmConfigured } from "../../../lib/llm.ts";
import { route } from "../../../lib/route.ts";
import { CATALOG_SOURCES, CATALOG_VERSION, PM_CATALOG } from "../../../lib/pm-catalog.generated.ts";
import { PROMPTS, type PromptKey } from "../../../lib/prompts.generated.ts";
import { SPEC_STAGES, SPEC_VERSION } from "../../../lib/spec-activities.generated.ts";
import { AGENT_REGISTRY } from "../../../lib/agent-registry.generated.ts";

export const GET = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const guard = requireBusinessActor(auth.auth, "read");
  if (guard) return guard;

  // 단계별 트랙 범위: 카탈로그의 trackScope(해당 단계 프롬프트들의
  // applicableTracks 유도값)를 단계 단위로 합친다. flow.spec.yaml 원문을
  // 런타임에 읽지 않기 위한 유일한 프러젝션 내 경로다.
  const tracksByStage = new Map<string, Set<string>>();
  for (const entry of Object.values(PM_CATALOG)) {
    if (!entry.stageId) continue;
    const set = tracksByStage.get(entry.stageId) ?? new Set<string>();
    for (const t of entry.trackScope) set.add(t);
    tracksByStage.set(entry.stageId, set);
  }

  // 프롬프트 키 → 활동 그룹핑: 활동 단위 드릴다운(화면 설계 §4.1)이
  // 활동당 소속 프롬프트 목록을 요구한다.
  const promptsByActivity = new Map<string, PromptKey[]>();
  for (const entry of Object.values(PM_CATALOG)) {
    if (!entry.activityId || !entry.stageId) continue;
    const key = `${entry.stageId}:${entry.activityId}`;
    const list = promptsByActivity.get(key) ?? [];
    list.push(entry.promptKey);
    promptsByActivity.set(key, list);
  }

  const stages = SPEC_STAGES.map((stage) => {
    const applicableTracks = [...(tracksByStage.get(stage.id) ?? new Set<string>())].sort();
    const activities = (stage.activities ?? []).map((activity) => {
      const prompts = (promptsByActivity.get(`${stage.id}:${activity.id}`) ?? []).sort();
      return {
        id: activity.id,
        agent: activity.agent,
        skills: activity.skills ?? [],
        procedure: activity.procedure ?? [],
        prompts: prompts.map((promptKey) => {
          const entry = PM_CATALOG[promptKey];
          return {
            key: promptKey,
            // null = 동적 항목 — 호출 시점 에이전트 선언으로 귀속된다(§6.2).
            agentKey: entry?.agentKey ?? null,
            purpose: entry?.purpose ?? null,
            trackScope: entry?.trackScope ?? [],
          };
        }),
      };
    });
    return { id: stage.id, applicableTracks, activities };
  });

  // 프롬프트 목록(드릴다운 미리보기용 시스템 프롬프트 본문 포함) —
  // 카탈로그(귀속·목적) × 프롬프트 레지스트리(본문) 결합.
  const prompts = Object.values(PM_CATALOG)
    .map((entry) => ({
      key: entry.promptKey,
      agentKey: entry.agentKey,
      activityId: entry.activityId,
      stageId: entry.stageId,
      purpose: entry.purpose,
      trackScope: entry.trackScope,
      system: PROMPTS[entry.promptKey]?.system ?? null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const agents = AGENT_REGISTRY.map((agent) => ({
    key: agent.key,
    name: agent.name,
    role: agent.role || null,
    domain: agent.domain,
  })).sort((a, b) => a.key.localeCompare(b.key));

  return ok(
    {
      llmConfigured: isLlmConfigured(),
      specVersion: SPEC_VERSION,
      catalogVersion: CATALOG_VERSION,
      sources: CATALOG_SOURCES,
      stages,
      prompts,
      agents,
    },
    200,
    { stages: stages.length, prompts: prompts.length, agents: agents.length },
  );
});
