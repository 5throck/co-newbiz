// 그룹/계열사 분석 파이프라인 — 계열사 프로파일 6단계 (flow.spec S3의 입력).
//   1. DART 재무제표·사업보고서 입수 (dart-client 재사용)
//   2. 외부 리서치 — 증권사 애널리스트 리포트·산업 동향·경쟁사 (web-research 재사용)
//   3. LLM 강점/약점/기회/위협(SWOT)/사업 평가 (근거 출처 명기, 결정론 폴백)
//   4. LLM 경쟁 포지셔닝 (실패해도 버전 저장을 막지 않는다)
//   5. 결정론 합성 — 재무 비율·추세, S1 매트릭스 산업 연계, 섹션별 신뢰도,
//      검증 원장, RAG 상한 (LLM 없음 — ADR-0093)
//   6. company_profile_version에 버전 누적 (append-only, ADR-0005 패턴)
import { getDb } from "../../../db/client.ts";
import { resolveCorpCode, validateCorpCode, fetchFinancials, isDartConfigured, type DartFinancials } from "../lib/dart-client.ts";
import { completeOrFallback } from "./llm.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "./web-research.ts";
import { deriveFinancialAnalysis } from "./company-financials.ts";
import { ulid } from "../../../db/lib/ulid.ts";

/** S1과 동일한 3단 검증 상태 (ADR-0092 decision 6의 검증 원장 표준) */
export type LedgerStatus = "confirmed" | "could_not_verify" | "needs_judgement";

export interface CompanyProfilePayload {
  companyName: string;
  dartCorpCode: string | null;
  dartFinancials: {
    available?: boolean;
    year?: string;
    items?: Array<{ name: string; value: number }>;
    reportUrl?: string;
    error?: string;
  };
  strengths: string[];
  weaknesses: string[];
  businessAssessment: string;
  industryExposure: string[];
  /** LLM 평가 실패로 폴백 저장된 경우 사유 — null이면 정상 분석 */
  degraded?: string | null;
  researchSources: Array<{ title: string; url: string; snippet?: string }>;
  dataSources: {
    dart: boolean;
    dartYear: string | null;
    webResearchCount: number;
  };
  stepSummaries: Array<{ step: number; title: string; summary: string; source: string }>;
  // ── ADR-0093 (schemaVersion 2) 확장 — 전부 optional, 구 v1 payload와 공존 ──
  /** 결정론 재무 분석 (비율·추세) — lib/company-financials.ts 참조 */
  financialAnalysis?: import("./company-financials.ts").FinancialAnalysis;
  /** SWOT 기회/위협 — strengths/weaknesses는 기존 대표 필드 유지 */
  swot?: { opportunities: string[]; threats: string[] };
  /** 경쟁 포지셔닝 (LLM, 단계 4) */
  competitive?: { competitors: Array<{ name: string; note: string }>; positioning: string; degraded?: string | null };
  /** S1 시장분석 매트릭스와의 산업 연계 (단계 5 결정론) */
  industryLinkage?: Array<{
    industry: string;
    industryId: string | null;
    matrixFound: boolean;
    anchorTotalUsdB?: number | null;
    cagr?: number | null;
    externalGapPercent?: number | null;
    qualitativeLinks?: { opportunityFactors: string[]; riskFactors: string[] };
    note?: string;
  }>;
  /** 섹션별 데이터 신뢰도 등급 — S1 표준 (단계 5 결정론) */
  sectionConfidence?: Array<{ section: string; grade: "A" | "B" | "B-" | "C" | "C-" | "D"; note: string }>;
  /** 검증 원장 — 확인/확인불가/판단필요 (S1 표준) */
  verificationLedger?: Array<{ item: string; status: LedgerStatus; evidence: string }>;
  /** RAG 상한 권고 — 데이터 신뢰도가 전체 등급을 캡핑 (경계 #4) */
  ragCapRecommendation?: { grade: "green" | "amber" | "red"; rationale: string };
  schemaVersion?: number;
}

const now = () => new Date().toISOString();

type Db = ReturnType<typeof getDb>;

