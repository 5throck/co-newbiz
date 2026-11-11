// POST /api/brownfield/[oppId]/target-proposals/web-search — S6 Long List 후보
// 웹검색 제안 (ADR-0118 계약). ADR-0118 §5가 "실검색 근거 필요"로 미뤄뒀던 기능:
// lib/web-research.ts(Tavily)로 실제 검색 근거를 먼저 확보한 뒤 LLM이 그
// 근거에 등장하는 회사만 후보로 제안한다. 근거 없는 회사명은 절대 반환하지 않는다.
// 실검색을 아예 쓸 수 없을 때(TAVILY_API_KEY 미설정 또는 쿼터 초과 HTTP 432)는
// llmKnowledgeFallback으로 LLM 자체 지식 제안(source: llm_knowledge, 항상
// "미검증" 라벨 부착)으로 대체하고, 그 LLM 호출마저 실패하거나 검색은 됐지만
// 근거가 0건이면 결정론 md_company 후보로 폴백(source: synthesis).
// 저장은 없다 — 사람이 "Long List에 등록"을 눌러야 brownfield_target 행이
// 생긴다(기존 POST .../target-proposals 경로 재사용, discovery_source=
// web_proposal로 기록).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeOrFallback, type LlmOrFallback } from "../../../../../../lib/llm.ts";
import {
  isWebResearchConfigured,
  researchSourcesDetailed,
  type WebSource,
} from "../../../../../../lib/web-research.ts";
import { playwrightSearch } from "../../../../../../lib/playwright-search.ts";
import { isSimilar } from "../../../../../../lib/name-similarity.ts";
import { reliabilityForSource } from "../../../../../../lib/dd-checklist-tailor.ts";
import { systemMessage } from "../../../../../../lib/prompts.ts";
import { parseGapRegister } from "../../../../../../lib/capability-gap.ts";

interface UniverseShape {
  definition?: string;
  criteria?: string[];
  scope?: string | null;
  /** DEC-20261111-05 (design §5.1) — additive, type completeness only; the
   * seeding logic consumes definition context, not this field. */
  financial_criteria?: string;
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
    ? (
        db
          .query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE name_ko LIKE ? ORDER BY name_ko LIMIT 20")
          .all(`%${root}%`) as Array<{ id: string; name_ko: string; dart_corp_code: string | null }>
      ).filter((c) => !existingNames.includes(c.name_ko))
    : [];
  const suggestions = rows.map((s) => ({
    company_name: s.name_ko,
    dart_corp_code: s.dart_corp_code,
    rationale: "기업 마스터(md_company) 산업명 매칭 — 결정론 제안",
    sources: [] as Suggestion["sources"],
    reliability: "C" as const,
  }));
  appendAudit(db, { actor, action: "target_proposal.web_search", target: opp.id, now: new Date().toISOString() });
  return ok({ source: "synthesis", provider: "deterministic", note, query_count: 0, suggestions }, 200, {
    proposals: suggestions.length,
  });
}

/** 폴백 — 실검색을 쓸 수 없을 때(TAVILY_API_KEY 미설정, 또는 Tavily 쿼터 초과
 * HTTP 432) 공용으로 쓴다. 실검색 근거가 없으므로 ADR-0118의 "근거 인용 필수"
 * 원칙은 적용할 수 없다 — 대신 LLM 자체 지식으로 제안하되 source_indices 없이
 * "미검증" 라벨을 강제로 붙여 결정론 폴백과 구분한다. 사람이 Long List 등록
 * 전 반드시 별도 검증해야 함을 note로 명시한다. */
