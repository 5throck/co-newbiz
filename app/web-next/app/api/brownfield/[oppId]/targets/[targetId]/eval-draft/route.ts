// POST /api/brownfield/[oppId]/targets/[targetId]/eval-draft — S7 재무·기술
// 평가 자동 초안(ADR-0140/0141). body { category: "financial" | "technical" }
// (기본 financial).
//
// financial: DART facts → deriveFinancialAnalysis(ADR-0093, 결정론적) → 항목별
//   루브릭(brownfield-financial-rubric.ts)으로 pass/partial/fail 제안.
// technical: 최근 3년 DART 공시 제목 + 회사 AI 프로파일 + 항목별 웹 검색을
//   근거로 LLM 판정 초안(brownfield-technical-draft.ts, ADR-0118 원칙).
//   근거로 확인되지 않은 항목은 판정 제안 없이 "확인 안됨" 사유를 명확히
//   반환한다 — 어떤 판정값도 날조하지 않는다.
//
// 공통: 저장은 없다 — 초안은 사람이 확인·수정한 뒤 기존 판정 저장(PUT
// eval-state, ADR-0139)으로 확정되며 assessed_by는 항상 사람이 된다. 이미
// 사람이 판정한 항목은 제안 대상에서 뺀다.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { getCompanyFinancialFacts, factRowsToDartItems } from "../../../../../../../lib/dart-financial-facts.ts";
import { deriveFinancialAnalysis } from "../../../../../../../lib/company-financials.ts";
import { targetEvalStates } from "../../../../../../../lib/brownfield-eval-criteria.ts";
import { draftFinancialVerdict, isFinancialDataRef } from "../../../../../../../lib/brownfield-financial-rubric.ts";
import {
  disclosureEvidenceBlock, parseTechnicalDrafts, profileEvidenceBlock, technicalDraftUserContent, webEvidenceBlock,
  type TechnicalCriterionInput,
} from "../../../../../../../lib/brownfield-technical-draft.ts";
import { loadLatestProfile } from "../../../../../../../lib/company-profile-pipeline.ts";
import { listConfirmedCompetitors } from "../../../../../../../lib/company-competitors.ts";
import { searchDisclosures } from "../../../../../../../lib/dart-client.ts";
import { completeOrFallback } from "../../../../../../../lib/llm.ts";
import { systemMessage } from "../../../../../../../lib/prompts.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "../../../../../../../lib/web-research.ts";

interface DraftItem {
  criterion_id: string;
  label: string;
  data_ref: string;
  status: "pass" | "partial" | "fail" | null;
  reason: string | null;
  metrics: Array<{ label: string; value: string }>;
  note: string;
}

const VERDICT_KO: Record<"pass" | "partial" | "fail", string> = { pass: "충족", partial: "부분충족", fail: "미충족" };

