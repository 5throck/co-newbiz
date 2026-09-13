// 경쟁 포지셔닝 공시·리서치 원문 대조 — S3 그룹/계열사 파이프라인의 단계 5.
// 웹 리서치 발췌만으로 LLM 추정한 경쟁 주장을 DART 사업보고서 원문 텍스트와
// 경쟁사별 추가 웹 리서치로 대조해 주장별 판정을 붙인다. 판정은 참고용이며
// 추정 텍스트를 자동 재작성하지 않는다 — 최종 판정은 분석가 (ADR-0093: 판정은 사람).
import { completeOrFallback } from "./llm.ts";
import {
  isDartConfigured,
  searchDisclosures,
  selectBusinessReport,
  fetchDisclosureText,
} from "./dart-client.ts";
import { isWebResearchConfigured, tavilySearch, type WebSource } from "./web-research.ts";

export type CrossCheckStatus = "cross_checked" | "dart_unavailable" | "research_only";
export type ClaimVerdict = "confirmed" | "directional" | "contradicted" | "unverified";
export type CrossCheckSource = "dart" | "research" | "dart+research";

export interface CrossCheckClaim {
  /** 주장 원문 — 경쟁사 항목은 "경쟁사 {name}: ..." 접두사로 UI 행과 매칭된다. */
  claim: string;
  verdict: ClaimVerdict;
  source: CrossCheckSource;
  evidence: string;
  url?: string;
}

export interface CompetitiveCrossCheck {
  status: CrossCheckStatus;
  checkedAt: string;
  dartReport?: { rceptNo: string; reportNm: string; rceptDt: string; reportUrl: string } | null;
  claims: CrossCheckClaim[];
  note?: string;
}

/** 판정 4단 → 검증 원장 3단 (파이프라인 LedgerStatus와 동일 유니언). 상충은 자동 판정 없이 분석가 판단으로 넘긴다. */
export function mapVerdictToLedger(verdict: ClaimVerdict | undefined): "confirmed" | "could_not_verify" | "needs_judgement" {
  if (verdict === "confirmed") return "confirmed";
  if (verdict === "unverified") return "could_not_verify";
  return "needs_judgement";
}

/** 경쟁 포지셔닝 산출물을 대조 주장 목록으로 — 경쟁사 1건씩 + 포지셔닝 서술 1건. */
export function buildClaims(competitive: { competitors: Array<{ name: string; note: string }>; positioning: string }): string[] {
  const claims = competitive.competitors.slice(0, 6).map((c) => `경쟁사 ${c.name}: ${c.note || "경쟁 관계 존재"}`);
  if (competitive.positioning.trim()) claims.push(`경쟁 포지셔닝: ${competitive.positioning.trim()}`);
  return claims;
}

/* ── 공시 원문 컨텍스트 추출 (결정론) ──
 * 사업보고서 원문은 최대 500k자 — 통째로 LLM에 넣을 수 없다. 경쟁·제품·매출
 * 관련 키워드 히트 주변 창만 추출해 컨텍스트를 구성한다. */
const CONTEXT_KEYWORDS = ["경쟁", "주요제품", "주요 제품", "주요서비스", "주요 서비스", "시장점유율", "시장 점유율", "매출처", "매출 구성", "사업의내용", "사업의 내용", "주력"];
const CONTEXT_WINDOW = 4000;
const CONTEXT_MAX_WINDOWS = 6;

export function extractDisclosureContext(text: string, opts: { window?: number; maxWindows?: number } = {}): string {
  const window = opts.window ?? CONTEXT_WINDOW;
  const maxWindows = opts.maxWindows ?? CONTEXT_MAX_WINDOWS;
  if (!text) return "";
  const candidates: Array<{ start: number; end: number }> = [];
  outer: for (const kw of CONTEXT_KEYWORDS) {
    let idx = text.indexOf(kw);
    while (idx !== -1) {
      const start = Math.max(0, idx - Math.floor(window / 2));
      candidates.push({ start, end: Math.min(text.length, start + window) });
      if (candidates.length >= maxWindows * 3) break outer;
      idx = text.indexOf(kw, idx + kw.length);
    }
  }
  // 키워드 미히트 — 목차·사업 개요가 앞부분에 있으므로 앞 2창을 폴백으로 쓴다.
  if (candidates.length === 0) return text.slice(0, window * 2);
  // 겹치는 창 병합 후 상한까지 절단
  candidates.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const w of candidates) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else merged.push({ ...w });
    if (merged.length >= maxWindows) break;
  }
  return merged
    .slice(0, maxWindows)
    .map((w) => text.slice(w.start, w.end).trim())
    .join("\n…\n")
    .slice(0, window * maxWindows);
}

