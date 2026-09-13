// ADR-0128 — 런타임 에이전트 로스터 열람. agents/*.md의 투영(agent-registry
// .generated.ts)을 읽어 반환한다. 인증된 모든 역할 열람 가능 — 로스터 자체는
// 비밀이 아니며, PM 라우터와 화면이 공유하는 배정 후보 목록이다.
import { AGENT_REGISTRY } from "../../../../lib/agent-registry.generated.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  return ok({ agents: AGENT_REGISTRY }, 200, { count: AGENT_REGISTRY.length });
}