// ── In-process 작업 상태 ──
// 파이프라인은 analyze 라우트에서 fire-and-forget으로 실행된다. 실패를 여기서
// 기록하지 않으면 라우트의 .catch(console.error)만 남고, profile 폴링은
// version이 없다는 이유로 영원히 "in_progress"를 돌려 분석이 끝을 알 수 없다.
export interface ProfileJobStatus {
  status: "running" | "failed";
  error?: string;
  startedAt: string;
  failedAt?: string;
}

const profileJobs = new Map<string, ProfileJobStatus>();

export function getProfileJobStatus(memberId: string): ProfileJobStatus | null {
  return profileJobs.get(memberId) ?? null;
}

/** analyze 라우트용 실행기 — running/failed 상태를 기록하고 성공 시 지운다(이후 status는 completed가 version 유무로 판정). */
export function startCompanyProfilePipeline(db: Db, memberId: string, userId: string): void {
  profileJobs.set(memberId, { status: "running", startedAt: now() });
  void runCompanyProfilePipeline(db, memberId, userId)
    .catch((err: unknown) => {
      profileJobs.set(memberId, {
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 300) : String(err),
        startedAt: profileJobs.get(memberId)?.startedAt ?? now(),
        failedAt: now(),
      });
      console.error("company profile pipeline failed:", err);
    });
}

