// S2 business-model-sketch activity (greenfield-agent, scenario-planning
// skill) — generates a one-page business model sketch for an opportunity from
// its linked industry's S1 market analysis. Persisted on the opportunity row
// (sketch_json/sketch_source/sketch_at, migration 0050) so the funnel card can
// show it; regenerating overwrites with a new provenance-stamped version.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { normalizeSketchV2, SKETCH_BLOCKS } from "../../../../../lib/sketch-schema.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";

const now = () => new Date().toISOString();

// GET — 현재 비즈니스 모델 검토 + 버전 이력 (ADR-0127). ?version=N으로 과거
// 버전 하나의 전체 내용을 열람할 수 있다. 생성은 POST(사람의 행위)다.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, sketch_json, sketch_source, sketch_at FROM opportunity WHERE id = ?")
    .get(id) as { id: string; sketch_json: string | null; sketch_source: string | null; sketch_at: string | null } | null;
  if (!opp) return notFound();

  const url = new URL(request.url);
  const versionParam = url.searchParams.get("version");
  if (versionParam) {
    const row = db
      .query("SELECT version_no, sketch_json, source, created_at FROM opportunity_sketch_version WHERE opportunity_id = ? AND version_no = ?")
      .get(id, Number(versionParam)) as { version_no: number; sketch_json: string; source: string | null; created_at: string } | undefined;
    if (!row) return notFound();
    return ok({ id, version_no: row.version_no, sketch: JSON.parse(row.sketch_json), source: row.source, created_at: row.created_at, cached: true });
  }

  const versions = db
    .query("SELECT version_no, source, created_at FROM opportunity_sketch_version WHERE opportunity_id = ? ORDER BY version_no DESC")
    .all(id) as Array<{ version_no: number; source: string | null; created_at: string }>;
  return ok({
    id,
    sketch: opp.sketch_json ? JSON.parse(opp.sketch_json) : null,
    source: opp.sketch_source,
    created_at: opp.sketch_at,
    versions,
    cached: true,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "스케치 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  // regenerateScenarios — 사용자 결정: 시나리오 전제(낙관/기본/비관)는 캔버스
  // 재생성과 성격이 다른 별도 행위다(캔버스는 자유롭게 다시 다듬는 초안,
  // 시나리오는 확정 후 유지되어야 하는 시장 가정). 기본 재생성(force만 true)은
  // 기존 시나리오를 그대로 보존하고 캔버스/시장진입/핵심리스크만 새로 만든다 —
  // 이 플래그가 true일 때만 시나리오도 함께 새로 만든다.
  const body = (await request.json().catch(() => null)) as { force?: boolean; regenerateScenarios?: boolean } | null;
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
      systemMessage("opportunity.sketch"),
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
    { maxTokens: 2400, agent: promptAgent("opportunity.sketch") },
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

  // 사용자 결정 — 캔버스 재생성과 시나리오 재생성은 서로 다른 행위이므로 한쪽만
  // 명시적으로 요청해도 다른 쪽은 조용히 덮어써지지 않는다:
  //   · 기본 재생성(force만 true) — 캔버스/시장진입/핵심리스크만 새로 만들고
  //     기존 시나리오는 그대로 유지한다.
  //   · 시나리오 재생성(regenerateScenarios=true) — 시나리오만 새로 만들고
  //     캔버스/시장진입/핵심리스크는 기존 값을 그대로 유지한다.
  // 최초 생성(기존 sketch 없음)은 전부 새로 만든다.
  if (opp.sketch_json) {
    try {
      const prev = JSON.parse(opp.sketch_json) as Partial<typeof sketch>;
      if (body?.regenerateScenarios) {
        if (prev.canvas) sketch.canvas = prev.canvas;
        if (prev.errc) sketch.errc = prev.errc;
        if (Array.isArray(prev.marketEntry)) sketch.marketEntry = prev.marketEntry;
        if (Array.isArray(prev.keyRisks)) sketch.keyRisks = prev.keyRisks;
      } else if (Array.isArray(prev.scenarios)) {
        sketch.scenarios = prev.scenarios;
      }
    } catch { /* 기존 payload 파싱 실패 — 새로 생성된 내용을 그대로 둔다 */ }
  }

  const ts = now();
  const source = res.source === "llm" && raw !== null ? "llm" : "synthesis";
  // ADR-0132 — 이미 LLM으로 생성된 스케치가 있는 상태에서 재생성이 LLM 장애로
  // 합성 폴백에 그치면, 기존 버전을 덮어쓰지 않고 실패를 알린다.
  if (opp.sketch_json && opp.sketch_source === "llm" && isLlmConfigured() && source !== "llm") {
    return ok({
      id: opp.id,
      sketch: JSON.parse(opp.sketch_json),
      source: opp.sketch_source,
      created_at: opp.sketch_at,
      cached: true,
      failed: true,
      error: "LLM 호출 실패 — 이전 스케치를 유지합니다. 잠시 후 다시 시도하세요.",
    }, 200);
  }
  // ADR-0127 — 버전 이력 append. opportunity.sketch_json은 "현재 버전"이고
  // 과거 검토는 이 테이블에서 열람한다.
  const maxNo = db
    .query("SELECT MAX(version_no) m FROM opportunity_sketch_version WHERE opportunity_id = ?")
    .get(opp.id) as { m: number | null };
  const nextNo = (maxNo.m ?? 0) + 1;
  db.run(
    `INSERT INTO opportunity_sketch_version (id, opportunity_id, version_no, sketch_json, source, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [ulid(), opp.id, nextNo, JSON.stringify(sketch), source, auth.auth.userId, ts],
  );
  db.run("UPDATE opportunity SET sketch_json = ?, sketch_source = ?, sketch_at = ? WHERE id = ?", [
    JSON.stringify(sketch), source, ts, opp.id,
  ]);
  appendAudit(db, { actor: auth.auth.userId, action: "opportunity.sketch", target: `${opp.id}:${source}`, now: ts });
  return ok({ id: opp.id, sketch, source, created_at: ts, version_no: nextNo, cached: false }, 200);
}

/** LLM 응답 파싱 실패 시의 폴백 원문 — normalizeSketchV2가 v2 골격으로 만든다. */
function parseFallback(opp: { name: string; rationale: string | null }, why: string): Record<string, unknown> {
  return {
    keyRisks: [`스케치 생성 결과 ${why} — ${opp.name} 기준 결정론 폴백. LLM 구성 후 재생성 권장`],
  };
}
