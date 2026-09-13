// S8 채택 권고 (ADR-0118) — 자기 단계(6개 case + 킬크라이어리아)만 컨텍스트로
// 읽는다. 채택할 case와 "무엇이 바꾸면 뒤집히는가" 초안을 제안하며, 채택
// (adopt API)은 사람의 행위다. 폴백은 결정론 RECOMMENDED(market_forward 진행
// 1차 기준)를 그대로 echo한다 — 위조가 아니라 기존 산출물의 인용.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { listBusinessCases, latestAdoption } from "../../../../../../lib/business-case.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../../lib/llm.ts";
import { route } from "../../../../../../lib/route.ts";

interface RecoPayload {
  recommended_model_id: string | null;
  rationale_draft: string;
  what_would_change: string | null;
  key_evidence: string[];
  cautions: string[];
}

function normalize(raw: Record<string, unknown>, validIds: Set<string>): RecoPayload {
  const id = String(raw.recommended_model_id ?? "").trim();
  const strList = (arr: unknown, max: number) =>
    Array.isArray(arr) ? arr.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, max) : [];
  return {
    recommended_model_id: validIds.has(id) ? id : null,
    rationale_draft: String(raw.rationale_draft ?? "").trim().slice(0, 1500),
    what_would_change: String(raw.what_would_change ?? "").trim().slice(0, 1000) || null,
    key_evidence: strList(raw.key_evidence, 8),
    cautions: strList(raw.cautions, 8),
  };
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "채택 권고 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();

  // 매니페스트 (자기 단계): 6개 case + 킬크라이어리아 상태
  const { cases, adoption } = listBusinessCases(id);
  if (cases.length === 0) return notFound();
  const adoptionRow = adoption;
  const kills = db
    .query(
      `SELECT criterion_id, action, outcome FROM (
         SELECT criterion_id, action, outcome,
                ROW_NUMBER() OVER (PARTITION BY criterion_id ORDER BY evaluated_at DESC, id DESC) AS rn
         FROM kill_criteria_evaluation WHERE project_id = ?
       ) WHERE rn = 1`,
    )
    .all(id) as Array<{ criterion_id: string; action: string; outcome: string }>;
  const caseLines = cases.slice(0, 8).map((c) => {
    const sims = c.simulations?.slice(0, 3) ?? [];
    const npv = sims.map((s) => `${s.percentile ?? "?"}: ${s.npv_krw_m ?? "?"}`).join(", ");
    return `- ${c.name} (${c.kind}${c.scenario ? `, ${c.scenario}` : ""}${c.variant ? `, ${c.variant}` : ""})${c.recommended ? " [결정론 RECOMMENDED]" : ""}${c.adopted ? " [채택됨]" : ""}${npv ? ` NPV ${npv}` : ""}`;
  });
  const manifest = ["Business Case 6종(variant·시나리오·NPV/IRR)", "킬크라이어리아 상태", "채택 현황"];

  let payload: RecoPayload;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  const recommendedCase = cases.find((c) => c.recommended);
  if (isLlmConfigured()) {
    const res = await completeOrFallback(
      [
        {
          role: "system" as const,
          content:
            "당신은 사업성 분석 심사관입니다. 최종 채택은 사람이 하며 당신 산출물은 제안입니다. " +
            "제공된 case 수치와 킬크라이어리아 안에서만 판단하세요. market_forward가 진행 1차 기준임을 고려하세요. JSON만 반환합니다.",
        },
        {
          role: "user" as const,
          content:
            "어떤 case를 채택할지 권고하세요. recommended_model_id는 아래 나열된 case의 id 그대로여야 합니다.\n" +
            `JSON: {"recommended_model_id":"case id","rationale_draft":"채택 근거 초안 3~5문장(수치 인용)","what_would_change":"무엇이 바뀌면 권고가 뒤집히는가","key_evidence":["..."],"cautions":["..."]}\n\n${[...caseLines, `\n[킬크라이어리아]\n${kills.length > 0 ? kills.map((k) => `- ${k.criterion_id}: ${k.action} → ${k.outcome}`).join("\n") : "없음"}`, `\n[채택 현황]\n${adoptionRow ? `${adoptionRow.modelId} (채택자 ${adoptionRow.adoptedBy})` : "미채택"}`].join("\n")}`,
        },
      ],
      () => "",
      { maxTokens: 1800 },
    );
    if (res.source === "llm") {
      const start = res.text.indexOf("{");
      const end = res.text.lastIndexOf("}");
      let raw: unknown = null;
      if (start !== -1 && end > start) {
        try { raw = JSON.parse(res.text.slice(start, end + 1)) as unknown; } catch { raw = null; }
      }
      if (raw) {
        payload = normalize(raw as Record<string, unknown>, new Set(cases.map((c) => c.id)));
        source = "llm";
        provider = res.provider;
        note = "LLM 제안 — 검토한 뒤 사람이 채택합니다 (경계 #2).";
      } else {
        payload = echoRecommended(recommendedCase, adoptionRow);
        note = "LLM 응답 파싱 실패 — 결정론 RECOMMENDED를 그대로 권고했습니다.";
      }
    } else {
      payload = echoRecommended(recommendedCase, adoptionRow);
      note = "LLM 호출 실패 — 결정론 RECOMMENDED를 그대로 권고했습니다.";
    }
  } else {
    payload = echoRecommended(recommendedCase, adoptionRow);
    note = "LLM 미구성 — 결정론 RECOMMENDED(market_forward 진행 1차 기준)를 권고합니다.";
  }

  appendAudit(db, { actor: ctx.userId, action: "adoption_recommendation.generate", target: `${id}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, recommendation: payload }, 200);
});

function echoRecommended(recommendedCase: { id: string; name: string; scenario: string | null; variant: string } | undefined, adoptionRow: { modelId: string; adoptedBy: string } | null): RecoPayload {
  return {
    recommended_model_id: recommendedCase?.id ?? null,
    rationale_draft: recommendedCase
      ? `결정론 폴백 — market_forward 진행 1차 기준 RECOMMENDED 케이스(${recommendedCase.name}${recommendedCase.scenario ? `, ${recommendedCase.scenario}` : ""})를 권고합니다. 채택 판단은 사람이 수치를 직접 검토해 수행하세요.`
      : "결정론 폴백 — RECOMMENDED 케이스가 없습니다 (수치 부족 또는 미생성).",
    what_would_change: null,
    key_evidence: [adoptionRow ? `이미 채택됨: ${adoptionRow.modelId} (채택자 ${adoptionRow.adoptedBy})` : "미채택"],
    cautions: ["LLM 미구성 또는 실패 — '무엇이 바뀌면 뒤집히는가' 초안은 포함되지 않았습니다."],
  };
}