export async function runCompanyProfilePipeline(db: Db, memberId: string, userId: string): Promise<void> {
  const member = db
    .query(
      `SELECT m.id, m.group_id, m.company_name, m.dart_corp_code, g.name AS group_name
       FROM company_group_member m JOIN company_group g ON g.id = m.group_id WHERE m.id = ?`,
    )
    .get(memberId) as
    | { id: string; group_id: string; company_name: string; dart_corp_code: string | null; group_name: string }
    | null;
  if (!member) throw new Error(`company_group_member ${memberId} not found`);
  const company = member.company_name;
  const stepSummaries: CompanyProfilePayload["stepSummaries"] = [];
  const summarize = async (step: number, title: string, summary: string) => {
    const source = isWebResearchConfigured() || isDartConfigured() ? "llm" : "synthesis";
    stepSummaries.push({ step, title, summary, source });
  };

  // ── Step 1: DART 재무 입수 (corp_code는 교차검증 통과 코드만 사용·저장) ──
  let corpCode = member.dart_corp_code ?? null;
  let codeNote: string | null = null;
  if (corpCode) {
    const v = await validateCorpCode(corpCode, company);
    if (v.validated === false) {
      codeNote = `저장된 DART 고유번호 ${corpCode}가 이 회사와 불일치(실제: ${v.corpName ?? "미확인"}) — 폴백 체인으로 재해석합니다.`;
      corpCode = null;
    }
  }
  if (!corpCode && isDartConfigured()) {
    const r = await resolveCorpCode(company);
    if (r.corpCode && r.validated !== false) {
      corpCode = r.corpCode;
      codeNote = `고유번호 ${r.corpCode}를 ${r.resolvedVia} 경로로 해소 (교차검증 ${r.validated ? "통과" : "불가"})`;
    } else {
      codeNote = "고유번호 해소 실패 — 비상장(리서치 기반)으로 진행";
    }
  }
  const dart: DartFinancials = corpCode ? await fetchFinancials(corpCode, { years: 5 }) : { corpCode: "", found: false, items: [], error: isDartConfigured() ? codeNote ?? "corp code 미확인 — 비상장 또는 검색 실패" : "DART_API_KEY 미구성" };
  // 교차검증 통과 코드만 영속화 — 잘못된 코드가 DB에 남지 않는다.
  if (corpCode && corpCode !== member.dart_corp_code && dart.found) {
    db.run("UPDATE company_group_member SET dart_corp_code = ? WHERE id = ?", [corpCode, member.id]);
  }
  // 연도 커버리지 — 최신 사업보고서가 어느 해인지/이후 미제출임을 명시한다
  const yearsFound = [...new Set((dart.items ?? []).map((i) => i.year ?? ""))].filter(Boolean).sort().reverse();
  const latestBusinessYear = new Date().getFullYear() - 1;
  let coverageNote = "";
  if (dart.found && yearsFound.length > 0 && Number(yearsFound[0]) < latestBusinessYear) {
    coverageNote = ` 참고: ${yearsFound[0]}년 사업보고서가 마지막 제출입니다 — 이후 사업보고서 미제출(013).`;
  }
  await summarize(1, "DART 재무제표·사업보고서 입수",
    (codeNote ? `${codeNote}. ` : "") +
    (dart.found
      ? `사업보고서 재무 입수: ${yearsFound.join(" / ")}년 (${dart.items.length}개 계정).${coverageNote}`
      : `DART 미입수 — ${dart.error ?? "사유 없음"} (웹 리서치로 보강).`));

  // ── Step 2: 외부 리서치 (애널리스트 리포트·산업 동향·경쟁사) ──
  let research: WebSource[] = [];
  if (isWebResearchConfigured()) {
    research = await researchSources([
      `${company} 애널리스트 리포트 리서치`,
      `${company} analyst report competitive position`,
      `${member.group_name} 그룹 산업 동향`,
      `${company} 사업 부문 경쟁력 실적`,
      `${company} 경쟁사 비교 주요 경쟁자`,
    ], 12);
  }
  const researchContext = research.length
    ? research.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.snippet}`).join("\n\n")
    : "(웹 리서치 미구성 — LLM 지식 기반)";
  await summarize(2, "외부 리서치 입수", `출처 ${research.length}건 (애널리스트 리포트·산업 동향·실적).`);

  // ── Step 3: LLM 강점/약점/기회/위협(SWOT)/사업 평가 ──
  const qualJson = await completeOrFallback(
    [
      { role: "system" as const, content: "당신은 기업 분석 전문가입니다. 제공된 근거(리서치 발췌·재무 데이터) 안에서만 자사 계열사의 프로파일을 작성하세요. 근거가 없는 항목은 '검증 필요'로 명시하세요." },
      {
        role: "user" as const,
        content:
          `${company}(${member.group_name} 그룹 계열사)의 프로파일을 작성하세요. JSON: {"strengths":["강점 2~4개"],"weaknesses":["약점 2~4개"],"opportunities":["기회 요인 2~3개(시장·산업·기술 관점)"],"threats":["위협 요인 2~3개(경쟁·규제·대체재 관점)"],"businessAssessment":"사업 평가 2~3문장","industryExposure":["노출 산업/부문", "..."]}. 기회/위협은 이 회사에 특정한 것으로 쓰고 일반론을 나열하지 말 것. 각 항목은 발췌 근거가 있으면 출처 번호([n])를 문장 끝에 붙이세요.\n\nDART 재무: ${dart.found ? `${dart.year}년 재무 ${dart.items.length}개 계정` : "미입수"}\n\n리서치 발췌:\n${researchContext}`,
      },
    ],
    () =>
      JSON.stringify({
        strengths: ["웹 리서치 미구성 — 수동 등록 필요"],
        weaknesses: ["웹 리서치 미구성 — 수동 등록 필요"],
        opportunities: ["검증 필요 — 재분석 요망"],
        threats: ["검증 필요 — 재분석 요망"],
        businessAssessment: "리서치 입수 결과가 없어 평가 미생성 — 재분석 또는 수동 작성 필요.",
        industryExposure: [],
      }),
    { maxTokens: 2000 },
  );
  let strengths: string[] = [];
  let weaknesses: string[] = [];
  let opportunities: string[] = [];
  let threats: string[] = [];
  let businessAssessment = "";
  let industryExposure: string[] = [];
  let degraded: string | null = null; // LLM 평가 실패 사유 — null이면 정상 (ADR 없이 2026-09-02 사용자 지시)
  try {
    const parsed = JSON.parse(qualJson.text.slice(qualJson.text.indexOf("{"), qualJson.text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5) : []);
    strengths = arr(parsed.strengths);
    weaknesses = arr(parsed.weaknesses);
    opportunities = arr(parsed.opportunities);
    threats = arr(parsed.threats);
    industryExposure = arr(parsed.industryExposure);
    if (typeof parsed.businessAssessment === "string") businessAssessment = parsed.businessAssessment;
  } catch (err) {
    degraded = `LLM 응답 파싱 실패 (${err instanceof Error ? err.message.slice(0, 60) : "알 수 없는 오류"})`;
  }
  // 정적 폴백 문구가 저장된 경우 — 실제 상황을 반영해 정직하게 표기
  if (strengths.length === 1 && strengths[0]?.includes("미구성")) {
    degraded = research.length > 0
      ? `LLM 평가 실패 — 리서치 ${research.length}건 수집됐으나 평가 생성 실패 (재분석 권장)`
      : "LLM 미구성 및 리서치 미구성 — 수동 등록 필요";
    strengths = [`(평가 실패 — ${research.length}건의 리서치 출처는 '출처·노트' 탭 참조)`];
    weaknesses = [`(평가 실패 — 재분석을 실행하세요)`];
    if (!businessAssessment) businessAssessment = "LLM 평가 실패 — 재분석 시 재생성됩니다.";
  }
  await summarize(3, "강점/약점·기회/위협(SWOT)·사업 평가",
    degraded
      ? `폴백 저장 — ${degraded}`
      : `강점 ${strengths.length}개·약점 ${weaknesses.length}개·기회 ${opportunities.length}개·위협 ${threats.length}개 도출 (출처 ${research.length}건 기반).`);

  // ── Step 4: 경쟁 포지셔닝 (LLM — 실패해도 버전 저장을 막지 않는다) ──
  const compJson = await completeOrFallback(
    [
      { role: "system" as const, content: "당신은 기업 분석 전문가입니다. 근거 발췌 안에서만 답하세요. 알 수 없으면 적지 마세요." },
      {
        role: "user" as const,
        content: `${company}의 주요 경쟁사와 경쟁 포지셔닝을 분석하세요. JSON: {"competitors":[{"name":"경쟁사명","note":"경쟁 관계 한 문장 [n]"}],"positioning":"이 회사의 포지셔닝 평가 2~3문장"}. 경쟁사 2~5개.\n\n리서치 발췌:\n${researchContext}`,
      },
    ],
    () => JSON.stringify({ competitors: [], positioning: "" }),
    { maxTokens: 1200 },
  );
  let competitive: CompanyProfilePayload["competitive"] | undefined;
  try {
    const parsed = JSON.parse(compJson.text.slice(compJson.text.indexOf("{"), compJson.text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const competitors = (Array.isArray(parsed.competitors) ? parsed.competitors as Array<Record<string, unknown>> : [])
      .map((c) => ({ name: typeof c.name === "string" ? c.name.trim() : "", note: typeof c.note === "string" ? c.note.trim() : "" }))
      .filter((c) => c.name)
      .slice(0, 6);
    if (competitors.length > 0 || (typeof parsed.positioning === "string" && parsed.positioning.trim())) {
      competitive = {
        competitors,
        positioning: typeof parsed.positioning === "string" ? parsed.positioning.trim() : "",
      };
    }
  } catch {
    competitive = { competitors: [], positioning: "", degraded: "LLM 응답 파싱 실패 — 재분석 시 재생성됩니다" };
  }
  await summarize(4, "경쟁 포지셔닝",
    competitive && !competitive.degraded
      ? `경쟁사 ${competitive.competitors.length}개·포지셔닝 평가 도출.`
      : "경쟁 포지셔닝 미생성 — 재분석 시 재생성됩니다.");

  // ── Step 5: 결정론 합성 (LLM 없음) — 재무 분석·산업 연계·신뢰도·검증 원장·RAG 상한 ──
  const financialAnalysis = deriveFinancialAnalysis(dart);
  if (coverageNote) financialAnalysis.notes.push(coverageNote.trim());

  const industryLinkage: CompanyProfilePayload["industryLinkage"] = [];
  for (const exposure of industryExposure) {
    const ind = (db.query("SELECT id, name_ko FROM md_industry WHERE name_ko = ? LIMIT 1").get(exposure)
      ?? db.query("SELECT id, name_ko FROM md_industry WHERE name_ko LIKE ('%' || ? || '%') LIMIT 1").get(exposure)) as { id: string; name_ko: string } | undefined;
    if (!ind) {
      industryLinkage.push({ industry: exposure, industryId: null, matrixFound: false, note: "S1 시장분석 매트릭스 없음 — /market에서 분석 가능" });
      continue;
    }
    const version = db.query(
      `SELECT v.payload FROM market_sizing_version v
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE a.industry_id = ? AND a.status = 'completed'
       ORDER BY v.version_no DESC LIMIT 1`,
    ).get(ind.id) as { payload: string } | undefined;
    if (!version) {
      industryLinkage.push({ industry: ind.name_ko, industryId: ind.id, matrixFound: false, note: "완료된 S1 분석 없음" });
      continue;
    }
    const m = (JSON.parse(version.payload) as {
      matrix?: {
        anchor?: { total?: number };
        consistency?: { bottomUpCagr?: number };
        externalForecast?: { gapPct?: number };
        qualitative?: { opportunityFactors?: string[]; riskFactors?: string[] };
      };
    }).matrix ?? {};
    industryLinkage.push({
      industry: ind.name_ko,
      industryId: ind.id,
      matrixFound: true,
      anchorTotalUsdB: m.anchor?.total ?? null,
      cagr: m.consistency?.bottomUpCagr ?? null,
      externalGapPercent: m.externalForecast?.gapPct ?? null,
      qualitativeLinks: {
        opportunityFactors: m.qualitative?.opportunityFactors?.slice(0, 3) ?? [],
        riskFactors: m.qualitative?.riskFactors?.slice(0, 3) ?? [],
      },
    });
  }

  // 섹션별 신뢰도 — 산출 근거 등급에서 결정론 부여 (S1 단계 7-A 표준)
  const sectionConfidence: CompanyProfilePayload["sectionConfidence"] = [
    { section: "재무 (DART)", grade: dart.found ? "B" : "D", note: dart.found ? `공시 원문 기반 (${yearsFound.join("/")}) — 원계정, 비율은 파생 계산` : dart.error ?? "DART 미입수" },
    { section: "강점·약점·사업 평가", grade: research.length >= 3 ? "B-" : "D", note: research.length >= 3 ? `웹 리서치 ${research.length}건 기반 — LLM 요약, 원문 확인 전` : "리서치 부족 — LLM 지식 의존" },
    { section: "기회·위협 (SWOT)", grade: research.length >= 3 ? "C" : "D", note: "LLM 추정 — 분석가 확인 전 (S1 정성요인 연계 참조)" },
    { section: "경쟁 포지셔닝", grade: competitive && !competitive.degraded ? "C" : "D", note: competitive && !competitive.degraded ? "LLM 추정 — 공시·리서치 대조 전" : "미생성 또는 폴백" },
    { section: "산업 연계 (S1 매트릭스)", grade: industryLinkage.some((l) => l.matrixFound) ? "B" : "C-", note: industryLinkage.some((l) => l.matrixFound) ? "S1 완료 매트릭스의 실측 수치 연결" : "연결된 S1 매트릭스 없음" },
  ];

  // 검증 원장 — 침묵은 승인으로 읽지 않는다 (S1 표준)
  // 업로드 파일(신용평가서 등)은 company_profile_version.source_ref에 기록된다.
  const uploadedRef = (db.query(
    "SELECT source_ref FROM company_profile_version WHERE member_id = ? AND source_ref IS NOT NULL ORDER BY version_no DESC LIMIT 1",
  ).get(member.id) as { source_ref: string } | undefined)?.source_ref ?? null;
  const verificationLedger: CompanyProfilePayload["verificationLedger"] = [
    dart.found
      ? { item: `DART 재무제표 입수 (${yearsFound.join("/")}, ${dart.items.length}계정)`, status: "confirmed", evidence: dart.reportUrl ?? `corp_code ${corpCode}` }
      : { item: "DART 재무제표 입수", status: "could_not_verify", evidence: dart.error ?? "사유 없음" },
    { item: "신용평가서 (업로드 파일)", status: "could_not_verify", evidence: uploadedRef ? "파일이 업로드돼 있으나 현재 파이프라인이 본문을 반영하지 않음" : "업로드된 파일 없음" },
    ...strengths.filter((s) => !s.includes("평가 실패")).map((s) => ({ item: `강점: ${s.slice(0, 60)}`, status: "needs_judgement" as const, evidence: "LLM 추정 — 분석가 확인 필요" })),
    ...weaknesses.filter((s) => !s.includes("재분석")).map((s) => ({ item: `약점: ${s.slice(0, 60)}`, status: "needs_judgement" as const, evidence: "LLM 추정 — 분석가 확인 필요" })),
    ...industryLinkage.filter((l) => l.matrixFound).map((l) => ({ item: `S1 매트릭스 연계: ${l.industry}`, status: "confirmed" as const, evidence: "완료된 S1 분석 버전에서 직접 조회" })),
  ];

  // RAG 상한 — 데이터 신뢰도가 전체 등급을 캡핑 (경계 #4). 분석가 서명 없이 green 불가.
  const ragCapRecommendation: CompanyProfilePayload["ragCapRecommendation"] = degraded
    ? { grade: "red", rationale: `폴백 저장 — ${degraded}. 재분석 후 재평가.` }
    : !dart.found && research.length === 0
      ? { grade: "red", rationale: "DART·웹 리서치 모두 미입수 — 근거 없는 LLM 지식만 사용됨. 재분석 필요." }
      : { grade: "amber", rationale: "DART 공시 기반 + LLM/웹 리서치 혼합 — 분석가 확정 전까지 상한 Amber." };

  await summarize(5, "결정론 합성 — 재무 분석·산업 연계·신뢰도",
    `재무 비율·추세 ${financialAnalysis.available ? `${financialAnalysis.years.length}개년` : "미산출(데이터 부족)"}, 산업 연계 ${industryLinkage.filter((l) => l.matrixFound).length}/${industryLinkage.length}건 매칭, RAG 상한 ${ragCapRecommendation.grade.toUpperCase()}.`);

  // ── Step 6: 버전 누적 저장 ──
  const payload: CompanyProfilePayload = {
    companyName: company,
    dartCorpCode: corpCode ?? member.dart_corp_code,
    // available 키 필수 — UI가 이 키로 DART 입수 여부를 판정한다 (synergy-pipeline과 동일 계약)
    dartFinancials: { ...dart, available: dart.found },
    strengths,
    weaknesses,
    businessAssessment,
    industryExposure,
    researchSources: research.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet.slice(0, 200) })),
    degraded,
    dataSources: { dart: dart.found, dartYear: dart.found ? dart.year ?? null : null, webResearchCount: research.length },
    stepSummaries,
    // ADR-0093 확장 (schemaVersion 2)
    financialAnalysis,
    swot: { opportunities, threats },
    competitive,
    industryLinkage,
    sectionConfidence,
    verificationLedger,
    ragCapRecommendation,
    schemaVersion: 2,
  };
  const nextVersionNo =
    ((db.query("SELECT MAX(version_no) m FROM company_profile_version WHERE member_id = ?").get(member.id) as { m: number | null }).m ?? 0) + 1;
  // 6단계 요약은 저장 '이전'에 push해야 이번 버전 payload에 포함된다.
  await summarize(6, "버전 누적 저장",
    `company_profile_version v${nextVersionNo} 저장 (append-only — 선행 버전은 의사결정 인용을 위해 보존).`);
  payload.stepSummaries = stepSummaries;
  db.transaction(() => {
    db.run(
      `INSERT INTO company_profile_version (id, member_id, version_no, payload, source_ref, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [ulid(), member.id, nextVersionNo, JSON.stringify({ methodology: "company-profile v2", schemaVersion: 2, profile: payload }), null, userId, now()],
    );
  })();
}

export function loadLatestProfile(db: Db, memberId: string): CompanyProfilePayload | null {
  const row = db
    .query("SELECT payload FROM company_profile_version WHERE member_id = ? ORDER BY version_no DESC LIMIT 1")
    .get(memberId) as { payload: string } | undefined;
  if (!row) return null;
  try {
    return (JSON.parse(row.payload) as { profile?: CompanyProfilePayload }).profile ?? null;
  } catch {
    return null;
  }
}

export const _internalNow = now;
