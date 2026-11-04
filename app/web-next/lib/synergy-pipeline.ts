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
import { completeOrFallback, isLlmConfigured } from "./llm.ts";
import { parseGapRegister, summarizeGap } from "./capability-gap.ts";
import { persistGapRegister } from "./capability-register-write.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "./web-research.ts";
import { fetchFinancials, findCorpCode, isDartConfigured, type DartFinancials } from "./dart-client.ts";
import { systemMessage, promptAgent, type PromptKey } from "./prompts.ts";

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
    items?: Array<{ name: string; value: number; fsDiv?: string }>;
    reportUrl?: string;
    error?: string;
    /** 조회 윈도우 집계 작성 기준 — 연도별 기준이 갈리면 "mixed" (P2-6 연도별 폴백) */
    fsDiv?: "CFS" | "BFS" | "mixed";
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
  /** ADR-0090 — 분석 대상(그룹/계열사 레지스트리) 및 연결 기회 */
  target?: { type: "affiliate" | "group"; name: string };
  opportunity?: { id: string; name: string } | null;
  /** 기회 연결 시 산출된 시너지 점수 권고값 (사람 확정 전 — 경계 #2) */
  synergyScore?: number | null;
  synergyRationale?: string | null;
  /** ADR-0103 — 점수 산출 방식과 팩터 분해 (규칙 앵커 + LLM ±10p 보정) */
  scoringMethod?: "hybrid" | "rule-based" | "unavailable";
  synergyScoreFactors?: unknown;
  synergyScoreLimitations?: string[];
  /** ADR-0182 — 필요 역량 충족도 (0-100, 레지스터 보유율·필수 충족율 혼합) */
  capabilityCoverage?: number | null;
  capabilityCoverageNote?: string | null;
  /** ADR-0182 — LLM ±10 보정 이력 (delta 0도 사유와 함께 기록) */
  scoreAdjustment?: { delta: number; reason: string } | null;
  /** ADR-0094 — 재사용된 프로파일의 딥링크 (상세 재무·SWOT는 /our-company가 담당) */
  profileRef?: { kind: "affiliate" | "group"; id: string; label: string; profileVersion: number | null };
}


const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v.trim() ? v.trim() : fallback);

/**
 * 경계 #2 — 파이프라인이 기록하는 것은 사람 확정 전 권고값이다(ADR-0090).
 * 사람이 확정한 점수(migration 0099)는 이 재기록이 '다른 값'을 쓸 때만 무효화된다
 * — 같은 값이면 확정(확정자·확정 시각)은 유효하게 남는다.
 */
export function recordSynergyRecommendation(db: Database, opportunityId: string, score: number, rationale: string | null): void {
  db.run(
    `UPDATE opportunity SET synergy_score = ?, synergy_rationale = ?,
       synergy_score_confirmed_at = CASE WHEN synergy_score IS NOT NULL AND synergy_score = ? THEN synergy_score_confirmed_at ELSE NULL END,
       synergy_score_confirmed_by = CASE WHEN synergy_score IS NOT NULL AND synergy_score = ? THEN synergy_score_confirmed_by ELSE NULL END
     WHERE id = ?`,
    [score, rationale, score, score, opportunityId],
  );
}

