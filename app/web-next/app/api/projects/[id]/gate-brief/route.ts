// Gate brief (project gates: fs / dd / entity_ic / group_ic) — ADR-0118.
// Opportunity gate-brief's project-side twin: the manifest artifacts come from
// the IC package inputs (adopted BC, DD state, RAG proposal, deal-structure
// hypothesis, prior gate decisions); the human records the gate. On-demand,
// nothing persisted.
import { reconfirmNotice } from "../../../../../lib/reconfirm.ts";
import { waccStatusView } from "../../../../../lib/wacc-status.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { recomputeRag } from "../../../../../../../db/lib/rag-service.ts";
import {
  buildGateContext,
  gateManifest,
  normalizeGateBrief,
  synthesisGateBrief,
  PROJECT_GATE_BRIEFS,
} from "../../../../../lib/gate-brief.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";
import { KILL_MANIFEST_ENTRY, briefKillEvaluation, killContextBlock, persistBriefRecord } from "../../../../../lib/gate-brief-integrity.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Gate-brief generation requires the analyst role or higher.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { gate?: string } | null;
  const gate = body?.gate?.trim() ?? "";
  if (!(PROJECT_GATE_BRIEFS as readonly string[]).includes(gate)) {
    return badRequest("invalid_request", `gate must be one of: ${PROJECT_GATE_BRIEFS.join(" | ")}.`);
  }
  if (!visibleProject(ctx, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();

  // ADR-0186 D3: kill-criteria outcomes are evaluated (and, for a project gate, persisted) before the brief is composed.
  const killEval = briefKillEvaluation(db, { entityType: "project", entityId: id, gate, actor: ctx.userId });
  const manifest = killEval ? [...gateManifest("project", gate)!, KILL_MANIFEST_ENTRY] : gateManifest("project", gate)!;
  // Gate-package assembly refreshes the RAG proposal first (Wave F-5) so the
  // brief reads the current assessment, not a stale or empty table. Only the
  // IC gates carry a RAG artifact in their manifest.
  if (gate === "entity_ic" || gate === "group_ic") {
    try {
      recomputeRag(db, id, "gate_brief", { actor: ctx.userId });
    } catch (err) {
      console.error(`gate-brief: rag recompute failed for ${id}: ${(err as Error).message}`);
    }
  }
  const context = buildGateContext(db, "project", id, gate) + (killEval ? killContextBlock(killEval.kill) : "");

  let brief;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  if (isLlmConfigured()) {
    const res = await completeOrFallback(
      [
        systemMessage("project.gate_brief"),
        {
          role: "user" as const,
          content:
            `아래 산출물을 근거로 ${gate} 진행 브리프를 작성하세요.\n` +
            `JSON: {"recommendation":"go|hold|kill","confidence":"high|medium|low","rationale_draft":"근거 초안 2~4문장(산출물 인용)","key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
        },
      ],
      () => "",
      { maxTokens: 1600, agent: promptAgent("project.gate_brief") },
    );
    if (res.source === "llm") {
      const start = res.text.indexOf("{");
      const end = res.text.lastIndexOf("}");
      let raw: unknown = null;
      if (start !== -1 && end > start) {
        try { raw = JSON.parse(res.text.slice(start, end + 1)) as unknown; } catch { raw = null; }
      }
      if (raw) {
        brief = normalizeGateBrief(raw);
        source = "llm";
        provider = res.provider;
        note = "LLM 제안 — 근거에 반영해 검토한 뒤 사람이 진행을 기록합니다 (경계 #2).";
      } else {
        brief = synthesisGateBrief(db, "project", id, gate, manifest);
        note = "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
      }
    } else {
      brief = synthesisGateBrief(db, "project", id, gate, manifest);
      note = "LLM 호출 실패 — 결정론 폴백으로 대체했습니다.";
    }
  } else {
    brief = synthesisGateBrief(db, "project", id, gate, manifest);
    note = "LLM 미구성 — 결정론 폴백(권고는 데이터 요약만). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }

  // ADR-0186 D9: the recommendation is stored beside the later human decision (brief_id travels with the decision).
  const briefId = persistBriefRecord(db, { entityType: "project", entityId: id, gate, actor: ctx.userId, brief, source, provider, evalRunId: killEval?.evalRunId ?? null });
  appendAudit(db, { actor: ctx.userId, action: "gate_brief.generate", target: `${id}:${gate}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, gate, brief, brief_id: briefId, kill: killEval?.kill ?? null, wacc_status: waccStatusView(id, db), reconfirmation: reconfirmNotice(db, id) }, 200);
});
