// S2 opportunity discovery (opportunity-discovery activity, insight-synthesis
// skill) — derives opportunity candidates from the S1 market analysis of one
// industry: the sizing matrix (anchor, CAGR, segments), the external-forecast
// gap analysis (new/strengthened drivers), qualitative factors, and the chain
// direction. LLM proposes 2–3 opportunities; a deterministic fallback builds
// them from the recorded factors when no LLM is configured. Candidates are
// inserted as `identified` — attractiveness evaluation happens in the funnel.
import { getDb } from "../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../lib/envelope.ts";
import { completeOrFallback, type LlmOrFallback } from "../../../../lib/llm.ts";
import { deriveAndSaveFactors } from "../../../../lib/opportunity-factors.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";
import { promptAgent, systemMessage } from "../../../../lib/prompts.ts";

const now = () => new Date().toISOString();

interface DiscoverRow {
  name: string;
  value_chain_node: string | null;
  rationale: string;
  attractiveness_score: number;
  source: string;
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "기회 발굴은 analyst 역할 이상이어야 합니다.");
  const body = (await request.json().catch(() => null)) as { industry?: string } | null;
  const industry = body?.industry?.trim();
  if (!industry) return badRequest("invalid_request", "industry (산업명) is required.");
  const db = getDb();

  const ind = db
    .query("SELECT id FROM md_industry WHERE name_ko = ? LIMIT 1")
    .get(industry) as { id: string } | undefined;
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
  if (!version) {
    return badRequest("no_analysis", `'${industry}' 산업의 완료된 시장분석이 없습니다 — 먼저 시장분석(S1)을 완료하세요.`);
  }

  const payload = JSON.parse(version.payload) as {
    matrix?: {
      industryLabel?: string;
      anchor?: { total?: number };
      chainDirection?: { position?: string; relatedIndustries?: Array<{ name?: string }> };
      qualitative?: { opportunityFactors?: string[] };
      externalForecast?: { gapAnalysis?: string; newDrivers?: string[] };
      competitive?: { structure?: string };
    };
    stepSummaries?: Array<{ step: number; summary: string }>;
  };
  const m = payload.matrix ?? {};
  const factors = m.qualitative?.opportunityFactors ?? [];
  const newDrivers = m.externalForecast?.newDrivers ?? [];

  const context = [
    `산업: ${m.industryLabel ?? industry}`,
    m.anchor?.total ? `기준 시장규모(2026, 글로벌): $${m.anchor.total.toFixed(2)}B` : "",
    m.chainDirection?.position ? `가치사슬 위치: ${m.chainDirection.position}` : "",
    m.chainDirection?.relatedIndustries?.length
      ? `인접 산업: ${m.chainDirection.relatedIndustries.map((r) => r.name).join(", ")}`
      : "",
    m.competitive?.structure ? `경쟁 구조: ${m.competitive.structure}` : "",
    factors.length ? `기회 요인: ${factors.join(" / ")}` : "",
    newDrivers.length ? `신규·강화 드라이버(외부 전망 격차 분석): ${newDrivers.join(" / ")}` : "",
    m.externalForecast?.gapAnalysis ? `격차 분석: ${m.externalForecast.gapAnalysis}` : "",
  ].filter(Boolean).join("\n");

  // 중복 방지 — 같은 산업에서 이미 발굴된 기회를 LLM에 제시해 재제출을 차단하고,
  // 응답 후에도 정규화 비교로 1차 필터링한다.
  const existing = db
    .query(
      "SELECT name, rationale FROM opportunity WHERE market_scope = ? AND status != 'dropped' ORDER BY created_at DESC LIMIT 30",
    )
    .all(industry) as Array<{ name: string; rationale: string | null }>;

  const messages = [
    systemMessage("s2.discover"),
    {
      role: "user" as const,
      content:
        `아래 시장분석 근거에서 사업 기회 후보 2~3개를 도출하세요. JSON: {"opportunities":[{"name":"기회명 (한글, 간결)","value_chain_node":"가치사슬 위치 (예: 상류(원자재·부품)/중류(조립·가공)/하류(완제품·수요처) 또는 구체 노드)","rationale":"근거 요약 2~3문장 — 기회 요인·드라이버·인접 산업을 인용","attractiveness_score":0부터100 사이 정수}]}\n\n이미 발굴된 기회와 동일하거나 실질적으로 유사한 기회는 절대 제안하지 마세요. 모든 후보가 기존 기회와 중복이면 {"opportunities":[]}만 반환하세요.\n\n이미 발굴된 기회:\n${existing.length ? existing.map((e) => `- ${e.name}: ${e.rationale ?? ""}`).join("\n") : "(없음 — 최초 발굴)"}\n\n근거:\n${context}`,
    },
  ];

  let proposals: DiscoverRow[];
  const llmRes: LlmOrFallback = await completeOrFallback(messages, () => "", { maxTokens: 1600, agent: promptAgent("s2.discover") });
  if (llmRes.source === "llm") {
    const parsed = parseJson(llmRes.text);
    proposals = (Array.isArray(parsed?.opportunities) ? parsed!.opportunities as Array<Record<string, unknown>> : [])
      .map((o) => ({
        name: typeof o.name === "string" ? o.name.trim().slice(0, 120) : "",
        value_chain_node: typeof o.value_chain_node === "string" ? o.value_chain_node.trim().slice(0, 120) : null,
        rationale: typeof o.rationale === "string" ? o.rationale.trim().slice(0, 600) : "",
        attractiveness_score: clamp(typeof o.attractiveness_score === "number" ? Math.round(o.attractiveness_score) : null),
        source: "llm",
      }))
      .filter((o) => o.name.length > 0)
      .filter((o) => !isSimilar(o.name, existing.map((e) => e.name)))
      .slice(0, 3);
  } else {
    // 결정론 폴백 — 기록된 기회 요인·신규 드라이버에서 직접 파생
    proposals = [...newDrivers, ...factors].slice(0, 3).map((f, i) => ({
      name: `${industry} — ${f.slice(0, 40)}`,
      value_chain_node: m.chainDirection?.position === "upstream" ? "후방(공급처)" : m.chainDirection?.position === "downstream" ? "하류(완제품·수요처)" : "중류(조립·가공)",
      rationale: `시장분석 기회 요인에서 파생: ${f} (결정론 합성 — 분석가 검증 필요)`,
      attractiveness_score: 60 - i * 5,
      source: "synthesis",
    }));
  }
  // 배치 내부 중복 제거 + 기존 기회 대조
  const seen: string[] = [...existing.map((e) => e.name)];
  const deduped: typeof proposals = [];
  let duplicatesSkipped = 0;
  for (const o of proposals) {
    if (isSimilar(o.name, seen)) { duplicatesSkipped++; continue; }
    seen.push(o.name);
    deduped.push(o);
  }
  proposals = deduped;
  if (proposals.length === 0) {
    return ok(
      { industry, inserted: [], duplicates_skipped: duplicatesSkipped, source: llmRes.source },
      200,
      { all_duplicates: true },
    );
  }

  const ts = now();
  const insertedRows = proposals.map((o) => ({ id: ulid(), o }));
  db.transaction(() =>
    insertedRows.forEach(({ id, o }) => {
      db.run(
        `INSERT INTO opportunity (id, name, market_scope, value_chain_node, market_size_krw_m, growth_rate, attractiveness_score, status, rationale, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, o.name, industry, o.value_chain_node,
          null, // market_size — 단위 환산은 분석가 확정 사항 (앵커 $B는 리포트 참조)
          null, // growth_rate — 산업 CAGR, 분석가 확정 후 입력
          o.attractiveness_score, "identified", o.rationale, "opportunity-discovery", ts,
        ],
      );
    }),
  )();
  // 기회/위험 요인 자동 도출 — 사람이 요인을 찾지 않아도 평가 근거가 채워진다.
  for (const { id, o } of insertedRows) {
    try {
      await deriveAndSaveFactors(db, { id, name: o.name, market_scope: industry, value_chain_node: o.value_chain_node, rationale: o.rationale });
    } catch (err) {
      console.error("opportunity factor derivation failed:", err);
    }
  }
  const inserted = insertedRows.map(({ id, o }) => ({ id, name: o.name, value_chain_node: o.value_chain_node, attractiveness_score: o.attractiveness_score, source: o.source }));
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "opportunity.discover",
    target: `${industry}:${insertedRows.map((r) => r.id).join(",")}`,
    now: ts,
  });

  return ok({ industry, inserted, duplicates_skipped: duplicatesSkipped, source: llmRes.source }, 201, { count: inserted.length });
}

function clamp(v: number | null): number {
  if (v === null || Number.isNaN(v)) return 50;
  return Math.min(100, Math.max(0, v));
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

/** 이름 정규화 — 공백·구두점 제거, 소문자. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[" + BS + "s" + BS + "p{P}]/gu, "");
}

/** 기존 기회 중 하나라도 유사하면 true — 완전일치·포함 관계·토큰 Jaccard ≥ 0.6. */
function isSimilar(name: string, existingNames: string[]): boolean {
  const a = normalizeName(name);
  if (!a) return true;
  for (const existing of existingNames) {
    const b = normalizeName(existing);
    if (!b) continue;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const at = a.split(" ").filter((x) => x);
    const bt = b.split(" ").filter((x) => x);
    if (at.length > 1 && bt.length > 1) {
      const bset = new Set(bt);
      let inter = 0;
      for (const t of new Set(at)) if (bset.has(t)) inter++;
      const union = new Set([...at, ...bt]).size;
      if (union > 0 && inter / union >= 0.6) return true;
    }
  }
  return false;
}
