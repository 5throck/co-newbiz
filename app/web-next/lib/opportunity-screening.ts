// S3 시너지·전략적 적합성 (flow.spec v2.0.0) — 기회별 산출물 생성·판정.
//   synergy-analysis (risk-officer / assumption-audit): 시너지 점수 + 근거
//   strategic-fit-screening (process-governance-manager): Go/Hold/Kill 권고
// 둘 다 산업 S1 매트릭스(기회/위험 요인·격차 분석·경쟁 구조)를 근거로 하며,
// LLM 미구성 시 결정론 폴백(정직한 저신뢰 표기)으로 동작한다.
import { getDb } from "../../../db/client.ts";
import { completeOrFallback } from "./llm.ts";

export interface ScreeningState {
  synergy_score: number | null;
  synergy_rationale: string | null;
  fit_verdict: "Go" | "Hold" | "Kill" | null;
  fit_rationale: string | null;
  /** screening 진행 권고 — synergy+fit 산출물이 있을 때만 산출 */
  gate: { recommendation: "Go" | "Hold" | "Kill"; rationale: string } | null;
}

const now = () => new Date().toISOString();

function industryContext(marketScope: string | null, rationale: string | null): string {
  let context = `근거: ${rationale ?? "없음"}`;
  const ind = marketScope
    ? getDb().query("SELECT id FROM md_industry WHERE name_ko = ? LIMIT 1").get(marketScope) as { id: string } | undefined
    : undefined;
  const version = ind
    ? getDb().query(
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
        chainDirection?: { position?: string; relatedIndustries?: Array<{ name?: string }> };
        competitive?: { structure?: string };
        qualitative?: { opportunityFactors?: string[]; riskFactors?: string[] };
        externalForecast?: { gapAnalysis?: string; newDrivers?: string[] };
      };
    }).matrix ?? {};
    context += [
      m.anchor?.total ? `\n기준 시장규모(2026 글로벌): $${m.anchor.total.toFixed(2)}B` : "",
      m.chainDirection?.relatedIndustries?.length ? `\n인접 산업: ${m.chainDirection.relatedIndustries.map((r) => r.name).join(", ")}` : "",
      m.competitive?.structure ? `\n경쟁 구조: ${m.competitive.structure}` : "",
      m.qualitative?.opportunityFactors?.length ? `\n기회 요인: ${m.qualitative.opportunityFactors.join(" / ")}` : "",
      m.qualitative?.riskFactors?.length ? `\n위험 요인: ${m.qualitative.riskFactors.join(" / ")}` : "",
      m.externalForecast?.gapAnalysis ? `\n격차 분석: ${m.externalForecast.gapAnalysis}` : "",
      m.externalForecast?.newDrivers?.length ? `\n신규·강화 드라이버: ${m.externalForecast.newDrivers.join(" / ")}` : "",
    ].join("");
  } else {
    context += "\n(산업 시장분석 매트릭스 없음 — 분석가 입력에 의존)";
  }
  return context;
}

export function loadScreeningState(id: string): ScreeningState | null {
  const row = getDb()
    .query("SELECT synergy_score, synergy_rationale, fit_verdict, fit_rationale, attractiveness_score FROM opportunity WHERE id = ?")
    .get(id) as Omit<ScreeningState, "gate"> & { attractiveness_score: number | null } | undefined;
  if (!row) return null;
  return { ...row, gate: gateRecommendation(row) };
}

/** screening 진행 권고 — 스펙 판정기준(매력도·knock-out·시너지)을 조합.
 *  gate-brief.ts의 결정론 폴백도 동일 기준을 재사용한다 (ADR-0118). */
export function gateRecommendation(row: { attractiveness_score: number | null; synergy_score: number | null; fit_verdict: string | null }): ScreeningState["gate"] {
  if (row.synergy_score === null || !row.fit_verdict || row.attractiveness_score === null) return null;
  const attractiveness = row.attractiveness_score;
  const synergy = row.synergy_score;
  const recommendation = (row.fit_verdict === "Go" && synergy >= 60 && attractiveness >= 60) ? "Go"
    : (row.fit_verdict === "Kill" || synergy < 40 || attractiveness < 60) ? "Kill"
    : "Hold";
  return {
    recommendation,
    rationale: `시장 매력도 ${attractiveness}점 + 전략적 적합성 ${row.fit_verdict} + 시너지 ${synergy}점 → screening 진행 권고 ${recommendation} (합의 기준: 매력도 ≥ 60 AND 적합성 Go AND 시너지 ≥ 60 → Go, 그 외 Hold, 매력도 < 60 OR 적합성 Kill OR 시너지 < 40 → Kill)`,
  };
}