/* ── 주장별 판정 메타 — S1 검증·한계 탭의 칩 규약(status-*)을 따른다 ── */
export const CROSSCHECK_VERDICT_META: Record<ClaimVerdict, { label: string; chip: string }> = {
  confirmed: { label: "확인", chip: "status-green" },
  directional: { label: "방향성 일치", chip: "status-in-progress" },
  contradicted: { label: "상충", chip: "status-red" },
  unverified: { label: "검증 불가", chip: "status-amber" },
};

/** 대조 결과에 따른 섹션 신뢰도 등급 — 결정론 부여 (S1 단계 7-A 표준). */
export function deriveCompetitiveSectionGrade(
  competitive: { competitors: Array<{ name: string; note: string }>; positioning: string; degraded?: string | null } | undefined,
  crossCheck: CompetitiveCrossCheck | undefined,
): { grade: "A" | "B" | "B-" | "C" | "C-" | "D"; note: string } {
  if (!competitive || competitive.degraded || (competitive.competitors.length === 0 && !competitive.positioning.trim())) {
    return { grade: "D", note: "미생성 또는 폴백" };
  }
  if (!crossCheck) return { grade: "C", note: "LLM 추정 — 공시·리서치 대조 전" };
  const confirmed = crossCheck.claims.filter((c) => c.verdict === "confirmed").length;
  const directional = crossCheck.claims.filter((c) => c.verdict === "directional").length;
  const contradicted = crossCheck.claims.filter((c) => c.verdict === "contradicted").length;
  const tail = ` (분석가 확인 전${contradicted > 0 ? ` — 상충 ${contradicted}건 분석가 판단 필요` : ""})`;
  if (crossCheck.status === "cross_checked") {
    if (confirmed > 0) return { grade: "B-", note: `DART 사업보고서 원문 대조 완료 — 확인 ${confirmed}·방향성 ${directional}건${tail}` };
    return { grade: "C", note: `DART 원문 대조 완료 — 직접 확인 0건, 방향성 ${directional}건${tail}` };
  }
  if (crossCheck.status === "research_only") {
    return { grade: "C", note: `웹 리서치 삼각검증만 완료 — DART 원문 대조 불가${tail}` };
  }
  return { grade: "C-", note: `공시 대조 실패 — ${crossCheck.note ?? "사유 미명시"}${tail}` };
}

export interface CrossCheckInput {
  company: string;
  corpCode: string | null;
  competitive: { competitors: Array<{ name: string; note: string }>; positioning: string };
}

