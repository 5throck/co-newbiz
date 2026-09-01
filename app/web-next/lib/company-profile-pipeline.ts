// 그룹/계열사 분석 파이프라인 — 계열사 프로파일 4단계 (flow.spec S3의 입력).
//   1. DART 재무제표·사업보고서 입수 (dart-client 재사용)
//   2. 외부 리서치 — 증권사 애널리스트 리포트·산업 동향 (web-research 재사용)
//   3. LLM 강점/약점/사업 평가 (근거 출처 명기, 결정론 폴백)
//   4. company_profile_version에 버전 누적 (append-only, ADR-0005 패턴)
import { getDb } from "../../../db/client.ts";
import { findCorpCode, fetchFinancials, isDartConfigured, type DartFinancials } from "../lib/dart-client.ts";
import { completeOrFallback } from "./llm.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "./web-research.ts";
import { ulid } from "../../../db/lib/ulid.ts";

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
  researchSources: Array<{ title: string; url: string; snippet?: string }>;
  dataSources: {
    dart: boolean;
    dartYear: string | null;
    webResearchCount: number;
  };
  stepSummaries: Array<{ step: number; title: string; summary: string; source: string }>;
}

const now = () => new Date().toISOString();

type Db = ReturnType<typeof getDb>;

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

  // ── Step 1: DART 재무 입수 ──
  let corpCode = member.dart_corp_code ?? null;
  if (!corpCode && isDartConfigured()) corpCode = await findCorpCode(company);
  const dart: DartFinancials = corpCode ? await fetchFinancials(corpCode, { years: 3 }) : { corpCode: "", found: false, items: [], error: isDartConfigured() ? "corp code 미확인 — 비상장 또는 검색 실패" : "DART_API_KEY 미구성" };
  if (corpCode && corpCode !== member.dart_corp_code) {
    db.run("UPDATE company_group_member SET dart_corp_code = ? WHERE id = ?", [corpCode, member.id]);
  }
  await summarize(1, "DART 재무제표·사업보고서 입수", dart.found ? `${dart.year}년 사업보고서 재무 ${dart.items.length}개 계정 입수.` : `DART 미입수 — ${dart.error ?? "사유 없음"} (웹 리서치로 보강).`);

  // ── Step 2: 외부 리서치 (애널리스트 리포트·산업 동향) ──
  let research: WebSource[] = [];
  if (isWebResearchConfigured()) {
    research = await researchSources([
      `${company} 애널리스트 리포트 리서치`,
      `${company} analyst report competitive position`,
      `${member.group_name} 그룹 산업 동향`,
      `${company} 사업 부문 경쟁력 실적`,
    ], 12);
  }
  const researchContext = research.length
    ? research.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.snippet}`).join("\n\n")
    : "(웹 리서치 미구성 — LLM 지식 기반)";
  await summarize(2, "외부 리서치 입수", `출처 ${research.length}건 (애널리스트 리포트·산업 동향·실적).`);

  // ── Step 3: LLM 강점/약점/사업 평가 ──
  const qualJson = await completeOrFallback(
    [
      { role: "system" as const, content: "당신은 기업 분석 전문가입니다. 제공된 근거(리서치 발췌·재무 데이터) 안에서만 자사 계열사의 프로파일을 작성하세요. 근거가 없는 항목은 '검증 필요'로 명시하세요." },
      {
        role: "user" as const,
        content:
          `${company}(${member.group_name} 그룹 계열사)의 프로파일을 작성하세요. JSON: {"strengths":["강점 2~4개"],"weaknesses":["약점 2~4개"],"businessAssessment":"사업 평가 2~3문장","industryExposure":["노출 산업/부문", "..."]}. 각 항목은 발췌 근거가 있으면 출처 번호([n])를 문장 끝에 붙이세요.\n\nDART 재무: ${dart.found ? `${dart.year}년 재무 ${dart.items.length}개 계정` : "미입수"}\n\n리서치 발췌:\n${researchContext}`,
      },
    ],
    () =>
      JSON.stringify({
        strengths: ["웹 리서치 미구성 — 수동 등록 필요"],
        weaknesses: ["웹 리서치 미구성 — 수동 등록 필요"],
        businessAssessment: "리서치 입수 결과가 없어 평가 미생성 — 재분석 또는 수동 작성 필요.",
        industryExposure: [],
      }),
    { maxTokens: 1600 },
  );
  let strengths: string[] = [];
  let weaknesses: string[] = [];
  let businessAssessment = "";
  let industryExposure: string[] = [];
  try {
    const parsed = JSON.parse(qualJson.text.slice(qualJson.text.indexOf("{"), qualJson.text.lastIndexOf("}") + 1)) as Record<string, unknown>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5) : []);
    strengths = arr(parsed.strengths);
    weaknesses = arr(parsed.weaknesses);
    industryExposure = arr(parsed.industryExposure);
    if (typeof parsed.businessAssessment === "string") businessAssessment = parsed.businessAssessment;
  } catch { /* 폴백 값 유지 */ }
  await summarize(3, "강점/약점·사업 평가", `강점 ${strengths.length}개·약점 ${weaknesses.length}개 도출 (출처 ${research.length}건 기반).`);

  // ── Step 4: 버전 누적 저장 ──
  const payload: CompanyProfilePayload = {
    companyName: company,
    dartCorpCode: corpCode ?? member.dart_corp_code,
    dartFinancials: dart,
    strengths,
    weaknesses,
    businessAssessment,
    industryExposure,
    researchSources: research.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet.slice(0, 200) })),
    dataSources: { dart: dart.found, dartYear: dart.found ? dart.year ?? null : null, webResearchCount: research.length },
    stepSummaries,
  };
  const nextVersionNo =
    ((db.query("SELECT MAX(version_no) m FROM company_profile_version WHERE member_id = ?").get(member.id) as { m: number | null }).m ?? 0) + 1;
  db.transaction(() => {
    db.run(
      `INSERT INTO company_profile_version (id, member_id, version_no, payload, source_ref, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [ulid(), member.id, nextVersionNo, JSON.stringify({ methodology: "company-profile v1", profile: payload }), null, userId, now()],
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