export async function runSynergyAnalysis(opp: { id: string; name: string; market_scope: string | null; attractiveness_score: number | null; rationale: string | null }): Promise<{ score: number; rationale: string; source: string }> {
  const context = industryContext(opp.market_scope, opp.rationale);
  const res = await completeOrFallback(
    [
      { role: "system" as const, content: "당신은 시너지 분석가(risk-officer)입니다. 제공된 근거 안에서만 자사와 이 기업(기회)의 시너지를 평가하세요. 근거가 없으면 낮은 점수와 '검증 필요'를 명시하세요." },
      {
        role: "user" as const,
        content:
          `이 기회와 자사 역량·포트폴리오 간의 시너지를 0-100 점으로 평가하세요. JSON: {"score":정수,"rationale":"근거 2~3문장 — 근거 요인(시장·경쟁·드라이버)을 인용하고 자사 보유 역량 가정을 명시"}. 기준: 60 이상 유의미한 시너지, 40 미만 시너지 부족.\n\n${context}`,
      },
    ],
    () =>
      JSON.stringify({
        score: Math.min(70, Math.max(30, (opp.attractiveness_score ?? 50) - 10)),
        rationale: `결정론 합성(저신뢰) — 매력도 ${opp.attractiveness_score ?? 50}점 기준 보수 추정. 산업 매트릭스 요인 대조 후 분석가 확정 필요.`,
      }),
    { maxTokens: 1000 },
  );
  const text = res.text;
  let score = Math.min(100, Math.max(0, (opp.attractiveness_score ?? 50) - 10));
  let rationale = `결정론 합성(저신뢰) — 분석가 확정 필요. ${opp.rationale ?? ""}`;
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { score?: unknown; rationale?: unknown };
    if (typeof parsed.score === "number") score = Math.min(100, Math.max(0, Math.round(parsed.score)));
    if (typeof parsed.rationale === "string" && parsed.rationale.trim()) rationale = parsed.rationale.trim();
  } catch { /* 폴백 값 유지 */ }
  const source = res.source === "llm" ? "llm" : "synthesis";
  if (source === "synthesis") rationale = `[결정론 합성 — 검증 필요] ${rationale}`;
  getDb().run("UPDATE opportunity SET synergy_score = ?, synergy_rationale = ? WHERE id = ?", [score, rationale, opp.id]);
  return { score, rationale, source };
}

export async function runFitAnalysis(opp: { id: string; name: string; market_scope: string | null; synergy_score: number | null; rationale: string | null }): Promise<{ verdict: "Go" | "Hold" | "Kill"; rationale: string; source: string }> {
  const context = industryContext(opp.market_scope, opp.rationale);
  const res = await completeOrFallback(
    [
      { role: "system" as const, content: "당신은 전략적 적합성 심사관(process-governance-manager)입니다. knock-out 기준과 포트폴리오 적합성 관점에서 Go/Hold/Kill 권고를 작성하세요. 근거 밖의 사실을 만들지 마세요." },
      {
        role: "user" as const,
        content:
          `이 기회의 전략적 적합성을 판정하세요. JSON: {"verdict":"Go|Hold|Kill","rationale":"판단 근거 2~3문장 — knock-out 관점(시장 축소·상품화, 규제, 자사 역량 괴리)과 포트폴리오 적합성을 인용"}. 기준: knock-out 없음+자사 역량 연계 가능=Go, 근거 부족 또는 보완 필요=Hold, 구조적 매력 부족(축소+상품화) 또는 역량 괴리=Kill.\n\n${context}`,
      },
    ],
    () =>
      JSON.stringify({
        verdict: "Hold",
        rationale: "결정론 폴백 — 자동 판단 근거 부족. 요인 자동 도출 후 재평가하거나 분석가가 직접 판정하세요.",
      }),
    { maxTokens: 1000 },
  );
  const text = res.text;
  let verdict: "Go" | "Hold" | "Kill" = "Hold";
  let rationale = "결정론 폴백 — 자동 판단 근거 부족. 요인 자동 도출 후 재평가하거나 분석가가 직접 판정하세요.";
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { verdict?: unknown; rationale?: unknown };
    if (typeof parsed.verdict === "string" && ["Go", "Hold", "Kill"].includes(parsed.verdict)) verdict = parsed.verdict as "Go" | "Hold" | "Kill";
    if (typeof parsed.rationale === "string" && parsed.rationale.trim()) rationale = parsed.rationale.trim();
  } catch { /* 폴백 유지 */ }
  const source = res.source === "llm" ? "llm" : "synthesis";
  if (source === "synthesis") rationale = `[결정론 합성 — 검증 필요] ${rationale}`;
  getDb().run("UPDATE opportunity SET fit_verdict = ?, fit_rationale = ? WHERE id = ?", [verdict, rationale, opp.id]);
  return { verdict, rationale, source };
}

export function stampDecision(id: string, userId: string): void {
  getDb().run("UPDATE opportunity SET decided_by = ?, decided_at = ? WHERE id = ?", [userId, now(), id]);
}
