// S5 투자비 검토 요건 LLM 추천 (ADR-0118) — flow.spec S5 inputs(트랙 결정·S1
// 시장 정의·S3 필요 역량·해소 방식·진출전략)만 컨텍스트로 읽는다. 저장(POST
// /api/greenfield/[oppId])은 사람의 행위다. On-demand, 비영속, 결정론 폴백은
// 금액을 위조하지 않는다(항목·근거만 제안, amount는 항상 사람이 입력).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { getCurrentRouteDecision } from "../../../../../../../db/repositories/route-decision.repository.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";
import { parseGapRegister, RESOLUTION_LABEL, type GapResolution } from "../../../../../lib/capability-gap.ts";
import { entryStrategyText } from "../../../../../lib/greenfield-entry-strategy.ts";

interface RecoPayload {
  investment_items: Array<{ line: string; category: "labor" | "opex" | "capex" | "revenue" | "gov_rnd"; note: string }> | null;
  key_evidence: string[];
  cautions: string[];
}

function strList(raw: unknown, max: number): string[] {
  return Array.isArray(raw)
    ? raw.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, max)
    : [];
}

function normalize(raw: Record<string, unknown>): RecoPayload {
  const rows: NonNullable<RecoPayload["investment_items"]> = [];
  if (Array.isArray(raw.investment_items)) {
    for (const item of raw.investment_items as Array<Record<string, unknown>>) {
      const line = String(item?.line ?? "").trim().slice(0, 120);
      if (!line || rows.length >= 20) continue;
      const category = String(item?.category ?? "opex").trim().toLowerCase();
      const CATEGORIES = new Set(["labor", "opex", "capex", "revenue", "gov_rnd"]);
      rows.push({
        line,
        category: (CATEGORIES.has(category) ? category : "opex") as "labor" | "opex" | "capex" | "revenue" | "gov_rnd",
        note: String(item?.note ?? "").trim().slice(0, 300) || "검증 필요 — 금액은 사람이 산정",
      });
    }
  }
  return {
    investment_items: rows.length > 0 ? rows : null,
    key_evidence: strList(raw.key_evidence, 8),
    cautions: strList(raw.cautions, 8),
  };
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ oppId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const denied = requireBusinessActor(ctx, "write", { viewerMessage: "투자비 항목 추천 생성은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, market_scope, value_chain_node, attractiveness_score, synergy_score, capability_gap_json FROM opportunity WHERE id = ?")
    .get(oppId) as
    | { id: string; name: string; market_scope: string | null; value_chain_node: string | null; attractiveness_score: number | null; synergy_score: number | null; capability_gap_json: string | null }
    | null;
  if (!opp) return notFound();
  const gapRegister = parseGapRegister(opp.capability_gap_json);
  const assessment = db
    .query("SELECT entry_strategy FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(oppId) as { entry_strategy: string | null } | undefined;

  // 매니페스트 (flow.spec S5 inputs): S4 트랙 결정 + S1 시장 정의 + S3 필요 역량·해소 방식 + 진출전략
  const s4 = getCurrentRouteDecision(oppId, db) ?? undefined;
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
      const m = (JSON.parse(version.payload) as { matrix?: { anchor?: { total?: number }; consistency?: { bottomUpCagr?: number } } }).matrix ?? {};
      s1 = [
        `기준 규모: ${m.anchor?.total ? `$${m.anchor.total.toFixed(2)}B` : "미상"}`,
        `CAGR: ${m.consistency?.bottomUpCagr != null ? `${m.consistency.bottomUpCagr.toFixed(1)}%` : "미상"}`,
      ].filter(Boolean).join("\n");
    } catch { /* keep default */ }
  }
  const resolutionLines = gapRegister.rows
    .filter((r) => r.resolution)
    .map((r) => `- ${r.capability}: ${RESOLUTION_LABEL[r.resolution as GapResolution]}`);
  const s3 = [
    `시너지 점수: ${opp.synergy_score ?? "미평가"}`,
    `매력도: ${opp.attractiveness_score ?? "미평가"}`,
    resolutionLines.length > 0 ? `역량 해소 방식:\n${resolutionLines.join("\n")}` : "역량 해소 방식: 아직 결정되지 않음",
  ].join("\n");
  const manifest = ["S4 트랙 결정(greenfield)", "S1 시장 정의", "S3 필요 역량·해소 방식", "S5 진출전략"];
  const context = [
    `기회명: ${opp.name} / 시장: ${opp.market_scope ?? "미정"} / 가치사슬: ${opp.value_chain_node ?? "미정"}`,
    `\n[S4 트랙 결정]\n${s4 ? `트랙: ${s4.track}${s4.sub_track ? ` / 라우트: ${s4.sub_track}` : ""}` : "없음"}`,
    `\n[S1 시장 정의]\n${s1}`,
    `\n[S3 필요 역량·해소 방식]\n${s3}`,
    `\n[S5 진출전략]\n${entryStrategyText(assessment?.entry_strategy) || "아직 작성되지 않음"}`,
  ].join("\n");

  let payload: RecoPayload;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  if (isLlmConfigured()) {
    const res = await completeOrFallback(
      [
        systemMessage("s5.greenfield_recommendation"),
        {
          role: "user" as const,
          content:
            "이 greenfield 기회의 S8 사업성 분석에 필요한 투자비 검토 요건(항목)을 제안하세요. " +
            "해소 방식(구축→설비 투자, 영입→인건비, 파트너십/투자→운영비·지분 투자금 등)과 진출전략을 근거로 " +
            "고려해야 할 항목명과 분류(category: labor=인건비 | opex=운영비 | capex=설비투자 | revenue=수익 | gov_rnd=정부 R&D 지원금)와 근거만 " +
            "제시하고, 구체적 금액은 절대 지어내지 마세요(금액은 사람이 입력).\n" +
            `JSON: {"investment_items":[{"line":"항목명(예: 생산설비 투자, 초기 인건비)","category":"labor|opex|capex|revenue|gov_rnd","note":"이 항목이 필요한 근거"}],"key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
        },
      ],
      () => "",
      { maxTokens: 1600, agent: promptAgent("s5.greenfield_recommendation") },
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
        note = "LLM 제안 — 금액은 포함되지 않습니다. 항목을 추가한 뒤 사람이 금액을 입력·저장합니다 (경계 #2).";
      } else {
        payload = synthesis(payloadFallback(s4), manifest);
        note = "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
      }
    } else {
      payload = synthesis(payloadFallback(s4), manifest);
      note = "LLM 호출 실패 — 결정론 폴백으로 대체했습니다.";
    }
  } else {
    payload = synthesis(payloadFallback(s4), manifest);
    note = "LLM 미구성 — 결정론 폴백(항목 제안 없음). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }

  appendAudit(db, { actor: ctx.userId, action: "greenfield_recommendation.generate", target: `${oppId}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, recommendation: payload }, 200);
});

function payloadFallback(s4: { track: string; sub_track: string | null; total_score: number | null } | undefined): { keyEvidence: string[] } {
  return { keyEvidence: [`S4 트랙: ${s4?.track ?? "없음"}${s4?.sub_track ? ` (${s4.sub_track})` : ""}`] };
}

function synthesis(fb: { keyEvidence: string[] }, manifest: string[]): RecoPayload {
  return {
    investment_items: null,
    key_evidence: fb.keyEvidence,
    cautions: [`LLM 미구성 또는 실패 — 매니페스트(${manifest.join(", ")}) 기반 항목 제안은 포함되지 않았습니다.`],
  };
}