async function llmKnowledgeFallback(
  db: ReturnType<typeof getDb>,
  actor: string,
  opp: { id: string; name: string; market_scope: string | null },
  universe: UniverseShape,
  requiredCapabilities: string[],
  existingNames: string[],
  oppId: string,
  reason: string,
) {
  const llmRes: LlmOrFallback = await completeOrFallback(
    [
      systemMessage("s6.target_proposal_web_search"),
      { role: "user" as const, content: buildKnowledgePrompt(opp, universe, requiredCapabilities, existingNames) },
    ],
    () => "",
    {
      maxTokens: 1200,
      agent: {
        key: "market-intelligence-agent",
        purpose: `S6 대상 후보 웹검색 제안 — ${reason}, LLM 자체 지식 폴백(미검증)`,
        contextType: "opportunity",
        contextId: oppId,
      },
    },
  );
  if (llmRes.source !== "llm") {
    return synthesisFallback(
      db,
      actor,
      opp,
      existingNames,
      `${reason} — LLM 호출도 실패해 기업 마스터 기반 결정론 제안으로 대체합니다.`,
    );
  }
  const suggestions = normalizeLlmKnowledgeSuggestions(llmRes, existingNames);
  appendAudit(db, {
    actor,
    action: "target_proposal.web_search_llm_knowledge",
    target: opp.id,
    now: new Date().toISOString(),
  });
  return ok(
    {
      source: "llm_knowledge",
      provider: llmRes.provider,
      note: `${reason} — 실시간 검색 근거 없이 LLM 자체 지식으로 제안했습니다. 사실 여부를 반드시 별도로 검증한 뒤 등록하세요.`,
      query_count: 0,
      suggestions,
    },
    200,
    { proposals: suggestions.length },
  );
}

