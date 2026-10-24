// Gate brief (opportunity gates: screening / pre_fs / target_screening) —
// ADR-0118. The LLM proposes go/hold/kill + a rationale draft from the gate's
// manifest artifacts (flow.spec stage inputs + own stage state); the human
// records the gate in POST /gate-decisions. On-demand, nothing persisted.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import {
  buildGateContext,
  gateManifest,
  normalizeGateBrief,
  synthesisGateBrief,
  OPPORTUNITY_GATE_BRIEFS,
} from "../../../../../lib/gate-brief.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Gate-brief generation requires the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { gate?: string } | null;
  const gate = body?.gate?.trim() ?? "";
  if (!(OPPORTUNITY_GATE_BRIEFS as readonly string[]).includes(gate)) {
    return badRequest("invalid_request", `gate must be one of: ${OPPORTUNITY_GATE_BRIEFS.join(" | ")}.`);
  }
  const db = getDb();
  if (!db.query("SELECT id FROM opportunity WHERE id = ?").get(id)) return notFound();

  const manifest = gateManifest("opportunity", gate)!;
  const context = buildGateContext(db, "opportunity", id, gate);

  let brief;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  if (isLlmConfigured()) {
    const res = await completeOrFallback(
      [
        systemMessage("opportunity.gate_brief"),
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
        brief = synthesisGateBrief(db, "opportunity", id, gate, manifest);
        note = "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
      }
    } else {
      brief = synthesisGateBrief(db, "opportunity", id, gate, manifest);
      note = "LLM 호출 실패 — 결정론 폴백으로 대체했습니다.";
    }
  } else {
    brief = synthesisGateBrief(db, "opportunity", id, gate, manifest);
    note = "LLM 미구성 — 결정론 폴백(권고는 스펙 공개 기준으로만 산출). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }

  appendAudit(db, { actor: ctx.userId, action: "gate_brief.generate", target: `${id}:${gate}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, gate, brief }, 200);
});
