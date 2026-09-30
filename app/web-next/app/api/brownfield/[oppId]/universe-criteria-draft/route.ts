// POST /api/brownfield/[oppId]/universe-criteria-draft — S6 Target Universe
// 선정 기준 LLM 초안 (ADR-0118 계약). 입력 매니페스트는 flow.spec S6 선언
// 입력으로 한정한다: S1 시장분석(해당 산업의 최근 완료 버전), S3 필요 역량
// (opportunity.capability_gap_json, flow.spec v2.4.0), 현재 Long List 현황.
// 저장은 없다 — "적용"은 UniverseForm 입력만 채우고 Universe 저장(사람 클릭)으로
// 확정된다. S1·S3 근거가 전혀 없으면 LLM을 호출하지 않고 제안을 보류한다 —
// 근거 없는 기준을 날조하지 않는다.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, type LlmOrFallback } from "../../../../../lib/llm.ts";
import { systemMessage } from "../../../../../lib/prompts.ts";

interface DraftCriteria {
  industry: string;
  region: string;
  size: string;
  rationale: string;
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "평가 기준 초안 생성은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, market_scope, capability_gap_json FROM opportunity WHERE id = ?")
    .get(oppId) as { id: string; name: string; market_scope: string | null; capability_gap_json: string | null } | undefined;
  if (!opp) return notFound();

  // ── 입력 매니페스트 (이 제안이 본 산출물) ──
  const manifest: string[] = [];
  const ind = opp.market_scope
    ? (db.query("SELECT id, name_ko FROM md_industry WHERE name_ko = ? LIMIT 1").get(opp.market_scope) as { id: string; name_ko: string } | undefined)
    : undefined;
  const version = ind
    ? db
        .query(
          `SELECT v.payload FROM market_sizing_version v
           JOIN market_sizing_analysis a ON a.id = v.analysis_id
           WHERE a.industry_id = ? AND a.status = 'completed'
           ORDER BY v.version_no DESC LIMIT 1`,
        )
        .get(ind.id) as { payload: string } | undefined
    : undefined;
  let s1Context = "";
  if (version) {
    manifest.push("S1 시장분석 (최근 완료 버전)");
    try {
      const payload = JSON.parse(version.payload) as {
        matrix?: { industryLabel?: string; anchor?: { total?: number }; competitive?: { structure?: string } };
      };
      const m = payload.matrix ?? {};
      s1Context = [
        m.industryLabel ? `산업: ${m.industryLabel}` : "",
        m.anchor?.total ? `기준 시장규모(2026, 글로벌): $${m.anchor.total.toFixed(2)}B` : "",
        m.competitive?.structure ? `경쟁 구조: ${m.competitive.structure}` : "",
      ].filter(Boolean).join("\n");
    } catch {
      // payload 파싱 실패 시에도 나머지 매니페스트로 제안은 가능.
    }
  }
  let capabilityContext = "";
  if (opp.capability_gap_json) {
    try {
      const gap = JSON.parse(opp.capability_gap_json) as { rows?: Array<{ capability?: string }> };
      const caps = (gap.rows ?? []).map((r) => str(r.capability, 60)).filter(Boolean);
      if (caps.length > 0) {
        manifest.push("S3 필요 역량 (역량 갭 레지스터)");
        capabilityContext = `필요 역량: ${caps.slice(0, 8).join(" / ")}`;
      }
    } catch {
      // register가 깨져 있어도 제안은 진행.
    }
  }
  const longListCount = (db.query("SELECT COUNT(*) c FROM brownfield_target WHERE opportunity_id = ? AND status != 'excluded'").get(oppId) as { c: number }).c;
  manifest.push("Long List 현황");
  const existingDefinition = (
    db.query("SELECT target_universe_json FROM opportunity WHERE id = ?").get(oppId) as { target_universe_json: string | null }
  ).target_universe_json;

  // S1·S3 근거가 모두 없으면 LLM을 부르지 않는다 — 근거 없는 기준 날조 방지.
  if (!s1Context && !capabilityContext) {
    return ok(
      {
        source: "synthesis",
        provider: "deterministic",
        note: "제안에 필요한 S1 시장분석·S3 필요 역량 산출물이 아직 없습니다 — 먼저 S1 분석을 완료하거나 S3 역량 갭을 작성하세요.",
        criteria: null,
        manifest,
      },
      200,
      { no_grounding: true },
    );
  }

  const llmRes: LlmOrFallback = await completeOrFallback(
    [
      systemMessage("s6.universe_criteria_draft"),
      {
        role: "user" as const,
        content: [
          `검토/안건: ${opp.name}`,
          s1Context,
          capabilityContext,
          `현재 Long List: ${longListCount}건 (제외 제외)`,
          existingDefinition ? `기존 정의(참고): ${existingDefinition.slice(0, 200)}` : "",
          "",
          "위 근거로 대상 후보(Long List)의 선정 기준을 제안하세요. JSON만 반환:",
          '{"criteria":{"industry":"산업 범위 (한 문장)","region":"지역 범위 (한 문장)","size":"규모 조건 (한 문장)","rationale":"이 기준을 제안한 근거 2~3문장 — S1/S3 산출물을 인용"}}',
        ].filter(Boolean).join("\n"),
      },
    ],
    () => "",
    {
      maxTokens: 800,
      agent: {
        key: "brownfield-agent",
        purpose: "S6 유니버스 선정 기준 초안 — S1·S3 산출물 기반 제안",
        contextType: "opportunity",
        contextId: oppId,
      },
    },
  );

  appendAudit(db, { actor: auth.auth.userId, action: "universe_criteria.draft", target: oppId, now: new Date().toISOString() });

  if (llmRes.source !== "llm") {
    return ok(
      {
        source: "synthesis",
        provider: llmRes.provider,
        note: "LLM 호출 실패 — 결정론 폴백으로는 근거 없는 기준을 만들지 않습니다.",
        criteria: null,
        manifest,
      },
      200,
      { no_grounding: true },
    );
  }
  const parsed = parseJson(llmRes.text);
  const c = (parsed?.criteria ?? null) as Record<string, unknown> | null;
  const criteria: DraftCriteria | null = c
    ? {
        industry: str(c.industry, 200),
        region: str(c.region, 200),
        size: str(c.size, 200),
        rationale: str(c.rationale, 600),
      }
    : null;
  if (!criteria || !criteria.industry) {
    return ok(
      { source: "llm", provider: llmRes.provider, note: "LLM 응답을 해석하지 못했습니다 — 다시 생성해 보세요.", criteria: null, manifest },
      200,
      { parse_failed: true },
    );
  }
  return ok({ source: "llm", provider: llmRes.provider, note: null, criteria, manifest }, 200, { drafted: true });
}