function buildKnowledgePrompt(
  opp: { name: string; market_scope: string | null },
  universe: UniverseShape,
  requiredCapabilities: string[],
  existingNames: string[],
): string {
  const lines = [
    `검토/안건(Brownfield로 결정된 기회): ${opp.name}`,
    opp.market_scope ? `산업: ${opp.market_scope}` : "",
    universe.definition ? `Target Universe 정의: ${universe.definition}` : "",
    requiredCapabilities.length ? `필요 역량(S3, 미보유·부분 충족): ${requiredCapabilities.join(" · ")}` : "",
    universe.criteria?.length ? `선정 기준: ${universe.criteria.join(" · ")}` : "",
    "",
    "이미 Long List에 등록된 후보(중복 제안 금지):",
    existingNames.length ? existingNames.map((n) => `- ${n}`).join("\n") : "(없음)",
    "",
    "실시간 웹 검색을 쓸 수 없습니다 — 당신의 사전 학습 지식만으로, 위 검토/안건·목표 시장" +
      (requiredCapabilities.length ? "·필요 역량" : "") +
      "에 부합한다고 확신하는 실제 존재하는 기업을 최대 3개까지만 제안하세요. 존재를 확신할 수 없는 기업명은 절대 지어내지 말고, " +
      "확신이 없으면 후보를 줄여도 됩니다(0개도 가능). rationale에는 왜 적합하다고 판단했는지와 함께, 이 정보가 실시간 검색 근거 없이 " +
      "학습 지식에만 기반한 것임을 명시하세요.",
    'JSON만 반환: {"candidates":[{"company_name":"회사명(한글, 간결)","rationale":"판단 근거 + 미검증 명시"}]}',
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/** 테스트 가능성을 위해 export — llmKnowledgeFallback의 LLM 응답 정규화(순수 함수).
 * 실검색 근거가 없으므로 sources는 항상 빈 배열, reliability는 항상 "C"(미검증) —
 * normalizeLlmSuggestions와 달리 source_indices를 요구하지 않는다. */
export function normalizeLlmKnowledgeSuggestions(llmRes: LlmOrFallback, existingNames: string[]): Suggestion[] {
  if (llmRes.source !== "llm") return [];
  const parsed = parseJson(llmRes.text);
  const raw = Array.isArray(parsed?.candidates) ? (parsed!.candidates as Array<Record<string, unknown>>) : [];
  const out: Suggestion[] = [];
  const seen = [...existingNames];
  for (const c of raw) {
    const name = typeof c.company_name === "string" ? c.company_name.trim().slice(0, 120) : "";
    if (!name || isSimilar(name, seen)) continue;
    const rationaleRaw = typeof c.rationale === "string" ? c.rationale.trim().slice(0, 560) : "";
    const rationale = `[미검증 — LLM 자체 지식, 실시간 검색 근거 없음] ${rationaleRaw}`.slice(0, 600);
    out.push({ company_name: name, rationale, sources: [], reliability: "C" });
    seen.push(name);
    if (out.length >= 3) break;
  }
  return out;
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Web-search proposal generation requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, market_scope, target_universe_json, capability_gap_json FROM opportunity WHERE id = ?")
    .get(oppId) as
    | {
        id: string;
        name: string;
        market_scope: string | null;
        target_universe_json: string | null;
        capability_gap_json: string | null;
      }
    | undefined;
  if (!opp) return notFound();

  let universe: UniverseShape = {};
  try {
    universe = opp.target_universe_json ? (JSON.parse(opp.target_universe_json) as UniverseShape) : {};
  } catch {
    // 미정의 유니버스로도 제안은 가능 — 근거가 얇아질 뿐이다.
  }
  // S3 필요 역량(capability_gap_json) — 미보유/부분 충족 역량을 우선 반영해
  // "결정된 기회가 실제로 필요로 하는 역량"을 갖춘 후보를 찾도록 한다.
  const requiredCapabilities = parseGapRegister(opp.capability_gap_json)
    .rows.filter((r) => r.held.status !== "leading" && r.held.status !== "average")
    .map((r) => r.capability);
  const existingNames = (
    db.query("SELECT company_name FROM brownfield_target WHERE opportunity_id = ?").all(oppId) as Array<{
      company_name: string;
    }>
  ).map((e) => e.company_name);

  // 1) 실검색 근거 확보 — 검색 미설정이면 Playwright headless 폴백, 그래도
  // 안 되면 LLM 자체 지식 폴백(미검증 라벨).
  const queries = buildQueries(opp, universe, requiredCapabilities);
  let searchNote: string | null = null;
  let sources: WebSource[] = [];
  let environmentFailure = false;
  if (isWebResearchConfigured()) {
    const tavily = await researchSourcesDetailed(queries, 10);
    sources = tavily.sources;
    if (sources.length === 0 && tavily.quotaExceeded) {
      // Tavily 쿼터 초과(HTTP 432) — Playwright headless(시스템 Chrome)로
      // 실검색 근거를 다시 확보한다(2026-09-15 사용자 요청). 성공하면
      // 미검증 폴백이 아니라 정상 근거 기반 경로를 그대로 탄다.
      const headless = await playwrightSearch(queries, 10);
      if (headless.length > 0) {
        sources = headless;
        searchNote =
          "웹 검색 쿼터가 초과되어 Playwright headless 검색으로 근거를 확보했습니다 — 출처 URL을 반드시 확인하세요.";
      } else {
        environmentFailure = true;
      }
    }
  } else {
    // TAVILY_API_KEY 미설정 — Playwright headless 검색을 1차 수단으로 쓴다.
    sources = await playwrightSearch(queries, 10);
    if (sources.length > 0) {
      searchNote =
        "웹 검색 API가 설정되지 않아 Playwright headless 검색으로 근거를 확보했습니다 — 출처 URL을 반드시 확인하세요.";
    } else {
      environmentFailure = true;
    }
  }
  if (sources.length === 0) {
    // 근거를 전혀 확보하지 못했다 — 쿼터 초과/미설정 등 환경 문제이면 LLM 자체
    // 지식 폴백(미검증 라벨), 단순 0건이면 ADR-0118 원칙대로 결정론 폴백을 유지한다.
    if (environmentFailure) {
      return llmKnowledgeFallback(
        db,
        auth.auth.userId,
        opp,
        universe,
        requiredCapabilities,
        existingNames,
        oppId,
        isWebResearchConfigured() ? "웹 검색 쿼터가 초과되었습니다" : "실시간 웹 검색이 설정되지 않았습니다",
      );
    }
    return synthesisFallback(
      db,
      auth.auth.userId,
      opp,
      existingNames,
      "웹 검색에서 근거를 찾지 못했습니다 — 기업 마스터 기반 결정론 제안으로 대체합니다.",
    );
  }

  // 2) LLM이 검색 근거에 등장하는 회사만 제안하게 한다.
  const llmRes: LlmOrFallback = await completeOrFallback(
    [
      systemMessage("s6.target_proposal_web_search"),
      { role: "user" as const, content: buildPrompt(opp, universe, requiredCapabilities, existingNames, sources) },
    ],
    () => "",
    {
      maxTokens: 1600,
      agent: {
        key: "market-intelligence-agent",
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
      note: llmRes.source === "synthesis" ? "LLM 호출 실패 — 결정론 폴백으로 대체했습니다." : searchNote,
      query_count: queries.length,
      suggestions,
    },
    200,
    { proposals: suggestions.length },
  );
}

/** 테스트 가능성을 위해 export — 순수 함수(네트워크·DB 없음).
 * opp.name(Brownfield로 결정된 구체 기회)을 검색 앵커로 쓰고, market_scope는
 * 보조 앵커로만 더한다 — market_scope 단독은 산업 전체로 검색이 흐려진다.
 * requiredCapabilities(S3 필요 역량, 미보유/부분 충족)를 반영해 그 역량을
 * 실제로 갖춘 후보를 우선 찾도록 한다. */
export function buildQueries(
  opp: { name: string; market_scope: string | null },
  universe: UniverseShape,
  requiredCapabilities: string[],
): string[] {
  const base = opp.name?.trim() || opp.market_scope?.trim();
  if (!base) return [];
  const q: string[] = [`${base} 사업 주요 기업`];
  if (opp.market_scope && opp.market_scope.trim() !== base) q.push(`${opp.market_scope.trim()} 시장 주요 기업 점유율`);
  if (universe.definition) q.push(`${base} ${universe.definition.slice(0, 40)} 대표 기업`);
  if (universe.criteria?.length) q.push(`${base} ${universe.criteria.slice(0, 3).join(" ")} 기업`);
  if (requiredCapabilities.length) q.push(`${base} ${requiredCapabilities.slice(0, 3).join(" ")} 보유 기업`);
  return q.slice(0, 5);
}

function buildPrompt(
  opp: { name: string; market_scope: string | null },
  universe: UniverseShape,
  requiredCapabilities: string[],
  existingNames: string[],
  sources: WebSource[],
): string {
  const lines = [
    `검토/안건(Brownfield로 결정된 기회): ${opp.name}`,
    opp.market_scope ? `산업: ${opp.market_scope}` : "",
    universe.definition ? `Target Universe 정의: ${universe.definition}` : "",
    requiredCapabilities.length ? `필요 역량(S3, 미보유·부분 충족): ${requiredCapabilities.join(" · ")}` : "",
    universe.criteria?.length ? `선정 기준: ${universe.criteria.join(" · ")}` : "",
    "",
    "이미 Long List에 등록된 후보(중복 제안 금지):",
    existingNames.length ? existingNames.map((n) => `- ${n}`).join("\n") : "(없음)",
    "",
    requiredCapabilities.length
      ? "아래 번호 매기기된 검색 근거만 사용해, 위 검토/안건과 목표 시장에 해당하면서 특히 필요 역량(S3)을 실제로 보유했다고 확인되는 대상 후보 기업을 3~5개 제안하세요. 근거에 역량 보유 여부가 나타나지 않는 후보는 rationale에 그 한계를 명시하세요."
      : "아래 번호 매기기된 검색 근거만 사용해, 이 산업·목표 시장에 해당하는 대상 후보 기업을 3~5개 제안하세요.",
    'JSON만 반환: {"candidates":[{"company_name":"회사명(한글, 간결)","rationale":"근거 요약 2~3문장 — 어떤 검색 근거에서 확인했는지 인용","source_indices":[근거 번호 배열]}]}',
    "",
    ...sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet.slice(0, 300)}`),
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/** 테스트 가능성을 위해 export — LLM 응답 화이트리스트 정규화(순수 함수).
 * 근거 인용(source_indices) 없는 후보는 폐기하고, 기존 후보와 유사한 이름도
 * 제거하며, 최대 5건으로 제한한다. */
export function normalizeLlmSuggestions(
  llmRes: LlmOrFallback,
  sources: WebSource[],
  existingNames: string[],
): Suggestion[] {
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
      ? (c.source_indices as unknown[])
          .map((v) => (typeof v === "number" ? Math.floor(v) - 1 : -1))
          .filter((v) => v >= 0 && v < sources.length)
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
