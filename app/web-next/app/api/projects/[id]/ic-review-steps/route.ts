// GET/POST /api/projects/[id]/ic-review-steps — the S11 투자심사 procedure
// steps (entity-ic-review 1~5, group-investment-review 1~5) with their status
// from the ledgers of record (lib/ic-review-steps). GET is the step strip the
// IC screen renders; POST takes one action:
//   { action: "record", procedure, step_id, payload?, evidence_ref? }
//   { action: "snapshot_ic_memo", note? }            → step 3 memo + hash
//   { action: "draft_insight_review" }               → step 4.5 LLM draft (NOT persisted — the person records it)
//   { action: "attach_decision_deck" }               → step 4.6: briefing pack built, hashed, recorded
// Derived steps (AI RAG proposal, gate decisions) are refused here — their
// own ledgers remain authoritative. Analyst+, audited ic_review_step.recorded;
// members only (FR-SEC-01). Nothing here gates: open steps feed the GO-gap
// warning the person must answer with a rationale (boundary #2).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import {
  attachDecisionDeck,
  buildIcMemo,
  IcReviewStepError,
  icReviewStepsView,
  insightFallback,
  recordIcReviewStep,
  snapshotIcMemo,
  type IcProcedure,
} from "../../../../../lib/ic-review-steps.ts";
import { completeOrFallback } from "../../../../../lib/llm.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";

interface InsightDraft { synthesis: string; tensions: string[]; open_questions: string[]; recommendation_note: string }

function normalizeInsight(raw: Record<string, unknown>): InsightDraft {
  const strList = (arr: unknown, max: number) =>
    Array.isArray(arr) ? arr.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, max) : [];
  return {
    synthesis: String(raw.synthesis ?? "").trim().slice(0, 2000),
    tensions: strList(raw.tensions, 8),
    open_questions: strList(raw.open_questions, 8),
    recommendation_note: String(raw.recommendation_note ?? "").trim().slice(0, 1000),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok(icReviewStepsView(getDb(), id), 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "투자심사 절차 단계 기록은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const db = getDb();
  try {
    if (body?.action === "snapshot_ic_memo") {
      const row = snapshotIcMemo(db, id, auth.auth.userId, typeof body.note === "string" ? body.note : null);
      return ok(row, 201);
    }
    if (body?.action === "attach_decision_deck") {
      const { row, pack, pack_hash } = attachDecisionDeck(db, id, auth.auth.userId);
      return ok({ record: row, pack_hash, pack }, 201);
    }
    if (body?.action === "draft_insight_review") {
      // Step 4.5 — an LLM DRAFT over the memo context (insight-synthesis); never
      // persisted here: the person reads it and records 4.5 with their own note.
      const view = icReviewStepsView(db, id);
      const { memo } = buildIcMemo(db, id);
      const context = JSON.stringify(memo, null, 1).slice(0, 8000);
      const fallback = () => JSON.stringify(insightFallback(view, memo));
      const res = await completeOrFallback(
        [
          systemMessage("s11.integrated_insight"),
          {
            role: "user" as const,
            content:
              "아래 투자심의 자료 요약만을 근거로 통합 인사이트 리뷰 초안을 작성하세요.\n" +
              'JSON: {"synthesis":"재무·기술·법무·리스크를 가로지르는 통합 해석 3~6문장","tensions":["차원 간 긴장·상충 지점"],"open_questions":["위원회가 확인해야 할 질문"],"recommendation_note":"권고 초안 1~3문장 (결정 아님)"}\n\n' +
              context,
          },
        ],
        fallback,
        { maxTokens: 1800, agent: promptAgent("s11.integrated_insight") },
      );
      let draft: InsightDraft;
      let note: string;
      if (res.source === "llm") {
        const start = res.text.indexOf("{");
        const end = res.text.lastIndexOf("}");
        let raw: Record<string, unknown> | null = null;
        if (start !== -1 && end > start) {
          try { raw = JSON.parse(res.text.slice(start, end + 1)) as Record<string, unknown>; } catch { raw = null; }
        }
        draft = raw ? normalizeInsight(raw) : insightFallback(view, memo);
        note = raw ? "LLM 초안 — 검토 후 4.5 단계 메모로 사람이 기록합니다 (경계 #2)." : "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
      } else {
        draft = insightFallback(view, memo);
        note = "LLM 미구성 — 결정론 폴백(통합 해석 없음). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
      }
      appendAudit(db, { actor: auth.auth.userId, action: "ic_insight_draft.generate", target: `${id}:${res.source}`, now: new Date().toISOString() });
      return ok({ source: res.source, provider: res.provider, note, draft }, 200);
    }
    if (body?.action === "record") {
      const procedure = body.procedure as IcProcedure;
      const stepId = typeof body.step_id === "string" ? body.step_id : "";
      const payload = body.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : null;
      const row = recordIcReviewStep(db, {
        projectId: id, procedure, stepId, payload,
        evidenceRef: typeof body.evidence_ref === "string" ? body.evidence_ref : null,
        by: auth.auth.userId,
      });
      return ok(row, 201);
    }
    return badRequest("invalid_action", "action은 record | snapshot_ic_memo | draft_insight_review | attach_decision_deck 중 하나여야 합니다.");
  } catch (err) {
    if (err instanceof IcReviewStepError) return badRequest("invalid_request", err.message);
    throw err;
  }
}