/** 회사 마스터 연결 규칙(상세 GET과 동일) — DART 코드 우선, 회사명 폴백. */
function resolveTargetCompanyId(db: ReturnType<typeof getDb>, targetId: string, oppId: string): { id: string; company_name: string; company_id: string | null } | null {
  return (db.query(
    `SELECT bt.id, bt.company_name,
       COALESCE(
         (SELECT mc.id FROM md_company mc WHERE bt.dart_corp_code IS NOT NULL AND mc.dart_corp_code = bt.dart_corp_code),
         (SELECT mc.id FROM md_company mc WHERE mc.name_ko = bt.company_name)
       ) AS company_id
     FROM brownfield_target bt WHERE bt.id = ? AND bt.opportunity_id = ?`,
  ).get(targetId, oppId) as { id: string; company_name: string; company_id: string | null } | null) ?? null;
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "평가 초안 생성은 analyst 역할 이상이어야 합니다.");
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as { category?: string } | null;
  const category = body?.category === "technical" ? "technical" : "financial";
  const db = getDb();
  const opp = db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId) as { id: string } | undefined;
  if (!opp) return notFound();
  const target = resolveTargetCompanyId(db, targetId, oppId);
  if (!target) return notFound();

  if (!target.company_id) {
    return ok(
      {
        source: category === "technical" ? "llm" : "deterministic",
        drafts: [],
        note: "회사 마스터가 연결되지 않아 근거를 조회할 수 없습니다 — 정보 수정에서 회사명·DART 고유번호를 확정하세요.",
      },
      200,
      { no_data: true },
    );
  }

  const evalItems = targetEvalStates(oppId, targetId, auth.auth.userId);

  // ── financial: 결정론적 루브릭 (ADR-0140) ──
  if (category === "financial") {
    let facts;
    try {
      facts = getCompanyFinancialFacts(db, target.company_id);
    } catch {
      return badRequest("company_not_found", "회사 마스터를 찾을 수 없습니다.");
    }
    const analysis = deriveFinancialAnalysis({
      corpCode: facts.company.dart_corp_code ?? "",
      found: facts.rows.length > 0,
      items: factRowsToDartItems(facts.rows),
      yearly: [],
    } as Parameters<typeof deriveFinancialAnalysis>[0]);

    const drafts: DraftItem[] = [];
    let pendingCount = 0;
    for (const it of evalItems) {
      if (it.category !== "financial" || it.source !== "builtin" || !isFinancialDataRef(it.data_ref)) continue;
      if ((it.state?.status ?? "pending") !== "pending") continue; // 사람 판정은 존중한다
      pendingCount++;
      const d = draftFinancialVerdict(it.data_ref, analysis, it.rubric_json);
      drafts.push({ criterion_id: it.id, label: it.label, data_ref: d.dataRef, status: d.status, reason: d.reason, metrics: d.metrics, note: d.note });
    }

    appendAudit(db, { actor: auth.auth.userId, action: "target_eval.financial_draft", target: `${oppId}:${targetId}`, now: new Date().toISOString() });

    const proposed = drafts.filter((d) => d.status != null).length;
    const yearRange = analysis.years.length > 0 ? `${analysis.years[0]}–${analysis.years[analysis.years.length - 1]}` : null;
    const note =
      pendingCount === 0
        ? "재무 평가의 미판정 항목이 없습니다 — 이미 사람이 판정한 항목은 초안으로 바꾸지 않습니다."
        : !analysis.available
          ? "동기화된 DART 재무 facts가 없습니다 — 재무 facts는 후보 상세 진입 시 자동 동기화되니 잠시 후 다시 시도하세요."
          : `${yearRange} DART facts 기준으로 ${proposed}/${pendingCount}개 미판정 항목에 제안을 만들었습니다${proposed < pendingCount ? " — 나머지는 데이터 부족으로 제안 없음(항목별 사유 표시)" : ""}. 확인·수정 후 저장하세요 — 판정 확정은 항상 사람이 합니다.`;
    return ok({ source: "deterministic", years: analysis.years, latest_sync_at: facts.latest_sync_at, drafts, note }, 200, { drafted: proposed, pending: pendingCount });
  }

  // ── technical: 공시·프로파일·웹 근거 LLM 초안 (ADR-0141) ──
  const techItems = evalItems.filter((it) => it.category === "technical" && (it.state?.status ?? "pending") === "pending");
  if (techItems.length === 0) {
    return ok(
      { source: "llm", drafts: [], note: "기술 평가의 미판정 항목이 없습니다 — S3 역량 정의가 비어 있으면 먼저 S3에서 정의하세요." },
      200,
      { pending: 0 },
    );
  }
  const company = db.query("SELECT name_ko, dart_corp_code FROM md_company WHERE id = ?").get(target.company_id) as
    | { name_ko: string; dart_corp_code: string | null }
    | undefined;
  const corpCode = company?.dart_corp_code ?? null;

  // 근거 1 — 회사 AI 프로파일(강점·약점·포지셔닝).
  const profile = loadLatestProfile(db, { kind: "company", id: target.company_id });
  // ADR-0142 — 확정 경쟁사 레지스트리가 근거의 1순위 (없으면 payload 제안이 미확정 표기로 들어간다)
  const confirmedCompetitors = listConfirmedCompetitors(db, { kind: "company", id: target.company_id });
  // 근거 2 — 최근 3년 공시: 전체(recent) + 사업보고서(business)를 합치고
  // 접수번호로 dedupe. 제목만 근거로 쓴다(본문 파싱은 범위 밖).
  let disclosureRows: Array<{ rcept_dt: string; report_nm: string; rcept_no: string }> = [];
  if (corpCode) {
    const [recent, business] = await Promise.all([
      searchDisclosures(corpCode, "recent", 20, 36),
      searchDisclosures(corpCode, "business", 6, 36),
    ]);
    const seen = new Set<string>();
    for (const r of [...recent.disclosures, ...business.disclosures]) {
      if (!r.rcept_no || seen.has(r.rcept_no)) continue;
      seen.add(r.rcept_no);
      disclosureRows.push({ rcept_no: r.rcept_no, rcept_dt: r.rcept_dt, report_nm: r.report_nm });
    }
    disclosureRows = disclosureRows.slice(0, 24);
  }
  // 근거 3 — 항목별 웹 검색(설정된 경우만).
  const webByCriterion = new Map<string, WebSource[]>();
  if (isWebResearchConfigured()) {
    for (const it of techItems) {
      const sources = await researchSources([`${company?.name_ko ?? target.company_name} ${it.label}`], 3);
      if (sources.length > 0) webByCriterion.set(it.id, sources);
    }
  }

  const criteria: TechnicalCriterionInput[] = techItems.map((it) => ({ id: it.id, label: it.label, description: it.description }));
  const llmRes = await completeOrFallback(
    [
      systemMessage("s7.screening_draft"),
      {
        role: "user" as const,
        content: technicalDraftUserContent(company?.name_ko ?? target.company_name, criteria, {
          profile: profileEvidenceBlock(profile, confirmedCompetitors),
          disclosures: disclosureEvidenceBlock(disclosureRows),
          web: webEvidenceBlock(webByCriterion, criteria),
        }),
      },
    ],
    () => "",
    {
      maxTokens: 1600,
      agent: {
        key: "brownfield-agent",
        purpose: "S7 기술 평가 판정 초안 — 공시·프로파일·웹 근거 기반",
        contextType: "opportunity",
        contextId: oppId,
      },
    },
  );
  const parsed = parseTechnicalDrafts(llmRes, webByCriterion, criteria);

  appendAudit(db, { actor: auth.auth.userId, action: "target_eval.technical_draft", target: `${oppId}:${targetId}`, now: new Date().toISOString() });

  // 조립 — 근거로 확인 안 된 항목은 "확인 안됨"을 명확히(사용자 요청,
  // 2026-09-16). 노트에도 확인 안됨 사유를 심어 사람 판정 기록에 남게 한다.
  const evidenceSummary = `공시 ${disclosureRows.length}건(3년) · ${profile ? "AI 프로파일" : "프로파일 없음"} · 웹 ${[...webByCriterion.values()].reduce((a, b) => a + b.length, 0)}건`;
  const drafts: DraftItem[] = techItems.map((it) => {
    const d = parsed[it.id];
    const webCount = webByCriterion.get(it.id)?.length ?? 0;
    const metrics = [{ label: "근거", value: evidenceSummary }];
    if (d && d.source_url) {
      try {
        metrics.push({ label: "출처", value: new URL(d.source_url).hostname });
      } catch {
        metrics.push({ label: "출처", value: d.source_url });
      }
    }
    if (!d || d.verdict === "unverified") {
      const why = !d
        ? llmRes.source !== "llm"
          ? "LLM 미설정 또는 응답 실패로 근거 해석 불가"
          : `근거 부족(웹 ${webCount}건) — LLM이 판정 보류`
        : d.rationale || "근거 부족";
      return {
        criterion_id: it.id, label: it.label, data_ref: "technical", status: null,
        reason: `확인 안됨 — ${why}`, metrics,
        note: `확인 안됨(자동 진단, ${evidenceSummary}) — ${why}. 판정은 사람이 직접 기록.`,
      };
    }
    return {
      criterion_id: it.id, label: it.label, data_ref: "technical", status: d.verdict,
      reason: null, metrics,
      note: `자동초안(공시·프로파일·웹 근거, 수정 가능) — ${d.rationale} → ${VERDICT_KO[d.verdict]} 제안`,
    };
  });

  const proposed = drafts.filter((d) => d.status != null).length;
  const unverified = drafts.length - proposed;
  const note = `${evidenceSummary} 기준 — 제안 ${proposed}건, 확인 안됨 ${unverified}건. 확인·수정 후 저장하세요 — 판정 확정은 항상 사람이 합니다.`;
  return ok({ source: llmRes.source, provider: llmRes.provider, drafts, note }, 200, { drafted: proposed, unverified, pending: techItems.length });
}
