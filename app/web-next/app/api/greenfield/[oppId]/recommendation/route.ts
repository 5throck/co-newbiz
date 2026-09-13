// S5 역량 평가·진출전략 LLM 추천 (ADR-0118) — flow.spec S5 inputs(트랙 결정·S1
// 시장 정의·S3 필요 역량)만 컨텍스트로 읽는다. 역량 격차 행과 Build/Partner/
// Hire/Invest 전략 초안을 제안하며, 저장(POST /api/greenfield/[oppId])은 사람의
// 행위다. On-demand, 비영속, 결정론 폴백은 수준 값을 위조하지 않는다.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";

const APPROACHES = ["build", "partner", "hire", "invest"] as const;

interface RecoPayload {
  capability_rows: Array<{ capability: string; required_level: string; current_level: string; gap: string; resolution: string; note: string }> | null;
  strategy_draft: string;
  alternatives_draft: string | null;
  rationale_draft: string;
  key_evidence: string[];
  cautions: string[];
}

function strList(raw: unknown, max: number): string[] {
  return Array.isArray(raw)
    ? raw.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, max)
    : [];
}

function normalize(raw: Record<string, unknown>): RecoPayload {
  const rows: RecoPayload["capability_rows"] = [];
  if (Array.isArray(raw.capability_rows)) {
    for (const item of raw.capability_rows as Array<Record<string, unknown>>) {
      const capability = String(item?.capability ?? "").trim().slice(0, 200);
      if (!capability || rows.length >= 10) continue;
      const resolution = String(item?.resolution ?? item?.approach ?? "").trim().toLowerCase();
      rows.push({
        capability,
        required_level: String(item?.required_level ?? "").trim().slice(0, 60) || "검증 필요",
        current_level: String(item?.current_level ?? "").trim().slice(0, 60) || "검증 필요",
        gap: String(item?.gap ?? "").trim().slice(0, 120) || "검증 필요",
        resolution: (APPROACHES as readonly string[]).includes(resolution) ? resolution : "build",
        note: String(item?.note ?? "").trim().slice(0, 300),
      });
    }
  }
  return {
    capability_rows: rows.length > 0 ? rows : null,
    strategy_draft: String(raw.strategy_draft ?? raw.entry_strategy ?? "").trim().slice(0, 1500),
    alternatives_draft: String(raw.alternatives_draft ?? "").trim().slice(0, 1000) || null,
    rationale_draft: String(raw.rationale_draft ?? "").trim().slice(0, 1500),
    key_evidence: strList(raw.key_evidence, 8),
    cautions: strList(raw.cautions, 8),
  };
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ oppId: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "역량·전략 추천 생성은 analyst 역할 이상이어야 합니다.");
  const { oppId } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, market_scope, value_chain_node, rationale, attractiveness_score, synergy_score, fit_verdict, fit_rationale FROM opportunity WHERE id = ?")
    .get(oppId) as
    | { id: string; name: string; market_scope: string | null; value_chain_node: string | null; rationale: string | null; attractiveness_score: number | null; synergy_score: number | null; fit_verdict: string | null; fit_rationale: string | null }
    | null;
  if (!opp) return notFound();

  // 매니페스트 (flow.spec S5 inputs): S4 트랙 결정 + S1 시장 정의 + S3 필요 역량
  const s4 = db
    .query("SELECT track, sub_track, total_score FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1")
    .get(oppId) as { track: string; sub_track: string | null; total_score: number | null } | undefined;
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
      const m = (JSON.parse(version.payload) as { matrix?: { anchor?: { total?: number }; consistency?: { bottomUpCagr?: number }; qualitative?: { opportunityFactors?: string[] } } }).matrix ?? {};
      s1 = [
        `기준 규모: ${m.anchor?.total ? `$${m.anchor.total.toFixed(2)}B` : "미상"}`,
        `CAGR: ${m.consistency?.bottomUpCagr != null ? `${m.consistency.bottomUpCagr.toFixed(1)}%` : "미상"}`,
        m.qualitative?.opportunityFactors?.length ? `기회 요인: ${m.qualitative.opportunityFactors.join(" / ")}` : "",
      ].filter(Boolean).join("\n");
    } catch { /* keep default */ }
  }
  const s3 = [
    `적합성 판정: ${opp.fit_verdict ?? "없음"}${opp.fit_rationale ? ` — ${opp.fit_rationale}` : ""}`,
    `시너지 점수: ${opp.synergy_score ?? "미평가"}`,
    `매력도: ${opp.attractiveness_score ?? "미평가"}`,
  ].join("\n");
  const manifest = ["S4 트랙 결정(greenfield)", "S1 시장 정의", "S3 필요 역량·진입 조건"];
  const context = [
    `기회명: ${opp.name} / 시장: ${opp.market_scope ?? "미정"} / 가치사슬: ${opp.value_chain_node ?? "미정"}`,
    `\n[S4 트랙 결정]\n${s4 ? `트랙: ${s4.track}${s4.sub_track ? ` / 라우트: ${s4.sub_track}` : ""}` : "없음"}`,
    `\n[S1 시장 정의]\n${s1}`,
    `\n[S3 필요 역량·진입 조건]\n${s3}`,
  ].join("\n");

  let payload: RecoPayload;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  if (isLlmConfigured()) {
    const res = await completeOrFallback(
      [
        {
          role: "system" as const,
          content:
            "당신은 그린필드 신규사업 기획자입니다. 최종 역량 평가·진출전략은 사람이 확정하며 당신 산출물은 제안입니다. " +
            "제공된 S1·S3·S4 산출물 안에서만 판단하고, 확인 불가능한 수준 값은 '검증 필요'로 쓰세요. JSON만 반환합니다.",
        },
        {
          role: "user" as const,
          content:
            "이 greenfield 기회의 역량 격차 평가와 진출전략 초안을 작성하세요. 해소 방식(resolution)은 build|partner|hire|invest 중 하나입니다.\n" +
            `JSON: {"capability_rows":[{"capability":"역량명","required_level":"필요 수준","current_level":"보유 수준(모르면 검증 필요)","gap":"격차 요약","resolution":"build|partner|hire|invest","note":"판단 근거"}],"strategy_draft":"진출전략 초안 3~5문장","alternatives_draft":"검토한 대안","rationale_draft":"평가 근거(S1·S3 인용)","key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
        },
      ],
      () => "",
      { maxTokens: 2200, agent: { key: "greenfield-agent", purpose: "S5 역량 평가 추천 초안" } },
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
        note = "LLM 제안 — 폼에 반영해 수정한 뒤 사람이 저장합니다 (경계 #2).";
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
    note = "LLM 미구성 — 결정론 폴백(격차 행 없음). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }

  appendAudit(db, { actor: ctx.userId, action: "greenfield_recommendation.generate", target: `${oppId}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, recommendation: payload }, 200);
});

