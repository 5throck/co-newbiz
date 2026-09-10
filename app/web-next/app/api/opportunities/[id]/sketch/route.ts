// S2 business-model-sketch activity (greenfield-agent, scenario-planning
// skill) — generates a one-page business model sketch for an opportunity from
// its linked industry's S1 market analysis. Persisted on the opportunity row
// (sketch_json/sketch_source/sketch_at, migration 0050) so the funnel card can
// show it; regenerating overwrites with a new provenance-stamped version.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { normalizeSketchV2, SKETCH_BLOCKS } from "../../../../../lib/sketch-schema.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback } from "../../../../../lib/llm.ts";

const now = () => new Date().toISOString();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "스케치 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { force?: boolean } | null;
  const db = getDb();

  const opp = db
    .query("SELECT id, name, market_scope, value_chain_node, rationale, sketch_json, sketch_source, sketch_at FROM opportunity WHERE id = ?")
    .get(id) as
    | { id: string; name: string; market_scope: string | null; value_chain_node: string | null; rationale: string | null; sketch_json: string | null; sketch_source: string | null; sketch_at: string | null }
    | null;
  if (!opp) return notFound();

  // 이미 스케치가 있으면 재생성(force)이 아닌 한 그대로 돌려준다.
  if (opp.sketch_json && !body?.force) {
    return ok({ id: opp.id, sketch: JSON.parse(opp.sketch_json), source: opp.sketch_source, created_at: opp.sketch_at, cached: true });
  }

  // S1 근거 — 기회의 산업(없으면 rationale로 보완)
  let context = `기회명: ${opp.name}\n가치사슬 노드: ${opp.value_chain_node ?? "미정"}\n근거: ${opp.rationale ?? "없음"}`;
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
    const m = (JSON.parse(version.payload) as {
      matrix?: {
        anchor?: { total?: number };
        chainDirection?: { relatedIndustries?: Array<{ name?: string }> };
        competitive?: { structure?: string };
        qualitative?: { opportunityFactors?: string[]; riskFactors?: string[] };
      };
    }).matrix ?? {};
    context += [
      m.anchor?.total ? `\n기준 시장규모(2026 글로벌): $${m.anchor.total.toFixed(2)}B` : "",
      m.chainDirection?.relatedIndustries?.length ? `\n인접 산업: ${m.chainDirection.relatedIndustries.map((r) => r.name).join(", ")}` : "",
      m.competitive?.structure ? `\n경쟁 구조: ${m.competitive.structure}` : "",
      m.qualitative?.opportunityFactors?.length ? `\n기회 요인: ${m.qualitative.opportunityFactors.join(" / ")}` : "",
      m.qualitative?.riskFactors?.length ? `\n위험 요인: ${m.qualitative.riskFactors.join(" / ")}` : "",
    ].join("");
  }

  const res = await completeOrFallback(
    [
      {
        role: "system" as const,
        content:
          "당신은 신규사업 기획 전문가입니다. 제공된 기회 정보와 시장분석 근거 안에서만 한 페이지 비즈니스 모델 스케치(비즈니스 모델 캔버스 + 블루오션 ERRC)를 작성하세요. 근거가 없는 항목은 '검증 필요'로 명시하세요. JSON만 반환합니다.",
      },
      {
        role: "user" as const,
        content:
          `아래 기회의 비즈니스 모델 스케치를 작성하세요.\n` +
          `각 블록은 2~5개의 항목을 가지며, 항목은 "문자열" 또는 {"text":"항목","action":"eliminate|reduce|raise|create","why":"블루오션 관점에서 어떻게 나아갈지 한 문장"} 형태입니다.\n` +
          `action은 블루오션 4가지 행동 프레임워크(제거/감축/증대/창조) 관점에서 해당 항목이 어떻게 나아가야 하는지를 표시하며, 전략 변화 대상인 항목에만 붙이세요(전체에 붙이지 말 것).\n` +
          `JSON: {"schema":2,"canvas":{"keyPartners":[...],"keyActivities":[...],"keyResources":[...],"valuePropositions":[...],"customerRelationships":[...],"channels":[...],"customerSegments":[...],"costStructure":[...],"revenueStreams":[...]},"marketEntry":["1단계...","2단계..."],"keyRisks":["..."],"scenarios":[{"name":"낙관","assumption":"..."},{"name":"기본","assumption":"..."},{"name":"비관","assumption":"..."}]}\n\n${context}`,
      },
    ],
    () =>
      JSON.stringify({
        schema: 2,
        canvas: Object.fromEntries(
          SKETCH_BLOCKS.map((k) => [
            k,
            [{ text: "검증 필요 — 스케치 미생성(결정론 폴백). LLM 구성 후 재생성 권장", action: "reduce", why: "스케치가 합성 폴백으로 생성되어 분석가 확정이 필요합니다" }],
          ]),
        ),
        marketEntry: ["검증 필요"],
        keyRisks: ["스케치 미생성(결정론 폴백) — LLM 구성 후 재생성 권장"],
        scenarios: [
          { name: "낙관", assumption: "검증 필요" },
          { name: "기본", assumption: "검증 필요" },
          { name: "비관", assumption: "검증 필요" },
        ],
      }),
    { maxTokens: 2400 },
  );

  const text = res.text;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let raw: Record<string, unknown> | null = null;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    raw = null;
  }
  // 파싱 실패 시 400 대신 결정론 폴백 스케치로 저장한다 — 스키마 v2 구조는 항상 유지.
  const parseFailed = raw === null;
  const sketch = normalizeSketchV2(raw ?? parseFallback(opp, parseFailed ? "파싱 실패" : "미생성"));

  const ts = now();
  const source = res.source === "llm" && raw !== null ? "llm" : "synthesis";
  db.run("UPDATE opportunity SET sketch_json = ?, sketch_source = ?, sketch_at = ? WHERE id = ?", [
    JSON.stringify(sketch), source, ts, opp.id,
  ]);
  appendAudit(db, { actor: auth.auth.userId, action: "opportunity.sketch", target: `${opp.id}:${source}`, now: ts });
  return ok({ id: opp.id, sketch, source, created_at: ts, cached: false }, 200);
}

/** LLM 응답 파싱 실패 시의 폴백 원문 — normalizeSketchV2가 v2 골격으로 만든다. */
function parseFallback(opp: { name: string; rationale: string | null }, why: string): Record<string, unknown> {
  return {
    keyRisks: [`스케치 생성 결과 ${why} — ${opp.name} 기준 결정론 폴백. LLM 구성 후 재생성 권장`],
  };
}
