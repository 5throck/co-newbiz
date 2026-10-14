// POST /api/opportunities/[id]/capability-attainability/ai-draft — S5 "판정 제안 (AI)" (ADR-0171 amendment 2026-10-15).
// PROPOSES the judgement inputs of required capabilities: 해소 방식, 기대 수준, 비용(백만원), 기간(개월), 달성 가능성 and a
// short 근거·증빙, each with a basis. Proposal only: NOTHING is written to the database and nothing is confirmed
// (boundary #1/#2); a person reviews, edits and saves (PUT) and confirms (human-only POST .../confirm). Same permission
// as editing the S5 judgement (analyst+). Offline: stored S3 definition, opportunity context and company
// profile/disclosure data plus the LLM — no web search. Body { rowIds?, includeEvidence? } (default rows: stale,
// unjudged, or lacking 해소 방식/기대 수준; max 12 rows per call; includeEvidence=false skips profile/disclosure lines).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeDetailed, isLlmConfigured } from "../../../../../../lib/llm.ts";
import { route } from "../../../../../../lib/route.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";
import type { LlmCall } from "../../../../../../lib/llm-json.ts";
import { readRegister } from "../../../../../../lib/capability-attainability.ts";
import { opportunityContextLines } from "../../../../../../lib/capability-holding-context.ts";
import { JUDGEMENT_ROW_CAP, loadJudgementEvidence, runJudgementDraft, selectJudgementTargets, strategyText } from "../../../../../../lib/capability-judgement-draft.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "판정 제안(AI)은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, market_scope FROM opportunity WHERE id = ?").get(id) as { id: string; name: string; market_scope: string | null } | undefined;
  if (!opp) return notFound();
  let body: { rowIds?: unknown; includeEvidence?: unknown } = {};
  try { body = ((await request.json()) as typeof body | null) ?? {}; } catch { /* empty body */ }
  if (body.rowIds !== undefined && !(Array.isArray(body.rowIds) && body.rowIds.every((x) => typeof x === "string"))) return badRequest("invalid_request", "rowIds는 문자열 배열입니다.");
  const reg = readRegister(db, id);
  if (!reg || reg.rows.length === 0) return badRequest("no_rows", "필요 역량 행이 없습니다 — S3에서 필요 역량을 먼저 정리하세요.");
  const { targets, unknown, capped } = selectJudgementTargets(reg.rows, body.rowIds as string[] | undefined);
  if (unknown.length > 0) return badRequest("unknown_row", `레지스터에 없는 행입니다: ${unknown.slice(0, 3).join(", ")}`);
  const empty = { drafts: {}, unfilled: {}, counts: { rows: 0, proposed: 0, fieldsFilled: 0, fieldsUnfilled: 0, kept: 0, failedRows: 0 } };
  if (targets.length === 0) return ok({ ...empty, source: "synthesis", note: "제안할 행이 없습니다 — 모든 행에 해소 방식·기대 수준·달성 가능성이 있고 S3 변경도 없습니다." }, 200);
  if (!isLlmConfigured()) {
    return ok({ ...empty, counts: { ...empty.counts, rows: targets.length }, source: "synthesis", note: "LLM 미구성 — 결정론 폴백은 판정 제안을 만들지 않습니다. 사람이 직접 판정하세요. 외부 웹 검색은 쓰지 않습니다." }, 200);
  }
  const assessment = db.query("SELECT entry_strategy, alternatives_considered FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1").get(id) as { entry_strategy: string | null; alternatives_considered: string | null } | undefined;
  const evidence = body.includeEvidence === false ? { profileLines: [], disclosureLines: [], companyNames: [] } : await loadJudgementEvidence(db, id);
  const call: LlmCall = async (messages, maxTokens) => {
    try {
      const r = await completeDetailed(messages, { maxTokens, agent: promptAgent("s5.capability_judgement_draft", { contextType: "opportunity", contextId: id }) });
      return { ok: true, text: r.text, finishReason: r.finishReason };
    } catch (err) {
      return { ok: false, text: "", reason: err instanceof Error ? err.message.slice(0, 80) : "call_failed" };
    }
  };
  const res = await runJudgementDraft({
    system: systemMessage("s5.capability_judgement_draft"), oppName: opp.name, marketScope: opp.market_scope, entryStrategy: strategyText(assessment),
    contextLines: opportunityContextLines(opp.market_scope, ""), profileLines: evidence.profileLines, disclosureLines: evidence.disclosureLines, targets, call, deadlineMs: 90_000,
  });
  const extra = [
    capped > 0 ? `한 번에 ${JUDGEMENT_ROW_CAP}개 행까지 제안합니다 — ${capped}개 행은 다음 호출에서 처리하세요.` : "",
    body.includeEvidence === false ? "회사 프로필·공시 근거는 쓰지 않았습니다." : evidence.companyNames.length === 0 ? "사용할 수 있는 회사 프로필이 없어 S3 정의와 기회 맥락만 근거로 썼습니다." : `사용한 프로필 ${evidence.companyNames.length}곳(${evidence.companyNames.slice(0, 3).join(", ")}${evidence.companyNames.length > 3 ? " 외" : ""}).`,
  ].filter(Boolean).join(" ");
  return ok({ ...res, note: extra ? `${res.note} ${extra}` : res.note }, 200);
});
// @version 1.0.0
