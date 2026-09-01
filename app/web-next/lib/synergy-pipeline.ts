// S3 시너지 정합성 파이프라인 — Long List(S1 시장분석 + S2 기회발굴)를
// Short List로 좁히는 단계. 대상 회사를 등록하면:
//   1. DART 재무제표·사업보고서 입수 (상장사/외감기업, DART_API_KEY)
//   2. 글로벌 기관·증권사·뉴스 리서치 (TAVILY) — 출처 명기 + 교차검증
//   3. 재무 강/약점 분석 (LLM, 1·2의 데이터 기반)
//   4. S1/S2 연계 — 어떤 영역에서 사업 기회가 도출되고 시너지 창출이
//      가능한지 분석 (LLM에 완료된 시장 인사이트를 함께 투입)
//   5. Short List 정리 — 시너지 영역별 기회/위험/근거 출처
// 외감·비상장 등 DART 대상이 아니면 1단계는 생략되고 2·3단계로 보완한다.

import type { Database } from "bun:sqlite";
import { ulid } from "../../../db/lib/ulid.ts";
import { completeOrFallback } from "./llm.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "./web-research.ts";
import { fetchFinancials, findCorpCode, isDartConfigured, type DartFinancials } from "./dart-client.ts";

export interface SynergyStepSummary {
  step: number;
  title: string;
  summary: string;
  source: "llm" | "synthesis";
}

export interface SynergySourceRef { title: string; url: string; snippet?: string }

export interface SynergyPayload {
  company: { name: string; dartCorpCode: string | null };
  acquirer: string | null;
  dartFinancials: {
    available: boolean;
    year?: string;
    items?: Array<{ name: string; value: number }>;
    reportUrl?: string;
    error?: string;
  };
  researchSources: SynergySourceRef[];
  /** 재무 데이터 출처 추적 — DART / 신용평가자료 / 외부 검색 */
  dataSources?: {
    dart: boolean;
    dartYear: string | null;
    creditReport: string | null;
    webResearchCount: number;
  };
  financialStrengths: string[];
  financialWeaknesses: string[];
  businessAssessment: string;
  marketLinkage: {
    marketSummaries: Array<{ industry: string; cagrPct: number | null; gapPct: number | null; newDrivers: string[] }>;
    synergyAreas: Array<{
      area: string;
      synergyType: string;
      rationale: string;
      opportunity: string;
      risk: string;
      sources: string[];
    }>;
  };
  shortList: Array<{ rank: number; area: string; verdict: string; reason: string }>;
  stepSummaries: SynergyStepSummary[];
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);