async function askJson(promptKey: PromptKey, user: string, maxTokens = 2500): Promise<Record<string, unknown> | null> {
  const res = await completeOrFallback(
    [
      systemMessage(promptKey),
      { role: "user", content: user },
    ],
    () => "NOT_JSON",
    { temperature: 0.2, maxTokens, agent: promptAgent(promptKey) },
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
      `SELECT sa.id, sa.company_id, sa.target_type, sa.member_id, sa.group_id, sa.opportunity_id,
              c.name_ko, c.dart_corp_code, sa.source_ref AS source_ref, ac.name_ko AS acquirer_name
       FROM synergy_analysis sa
       JOIN md_company c ON c.id = sa.company_id
       LEFT JOIN md_company ac ON ac.id = sa.acquirer_company_id
       WHERE sa.id = ?`,
    )
    .get(analysisId) as { id: string; company_id: string; target_type: "affiliate" | "group" | null; member_id: string | null; group_id: string | null; opportunity_id: string | null; name_ko: string; dart_corp_code: string | null; source_ref: string | null; acquirer_name: string | null } | null;
  if (!row) throw new Error(`synergy analysis ${analysisId} not found`);
  let company = row.name_ko;
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
  // ADR-0090 — target_type 분기 공유 변수 (그룹/계열사 프로파일 재사용 경로)
  let dart: DartFinancials = { corpCode: "", found: false, items: [], error: "" };
  let research: WebSource[] = [];
  let financialStrengths: string[] = [];
  let financialWeaknesses: string[] = [];
  let businessAssessment = "";
  let corpCode: string | null = row.dart_corp_code ?? null;
  const now = () => new Date().toISOString();
  const advance = (step: number) => db.run("UPDATE synergy_analysis SET current_step = ? WHERE id = ?", [step, analysisId]);
  const stepSummaries: SynergyStepSummary[] = [];
  // ADR-0132 — market-sizing-pipeline.ts와 동일한 패턴(ADR-0131). LLM이
  // 구성되어 있었는데도 호출이 실패한 경우만 "장애"로 취급한다(미구성으로
  // 인한 합성 폴백은 오늘날의 정상 동작이므로 구분한다).
  const llmConfiguredAtStart = isLlmConfigured();
  let hadLlmFailure = false;
  const askJsonTracked: typeof askJson = async (...args) => {
    const result = await askJson(...args);
    if (llmConfiguredAtStart && result === null) hadLlmFailure = true;
    return result;
  };
  // ADR-0094 — 재사용된 프로파일의 딥링크 (affiliate/group 경로에서 채워짐)
  let profileRef: SynergyPayload["profileRef"];
  // ADR-0102 — 재사용 경로에서도 스코어링 입력(산업노출·재무비율)을 쓰기 위해 보관
  type ReusedProfile = Awaited<ReturnType<typeof import("./company-profile-pipeline.ts")["loadLatestProfile"]>>;
  let reusedProfile: ReusedProfile = null;

  if (row.target_type === "affiliate" || row.target_type === "group") {
    // ── ADR-0090 신규 경로: 그룹/계열사 프로파일 재사용 (Steps 1~3 대체) ──
    const { loadLatestProfile } = await import("./company-profile-pipeline.ts");
    advance(1);
    if (row.target_type === "affiliate") {
      const member = db.query("SELECT company_name FROM company_group_member WHERE id = ?").get(row.member_id) as { company_name: string } | undefined;
      company = member?.company_name ?? row.name_ko;
      const prof = row.member_id ? loadLatestProfile(db, { kind: "member", id: row.member_id }) : null;
      if (!prof) throw new Error("계열사 프로파일이 없습니다 — 그룹/계열사 분석 화면에서 먼저 분석하세요.");
      profileRef = {
        kind: "affiliate",
        id: row.member_id!,
        label: company,
        profileVersion: (db.query("SELECT MAX(version_no) m FROM company_profile_version WHERE member_id = ?").get(row.member_id!) as { m: number | null }).m,
      };
      financialStrengths = prof.strengths;
      financialWeaknesses = prof.weaknesses;
      businessAssessment = prof.businessAssessment;
      reusedProfile = prof;
      corpCode = prof.dartCorpCode ?? null;
      dart = prof.dartFinancials?.available
        ? { corpCode: corpCode ?? "", found: true, year: prof.dartFinancials.year, items: (prof.dartFinancials.items ?? []).map((i) => ({ name: i.name, value: i.value, unit: "KRW", fsDiv: i.fsDiv })), reportUrl: prof.dartFinancials.reportUrl }
        : { corpCode: corpCode ?? "", found: false, items: [], error: prof.dartFinancials?.error ?? "프로파일에 재무 데이터 없음" };
    } else {
      const grp = db.query("SELECT name FROM company_group WHERE id = ?").get(row.group_id) as { name: string } | undefined;
      company = `그룹 전체 (${grp?.name ?? "그룹"})`;
      const members = db.query("SELECT id, company_name FROM company_group_member WHERE group_id = ?").all(row.group_id) as Array<{ id: string; company_name: string }>;
      const strengths = new Set<string>();
      const exposures = new Set<string>();
      let best: ReturnType<typeof loadLatestProfile> = null;
      for (const m of members) {
        const prof = loadLatestProfile(db, { kind: "member", id: m.id });
        if (!prof) continue;
        prof.strengths.forEach((x) => strengths.add(x));
        (prof.industryExposure ?? []).forEach((x) => exposures.add(x));
        if (!best || (prof.dartFinancials?.items?.length ?? 0) > (best.dartFinancials?.items?.length ?? 0)) best = prof;
      }
      if (!best) throw new Error("그룹 소속 계열사의 프로파일이 없습니다 — 그룹/계열사 분석을 먼저 실행하세요.");
      profileRef = { kind: "group", id: row.group_id!, label: grp?.name ?? "그룹", profileVersion: null };
      financialStrengths = [...strengths].slice(0, 5);
      financialWeaknesses = best.weaknesses;
      businessAssessment = `그룹 롤업 — ${members.length}개 계열사 프로파일 통합 (공통 강점 ${strengths.size}건, 산업 노출 ${exposures.size}개). 대표 재무: ${best.companyName}.`;
      // ADR-0103 — 그룹 롤업도 스코어링 입력으로 사용(노출 합집합 + 대표 재무 비율)
      reusedProfile = {
        ...best,
        industryExposure: [...exposures],
      };
      corpCode = best.dartCorpCode ?? null;
      dart = best.dartFinancials?.available
        ? { corpCode: corpCode ?? "", found: true, year: best.dartFinancials.year, items: (best.dartFinancials.items ?? []).map((i) => ({ name: i.name, value: i.value, unit: "KRW", fsDiv: i.fsDiv })), reportUrl: best.dartFinancials.reportUrl }
        : { corpCode: corpCode ?? "", found: false, items: [], error: "그룹 대표 재무 없음" };
    }
    stepSummaries.push({
      step: 1,
      title: "그룹/계열사 프로파일 입수",
      summary: `${company} — 그룹/계열사 분석의 최신 프로파일 버전을 재사용합니다 (DART ${dart.found ? "포함" : "미포함"}).`,
      source: "synthesis",
    });
    advance(2);
    stepSummaries.push({
      step: 2,
      title: "프로파일 리서치 팩 재사용",
      summary: "프로파일 분석 시 수집된 리서치 출처는 프로파일 버전에 보존돼 있어 재수집하지 않습니다 (출처·노트 탭 참조).",
      source: "synthesis",
    });
    advance(3);
    stepSummaries.push({
      step: 3,
      title: "강점/약점 확정",
      summary: `프로파일 기반 — 강점 ${financialStrengths.length}개·약점 ${financialWeaknesses.length}개. 상세 재무·SWOT·신뢰도는 그룹/계열사 분석 리포트를 참조하세요.`,
      source: "synthesis",
    });
  } else {
  // ── Step 1: DART 재무제표·사업보고서 입수 (legacy md_company 경로) ──
  advance(1);
  corpCode = row.dart_corp_code ?? null;
  if (!corpCode && isDartConfigured()) corpCode = await findCorpCode(company);
  dart = corpCode ? await fetchFinancials(corpCode, { years: 5 }) : { corpCode: "", found: false, items: [], error: isDartConfigured() ? "corp code 미확인 — 비상장 또는 검색 실패" : "DART_API_KEY 미구성" };
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
  research = isWebResearchConfigured()
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
  const faJson = await askJsonTracked(
    "s3.synergy_fa",
    `회사: ${company}\nDART 재무: ${dartContext}${creditText ? `\n\n신용평가자료 발췌:\n${creditText.slice(0, 4000)}` : ""}\n\n외부 리서치 발췌:\n${researchContext}\n\nJSON: {"strengths":["재무·사업 강점", ...],"weaknesses":["재무·사업 약점", ...],"businessAssessment":"종합 평가 3~5문장 — 리서치 발췌와 교차검증하고 상충 시 명시"}. 강점·약점 각 3~5개, 리서치 출처 번호([n])를 문장 끝에 붙이세요.`,
  );
  const listOf = (v: unknown, fallback: string[]): string[] => {
    const arr = Array.isArray(v) ? v : [];
    const items = arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5);
    return items.length ? items : fallback;
  };
  financialStrengths = listOf(faJson?.strengths, ["재무 분석 미생성 — DART/리서치 데이터 확인 후 보완"]);
  financialWeaknesses = listOf(faJson?.weaknesses, ["재무 분석 미생성 — 보완 필요"]);
  businessAssessment = str(faJson?.businessAssessment, "종합 평가 미생성 — 보완 필요");
  const faSummary = await completeOrFallback(
    [{ role: "user", content: `회사 ${company}의 재무·사업 분석을 한국어 2문장으로 요약하세요. 강점 ${financialStrengths.length}개, 약점 ${financialWeaknesses.length}개 도출.` }],
    () => `재무 강점 ${financialStrengths.length}개·약점 ${financialWeaknesses.length}개 도출. ${businessAssessment.slice(0, 120)}`,
    { maxTokens: 300, agent: promptAgent("s3.synergy_fa", { purpose: "시너지 재무·사업 분석 요약" }) },
  );
  stepSummaries.push({ step: 3, title: "재무 강/약점 분석", summary: faSummary.text, source: faSummary.source });
  if (llmConfiguredAtStart && faSummary.source !== "llm") hadLlmFailure = true;
  }

  // 리서치 보강 — 프로파일 재사용 경로(ADR-0090)는 Tavily 리서치를 실행하지
  // 않아 webResearchCount가 0이었다. 리서치는 LLM과 무관한 입수 단계이므로
  // 근거 확보를 위해 여기서 독립 실행한다 (ADR-0103 — 리서치/평가 분리).
  if (!research.length && isWebResearchConfigured()) {
    research = await researchSources([
      `${company} 사업보고서 재무 분석`,
      `${company} 증권사 리포트 전망`,
      `${company} 뉴스 시너지 M&A`,
    ], 12);
    if (research.length) {
      stepSummaries.push({ step: 3, title: "외부 리서치 보강 (재사용 경로)", summary: `프로파일 재사용 경로에 외부 출처 ${research.length}건 추가 입수 — 출처·노트 탭 참조.`, source: "synthesis" });
    }
  }

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
    let relatedIndustries: string[] = [];
    try {
      const matrix = (JSON.parse(m.payload) as {
        matrix?: {
          consistency?: { bottomUpCagr?: number };
          externalForecast?: EfShape;
          chainDirection?: { relatedIndustries?: Array<{ name?: string }> };
        };
      }).matrix;
      cagrPct = matrix?.consistency?.bottomUpCagr ?? null;
      ef = matrix?.externalForecast ?? null;
      newDrivers = ef?.newDrivers ?? [];
      relatedIndustries = (matrix?.chainDirection?.relatedIndustries ?? [])
        .map((r) => String(r?.name ?? "")).filter(Boolean);
    } catch { /* skip malformed */ }
    return { industry: m.name_ko, cagrPct, gapPct: ef?.gapPct ?? null, newDrivers, relatedIndustries };
  });
  const marketsContext = marketSummaries
    .map((m) => `${m.industry}: CAGR ${m.cagrPct ?? "?"}%${m.gapPct !== null ? `, 외부 전망 대비 격차 ${m.gapPct > 0 ? "+" : ""}${m.gapPct}%` : ""}${m.newDrivers.length ? `, 신규 드라이버: ${m.newDrivers.join("/")}` : ""}`)
    .join("\n") || "(완료된 시장분석 없음)";
  // ADR-0090 — 연결 기회 컨텍스트
  type OppRow = { id: string; name: string; market_scope: string | null; rationale: string | null };
  let oppRow: OppRow | null = null;
  let oppContext = "";
  if (row.opportunity_id) {
    oppRow = db.query("SELECT id, name, market_scope, rationale FROM opportunity WHERE id = ?").get(row.opportunity_id) as OppRow | null;
    if (oppRow) {
      oppContext = `\n\n연결 기회 (이 분석은 아래 기회를 위한 시너지 검증입니다):\n- 기회명: ${oppRow.name}\n- 시장 범위: ${oppRow.market_scope ?? "—"}\n- 발굴 근거: ${oppRow.rationale ?? "—"}`;
      // ADR-0181 slice 5 — the S2-confirmed entry market is the SUBJECT MARKET
      // this synergy analysis is judged against; the guarded block is
      // evidence, never instructions (values may be unset).
      const { buildSubjectMarketContext, subjectMarketPromptBlock } = await import("./entry-market-context.ts");
      const subject = buildSubjectMarketContext(db, oppRow.id);
      if (subject) oppContext += `\n\n${subjectMarketPromptBlock(subject)}`;
    }
  }
  const synJson = await askJsonTracked(
    "s3.synergy_synergy",
    `역할 구분 — 인수 주체: ${acquirer ?? (row.target_type ? `자사 (${company})` : "미지정")}, 검증 대상: ${company}\n대상 기업 재무/사업 평가: ${businessAssessment}\n대상 기업 강점: ${financialStrengths.join(" / ")}\n\nS1·S2 완료 시장 분석(Long List):\n${marketsContext}${oppContext}\n\nJSON: {"synergyAreas":[{"area":"시너지 영역명","synergyType":"매출 시너지|원가 절감|기술·역량|유통·채널 등","rationale":"대상 기업의 역량·자산이 인수 주체와 연결되어 시너지가 나는 근거 2~3문장","opportunity":"구체 기회","risk":"리스크","sources":["관련 출처 번호/명"]}]} — 3~6개 영역. 인수 주체의 역량과 대상 기업 강점, 시장 격차·드라이버를 연결해 Long List를 Short List로 좁히세요.`,
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

  // ── Step 5: Short List 정리 + 시너지 점수 (하이브리드 — ADR-0102) ──
  advance(5);
  const slJson = await askJsonTracked(
    "s3.synergy_ic",
    `시너지 영역 후보: ${JSON.stringify(synergyAreas.map((a, i) => ({ no: i + 1, area: a.area, opportunity: a.opportunity, risk: a.risk })))}${oppRow ? `\n\n연결 기회: ${oppRow.name} (${oppRow.market_scope ?? "—"})` : ""}\n\nJSON: {"shortList":[{"rank":1,"area":"영역명","verdict":"Short List|보류","reason":"한두 문장"}]} — 전체 순위 매기고 상위 2~3개를 Short List로.`,
  );
  const shortList = (Array.isArray(slJson?.shortList) ? slJson!.shortList : synergyAreas.map((a, i) => ({ rank: i + 1, area: a.area, verdict: "보류", reason: "자동 선별 미생성" })))
    .slice(0, 6)
    .map((s, i) => ({ rank: num(s.rank, i + 1), area: str(s.area, "—"), verdict: str(s.verdict, "보류"), reason: str(s.reason, "—") }));

  // 시너지 점수 — 규칙 기반 팩터 엔진이 앵커를 계산하고(결정론·인자 분해),
  // LLM이 가용하면 서사 근거와 ±10p 이내 보정만 추가한다. LLM 불가 시에도
  // 규칙 점수 + 템플릿 근거로 저하 동작한다 (fail-degraded, 점수 소실 없음).
  const { computeSynergyScore, toCagrFraction } = await import("./synergy-score.ts");
  // ADR-0182 — 필요 역량 충족도 (5번째 팩터): the opportunity's capability
  // register holding coverage (0-100, essential rows weighted ×2 via
  // summarizeGap.essentialCoveragePct blend). Null when the register is
  // empty/unjudged — the factor is then excluded with a 미반영 note.
  let capabilityCoverage: number | null = null;
  let capabilityCoverageNote: string | null = null;
  if (oppRow) {
    const storedGapJson = (db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(oppRow.id) as { capability_gap_json: string | null } | undefined)?.capability_gap_json ?? null;
    const reg = parseGapRegister(storedGapJson);
    if (reg.rows.length > 0) {
      const s = summarizeGap(reg.rows);
      const essential = s.essentialCoveragePct;
      if (s.evaluated === 0) {
        capabilityCoverage = null;
        capabilityCoverageNote = `필요 역량 ${s.total}건 모두 미판정 — 충족도 팩터 미반영`;
      } else {
        capabilityCoverage = essential !== null && s.coveragePct !== null
          ? Math.round(s.coveragePct * 0.5 + essential * 0.5)
          : s.coveragePct;
        capabilityCoverageNote = `필요 역량 ${s.total}건 중 판정 ${s.evaluated}건 — 보유율 ${s.coveragePct !== null ? s.coveragePct + "%" : "—"}, 필수 충족율 ${essential !== null ? essential + "%" : "—"}`;
      }
    }
  }
  const rule = computeSynergyScore({
    opportunity: oppRow ? { market_scope: oppRow.market_scope, value_chain_node: null, name: oppRow.name } : null,
    profile: reusedProfile ? { industryExposure: reusedProfile.industryExposure ?? [], strengths: financialStrengths, ratios: reusedProfile.financialAnalysis?.ratios ?? [] } : null,
    markets: marketSummaries.map((m) => ({ industry: m.industry, cagr: toCagrFraction(m.cagrPct), relatedIndustries: m.relatedIndustries })),
    capabilityCoverage,
    capabilityCoverageNote,
  });
  let synergyScore: number | null = rule.score;
  let adjustmentDelta = 0;
  let adjustmentReason = "";
  // 사람이 읽는 근거는 산식(값×가중치)이 아니라 서술이어야 한다 — 계산
  // 과정을 그대로 노출하면 "확정 근거"를 사람이 검토·작성한 것처럼 보여줄 때
  // 어색해진다(2026-09-15 사용자 리포트). 반영된 요소 이름만 나열하고, 실제
  // 판단 내용은 LLM 정성 근거(adj.reason) 또는 아래 fallback 문장이 담당한다.
  const consideredFactors = rule.factors.filter((f) => f.value !== null).map((f) => f.label);
  let synergyRationale: string | null = rule.score !== null
    ? `규칙 기반 종합 판단 — 반영 요소: ${consideredFactors.join(", ") || "—"}.${rule.missing.length ? ` 미반영: ${rule.missing.join("; ")}.` : ""}`
    : null;
  let scoringMethod: "hybrid" | "rule-based" | "unavailable" = rule.score !== null ? "rule-based" : "unavailable";
  if (oppRow) {
    const adj = await askJsonTracked(
      "s3.synergy_ic",
      `규칙 기반 시너지 점수: ${rule.score ?? "산출 불가"} (인자: ${JSON.stringify(rule.factors)})\n대상: ${company}, 연결 기회: ${oppRow.name}\n강점: ${financialStrengths.join(" / ")}\n시너지 영역: ${synergyAreas.map((a) => a.area).join(", ") || "없도"}\n\nJSON: {"adjustment": <-10..10 정수>, "reason": "<보정 사유 1~2문장, 정성 근거 명시>"} — 데이터가 부족하면 adjustment 0.`,
    );
    if (adj && rule.score !== null) {
      const delta = typeof adj.adjustment === "number" ? Math.max(-10, Math.min(10, Math.round(adj.adjustment))) : 0;
      if (delta !== 0) {
        synergyScore = Math.max(0, Math.min(100, rule.score + delta));
        scoringMethod = "hybrid";
        synergyRationale = String(adj.reason ?? synergyRationale);
      } else if (adj.reason) {
        synergyRationale = String(adj.reason);
      }
      // ADR-0182 Phase 2 — 보정 이력을 breakdown에 남긴다 (delta 0도 기록).
      adjustmentDelta = delta;
      adjustmentReason = String(adj.reason ?? "");
    }
  }
  stepSummaries.push({
    step: 5,
    title: "Short List 정리 + 시너지 점수",
    summary: `Short List ${shortList.filter((s) => s.verdict.includes("Short")).length}개 선별 (전체 ${shortList.length}영역 평가). 시너지 점수: ${synergyScore ?? "산출 불가"} (${scoringMethod}).`,
    source: slJson || scoringMethod === "hybrid" ? "llm" : "synthesis",
  });

  // ── 필요 역량 수준 자동 도출 (2026-09-15 사용자 설계) — 시너지 분석이
  // 도출한 영역(선별 우선)을 채우는 데 필요한 역량을 제안한다. 연결 기회
  // 레지스터에 병합하되 기존 행은 건드리지 않는다(중복 역량명 제외, 미판정
  // 행으로만 추가) — 보유 판정은 사람의 몫(경계 #2). LLM 불가·실패 시에는
  // 건너뛴다(수준 값을 위조하지 않는다). ──
  let derivedGapRows: Array<{ capability: string; requiredNote: string }> = [];
  if (oppRow) {
    const areaInputs = [
      ...shortList.map((s) => ({ area: s.area, shortlisted: s.verdict.includes("Short"), opportunity: undefined as string | undefined, risk: undefined as string | undefined })),
      ...synergyAreas
        .filter((a) => !shortList.some((s) => s.area === a.area))
        .map((a) => ({ area: a.area, shortlisted: false, opportunity: a.opportunity, risk: a.risk })),
    ].slice(0, 8);
    const capJson = await askJsonTracked(
      "s3.synergy_ic",
      `시너지 영역: ${JSON.stringify(areaInputs)}\n대상: ${company}, 연결 기회: ${oppRow.name}\n강점: ${financialStrengths.join(" / ") || "없음"}\n\nJSON: {"rows":[{"capability":"필요 역량명","requiredNote":"시너지 영역 X에서 도출 — 사유"}]} — 위 영역을 실제로 채우는 데 필요한 역량만 제안하고(최대 6개), 이미 같은 역량이면 중복 제안하지 않는다. requiredNote에는 출처 영역명을 인용한다.`,
    );
    const rawRows = Array.isArray(capJson?.rows) ? capJson!.rows : [];
    derivedGapRows = rawRows
      .map((r) => ({ capability: String(r?.capability ?? "").trim().slice(0, 200), requiredNote: String(r?.requiredNote ?? "").trim().slice(0, 300) }))
      .filter((r) => r.capability)
      .slice(0, 6);
  }

  // ── Persist ──
  // ADR-0132 — 이미 완료된 분석의 재분석이 LLM 장애로 저하되면, status가
  // 여전히 'completed'인지(요청 시점에 손대지 않았는지)로 "보호 대상
  // 재분석"임을 판별해 새 버전을 만들지 않고 이전 버전을 그대로 둔다.
  const statusNow = (db.query("SELECT status FROM synergy_analysis WHERE id = ?").get(analysisId) as { status: string }).status;
  const wasProtectedRerun = statusNow === "completed";
  if (hadLlmFailure && wasProtectedRerun) {
    db.run(
      "UPDATE synergy_analysis SET rerun_in_progress = 0, error_message = ? WHERE id = ?",
      ["LLM 호출 중 일부 실패 — 이전 분석 결과를 유지합니다. 재시도하세요.", analysisId],
    );
    return;
  }
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
    target: row.target_type ? { type: row.target_type, name: company } : undefined,
    opportunity: oppRow ? { id: oppRow.id, name: oppRow.name } : null,
    profileRef,
    synergyScore: oppRow ? synergyScore : null,
    synergyRationale: oppRow ? synergyRationale : null,
    scoringMethod: oppRow ? scoringMethod : undefined,
    synergyScoreFactors: oppRow ? rule.factors : undefined,
    synergyScoreLimitations: oppRow ? rule.missing : undefined,
    capabilityCoverage: oppRow ? capabilityCoverage : null,
    capabilityCoverageNote: oppRow ? capabilityCoverageNote : null,
    scoreAdjustment: adjustmentDelta !== 0 || adjustmentReason ? { delta: adjustmentDelta, reason: adjustmentReason } : null,
  };
  const nextVersionNo =
    ((db.query("SELECT MAX(version_no) m FROM synergy_version WHERE analysis_id = ?").get(analysisId) as { m: number | null }).m ?? 0) + 1;
  db.transaction(() => {
    db.run(
      `INSERT INTO synergy_version (id, analysis_id, version_no, payload, changelog, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [ulid(), analysisId, nextVersionNo, JSON.stringify(payload), `시너지 정합성 분석 v${nextVersionNo} (DART ${dart.found ? "입수" : "미입수"} · 리서치 ${research.length}건 · Short List ${shortList.filter((s) => s.verdict.includes("Short")).length}개)`, "synergy-pipeline", now()],
    );
    if (oppRow && payload.synergyScore !== null && payload.synergyScore !== undefined) {
      // 경계 #2 — 사람 확정 전 권고값: opportunity.synergy_score에 권고를 기록하고
      // 근거(synergy_rationale)를 남긴다. 최종 판단은 사람이 한다.
      recordSynergyRecommendation(db, oppRow.id, Math.max(0, Math.min(100, Math.round(payload.synergyScore))), payload.synergyRationale ?? null);
    }
    // 시너지 영역에서 도출한 필요 역량 제안 병합 — 기존 행 보존, 중복 역량명
    // 제외, 미판정 행으로만 추가. 사람이 화면에서 확인·판정한다(경계 #2).
    if (oppRow && derivedGapRows.length > 0) {
      const storedGapJson = (db.query("SELECT capability_gap_json FROM opportunity WHERE id = ?").get(oppRow.id) as { capability_gap_json: string | null } | undefined)?.capability_gap_json ?? null;
      const existing = parseGapRegister(storedGapJson);
      const caps = new Set(existing.rows.map((r) => r.capability.toLowerCase()));
      const additions = derivedGapRows
        .filter((r) => !caps.has(r.capability.toLowerCase()))
        .map((r) => ({
          id: `gap-synarea-${ulid()}`,
          capability: r.capability,
          source: "synergy_area" as const,
          requiredNote: r.requiredNote,
          necessity: "" as const,
          necessityScopeNote: "",
          held: { status: "unevaluated" as const, holders: [] as string[], evidence: "" },
          resolution: null,
          note: "LLM 시너지 영역 도출 초안 — 사람이 확인해 확정하세요.",
          requiredLevel: "",
          currentLevel: "",
        }));
      if (additions.length > 0) {
        persistGapRegister(db, oppRow.id, [...existing.rows, ...additions], now(), "synergy-pipeline");
      }
    }
    db.run(
      "UPDATE synergy_analysis SET status = 'completed', current_step = 5, completed_at = ?, rerun_in_progress = 0, error_message = NULL WHERE id = ?",
      [now(), analysisId],
    );
  })();
}
