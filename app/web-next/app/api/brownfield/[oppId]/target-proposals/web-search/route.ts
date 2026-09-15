// POST /api/brownfield/[oppId]/target-proposals/web-search — S6 Long List 후보
// 웹검색 제안 (ADR-0118 계약). ADR-0118 §5가 "실검색 근거 필요"로 미뤄뒀던 기능:
// lib/web-research.ts(Tavily)로 실제 검색 근거를 먼저 확보한 뒤 LLM이 그
// 근거에 등장하는 회사만 후보로 제안한다. 근거 없는 회사명은 절대 반환하지 않는다
// — 검색 미설정·결과 0건이면 결정론 md_company 후보로 폴백(source: synthesis).
// 저장은 없다 — 사람이 "Long List에 등록"을 눌러야 brownfield_target 행이
// 생긴다(기존 POST .../target-proposals 경로 재사용, discovery_source=
// web_proposal로 기록).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeOrFallback, type LlmOrFallback } from "../../../../../../lib/llm.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "../../../../../../lib/web-research.ts";
import { isSimilar } from "../../../../../../lib/name-similarity.ts";
import { reliabilityForSource } from "../../../../../../lib/dd-checklist-tailor.ts";

interface UniverseShape {
  definition?: string;
  criteria?: string[];
  scope?: string | null;
  min_long_list?: number;
}

