// 프롬프트 레지스트리 접근 헬퍼 — 호출 지점은 키로만 프롬프트·에이전트 메타를 참조한다.
// SSOT: prompts/prompts.json (→ prompts.generated.ts, 재생성 스크립트로만 갱신).
import { PROMPTS, type PromptKey } from "./prompts.generated.ts";
import type { AgentCallMeta, LlmMessage } from "./llm.ts";

export type { PromptKey };

/** 키에 해당하는 시스템 프롬프트 원문. */
export function promptSystem(key: PromptKey): string {
  return PROMPTS[key].system;
}

/** 키에 해당하는 시스템 메시지(완전한 LlmMessage). */
export function systemMessage(key: PromptKey): LlmMessage {
  return { role: "system", content: PROMPTS[key].system };
}

/**
 * 키에 해당하는 런 장부(AgentCallMeta) 메타. agent=null인 항목은 호출 시점
 * 에이전트 키 오버라이드가 필수다. purpose/context는 오버라이드로 대체 가능하다.
 */
export function promptAgent(key: PromptKey, overrides: Partial<AgentCallMeta> = {}): AgentCallMeta {
  const entry = PROMPTS[key];
  const agentKey = overrides.key ?? entry.agent;
  if (!agentKey) throw new Error(`prompt '${key}' has no static agent — pass overrides.key`);
  return { key: agentKey, purpose: overrides.purpose ?? entry.purpose, contextType: overrides.contextType, contextId: overrides.contextId };
}