async function askJson(system: string, user: string, maxTokens = 2500): Promise<Record<string, unknown> | null> {
  const res = await completeOrFallback(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    () => "NOT_JSON",
    { temperature: 0.2, maxTokens },
  );
  if (res.source !== "llm") return null;
  const text = res.text.replace(/```json|```/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runSynergyPipeline(db: Database, analysisId: string): Promise<void> {
  const row = db
    .query(
      `SELECT sa.id, sa.company_id, c.name_ko, c.dart_corp_code, sa.source_ref AS source_ref, ac.name_ko AS acquirer_name
       FROM synergy_analysis sa
       JOIN md_company c ON c.id = sa.company_id
       LEFT JOIN md_company ac ON ac.id = sa.acquirer_company_id
       WHERE sa.id = ?`,
    )
    .get(analysisId) as { id: string; company_id: string; name_ko: string; dart_corp_code: string | null; source_ref: string | null; acquirer_name: string | null } | null;
  if (!row) throw new Error(`synergy analysis ${analysisId} not found`);
  const company = row.name_ko;
  const sourceRef = row.source_ref ?? null; // M&A 대상 기업
  // 신용평가자료 업로드 파일의 추출 텍스트 — "신용평가자료: {original} ({stored})"에서 stored 파싱
  let creditText: string | null = null;
  if (sourceRef) {
    const m = sourceRef.match(/\(([^\)]+)\)$/);
    if (m) {
      try {
        const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
        const { join } = require("node:path") as typeof import("node:path");
        const p2 = join(process.cwd(), "..", "workspace", "uploads", `${m[1]}.txt`);
        if (existsSync(p2)) creditText = readFileSync(p2, "utf-8").slice(0, 60_000);
      } catch { /* 추출 텍스트 없음 — 리서치로 대체 */ }
    }
  }
  const acquirer = row.acquirer_name ?? null; // 인수 주체
  const now = () => new Date().toISOString();
  const advance = (step: number) => db.run("UPDATE synergy_analysis SET current_step = ? WHERE id = ?", [step, analysisId]);
  const stepSummaries: SynergyStepSummary[] = [];

  // ── Step 1: DART 재무제표·사업보고서 입수 ──
  advance(1);
  let corpCode = row.dart_corp_code ?? null;
  if (!corpCode && isDartConfigured()) corpCode = await findCorpCode(company);
  const dart: DartFinancials = corpCode ? await fetchFinancials(corpCode, { years: 3 }) : { corpCode: "", found: false, items: [], error: isDartConfigured() ? "corp code 미확인 — 비상장 또는 검색 실패" : "DART_API_KEY 미구성" };
  if (corpCode && corpCode !== row.dart_corp_code) {
    db.run("UPDATE md_company SET dart_corp_code = ? WHERE id = ?", [corpCode, row.company_id]);
  }
  stepSummaries.push({
    step: 1,
    title: "DART 재무제표·사업보고서 입수",
    summary: dart.found
      ? `${dart.year}년 사업보고서 재무제표 ${dart.items.length}개 계정 입수 (${corpCode}).`
      : `DART 입수 실패/해당 없음 — ${dart.error ?? "사유 미확인"}. 웹 리서치로 보완합니다.`,
    source: "synthesis",
  });

  // ── Step 2: 외부 리서치 (글로벌 기관·증권사·뉴스) ──
  advance(2);
  const research: WebSource[] = isWebResearchConfigured()
    ? await researchSources([
        `${company} 사업보고서 재무 분석`,
        `${company} 증권사 리포트 전망`,
        `${company} 뉴스 시너지 M&A`,
      ], 12)
    : [];
  stepSummaries.push({
    step: 2,
    title: "외부 리서치 (기관·증권사·뉴스)",
    summary: research.length ? `${research.length}건의 외부 출처 입수 — 출처 명기 및 LLM 교차검증에 사용.` : "웹 리서치 미구성(TAVILY_API_KEY) — DART+LLM 지식으로 보완.",
    source: "synthesis",
  });

  // ── Step 3: 재무 강/약점 분석 ──
  advance(3);
  const dartContext = dart.found
    ? dart.items.map((i) => `${i.name}: ${(i.value / 1e8).toFixed(0)}억원 (${dart.year})`).join(", ")
    : `DART 데이터 없음 (${dart.error ?? ""})`;
  const researchContext = research.length
    ? research.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.snippet}`).join("\n\n")
    : "(웹 리서치 없음)";
  const faJson = await askJson(
    "You are an M&A financial analyst. Reply with ONE JSON object only.",
    `회사: ${company}\nDART 재무: ${dartContext}${creditText ? `\n\n신용평가자료 발췌:\n${creditText.slice(0, 4000)}` : ""}\n\n외부 리서치 발췌:\n${researchContext}\n\nJSON: {"strengths":["재무·사업 강점", ...],"weaknesses":["재무·사업 약점", ...],"businessAssessment":"종합 평가 3~5문장 — 리서치 발췌와 교차검증하고 상충 시 명시"}. 강점·약점 각 3~5개, 리서치 출처 번호([n])를 문장 끝에 붙이세요.`,
  );
  const listOf = (v: unknown, fallback: string[]): string[] => {
    const arr = Array.isArray(v) ? v : [];
    const items = arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5);
    return items.length ? items : fallback;
  };
  const financialStrengths = listOf(faJson?.strengths, ["재무 분석 미생성 — DART/리서치 데이터 확인 후 보완"]);
  const financialWeaknesses = listOf(faJson?.weaknesses, ["재무 분석 미생성 — 보완 필요"]);
  const businessAssessment = str(faJson?.businessAssessment, "종합 평가 미생성 — 보완 필요");
  const faSummary = await completeOrFallback(
    [{ role: "user", content: `회사 ${company}의 재무·사업 분석을 한국어 2문장으로 요약하세요. 강점 ${financialStrengths.length}개, 약점 ${financialWeaknesses.length}개 도출.` }],
    () => `재무 강점 ${financialStrengths.length}개·약점 ${financialWeaknesses.length}개 도출. ${businessAssessment.slice(0, 120)}`,
    { maxTokens: 300 },
  );
  stepSummaries.push({ step: 3, title: "재무 강/약점 분석", summary: faSummary.text, source: faSummary.source });

  // ── Step 4: S1/S2 연계 — 시너지 영역 도출 ──
  advance(4);
  const completedMarkets = db
    .query(
      `SELECT i.name_ko, v.payload FROM market_sizing_analysis a
       JOIN md_industry i ON i.id = a.industry_id
       JOIN market_sizing_version v ON v.analysis_id = a.id
       WHERE a.status = 'completed'
         AND v.version_no = (SELECT MAX(version_no) FROM market_sizing_version x WHERE x.analysis_id = a.id)
       ORDER BY a.completed_at DESC LIMIT 6`,
    )
    .all() as Array<{ name_ko: string; payload: string }>;
  type EfShape = { cagr?: number; gapPct?: number; newDrivers?: string[]; targetYear?: number } | null;
  const marketSummaries = completedMarkets.map((m) => {
    let cagrPct: number | null = null;
    let ef: EfShape = null;
    let newDrivers: string[] = [];
    try {
      const matrix = (JSON.parse(m.payload) as { matrix?: { consistency?: { bottomUpCagr?: number }; externalForecast?: EfShape } }).matrix;
      cagrPct = matrix?.consistency?.bottomUpCagr ?? null;
      ef = matrix?.externalForecast ?? null;
      newDrivers = ef?.newDrivers ?? [];
    } catch { /* skip malformed */ }
    return { industry: m.name_ko, cagrPct, gapPct: ef?.gapPct ?? null, newDrivers };
  });
  const marketsContext = marketSummaries
    .map((m) => `${m.industry}: CAGR ${m.cagrPct ?? "?"}%${m.gapPct !== null ? `, 외부 전망 대비 격차 ${m.gapPct > 0 ? "+" : ""}${m.gapPct}%` : ""}${m.newDrivers.length ? `, 신규 드라이버: ${m.newDrivers.join("/")}` : ""}`)
    .join("\n") || "(완료된 시장분석 없음)";
  const synJson = await askJson(
    "You are a corporate development analyst. Reply with ONE JSON object only.",
    `역할 구분 — 인수 주체: ${acquirer ?? "미지정"}, M&A 대상 기업: ${company}\n대상 기업 재무/사업 평가: ${businessAssessment}\n대상 기업 강점: ${financialStrengths.join(" / ")}\n\nS1·S2 완료 시장 분석(Long List):\n${marketsContext}\n\nJSON: {"synergyAreas":[{"area":"시너지 영역명","synergyType":"매출 시너지|원가 절감|기술·역량|유통·채널 등","rationale":"대상 기업의 역량·자산이 인수 주체와 연결되어 시너지가 나는 근거 2~3문장","opportunity":"구체 기회","risk":"리스크","sources":["관련 출처 번호/명"]}]} — 3~6개 영역. 인수 주체의 역량과 대상 기업 강점, 시장 격차·드라이버를 연결해 Long List를 Short List로 좁히세요.`,
    3000,
  );
  const synergyAreas = (Array.isArray(synJson?.synergyAreas) ? synJson!.synergyAreas : []).slice(0, 6).map((a) => ({
    area: str(a.area, "—"),
    synergyType: str(a.synergyType, "—"),
    rationale: str(a.rationale, "—"),
    opportunity: str(a.opportunity, "—"),
    risk: str(a.risk, "—"),
    sources: Array.isArray((a as { sources?: unknown }).sources) ? ((a as { sources: unknown[] }).sources.filter((x): x is string => typeof x === "string") as string[]).slice(0, 4) : [],
  }));
  stepSummaries.push({
    step: 4,
    title: "S1·S2 연계 시너지 분석",
    summary: `완료된 시장분석 ${marketSummaries.length}개와 연계해 시너지 영역 ${synergyAreas.length}개 도출.`,
    source: synJson ? "llm" : "synthesis",
  });

  // ── Step 5: Short List 정리 ──
  advance(5);
  const slJson = await askJson(
    "You are an IC advisor. Reply with ONE JSON object only.",
    `시너지 영역 후보: ${JSON.stringify(synergyAreas.map((a, i) => ({ no: i + 1, area: a.area, opportunity: a.opportunity, risk: a.risk })))}\n\nJSON: {"shortList":[{"rank":1,"area":"영역명","verdict":"Short List|보류","reason":"한두 문장"}]} — 전체 순위 매기고 상위 2~3개를 Short List로.`,
  );
  const shortList = (Array.isArray(slJson?.shortList) ? slJson!.shortList : synergyAreas.map((a, i) => ({ rank: i + 1, area: a.area, verdict: "보류", reason: "자동 선별 미생성" })))
    .slice(0, 6)
    .map((s, i) => ({ rank: num(s.rank, i + 1), area: str(s.area, "—"), verdict: str(s.verdict, "보류"), reason: str(s.reason, "—") }));
  stepSummaries.push({ step: 5, title: "Short List 정리", summary: `Short List ${shortList.filter((s) => s.verdict.includes("Short")).length}개 선별 (전체 ${shortList.length}영역 평가).`, source: slJson ? "llm" : "synthesis" });

  // ── Persist ──
  const payload: SynergyPayload = {
    company: { name: company, dartCorpCode: corpCode },
    acquirer: acquirer,
    dartFinancials: {
      available: dart.found,
      year: dart.year,
      items: dart.items,
      reportUrl: dart.reportUrl,
      error: dart.error,
    },
    researchSources: research.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet.slice(0, 200) })),
    dataSources: {
      dart: dart.found,
      dartYear: dart.found ? dart.year ?? null : null,
      creditReport: creditText ? `${sourceRef ?? "신용평가자료"} (텍스트 추출됨)` : sourceRef,
      webResearchCount: research.length,
    },
    financialStrengths,
    financialWeaknesses,
    businessAssessment,
    marketLinkage: { marketSummaries, synergyAreas },
    shortList,
    stepSummaries,
  };
  const nextVersionNo =
    ((db.query("SELECT MAX(version_no) m FROM synergy_version WHERE analysis_id = ?").get(analysisId) as { m: number | null }).m ?? 0) + 1;
  db.transaction(() => {
    db.run(
      `INSERT INTO synergy_version (id, analysis_id, version_no, payload, changelog, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [ulid(), analysisId, nextVersionNo, JSON.stringify(payload), `시너지 정합성 분석 v${nextVersionNo} (DART ${dart.found ? "입수" : "미입수"} · 리서치 ${research.length}건 · Short List ${shortList.filter((s) => s.verdict.includes("Short")).length}개)`, "synergy-pipeline", now()],
    );
    db.run(
      "UPDATE synergy_analysis SET status = 'completed', current_step = 5, completed_at = ? WHERE id = ?",
      [now(), analysisId],
    );
  })();
}