interface Suggestion {
  company_name: string;
  rationale: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  reliability: "A" | "B" | "C";
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

/** 폴백 — 기업 마스터 산업명 매칭(결정론). 근거 없는 이름을 만들지 않는다. */
function synthesisFallback(
  db: ReturnType<typeof getDb>,
  actor: string,
  opp: { id: string; market_scope: string | null },
  existingNames: string[],
  note: string,
) {
  const root = opp.market_scope ? opp.market_scope.replace(/ 제조| 업| 서비스| 산업| 시장/g, "").slice(0, 2) : null;
  const rows = root
    ? (db.query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE name_ko LIKE ? ORDER BY name_ko LIMIT 20")
        .all(`%${root}%`) as Array<{ id: string; name_ko: string; dart_corp_code: string | null }>)
        .filter((c) => !existingNames.includes(c.name_ko))
    : [];
  const suggestions = rows.map((s) => ({
    company_name: s.name_ko,
    dart_corp_code: s.dart_corp_code,
    rationale: "기업 마스터(md_company) 산업명 매칭 — 결정론 제안",
    sources: [] as Suggestion["sources"],
    reliability: "C" as const,
  }));
  appendAudit(db, { actor, action: "target_proposal.web_search", target: opp.id, now: new Date().toISOString() });
  return ok(
    { source: "synthesis", provider: "deterministic", note, query_count: 0, suggestions },
    200,
    { proposals: suggestions.length },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "웹검색 제안 생성은 analyst 역할 이상이어야 합니다.");
  const { oppId } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, market_scope, target_universe_json FROM opportunity WHERE id = ?")
    .get(oppId) as { id: string; name: string; market_scope: string | null; target_universe_json: string | null } | undefined;
  if (!opp) return notFound();

  let universe: UniverseShape = {};
  try {
    universe = opp.target_universe_json ? (JSON.parse(opp.target_universe_json) as UniverseShape) : {};
  } catch {
    // 미정의 유니버스로도 제안은 가능 — 근거가 얇아질 뿐이다.
  }
  const existingNames = (
    db.query("SELECT company_name FROM brownfield_target WHERE opportunity_id = ?").all(oppId) as Array<{ company_name: string }>
  ).map((e) => e.company_name);

  // 1) 실검색 근거 확보 — 검색 미설정이면 즉시 결정론 폴백.
  if (!isWebResearchConfigured()) {
    return synthesisFallback(db, auth.auth.userId, opp, existingNames, "실시간 웹 검색이 설정되지 않았습니다 — 기업 마스터 기반 결정론 제안으로 대체합니다.");
  }
  const queries = buildQueries(opp.market_scope, universe);
  const sources = await researchSources(queries, 10);
  if (sources.length === 0) {
    return synthesisFallback(db, auth.auth.userId, opp, existingNames, "웹 검색에서 근거를 찾지 못했습니다 — 기업 마스터 기반 결정론 제안으로 대체합니다.");
  }

  // 2) LLM이 검색 근거에 등장하는 회사만 제안하게 한다.
  const llmRes: LlmOrFallback = await completeOrFallback(
    [
      {
        role: "system" as const,
        content:
          "당신은 M&A·신규사업 대상 후보 발굴 전문가입니다. 제공된 검색 근거(스니펫)에 실제로 등장하는 회사만 제안하세요. 근거에 없는 회사명을 만들어내면 안 됩니다.",
      },
      { role: "user" as const, content: buildPrompt(opp, universe, existingNames, sources) },
    ],
    () => "",
    {
      maxTokens: 1600,
      agent: {
        key: "brownfield-agent",
        purpose: "S6 대상 후보 웹검색 제안 — 실검색 근거 기반 후보 도출",
        contextType: "opportunity",
        contextId: oppId,
      },
    },
  );

  const suggestions = normalizeLlmSuggestions(llmRes, sources, existingNames);
  appendAudit(db, {
    actor: auth.auth.userId,
    action: "target_proposal.web_search",
    target: oppId,
    now: new Date().toISOString(),
  });
  return ok(
    {
      source: llmRes.source,
      provider: llmRes.provider,
      note: llmRes.source === "synthesis" ? "LLM 호출 실패 — 결정론 폴백으로 대체했습니다." : null,
      query_count: queries.length,
      suggestions,
    },
    200,
    { proposals: suggestions.length },
  );
}

/** 테스트 가능성을 위해 export — 순수 함수(네트워크·DB 없음). */
export function buildQueries(marketScope: string | null, universe: UniverseShape): string[] {
  const base = marketScope?.trim();
  if (!base) return [];
  const q: string[] = [`${base} 시장 주요 기업 점유율`];
  if (universe.definition) q.push(`${base} ${universe.definition.slice(0, 40)} 대표 기업`);
  if (universe.criteria?.length) q.push(`${base} ${universe.criteria.slice(0, 3).join(" ")} 기업`);
  return q.slice(0, 4);
}

function buildPrompt(
  opp: { name: string; market_scope: string | null },
  universe: UniverseShape,
  existingNames: string[],
  sources: WebSource[],
): string {
  const lines = [
    `검토/안건: ${opp.name}`,
    opp.market_scope ? `산업: ${opp.market_scope}` : "",
    universe.definition ? `Target Universe 정의: ${universe.definition}` : "",
    universe.criteria?.length ? `선정 기준: ${universe.criteria.join(" · ")}` : "",
    "",
    "이미 Long List에 등록된 후보(중복 제안 금지):",
    existingNames.length ? existingNames.map((n) => `- ${n}`).join("\n") : "(없음)",
    "",
    "아래 번호 매기기된 검색 근거만 사용해, 이 산업·유니버스에 해당하는 대상 후보 기업을 3~5개 제안하세요.",
    'JSON만 반환: {"candidates":[{"company_name":"회사명(한글, 간결)","rationale":"근거 요약 2~3문장 — 어떤 검색 근거에서 확인했는지 인용","source_indices":[근거 번호 배열]}]}',
    "",
    ...sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet.slice(0, 300)}`),
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/** 테스트 가능성을 위해 export — LLM 응답 화이트리스트 정규화(순수 함수).
 * 근거 인용(source_indices) 없는 후보는 폐기하고, 기존 후보와 유사한 이름도
 * 제거하며, 최대 5건으로 제한한다. */
export function normalizeLlmSuggestions(llmRes: LlmOrFallback, sources: WebSource[], existingNames: string[]): Suggestion[] {
  if (llmRes.source !== "llm") return [];
  const parsed = parseJson(llmRes.text);
  const raw = Array.isArray(parsed?.candidates) ? (parsed!.candidates as Array<Record<string, unknown>>) : [];
  const out: Suggestion[] = [];
  const seen = [...existingNames];
  for (const c of raw) {
    const name = typeof c.company_name === "string" ? c.company_name.trim().slice(0, 120) : "";
    if (!name || isSimilar(name, seen)) continue;
    const rationale = typeof c.rationale === "string" ? c.rationale.trim().slice(0, 600) : "";
    const idx = Array.isArray(c.source_indices)
      ? (c.source_indices as unknown[]).map((v) => (typeof v === "number" ? Math.floor(v) - 1 : -1)).filter((v) => v >= 0 && v < sources.length)
      : [];
    // 근거 인용 없는 후보는 폐기 — 근거 없는 이름은 날조로 간주한다(ADR-0118).
    if (idx.length === 0) continue;
    const cited = idx.map((i) => ({ title: sources[i].title, url: sources[i].url, snippet: sources[i].snippet }));
    out.push({ company_name: name, rationale, sources: cited, reliability: reliabilityForSource(cited[0].url) });
    seen.push(name);
    if (out.length >= 5) break;
  }
  return out;
}