function payloadFallback(s4: { track: string; sub_track: string | null; total_score: number | null } | undefined): { strategy: string; keyEvidence: string[] } {
  const strategy = !s4
    ? "S4 트랙 결정이 없어 전략 초안을 산출할 수 없습니다 — 진출방식 결정(S4)을 먼저 기록하세요."
    : s4.sub_track === "intra_venture"
      ? "결정론 폴백 — S4 결정이 사내벤처(CVC) 라우트이므로 소규모 베팅·단계적 투자 관점의 진출전략을 권장합니다. 격차 행은 LLM 구성 후 생성하거나 사람이 직접 작성하세요."
      : "결정론 폴백 — S4 결정이 기존 사업 R&BD 확장 라우트이므로 자사 보유 역량 확장 관점의 진출전략을 권장합니다. 격차 행은 LLM 구성 후 생성하거나 사람이 직접 작성하세요.";
  return { strategy, keyEvidence: [`S4 트랙: ${s4?.track ?? "없음"}${s4?.sub_track ? ` (${s4.sub_track})` : ""}`] };
}

function synthesis(fb: { strategy: string; keyEvidence: string[] }, manifest: string[]): RecoPayload {
  return {
    capability_rows: null,
    strategy_draft: fb.strategy,
    alternatives_draft: null,
    rationale_draft: `결정론 폴백 — 매니페스트(${manifest.join(", ")}) 기반 요약이며 격차 수준 값은 위조하지 않습니다.`,
    key_evidence: fb.keyEvidence,
    cautions: ["LLM 미구성 또는 실패 — 역량 격차 행 초안은 포함되지 않았습니다."],
  };
}
