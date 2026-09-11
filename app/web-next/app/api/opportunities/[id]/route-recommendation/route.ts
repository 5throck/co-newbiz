// S4 LLM route recommendation — the decision-support side of boundary #2
// (CLAUDE.md amendment 2026-09-11): the FINAL decision (track, route, intent,
// 5-criteria scoring) is recorded by a human in POST /route-decision; this
// endpoint only DRAFTS a proposal from the S1~S3 artifacts already in the DB
// plus the deterministic track advisory (ADR-0104). Nothing is persisted —
// every click regenerates, and the response carries its source ("llm" |
// "synthesis") so the UI can label provenance. Without an LLM configured (or
// when the LLM output fails parsing/normalization) the deterministic
// synthesis echoes the advisory signals and never fabricates 5-criteria
// scores — drafting scores is the LLM's or the human's job, not a template's.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { computeTrackAdvisory, type TrackAdvisory } from "../../../../../lib/track-advisory.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";

const TRACKS = ["greenfield", "brownfield"] as const;
const GF_SUB = ["existing_business_rbd", "intra_venture"] as const;
const BF_SUB = ["m_and_a", "jv", "strategic_investment", "minority_investment", "partnership", "rbd", "corporate_venture"] as const;
const INTENTS = ["integration", "capability_access"] as const;
const CRITERIA = ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"] as const;

interface RecoDraft {
  track: (typeof TRACKS)[number];
  sub_track: string | null;
  intent: string | null;
  confidence: string | null;
  scores: Array<{ criterion: string; score: number; evidence_note: string }> | null;
  rationale_draft: string;
  alternatives_draft: string | null;
  key_evidence: string[];
  cautions: string[];
}

function strList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => String(s ?? "").trim().slice(0, 300))
    .filter((s) => s !== "")
    .slice(0, max);
}

/** Whitelist-clamp the LLM's JSON into a RecoDraft — never trusted raw. */
function normalizeReco(raw: Record<string, unknown>, advisory: TrackAdvisory): RecoDraft {
  const rawTrack = String(raw.track ?? "");
  const track = (TRACKS as readonly string[]).includes(rawTrack)
    ? (rawTrack as RecoDraft["track"])
    : advisory.recommendedTrack !== "neutral"
      ? advisory.recommendedTrack
      : advisory.greenfieldScore >= advisory.brownfieldScore ? "greenfield" : "brownfield";
  const subWhitelist = track === "greenfield" ? GF_SUB : BF_SUB;
  const rawSub = String(raw.sub_track ?? "").trim();
  const subTrack = (subWhitelist as readonly string[]).includes(rawSub) ? rawSub : null;
  const rawIntent = String(raw.intent ?? "").trim();
  const intent = (INTENTS as readonly string[]).includes(rawIntent) ? rawIntent : null;
  const rawConfidence = String(raw.confidence ?? "").trim().toLowerCase();
  const confidence = ["high", "medium", "low"].includes(rawConfidence) ? rawConfidence : null;

  const seen = new Set<string>();
  const scores: RecoDraft["scores"] = [];
  if (Array.isArray(raw.scores)) {
    for (const item of raw.scores as Array<Record<string, unknown>>) {
      const criterion = String(item?.criterion ?? "").trim();
      const score = Number(item?.score);
      if (!(CRITERIA as readonly string[]).includes(criterion) || seen.has(criterion)) continue;
      if (!Number.isInteger(score) || score < 1 || score > 3) continue;
      seen.add(criterion);
      scores.push({ criterion, score, evidence_note: String(item?.evidence_note ?? "").trim().slice(0, 500) || "검증 필요" });
    }
  }

  return {
    track,
    sub_track: subTrack,
    intent,
    confidence,
    scores: scores.length > 0 ? scores : null,
    rationale_draft: String(raw.rationale_draft ?? "").trim().slice(0, 2000),
    alternatives_draft: String(raw.alternatives_draft ?? "").trim().slice(0, 1000) || null,
    key_evidence: strList(raw.key_evidence, 8),
    cautions: strList(raw.cautions, 8),
  };
}

