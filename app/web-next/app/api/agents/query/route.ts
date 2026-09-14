// ADR-0128 — 런타임 PM 에이전트 질의 엔드포인트. 모든 LLM 질의는 이 seam을
// 거친 에이전트 실행으로 처리되고 런 장부(llm_call_log)에 기록된다. 산출물은
// 제안 전용 — 결정·기록은 기존 인간 게이트 UI를 통해서만 가능하다(경계 #2).
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../../lib/envelope.ts";
import { routeTask } from "../../../../lib/pm-router.ts";
import { runOpportunityEvaluationChain, chainAsk } from "../../../../lib/agent-chains.ts";
import { completeOrFallback } from "../../../../lib/llm.ts";
import { AGENT_REGISTRY } from "../../../../lib/agent-registry.generated.ts";

interface OppLite { id: string; name: string; market_scope: string | null; rationale: string | null; attractiveness_score: number | null; synergy_score: number | null }

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctxUser = auth.auth;
  if (ctxUser.role === "viewer") return forbidden("role_required", "에이전트 질의는 analyst 역할 이상이어야 합니다.");

  const body = (await request.json().catch(() => null)) as {
    query?: string;
    opportunityId?: string;
    projectId?: string;
    industryName?: string;
  } | null;
  const query = body?.query?.trim();
  if (!query) return badRequest("query_required", "query는 필수입니다.");

  const routeCtx = {
    opportunityId: body?.opportunityId,
    projectId: body?.projectId,
    industryName: body?.industryName,
  };

  const decision = await routeTask(query, routeCtx);
  const db = getDb();

  // ── 체인 모드: 기회 종합 평가 ──
  if (decision.mode === "chain" && decision.chain === "opportunity_evaluation") {
    const oppId = routeCtx.opportunityId;
    if (!oppId) return badRequest("context_required", "기회 종합 평가 체인은 opportunityId 컨텍스트가 필요합니다.");
    const opp = db
      .query("SELECT id, name, market_scope, rationale, attractiveness_score, synergy_score FROM opportunity WHERE id = ? AND deleted_at IS NULL")
      .get(oppId) as OppLite | undefined;
    if (!opp) return badRequest("context_invalid", "기회를 찾을 수 없습니다.");

    const factorRow = db
      .query("SELECT factors_json FROM opportunity WHERE id = ?")
      .get(oppId) as { factors_json: string | null } | undefined;
    let factors = { opportunity: [] as string[], risk: [] as string[] };
    if (factorRow?.factors_json) {
      try {
        const parsed = JSON.parse(factorRow.factors_json) as { opportunity?: string[]; risk?: string[] };
        factors = { opportunity: parsed.opportunity ?? [], risk: parsed.risk ?? [] };
      } catch { /* 파싱 실패 — 빈 요인 */ }
    }

    const result = await runOpportunityEvaluationChain(
      {
        opportunityId: opp.id, name: opp.name, marketScope: opp.market_scope, rationale: opp.rationale,
        attractivenessScore: opp.attractiveness_score, factors,
      },
      chainAsk,
    );
    appendAudit(db, { actor: ctxUser.userId, action: "agent_chain_run", target: `${decision.chain}:${oppId}`, now: new Date().toISOString() });
    return ok({
      mode: "chain" as const,
      chain: result.chain,
      answer: result.answer,
      steps: result.steps,
      proposalOnly: true,
    }, 200);
  }

  // ── 단일 에이전트 모드 ──
  const entry = AGENT_REGISTRY.find((a) => a.key === decision.agentKey);
  const system =
    (entry ? `당신은 ${entry.name}(${entry.key})입니다. 역할: ${entry.role}\n` : "") +
    "당신은 신규사업 검토 플랫폼의 전문 에이전트입니다. 제공된 근거와 데이터 안에서만 답하고, 근거 밖의 사실은 만들지 마세요. " +
    "결론은 제안이며 최종 판단은 사람이 한다는 점을 답변에 반영하세요. 질의와 같은 언어로 답합니다.";

  const contextLines = [
    routeCtx.opportunityId ? (() => {
      const opp = db
        .query("SELECT id, name, market_scope, status, attractiveness_score, synergy_score, rationale FROM opportunity WHERE id = ? AND deleted_at IS NULL")
        .get(routeCtx.opportunityId) as OppLite & { status: string } | undefined;
      return opp ? `연결 기회: ${opp.name} (상태 ${opp.status}, 매력도 ${opp.attractiveness_score ?? "—"}, 시너지 ${opp.synergy_score ?? "—"})\n근거: ${opp.rationale ?? "없음"}` : null;
    })() : null,
    routeCtx.industryName ? `연결 산업: ${routeCtx.industryName}` : null,
  ].filter(Boolean).join("\n");

  const res = await completeOrFallback(
    [
      { role: "system", content: system },
      { role: "user", content: contextLines ? `${contextLines}\n\n질의: ${query}` : query },
    ],
    () =>
      "LLM이 구성되지 않았습니다 — 결정론 폴백 상태입니다. 질의에 해당하는 데이터는 화면의 각 단계 산출물(브리프·추천·요인)에서 확인할 수 있으며, " +
      "에이전트 LLM 모드(CO_NEWBIZ_LLM_* 설정) 활성화 후 다시 질의하면 에이전트 응답이 생성됩니다.",
    {
      maxTokens: 1400,
      agent: { key: decision.agentKey ?? "pm", purpose: decision.task, contextType: routeCtx.opportunityId ? "opportunity" : routeCtx.projectId ? "project" : routeCtx.industryName ? "industry" : undefined, contextId: routeCtx.opportunityId ?? routeCtx.projectId },
    },
  );

  appendAudit(db, { actor: ctxUser.userId, action: "agent_query", target: `${decision.agentKey ?? "pm"}:${query.slice(0, 40)}`, now: new Date().toISOString() });
  return ok({
    mode: "single" as const,
    agentKey: decision.agentKey ?? "pm",
    task: decision.task,
    answer: res.text,
    source: res.source,
    classifiedBy: decision.classifiedBy,
    proposalOnly: true,
  }, 200);
}