/** 대조 실행 — DART 원문 입수 실패·LLM 판정 실패 모두 결과에 사유를 남기고 throw하지 않는다. */
export async function crossCheckCompetitive(input: CrossCheckInput): Promise<CompetitiveCrossCheck> {
  const checkedAt = new Date().toISOString();
  const claims = buildClaims(input.competitive);

  // 경쟁사별 리서치 삼각검증 — 단계 2 공용 발췌와 별개로 경쟁사 조합 타겟 쿼리 (≤5회).
  const competitorNames = input.competitive.competitors.slice(0, 5).map((c) => c.name);
  let researchByCompetitor: Array<{ name: string; sources: WebSource[] }> = [];
  if (isWebResearchConfigured() && competitorNames.length > 0) {
    const lists = await Promise.all(
      competitorNames.map((name) => tavilySearch(`${input.company} ${name} 경쟁 관계 시장지위`, { maxResults: 3 })),
    );
    researchByCompetitor = competitorNames.map((name, i) => ({ name, sources: lists[i] }));
  }
  const researchContext = researchByCompetitor
    .flatMap((r, ri) => r.sources.map((s, si) => `[R${ri + 1}-${si + 1}] (${r.name} 관련) ${s.title} (${s.url})\n${s.snippet}`))
    .join("\n\n");

  // DART 최신 사업보고서 원문 입수
  let dartStatus: "ok" | "unavailable" | "not_applicable" = "not_applicable";
  let dartError: string | null = null;
  let dartContext = "";
  let dartReport: CompetitiveCrossCheck["dartReport"] = null;
  if (input.corpCode && isDartConfigured()) {
    dartStatus = "unavailable";
    const list = await searchDisclosures(input.corpCode, "business", 20);
    const report = list.found ? selectBusinessReport(list.disclosures) : null;
    if (!report) {
      dartError = list.error ?? "최근 12개월 내 사업보고서 없음";
    } else {
      const doc = await fetchDisclosureText(report.rcept_no);
      if (doc.available && doc.text) {
        dartStatus = "ok";
        dartContext = extractDisclosureContext(doc.text);
        if (doc.truncated) dartContext += "\n(원문이 추출 상한에서 잘렸습니다 — 전문은 DART 링크 참조)";
        dartReport = {
          rceptNo: report.rcept_no,
          reportNm: report.report_nm,
          rceptDt: report.rcept_dt,
          // fetchFinancials와 동일한 DART 뷰어 URL 형식 (corp 단위 공시 목록)
          reportUrl: `https://dart.fss.or.kr/dsab007/main.do?option=corp&corp_code=${input.corpCode}`,
        };
      } else {
        dartError = doc.error ?? "원문 텍스트 추출 실패";
      }
    }
  }

  const notes: string[] = [];
  if (dartStatus === "unavailable") notes.push(`DART 원문 입수 실패 — ${dartError ?? "사유 미명시"}`);
  if (dartStatus === "not_applicable") notes.push(input.corpCode ? "DART_API_KEY 미구성 — 웹 리서치 대조만 수행" : "비상장 또는 corp_code 미확보 — DART 원문 대조 불가, 웹 리서치 대조만 수행");

  const result: CompetitiveCrossCheck = {
    status: dartStatus === "ok" ? "cross_checked" : dartStatus === "unavailable" ? "dart_unavailable" : "research_only",
    checkedAt,
    dartReport,
    claims: [],
  };

  if (claims.length === 0) {
    result.note = "대조할 경쟁 주장이 없습니다";
    return result;
  }

  // LLM 주장별 판정 — 근거 발췌(공시 원문 + 타겟 리서치) 안에서만. 판정 실패 시 전부 unverified.
  const verdictJson = await completeOrFallback(
    [
      { role: "system" as const, content: "당신은 기업 공시 검증 전문가입니다. 제공된 근거 발췌 안에서만 판정하세요. 근거가 없으면 추측하지 말고 unverified로 판정하세요." },
      {
        role: "user" as const,
        content:
          `다음은 ${input.company}에 대한 LLM 추정 경쟁 주장입니다. 각 주장을 근거 발췌와 대조해 판정하세요.\n` +
          `판정 기준: confirmed=근거에 직접적 근거 있음 / directional=방향성만 일치 / contradicted=근거와 상충 / unverified=근거에서 확인 불가.\n` +
          `판정 근거가 어느 출처에서 왔는지 밝히세요: dart(사업보고서 원문) / research(웹 리서치) / dart+research.\n` +
          `JSON만 출력: {"verdicts":[{"index":0,"verdict":"confirmed","source":"dart","evidence":"판정 근거 발췌 1~2문장","url":"research 출처 URL(있을 때만)"}]}\n\n` +
          `주장:\n${claims.map((c, i) => `${i}. ${c}`).join("\n")}\n\n` +
          `DART 사업보고서 원문 발췌:\n${dartContext || "(입수 불가)"}\n\n` +
          `경쟁사별 웹 리서치 발췌:\n${researchContext || "(없음)"}`,
      },
    ],
    () => JSON.stringify({}),
    { maxTokens: 1500, agent: { key: "market-intelligence-agent", purpose: "프로파일 공시 대조 검증" } },
  );

  const fallbackNote =
    verdictJson.source === "synthesis"
      ? "LLM 미구성 — 자동 판정 없음, 분석가 확인 필요"
      : null;
  let parsed: { verdicts?: Array<{ index?: number; verdict?: string; source?: string; evidence?: string; url?: string }> } = {};
  try {
    parsed = JSON.parse(verdictJson.text.slice(verdictJson.text.indexOf("{"), verdictJson.text.lastIndexOf("}") + 1)) as typeof parsed;
    if (verdictJson.source === "synthesis") throw new Error("fallback");
  } catch {
    notes.push(fallbackNote ?? "LLM 판정 생성 실패 — 주장별 자동 판정 없음, 분석가 확인 필요");
  }

  const srcOk = (s: string | undefined): s is CrossCheckSource => s === "dart" || s === "research" || s === "dart+research";
  const urlOk = (u: string | undefined) => (typeof u === "string" && /^https?:\/\//.test(u) ? u : undefined);
  result.claims = claims.map((claim, i) => {
    const v = (parsed.verdicts ?? []).find((x) => x.index === i);
    const verdict = v && ["confirmed", "directional", "contradicted", "unverified"].includes(v.verdict ?? "")
      ? (v.verdict as ClaimVerdict)
      : "unverified";
    return {
      claim,
      verdict,
      source: srcOk(v?.source) ? v.source : "research",
      evidence: typeof v?.evidence === "string" && v.evidence.trim() ? v.evidence.trim().slice(0, 300) : "근거 발췌에서 확인 불가 — 분석가 확인 필요",
      url: urlOk(v?.url),
    };
  });
  if (notes.length > 0) result.note = notes.join(" / ");
  return result;
}
