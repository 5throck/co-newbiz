// competitor-web-proposals.ts — 경쟁사 웹검색 재제안 (ADR-0142 후속, design
// 2026-09-18-company-competitor-registry-design §Deferred). 브라운필드
// target-proposals/web-search(ADR-0118 계약)와 동일한 사다리를 경쟁사 도메인에
// 맞게 축소해 재사용한다: 실검색 근거(Tavily → Playwright headless 폴백)를 먼저
// 확보하고 LLM은 그 근거에 등장하는 기업만 후보로 제시한다. 근거 없는 이름은
// 절대 반환하지 않으며, 실검색을 쓸 수 없을 때는 LLM 자체 지식 제안(미검증
// 라벨)으로 대체한다. 저장은 없다 — 사람이 [수용]을 눌러야
// company_competitor 행이 생긴다(경계 #2).
import { getDb } from "../../../db/client.ts";

type Db = ReturnType<typeof getDb>;
import { appendAudit } from "../../../db/lib/access-control.ts";
import { completeOrFallback, type LlmOrFallback } from "./llm.ts";
import { isWebResearchConfigured, researchSourcesDetailed, type WebSource } from "./web-research.ts";
import { playwrightSearch } from "./playwright-search.ts";
import { isSimilar } from "./name-similarity.ts";
import { systemMessage } from "./prompts.ts";
import type { ProfileSubject } from "./company-profile-pipeline.ts";

export interface CompetitorWebSuggestion {
  name: string;
  note: string;
  sources: Array<{ title: string; url: string }>;
  reliability: "A" | "B" | "C";
}

