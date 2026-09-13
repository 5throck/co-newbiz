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
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "진행 브리프 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { gate?: string } | null;
  const gate = body?.gate?.trim() ?? "";
  if (!(OPPORTUNITY_GATE_BRIEFS as readonly string[]).includes(gate)) {
    return badRequest("invalid_request", `gate는 ${OPPORTUNITY_GATE_BRIEFS.join(" | ")} 중 하나입니다.`);
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
        {
          role: "system" as const,
          content:
            "당신은 신규사업 검토 리드 PM입니다. 이 진행에 대해 GO/HOLD/KILL 권고와 근거 초안을 작성합니다. 최종 기록은 사람이 하며 당신 산출물은 제안입니다. " +
            "제공된 매니페스트 산출물 안에서만 판단하고 근거 없는 사실을 만들지 마세요. 근거가 부족하면 HOLD와 '검증 필요'를 제안하세요. JSON만 반환합니다.",
        },
        {
          role: "user" as const,
          content:
            `아래 산출물을 근거로 ${gate} 진행 브리프를 작성하세요.\n` +
            `JSON: {"recommendation":"go|hold|kill","confidence":"high|medium|low","rationale_draft":"근거 초안 2~4문장(산출물 인용)","key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
        },
      ],
      () => "",
      { maxTokens: 1600, agent: { key: "risk-officer", purpose: "진행 브리프 — 권고·근거 초안 작성" } },
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
