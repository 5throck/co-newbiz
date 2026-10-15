// POST /api/greenfield/[oppId]/entry-strategy-draft — S5 "진출전략 제안 (AI)" (ADR-0171 amendment 2026-10-15 (2)).
// PROPOSES the entry-strategy modes (build|partner|hire, one main), the rationale and the considered-but-rejected
// alternatives. Proposal only: NOTHING is written to the database and nothing is decided (boundary #1/#2); the page fills
// only EMPTY fields as drafts and a person saves. Same permission as saving the assessment (analyst+). Offline: stored S3
// register, S4 decision record, opportunity context and company profile/disclosure data plus the LLM — no web search.
// Without a configured LLM: 200 with an empty proposal and an explanatory note.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { completeDetailed, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";
import type { LlmCall } from "../../../../../lib/llm-json.ts";
import { readRegister } from "../../../../../lib/capability-attainability.ts";
import { opportunityContextLines } from "../../../../../lib/capability-holding-context.ts";
import { loadJudgementEvidence } from "../../../../../lib/capability-judgement-draft.ts";
import { capabilityEvidenceLines, routeDecisionLines, runEntryStrategyDraft } from "../../../../../lib/entry-strategy-draft.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ oppId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "진출전략 제안(AI)은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { oppId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, market_scope FROM opportunity WHERE id = ?").get(oppId) as { id: string; name: string; market_scope: string | null } | undefined;
  if (!opp) return notFound();
  if (!isLlmConfigured()) {
    return ok({ proposal: null, source: "synthesis", note: "LLM 미구성 — 결정론 폴백은 진출전략 제안을 만들지 않습니다. 사람이 직접 선택하세요. 외부 웹 검색은 쓰지 않습니다." }, 200);
  }
  const reg = readRegister(db, oppId);
  const evidence = await loadJudgementEvidence(db, oppId);
  const call: LlmCall = async (messages, maxTokens) => {
    try {
      const r = await completeDetailed(messages, { maxTokens, agent: promptAgent("s5.entry_strategy_draft", { contextType: "opportunity", contextId: oppId }) });
      return { ok: true, text: r.text, finishReason: r.finishReason };
    } catch (err) {
      return { ok: false, text: "", reason: err instanceof Error ? err.message.slice(0, 80) : "call_failed" };
    }
  };
  const res = await runEntryStrategyDraft({
    system: systemMessage("s5.entry_strategy_draft"), oppName: opp.name, marketScope: opp.market_scope,
    capabilityLines: capabilityEvidenceLines(reg?.rows ?? []), routeLines: routeDecisionLines(db, oppId),
    contextLines: opportunityContextLines(opp.market_scope, ""), profileLines: evidence.profileLines, disclosureLines: evidence.disclosureLines, call, deadlineMs: 90_000,
  });
  const extra = evidence.companyNames.length === 0 ? "사용할 수 있는 회사 프로필이 없어 S3·S4 기록과 기회 맥락만 근거로 썼습니다." : `사용한 프로필 ${evidence.companyNames.length}곳.`;
  return ok({ ...res, note: `${res.note} ${extra}` }, 200);
});