export interface CompetitorWebProposalResult {
  source: "llm" | "llm_knowledge" | "synthesis";
  provider: string | null;
  note: string;
  suggestions: CompetitorWebSuggestion[];
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

/** 근거 블록 — [n] 번호로 인용 가능한 형태(브라운필드 screening-draft 규약). */
function evidenceBlock(sources: WebSource[]): string {
  return sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.snippet.slice(0, 220)}`)
    .join("\n\n");
}

function buildUserPrompt(companyName: string, existingNames: string[], sources: WebSource[]): string {
  return [
    `대상 기업: ${companyName}`,
    "",
    "이 기업의 주요 경쟁 기업 후보를 아래 웹 검색 근거에서 찾아 제안하세요.",
    "",
    "웹 검색 근거:",
    evidenceBlock(sources),
    "",
    "이미 등록된 경쟁사(중복 제안 금지):",
    existingNames.length ? existingNames.map((n) => `- ${n}`).join("\n") : "(없음)",
    "",
    "규칙: 근거 발췌에 실제로 등장한 기업만 제안하세요. 각 후보의 source_indices에" +
      " 근거가 된 항목 번호를 넣으세요. 근거에 없는 기업명은 절대 지어내지 않습니다." +
      " 후보는 최대 5개까지, 확신이 없으면 줄여도 됩니다(0개도 가능).",
    'JSON만 반환: {"candidates":[{"name":"기업명","note":"경쟁 관계 한 문장","source_indices":[1,2]}]}',
  ].join("\n");
}

/** 실검색 근거 기반 정규화 — source_indices가 유효한 후보만 남긴다(근거 없는
 *  이름은 날조로 간주해 버린다). 순수 함수 — 테스트에서 직접 호출한다. */
export function normalizeWebSuggestions(
  llmRes: LlmOrFallback,
  sources: WebSource[],
  existingNames: string[],
): CompetitorWebSuggestion[] {
  if (llmRes.source !== "llm") return [];
  const parsed = parseJson(llmRes.text);
  const raw = Array.isArray(parsed?.candidates) ? (parsed!.candidates as Array<Record<string, unknown>>) : [];
  const out: CompetitorWebSuggestion[] = [];
  const seen = [...existingNames];
  for (const c of raw) {
    const name = typeof c.name === "string" ? c.name.trim().slice(0, 120) : "";
    if (!name || isSimilar(name, seen)) continue;
    const idx = Array.isArray(c.source_indices)
      ? (c.source_indices as unknown[]).map((n) => numOrZero(n)).filter((n) => n >= 1 && n <= sources.length)
      : [];
    if (idx.length === 0) continue; // 근거 없는 이름은 날조로 간주
    const note = typeof c.note === "string" ? c.note.trim().slice(0, 400) : "";
    const cited = idx.map((i) => sources[i - 1]).filter(Boolean);
    out.push({
      name,
      note,
      sources: cited.map((s) => ({ title: s.title, url: s.url })),
      reliability: "B",
    });
    seen.push(name);
    if (out.length >= 5) break;
  }
  return out;
}

function numOrZero(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** LLM 자체 지식 폴백 — 실검색 근거 없이 제안하며 모든 후보에 미검증 라벨을
 *  강제로 붙인다(브라운필드 llmKnowledgeFallback 규약 준용). */
function knowledgeFallbackText(companyName: string, existingNames: string[]): string {
  return [
    `대상 기업: ${companyName}`,
    "",
    "실시간 웹 검색을 쓸 수 없습니다 — 사전 학습 지식만으로 이 기업의 주요 경쟁 기업을" +
      " 최대 3개까지만 제안하세요. 존재를 확신할 수 없는 기업명은 절대 지어내지 마세요.",
    "이미 등록된 경쟁사(중복 제안 금지):",
    existingNames.length ? existingNames.map((n) => `- ${n}`).join("\n") : "(없음)",
    'JSON만 반환: {"candidates":[{"name":"기업명","note":"경쟁 관계 한 문장 + 미검증 명시"}]}',
  ].join("\n");
}

function knowledgeNormalize(llmRes: LlmOrFallback, existingNames: string[]): CompetitorWebSuggestion[] {
  if (llmRes.source !== "llm") return [];
  const parsed = parseJson(llmRes.text);
  const raw = Array.isArray(parsed?.candidates) ? (parsed!.candidates as Array<Record<string, unknown>>) : [];
  const out: CompetitorWebSuggestion[] = [];
  const seen = [...existingNames];
  for (const c of raw) {
    const name = typeof c.name === "string" ? c.name.trim().slice(0, 120) : "";
    if (!name || isSimilar(name, seen)) continue;
    const rationaleRaw = typeof c.note === "string" ? c.note.trim().slice(0, 500) : "";
    out.push({
      name,
      note: `[미검증 — LLM 자체 지식, 실시간 검색 근거 없음] ${rationaleRaw}`,
      sources: [],
      reliability: "C",
    });
    seen.push(name);
    if (out.length >= 3) break;
  }
  return out;
}

export async function webSearchCompetitorProposals(
  db: Db,
  subject: ProfileSubject,
  actor: string,
): Promise<CompetitorWebProposalResult> {
  const companyName = subject.companyName;
  const existingNames = (
    db
      .query(`SELECT name FROM company_competitor WHERE ${subject.kind === "member" ? "member_id" : "company_id"} = ?`)
      .all(subject.id) as Array<{ name: string }>
  ).map((r) => r.name);

  const queries = [`${companyName} 주요 경쟁사 경쟁 구도`, `${companyName} main competitors`];
  let sources: WebSource[] = [];
  let searchNote: string | null = null;
  let environmentFailure = false;
  if (isWebResearchConfigured()) {
    const detailed = await researchSourcesDetailed(queries, 8);
    sources = detailed.sources;
    if (sources.length === 0 && detailed.quotaExceeded) {
      const headless = await playwrightSearch(queries, 8);
      if (headless.length > 0) {
        sources = headless;
        searchNote = "웹 검색 쿼터가 초과되어 Playwright headless 검색으로 근거를 확보했습니다 — 출처 URL을 반드시 확인하세요.";
      } else {
        environmentFailure = true;
      }
    }
  } else {
    sources = await playwrightSearch(queries, 8);
    if (sources.length > 0) {
      searchNote = "웹 검색 API가 설정되지 않아 Playwright headless 검색으로 근거를 확보했습니다 — 출처 URL을 반드시 확인하세요.";
    } else {
      environmentFailure = true;
    }
  }

  if (sources.length === 0) {
    // 근거 0건 — 환경 문제면 LLM 자체 지식 폴백(미검증), 단순 0건이면 빈 결과를
    // 정직하게 돌려준다(경쟁사에는 md_company 결정론 매칭이 성립하지 않는다).
    const llmRes: LlmOrFallback = await completeOrFallback(
      [systemMessage("company_profile.competitor_web_search"), { role: "user" as const, content: knowledgeFallbackText(companyName, existingNames) }],
      () => "",
      {
        maxTokens: 900,
        agent: {
          key: "market-intelligence-agent",
          purpose: "경쟁사 웹검색 재제안 — LLM 자체 지식 폴백(미검증)",
          contextType: subject.kind,
          contextId: subject.id,
        },
      },
    );
    const suggestions = knowledgeNormalize(llmRes, existingNames);
    appendAudit(db, { actor, action: "competitor_proposal.web_search_llm_knowledge", target: `${subject.kind}:${subject.id}`, now: new Date().toISOString() });
    return {
      source: "llm_knowledge",
      provider: llmRes.provider,
      note: suggestions.length
        ? "실시간 검색 근거 없이 LLM 자체 지식으로 제안했습니다 — 등록 전 반드시 별도 검증하세요."
        : "근거도 확보하고 제안도 만들지 못했습니다 — 프로필 재분석으로 제안을 갱신하세요.",
      suggestions,
    };
  }

  const llmRes: LlmOrFallback = await completeOrFallback(
    [
      systemMessage("company_profile.competitor_web_search"),
      { role: "user" as const, content: buildUserPrompt(companyName, existingNames, sources) },
    ],
    () => "",
    {
      maxTokens: 1200,
      agent: {
        key: "market-intelligence-agent",
        purpose: "경쟁사 웹검색 재제안 — 실검색 근거 기반 후보 도출",
        contextType: subject.kind,
        contextId: subject.id,
      },
    },
  );

  const suggestions = normalizeWebSuggestions(llmRes, sources, existingNames);
  appendAudit(db, { actor, action: "competitor_proposal.web_search", target: `${subject.kind}:${subject.id}`, now: new Date().toISOString() });
  return {
    source: llmRes.source,
    provider: llmRes.provider,
    note: llmRes.source === "llm" ? (searchNote ?? "웹검색 근거 기반 제안") : "LLM 호출 실패 — 제안을 만들지 못했습니다. 프로필 재분석으로 제안을 갱신하세요.",
    suggestions,
  };
}
