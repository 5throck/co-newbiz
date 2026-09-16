// brownfield-technical-draft.ts — S7 기술 평가 자동 초안(ADR-0141).
// 기술 평가 항목(S3 역량 갭 시딩)은 숫자 루브릭으로 판정할 수 없다 — 대신
// 3가지 근거(최근 3년 DART 공시 제목, 회사 AI 프로파일, 항목별 웹 검색)를
// 모아 LLM이 근거 기반 판정 초안을 만든다(ADR-0118 screening-draft와 같은
// 원칙: 근거가 없으면 판정하지 않는다). 근거로 확인되지 않은 항목은 판정
// 제안 없이 "확인 안됨" 사유를 명확히 돌려준다 — 어떤 판정값도 날조하지
// 않는다. 초안은 저장되지 않고 사람이 확인·수정한 뒤 기존 판정 저장(PUT
// eval-state, ADR-0139)으로 확정된다(경계 #2 — 판정은 항상 사람).
import type { LlmOrFallback } from "./llm.ts";
import type { WebSource } from "./web-research.ts";
import type { CompanyProfilePayload } from "./company-profile-pipeline.ts";

export interface TechnicalCriterionInput {
  id: string;
  label: string;
  description: string | null;
}

/** LLM이 내릴 수 있는 판정 — "unverified"는 "근거로 확인 안 됨"을 뜻하는
 * 명시적 답변이지 판정 제안이 아니다(클라이언트에서 status=null로 표시). */
export type TechnicalVerdict = "pass" | "partial" | "fail" | "unverified";

export interface TechnicalDraft {
  verdict: TechnicalVerdict;
  rationale: string;
  /** 웹 근거 인용이 있을 때만 — 근거 번호(source_index)로 복원한 URL. */
  source_url: string | null;
}

/** AI 프로파일 → 근거 텍스트 블록(강점·약점·종합평가·산업 노출·포지셔닝). */
export function profileEvidenceBlock(profile: CompanyProfilePayload | null): string {
  if (!profile) return "없음 — 아직 AI 분석을 실행하지 않았습니다.";
  const lines = [
    `종합 평가: ${profile.businessAssessment || "—"}`,
    profile.strengths.length > 0 ? `강점: ${profile.strengths.join(" / ")}` : "강점: —",
    profile.weaknesses.length > 0 ? `약점: ${profile.weaknesses.join(" / ")}` : "약점: —",
    profile.industryExposure.length > 0 ? `산업 노출: ${profile.industryExposure.join(" / ")}` : "산업 노출: —",
    profile.competitive?.positioning ? `경쟁 포지셔닝: ${profile.competitive.positioning}` : null,
    profile.competitive?.competitors && profile.competitive.competitors.length > 0
      ? `경쟁사: ${profile.competitive.competitors.map((c) => `${c.name}(${c.note})`).join(" / ")}`
      : null,
  ].filter((x): x is string => x != null);
  return lines.join("\n");
}

/** 공시 목록 → 근거 텍스트 블록(접수일·제목). */
export function disclosureEvidenceBlock(disclosures: Array<{ rcept_dt: string; report_nm: string }>): string {
  if (disclosures.length === 0) return "없음 — DART 미연결 또는 최근 3년 공시 없음";
  return disclosures.map((d) => `- ${d.rcept_dt} ${d.report_nm}`).join("\n");
}

/** 웹 근거 → 항목별 블록(screening-draft와 같은 [번호] 인용 형식). */
export function webEvidenceBlock(webByCriterion: Map<string, WebSource[]>, items: TechnicalCriterionInput[]): string {
  const parts: string[] = [];
  for (const it of items) {
    const sources = webByCriterion.get(it.id) ?? [];
    if (sources.length === 0) continue;
    parts.push(
      `${it.id}:\n${sources.map((s, i) => `  [${i + 1}] ${s.title}\n  URL: ${s.url}\n  ${s.snippet.slice(0, 200)}`).join("\n")}`,
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : "없음 — 검색 미설정 또는 근거 미확보";
}

/** LLM user 프롬프트 본문 — 근거 3종을 나열하고 JSON 전용 응답을 요구한다.
 * "unverified"를 정당한 답변으로 명시해 추측 판정을 차단한다. */
export function technicalDraftUserContent(
  companyName: string,
  items: TechnicalCriterionInput[],
  blocks: { profile: string; disclosures: string; web: string },
): string {
  return [
    `대상 후보: ${companyName}`,
    "",
    "판정할 기술 평가 항목 (S3에서 정의된 필요 역량 — 이 인수로 메울 수 있는지):",
    ...items.map((it) => `- ${it.id} — ${it.label}${it.description ? `: ${it.description}` : ""}`),
    "",
    "[근거 1] 회사 AI 프로파일(DART·웹 리서치 기반):",
    blocks.profile,
    "",
    "[근거 2] 최근 3년 DART 공시:",
    blocks.disclosures,
    "",
    "[근거 3] 항목별 웹 검색 근거:",
    blocks.web,
    "",
    'JSON만 반환: {"drafts":{"<항목id>":{"verdict":"pass|partial|fail|unverified","rationale":"근거 한 줄 — 어느 근거에서 확인했는지","source_index":웹근거번호}}}',
    "근거에서 확인되지 않는 항목은 반드시 verdict를 \"unverified\"로 하고, rationale에 무엇을 확인하려 했고 왜 안 됐는지 한 줄 남기세요.",
    "절대 추측으로 pass/partial/fail을 만들지 마세요 — 확인 안됨은 틀린 답이 아닙니다.",
  ].join("\n");
}

const VERDICTS = new Set(["pass", "partial", "fail", "unverified"]);

/** LLM 응답 → 항목별 초안 (순수 함수). verdict 화이트리스트 검증, 근거
 * 인용(source_index)으로 웹 출처 복원. LLM 응답이 없거나 파싱 실패면
 * 빈 맵 — 호출부가 전 항목 "확인 안됨"으로 처리한다. */
export function parseTechnicalDrafts(
  llmRes: LlmOrFallback,
  webByCriterion: Map<string, WebSource[]>,
  items: TechnicalCriterionInput[],
): Record<string, TechnicalDraft> {
  const drafts: Record<string, TechnicalDraft> = {};
  if (llmRes.source !== "llm") return drafts;
  const start = llmRes.text.indexOf("{");
  const end = llmRes.text.lastIndexOf("}");
  if (start === -1 || end <= start) return drafts;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(llmRes.text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const raw = (parsed?.drafts ?? null) as Record<string, Record<string, unknown>> | null;
  if (!raw) return drafts;
  for (const it of items) {
    const d = raw[it.id];
    if (!d) continue;
    const verdict = typeof d.verdict === "string" && VERDICTS.has(d.verdict) ? (d.verdict as TechnicalVerdict) : null;
    if (!verdict) continue;
    const srcIdx = typeof d.source_index === "number" ? Math.floor(d.source_index) - 1 : -1;
    const sources = webByCriterion.get(it.id) ?? [];
    const src = srcIdx >= 0 && srcIdx < sources.length ? sources[srcIdx] : null;
    drafts[it.id] = {
      verdict,
      rationale: typeof d.rationale === "string" ? d.rationale.trim().slice(0, 300) : "",
      source_url: src?.url ?? null,
    };
  }
  return drafts;
}