/** No-LLM (or unparseable-LLM) path — advisory echo, no fabricated scores. */
function synthesisReco(advisory: TrackAdvisory, oppName: string, why: string): RecoDraft {
  const track =
    advisory.recommendedTrack !== "neutral"
      ? advisory.recommendedTrack
      : advisory.greenfieldScore >= advisory.brownfieldScore ? "greenfield" : "brownfield";
  return {
    track,
    sub_track: null,
    intent: null,
    confidence: "low",
    scores: null,
    rationale_draft:
      `결정론 폴백 — 결정론 어드바이저는 ${track}을 가리킵니다 (Greenfield ${advisory.greenfieldScore} : Brownfield ${advisory.brownfieldScore}). ` +
      `${oppName}에 대한 5기준 채점과 근거 서술은 LLM 구성 후 'LLM 추천 생성'으로 받거나 사람이 직접 작성해야 합니다.`,
    alternatives_draft: null,
    key_evidence: advisory.signals.map((s) => `${s.label}: ${s.note}`),
    cautions: [...advisory.reReviewTriggers, why],
  };
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "LLM 추천 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, market_scope, value_chain_node, rationale, attractiveness_score, synergy_score, fit_verdict, fit_rationale, market_size_krw_m, growth_rate FROM opportunity WHERE id = ?")
    .get(id) as
    | { id: string; name: string; market_scope: string | null; value_chain_node: string | null; rationale: string | null; attractiveness_score: number | null; synergy_score: number | null; fit_verdict: string | null; fit_rationale: string | null; market_size_krw_m: number | null; growth_rate: number | null }
    | null;
  if (!opp) return notFound();
  // S4 화면과 동일한 전제 — 선별(selected)된 기회만 결정 작업의 대상이다.
  const row = db.query("SELECT status FROM opportunity WHERE id = ?").get(id) as { status: string } | undefined;
  if (!row || row.status !== "selected") return badRequest("invalid_request", "선별(selected)된 기회만 LLM 진출방식 추천을 받을 수 있습니다.");

  const advisory = computeTrackAdvisory(db, id);

  // S1 근거 — 기회의 산업의 최신 완료 시장분석 (스케치 생성과 동일한 출처).
  let s1 = "S1 시장분석: 없음";
  const ind = opp.market_scope
    ? db.query("SELECT id FROM md_industry WHERE name_ko = ? LIMIT 1").get(opp.market_scope) as { id: string } | undefined
    : undefined;
  const version = ind
    ? db.query(
        `SELECT v.payload FROM market_sizing_version v
         JOIN market_sizing_analysis a ON a.id = v.analysis_id
         WHERE a.industry_id = ? AND a.status = 'completed'
         ORDER BY v.version_no DESC LIMIT 1`,
      ).get(ind.id) as { payload: string } | undefined
    : undefined;
  if (version) {
    try {
      const m = (JSON.parse(version.payload) as {
        matrix?: {
          anchor?: { total?: number };
          consistency?: { bottomUpCagr?: number };
          competitive?: { structure?: string };
          qualitative?: { opportunityFactors?: string[]; riskFactors?: string[] };
        };
      }).matrix ?? {};
      s1 = [
        `기준 시장규모: ${m.anchor?.total ? `$${m.anchor.total.toFixed(2)}B` : "미상"}`,
        `CAGR: ${m.consistency?.bottomUpCagr !== undefined && m.consistency.bottomUpCagr !== null ? `${(m.consistency.bottomUpCagr * 100).toFixed(1)}%` : "미상"}`,
        m.competitive?.structure ? `경쟁 구조: ${m.competitive.structure}` : "",
        m.qualitative?.opportunityFactors?.length ? `기회 요인: ${m.qualitative.opportunityFactors.join(" / ")}` : "",
        m.qualitative?.riskFactors?.length ? `위험 요인: ${m.qualitative.riskFactors.join(" / ")}` : "",
      ].filter(Boolean).join("\n");
    } catch { /* malformed payload — keep the "없음" default */ }
  }

  // S3 근거 — 이 기회에 연결된 최신 완료 시너지 분석 (synergy_version payload).
  let s3 = "S3 시너지·적합성 평가: 없음";
  const synVersion = db
    .query(
      `SELECT v.payload FROM synergy_version v
       JOIN synergy_analysis sa ON sa.id = v.analysis_id
       WHERE sa.opportunity_id = ? AND sa.status = 'completed'
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(id) as { payload: string } | undefined;
  if (synVersion) {
    try {
      const p = JSON.parse(synVersion.payload) as {
        synergyScore?: number;
        synergyRationale?: string;
        shortList?: Array<{ area?: string; verdict?: string; reason?: string }>;
      };
      s3 = [
        `시너지 권고 점수: ${typeof p.synergyScore === "number" ? p.synergyScore : "미상"}`,
        p.synergyRationale ? `시너지 근거: ${p.synergyRationale}` : "",
        p.shortList?.length ? `우선 시너지 영역: ${p.shortList.map((s) => `${s.area ?? "?"}(${s.verdict ?? "?"})`).join(", ")}` : "",
      ].filter(Boolean).join("\n");
    } catch { /* malformed payload — keep the "없음" default */ }
  }

  const context = [
    `기회명: ${opp.name}`,
    `시장: ${opp.market_scope ?? "미정"}${opp.market_size_krw_m ? ` (규모 ${opp.market_size_krw_m} 백만원)` : ""}${opp.growth_rate !== null && opp.growth_rate !== undefined ? ` · 성장률 ${(opp.growth_rate * 100).toFixed(1)}%` : ""}`,
    `가치사슬 노드: ${opp.value_chain_node ?? "미정"}`,
    `발굴 근거: ${opp.rationale ?? "없음"}`,
    `매력도: ${opp.attractiveness_score ?? "미평가"} · 시너지 점수(기회 행): ${opp.synergy_score ?? "미평가"}`,
    `적합성 판정: ${opp.fit_verdict ?? "없음"}${opp.fit_rationale ? ` — ${opp.fit_rationale}` : ""}`,
    ``,
    `[S1 시장분석]\n${s1}`,
    ``,
    `[S3 시너지·적합성]\n${s3}`,
    ``,
    `[결정론 트랙 어드바이저 (ADR-0104) — 참고 신호]`,
    ...advisory.signals.map((s) => `- ${s.label} (${s.leans}, 가중치 ${s.weight}): ${s.note}`),
    advisory.reReviewTriggers.length > 0 ? `재검토 트리거: ${advisory.reReviewTriggers.join(" / ")}` : "",
  ].filter(Boolean).join("\n");

  const messages = [
    {
      role: "system" as const,
      content:
        "당신은 신규사업 검토 리드 PM입니다. 최종 결정(트랙·라우트·5기준 채점)은 반드시 사람이 기록하며, 당신의 산출물은 사람 결정을 돕는 제안(proposal)입니다. " +
        "제공된 S1~S3 근거와 결정론 어드바이저 신호 안에서만 판단하고 근거 없는 사실을 만들어내지 마세요. 근거가 부족하면 보수적으로 판단하고 근거란에 '검증 필요'를 명시하세요. JSON만 반환합니다.",
    },
    {
      role: "user" as const,
      content:
        "아래 기회의 S4 진출방식 결정 초안을 작성하세요.\n" +
        "채점은 통제 필요도(control_need)·역량 결정성(capability_criticality)·시장 불확실성(market_uncertainty)·통합 역량(integration_capacity)·역량확보 속도(speed_to_capability) 각 1~3점이며, " +
        "각 점수의 근거를 S1·S3 산출물 인용으로 한 문장씩 씁니다. 5기준 모두 채점하세요.\n" +
        "rationale_draft은 결정 근거 서술 초안(3~5문장), alternatives_draft은 검토한 대안과 사유입니다.\n" +
        `JSON: {"track":"greenfield|brownfield","sub_track":null|"existing_business_rbd|intra_venture|m_and_a|jv|strategic_investment|minority_investment|partnership|rbd|corporate_venture","intent":null|"integration|capability_access","confidence":"high|medium|low","scores":[{"criterion":"...","score":1,"evidence_note":"..."}],"rationale_draft":"...","alternatives_draft":"...","key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
    },
  ];

  let draft: RecoDraft;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  if (isLlmConfigured()) {
    const res = await completeOrFallback(messages, () => "", { maxTokens: 2200 });
    if (res.source === "llm") {
      const start = res.text.indexOf("{");
      const end = res.text.lastIndexOf("}");
      let raw: Record<string, unknown> | null = null;
      if (start !== -1 && end > start) {
        try { raw = JSON.parse(res.text.slice(start, end + 1)) as Record<string, unknown>; } catch { raw = null; }
      }
      if (raw) {
        draft = normalizeReco(raw, advisory);
        source = "llm";
        provider = res.provider;
        note = "LLM 제안 — 결정 폼에 반영해 검토·수정한 뒤 사람이 결정을 기록합니다 (경계 #2).";
      } else {
        draft = synthesisReco(advisory, opp.name, "LLM 응답을 파싱하지 못해 결정론 폴백으로 대체했습니다 — 재생성하거나 사람이 직접 작성하세요.");
        note = "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
      }
    } else {
      draft = synthesisReco(advisory, opp.name, "LLM 호출이 실패해 결정론 폴백으로 대체했습니다 — 제공자 상태를 확인하세요.");
      note = "LLM 호출 실패 — 결정론 폴백으로 대체했습니다.";
    }
  } else {
    draft = synthesisReco(advisory, opp.name, "LLM 미구성 — 이 제안은 결정론 신호 기반이며 5기준 채점 초안은 포함하지 않습니다.");
    note = "LLM 미구성 — 결정론 폴백(채점 초안 없음). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }

  appendAudit(db, { actor: ctx.userId, action: "route_recommendation.generate", target: `${id}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, recommendation: draft }, 200);
});
