// Gate brief (project gates: fs / dd / entity_ic / group_ic) — ADR-0118.
// Opportunity gate-brief's project-side twin: the manifest artifacts come from
// the IC package inputs (adopted BC, DD state, RAG proposal, deal-structure
// hypothesis, prior gate decisions); the human records the gate. On-demand,
// nothing persisted.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
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

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "게이트 브리프 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { gate?: string } | null;
  const gate = body?.gate?.trim() ?? "";
  if (!(PROJECT_GATE_BRIEFS as readonly string[]).includes(gate)) {
    return badRequest("invalid_request", `gate는 ${PROJECT_GATE_BRIEFS.join(" | ")} 중 하나입니다.`);
  }
  if (!visibleProject(ctx, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();

  const manifest = gateManifest("project", gate)!;
  const context = buildGateContext(db, "project", id, gate);

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
            "당신은 신규사업 검토 리드 PM입니다. 이 게이트에 대해 GO/HOLD/KILL 권고와 근거 초안을 작성합니다. 최종 기록은 사람이 하며 당신 산출물은 제안입니다. " +
            "제공된 매니페스트 산출물 안에서만 판단하고 근거 없는 사실을 만들지 마세요. 근거가 부족하면 HOLD와 '검증 필요'를 제안하세요. JSON만 반환합니다.",
        },
        {
          role: "user" as const,
          content:
            `아래 산출물을 근거로 ${gate} 게이트 브리프를 작성하세요.\n` +
            `JSON: {"recommendation":"go|hold|kill","confidence":"high|medium|low","rationale_draft":"근거 초안 2~4문장(산출물 인용)","key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
        },
      ],
      () => "",
      { maxTokens: 1600 },
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
        note = "LLM 제안 — 근거에 반영해 검토한 뒤 사람이 게이트를 기록합니다 (경계 #2).";
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

  appendAudit(db, { actor: ctx.userId, action: "gate_brief.generate", target: `${id}:${gate}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, gate, brief }, 200);
});
