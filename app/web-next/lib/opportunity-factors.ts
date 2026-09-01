// S2 평가 요인 (기회/위험) — 자동 도출(insight-synthesis: LLM + 시장분석 근거)
// 과 수동 등록을 함께 지원한다. 저장은 opportunity.factors_json (0051).
// 매력도 평가가 요인 근거 위에서 이루어지도록 하는 것이 목적이다.
import { getDb } from "../../../db/client.ts";
import { completeOrFallback } from "../lib/llm.ts";

export interface OppFactors {
  opportunity: string[];
  risk: string[];
}

export function readFactors(row: { factors_json: string | null }): OppFactors {
  if (!row.factors_json) return { opportunity: [], risk: [] };
  try {
    const parsed = JSON.parse(row.factors_json) as Partial<OppFactors>;
    return {
      opportunity: Array.isArray(parsed.opportunity) ? parsed.opportunity : [],
      risk: Array.isArray(parsed.risk) ? parsed.risk : [],
    };
  } catch {
    return { opportunity: [], risk: [] };
  }
}

export function saveFactors(db: ReturnType<typeof getDb>, id: string, factors: OppFactors, source: string): void {
  db.run("UPDATE opportunity SET factors_json = ?, factors_source = ?, factors_at = ? WHERE id = ?", [
    JSON.stringify(factors), source, new Date().toISOString(), id,
  ]);
}

interface OppRow {
  id: string;
  name: string;
  market_scope: string | null;
  value_chain_node: string | null;
  rationale: string | null;
}

/** 산업 S1 매트릭스 근거를 모아 LLM(없으면 결정론)으로 요인을 도출해 저장한다. */
export async function deriveAndSaveFactors(db: ReturnType<typeof getDb>, opp: OppRow): Promise<{ factors: OppFactors; source: string }> {
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
        externalForecast?: { gapAnalysis?: string; newDrivers?: string[] };
      };
    }).matrix ?? {};
    context += [
      m.anchor?.total ? `\n기준 시장규모(2026 글로벌): $${m.anchor.total.toFixed(2)}B` : "",
      m.chainDirection?.relatedIndustries?.length ? `\n인접 산업: ${m.chainDirection.relatedIndustries.map((r) => r.name).join(", ")}` : "",
      m.competitive?.structure ? `\n경쟁 구조: ${m.competitive.structure}` : "",
      m.qualitative?.opportunityFactors?.length ? `\n산업 기회 요인: ${m.qualitative.opportunityFactors.join(" / ")}` : "",
      m.qualitative?.riskFactors?.length ? `\n산업 위험 요인: ${m.qualitative.riskFactors.join(" / ")}` : "",
      m.externalForecast?.gapAnalysis ? `\n격차 분석: ${m.externalForecast.gapAnalysis}` : "",
      m.externalForecast?.newDrivers?.length ? `\n신규·강화 드라이버: ${m.externalForecast.newDrivers.join(" / ")}` : "",
    ].join("");
  }

  const res = await completeOrFallback(
    [
      {
        role: "system" as const,
        content:
          "당신은 신규사업 평가 전문가입니다. 제공된 근거 안에서만 이 기회의 기회 요인과 위험 요인을 도출하세요. 근거가 없는 항목은 만들지 말고 '검증 필요'로 표기하세요.",
      },
      {
        role: "user" as const,
        content:
          `이 기회에 투자 판단을 내리기 위해 볼 기회 요인과 위험 요인을 각 2~4개 도출하세요. JSON: {"opportunity":["기회 요인", ...],"risk":["위험 요인", ...]}. 각 항목은 한 문장.\n\n${context}`,
      },
    ],
    () =>
      JSON.stringify({
        opportunity: ["시장분석 기회 요인 기반 — 자동 도출 실패, 수동 등록 필요"],
        risk: ["자동 도출 실패 — LLM 구성 또는 수동 등록 필요"],
      }),
    { maxTokens: 1200 },
  );

  const text = res.text;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let factors: OppFactors;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Partial<OppFactors>;
    factors = {
      opportunity: (Array.isArray(parsed.opportunity) ? parsed.opportunity : []).filter((x): x is string => typeof x === "string").slice(0, 5),
      risk: (Array.isArray(parsed.risk) ? parsed.risk : []).filter((x): x is string => typeof x === "string").slice(0, 5),
    };
  } catch {
    factors = { opportunity: [], risk: [] };
  }
  if (factors.opportunity.length === 0 && factors.risk.length === 0) {
    factors = {
      opportunity: ["자동 도출 실패 — 수동 등록 필요"],
      risk: ["자동 도출 실패 — 수동 등록 필요"],
    };
  }
  const source = res.source === "llm" ? "llm" : "synthesis";
  saveFactors(db, opp.id, factors, source);
  return { factors, source };
}

/** 기회 행 + 현재 저장된 요인을 한 번에 읽는 편의 함수. */
export function loadOpportunityWithFactors(id: string): { opp: OppRow; factors: OppFactors; source: string | null } | null {
  const row = getDb()
    .query("SELECT id, name, market_scope, value_chain_node, rationale, factors_json, factors_source FROM opportunity WHERE id = ?")
    .get(id) as (OppRow & { factors_json: string | null; factors_source: string | null }) | undefined;
  if (!row) return null;
  return { opp: row, factors: readFactors(row), source: row.factors_source };
}
