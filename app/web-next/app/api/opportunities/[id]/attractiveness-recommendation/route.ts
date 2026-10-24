// S2 매력도 초안 (ADR-0118) — flow.spec S2 inputs(S1 시장 규모·성장 추정,
// 가치사슬 구조) + 자기 단계 요인(factors_json)만 컨텍스트로 읽는다. 매력도
// 점수 초안을 제안하며, 점수 입력(평가)은 사람의 행위다. 폴백은 점수를
// 위조하지 않는다(다른 화면이 이미 표시하는 발굴 시 초안과 달리 on-demand).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";

interface RecoPayload {
  suggested_score: number | null;
  rationale_draft: string;
  key_evidence: string[];
  cautions: string[];
}

function normalize(raw: Record<string, unknown>): RecoPayload {
  const n = Number(raw.suggested_score);
  const strList = (arr: unknown, max: number) =>
    Array.isArray(arr) ? arr.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, max) : [];
  return {
    suggested_score: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null,
    rationale_draft: String(raw.rationale_draft ?? "").trim().slice(0, 1200),
    key_evidence: strList(raw.key_evidence, 8),
    cautions: strList(raw.cautions, 8),
  };
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Attractiveness-draft generation requires the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, market_scope, value_chain_node, rationale, attractiveness_score, factors_json FROM opportunity WHERE id = ?")
    .get(id) as { id: string; name: string; market_scope: string | null; value_chain_node: string | null; rationale: string | null; attractiveness_score: number | null; factors_json: string | null } | null;
  if (!opp) return notFound();

  // 매니페스트 (flow.spec S2 inputs): S1 시장 규모·성장 + 가치사슬 + 자기 요인
  let s1 = "S1 시장분석: 없음";
  const ind = opp.market_scope
    ? db.query("SELECT id FROM md_industry WHERE name_ko = ? LIMIT 1").get(opp.market_scope) as { id: string } | undefined
    : undefined;
  const version = ind
    ? db.query(
        `SELECT v.payload FROM market_sizing_version v
         JOIN market_sizing_analysis a ON a.id = v.analysis_id
         WHERE a.industry_id = ? AND a.status = 'completed' ORDER BY v.version_no DESC LIMIT 1`,
      ).get(ind.id) as { payload: string } | undefined
    : undefined;
  if (version) {
    try {
      const m = (JSON.parse(version.payload) as { matrix?: { anchor?: { total?: number }; consistency?: { bottomUpCagr?: number }; competitive?: { structure?: string } } }).matrix ?? {};
      s1 = [
        `기준 규모: ${m.anchor?.total ? `$${m.anchor.total.toFixed(2)}B` : "미상"}`,
        `CAGR: ${m.consistency?.bottomUpCagr != null ? `${m.consistency.bottomUpCagr.toFixed(1)}%` : "미상"}`,
        m.competitive?.structure ? `경쟁 구조: ${m.competitive.structure}` : "",
      ].filter(Boolean).join("\n");
    } catch { /* keep default */ }
  }
  let factors = "요인: 없음";
  if (opp.factors_json) {
    try {
      const f = JSON.parse(opp.factors_json) as { opportunity?: string[]; risk?: string[] };
      factors = [
        f.opportunity?.length ? `기회 요인: ${f.opportunity.join(" / ")}` : "",
        f.risk?.length ? `위험 요인: ${f.risk.join(" / ")}` : "",
      ].filter(Boolean).join("\n") || "요인: 없음";
    } catch { factors = "요인: 파싱 실패"; }
  }
  const manifest = ["S1 시장 규모·성장 추정", "가치사슬 구조", "기회·위험 요인"];
  const context = [
    `기회명: ${opp.name} / 시장: ${opp.market_scope ?? "미정"} / 가치사슬: ${opp.value_chain_node ?? "미정"} / 발굴 근거: ${opp.rationale ?? "없음"}`,
    opp.attractiveness_score != null ? `현재 기록된 매력도: ${opp.attractiveness_score}` : "현재 기록된 매력도: 없음",
    `\n[S1 시장 규모·성장]\n${s1}`,
    `\n[요인]\n${factors}`,
  ].join("\n");

  let payload: RecoPayload;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  if (isLlmConfigured()) {
    const res = await completeOrFallback(
      [
        systemMessage("s3.attractiveness_recommendation"),
        {
          role: "user" as const,
          content:
            "이 기회의 매력도 점수(0-100 정수) 초안과 근거를 작성하세요.\n" +
            `JSON: {"suggested_score":정수,"rationale_draft":"점수 근거 2~4문장(S1·요인 인용)","key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
        },
      ],
      () => "",
      { maxTokens: 1200, agent: promptAgent("s3.attractiveness_recommendation") },
    );
    if (res.source === "llm") {
      const start = res.text.indexOf("{");
      const end = res.text.lastIndexOf("}");
      let raw: unknown = null;
      if (start !== -1 && end > start) {
        try { raw = JSON.parse(res.text.slice(start, end + 1)) as unknown; } catch { raw = null; }
      }
      if (raw) {
        payload = normalize(raw as Record<string, unknown>);
        source = "llm";
        provider = res.provider;
        note = "LLM 초안 — 반영한 뒤 수정하고 매력도 평가를 기록하는 것은 사람입니다 (경계 #2).";
      } else {
        payload = synthesisFallback(opp.attractiveness_score);
        note = "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
      }
    } else {
      payload = synthesisFallback(opp.attractiveness_score);
      note = "LLM 호출 실패 — 결정론 폴백으로 대체했습니다.";
    }
  } else {
    payload = synthesisFallback(opp.attractiveness_score);
    note = "LLM 미구성 — 결정론 폴백(점수 초안 없음). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }

  appendAudit(db, { actor: ctx.userId, action: "attractiveness_recommendation.generate", target: `${id}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, recommendation: payload }, 200);
});

function synthesisFallback(existing: number | null): RecoPayload {
  return {
    suggested_score: null,
    rationale_draft:
      existing != null
        ? `결정론 폴백 — 현재 기록된 매력도는 ${existing}점입니다. 점수 초안은 LLM 구성 후 생성하거나 요인 근거 위에서 사람이 직접 산출하세요.`
        : "결정론 폴백 — 데이터만으로 점수를 산출할 수 없어 null입니다. S1 시장분석·요인을 채운 뒤 LLM 초안을 받거나 사람이 직접 평가하세요.",
    key_evidence: [],
    cautions: ["LLM 미구성 또는 실패 — 점수 초안은 포함되지 않았습니다."],
  };
}
