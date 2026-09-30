// POST /api/brownfield/[oppId]/targets/[targetId]/screening-draft — S7 스크리닝
// 판정(t-01~t-09) LLM 초안 (ADR-0118 계약). 증거는 두 종류다(사용자 결정,
// 2026-09-16 — "이미 기 확보한 정보는 재수집하지 않는다"):
//   1) 기확보 정보 — DART 재무 facts(5개년), 회사 AI 프로파일, 최근 3년 공시
//      제목. 재무로 판정 가능한 항목(t-08 재무적 매력도)은 검색하지 않고 이
//      근거로 판정한다. 나머지 항목의 판정 참조용으로도 프롬프트에 함께 넣는다.
//   2) 웹검색 근거(lib/web-research.ts) — 기확보 정보로 못 판정하는 항목만
//      후보 회사 × 체크리스트 항목 단위로 확보한다.
// 근거가 있는 항목만 판정 초안을 만들고, 못 찾은 항목은 판정하지 않는다 — 전
// 항목을 억지로 채우지 않는다. 검색 미설정이면 기확보 근거로만 시도한다.
// 저장은 없다 — 초안은 사람이 확인·수정한 뒤 기존 POST .../targets/{targetId}
// (판정 저장)로 확정된다. 저장 경로는 LLM을 전혀 모른다.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../../../lib/envelope.ts";
import { completeOrFallback, type LlmOrFallback } from "../../../../../../../lib/llm.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "../../../../../../../lib/web-research.ts";
import { screeningItems, insertTargetEvidence } from "../../../../../../../lib/brownfield-targets.ts";
import { targetEvalStates } from "../../../../../../../lib/brownfield-eval-criteria.ts";
import { parseGapRegister, HELD_STATUS_LABEL } from "../../../../../../../lib/capability-gap.ts";
import { systemMessage } from "../../../../../../../lib/prompts.ts";
import { getCompanyFinancialFacts, factRowsToDartItems } from "../../../../../../../lib/dart-financial-facts.ts";
import { deriveFinancialAnalysis } from "../../../../../../../lib/company-financials.ts";
import { loadLatestProfile } from "../../../../../../../lib/company-profile-pipeline.ts";
import { listConfirmedCompetitors } from "../../../../../../../lib/company-competitors.ts";
import { searchDisclosures } from "../../../../../../../lib/dart-client.ts";
import { profileEvidenceBlock } from "../../../../../../../lib/brownfield-technical-draft.ts";

interface ItemDraft {
  verdict: "confirmed" | "probable" | "partial" | "unfulfilled" | "insufficient";
  rationale: string;
  source_url: string | null;
  /** 근거 구분 — secured: 기확보 정보(DART 재무 facts 등), web: 웹검색. */
  kind?: "secured" | "web";
}

// 판정 척도(사용자 결정, 2026-09-16) — 5단 세분화. 해당없음/예외는 폐기하고
// "근거 부족"을 정식 판정으로 넣어 전 항목 제안 커버리지를 확보한다.
const VERDICT_LABEL: Record<ItemDraft["verdict"], string> = {
  confirmed: "충족 (근거 명확)",
  probable: "충족 (추정)",
  partial: "부분 충족",
  unfulfilled: "미충족",
  insufficient: "근거 부족",
};

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

const VERDICTS = new Set(["confirmed", "probable", "partial", "unfulfilled", "insufficient"]);

/** LLM 응답 → 항목별 초안 (순수 함수, 테스트 가능성을 위해 export).
 * 화이트리스트 정규화: verdict enum 검증, 근거 인용(source_index)으로 출처
 * 복원, 근거·판정 없는 항목은 초안 자체를 만들지 않는다. */
export function parseScreeningDrafts(
  llmRes: LlmOrFallback,
  evidence: Map<string, WebSource[]>,
  openItems: Array<{ id: string }>,
): Record<string, ItemDraft> {
  const drafts: Record<string, ItemDraft> = {};
  if (llmRes.source !== "llm") return drafts;
  const parsed = parseJson(llmRes.text);
  const raw = (parsed?.drafts ?? null) as Record<string, Record<string, unknown>> | null;
  if (!raw) return drafts;
  for (const it of openItems) {
    const d = raw[it.id];
    if (!d) continue;
    const verdict = typeof d.verdict === "string" && VERDICTS.has(d.verdict) ? (d.verdict as ItemDraft["verdict"]) : null;
    if (!verdict) continue; // 근거·판정 없는 항목은 초안도 없다
    const srcIdx = typeof d.source_index === "number" ? Math.floor(d.source_index) - 1 : -1;
    const sources = evidence.get(it.id) ?? [];
    const src = srcIdx >= 0 && srcIdx < sources.length ? sources[srcIdx] : (sources[0] ?? null);
    drafts[it.id] = {
      verdict,
      rationale: typeof d.rationale === "string" ? d.rationale.trim().slice(0, 300) : "",
      source_url: src?.url ?? null,
    };
  }
  return drafts;
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "판정 초안 생성은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { oppId, targetId } = await params;
  const db = getDb();
  const opp = db
    .query("SELECT id, name, target_universe_json, capability_gap_json FROM opportunity WHERE id = ?")
    .get(oppId) as { id: string; name: string; target_universe_json: string | null; capability_gap_json: string | null } | undefined;
  if (!opp) return notFound();
  const target = db
    .query(
      `SELECT bt.id, bt.company_name, bt.screening_json,
         COALESCE(
           (SELECT mc.id FROM md_company mc WHERE bt.dart_corp_code IS NOT NULL AND mc.dart_corp_code = bt.dart_corp_code),
           (SELECT mc.id FROM md_company mc WHERE mc.name_ko = bt.company_name)
         ) AS company_id
       FROM brownfield_target bt WHERE bt.id = ? AND bt.opportunity_id = ?`,
    )
    .get(targetId, oppId) as { id: string; company_name: string; screening_json: string | null; company_id: string | null } | undefined;
  if (!target) return notFound();

  const items = screeningItems();
  if (items.length === 0) return notFound();
  // 이미 사람이 판정한 항목은 초안 대상에서 제외한다 — 초안은 미판정만 채운다.
  const saved = target.screening_json ? (JSON.parse(target.screening_json) as Record<string, string>) : {};
  const openItems = items.filter((it) => {
    const st = saved[it.id];
    return !st || st === "pending";
  });
  if (openItems.length === 0) {
    return ok(
      { source: "synthesis", provider: "deterministic", note: "모든 항목이 이미 판정되어 있습니다 — 사람이 저장한 판정을 유지합니다.", drafts: {}, manifest: [] },
      200,
      { nothing_to_draft: true },
    );
  }

  // ── 기확보 정보 블록 (사용자 결정 2026-09-16 — 재수집하지 않고 그대로 쓴다) ──
  // 1) DART 재무 facts 5개년 요약, 2) 회사 AI 프로파일, 3) 최근 3년 공시 제목.
  const company = target.company_id
    ? db.query("SELECT name_ko, dart_corp_code FROM md_company WHERE id = ?").get(target.company_id) as
        | { name_ko: string; dart_corp_code: string | null }
        | undefined
    : undefined;

  let financialBlock = "없음 — 동기화된 DART 재무 facts가 없습니다.";
  let financialAvailable = false;
  if (target.company_id) {
    try {
      const facts = getCompanyFinancialFacts(db, target.company_id);
      const analysis = deriveFinancialAnalysis({
        corpCode: facts.company.dart_corp_code ?? "",
        found: facts.rows.length > 0,
        items: factRowsToDartItems(facts.rows),
        yearly: [],
      } as Parameters<typeof deriveFinancialAnalysis>[0]);
      if (analysis.available && analysis.years.length > 0) {
        financialAvailable = true;
        const seriesLines = analysis.series.map((s) => {
          const pts = s.points.filter((p) => p.value != null).map((p) => `${p.year} ${p.value}`);
          return `  ${s.label}: ${pts.length > 0 ? pts.join(" → ") : "데이터 없음"}`;
        });
        const ratioLines = analysis.ratios.slice(-3).map((r) => {
          const parts = [
            r.operatingMargin != null ? `영업이익률 ${r.operatingMargin}%` : null,
            r.netMargin != null ? `순이익률 ${r.netMargin}%` : null,
            r.debtRatio != null ? `부채비율 ${r.debtRatio}%` : null,
          ].filter(Boolean);
          return `  ${r.year}: ${parts.join(", ") || "—"}`;
        });
        financialBlock = `연도 범위 ${analysis.years[0]}–${analysis.years[analysis.years.length - 1]}\n${[...seriesLines, ...ratioLines].join("\n")}`;
      }
    } catch {
      // 재무 facts 부재는 치명적이지 않다 — 나머지 근거로 계속한다.
    }
  }

  const profile = target.company_id ? loadLatestProfile(db, { kind: "company", id: target.company_id }) : null;
  // ADR-0142 — 확정 경쟁사 레지스트리 우선 (미확정 payload 제안은 표기 후 폴백)
  const confirmedCompetitors = target.company_id ? listConfirmedCompetitors(db, { kind: "company", id: target.company_id }) : [];

  // 기확보 근거 4 — 기회의 목표 시장 정의(지역 기준)·S3 필요 역량(갭)·후보 기술
  // 평가 판정. t-03(지역)/t-05(역량 적합성)/t-07(역량 보완성)의 판정 앵커다
  // (사용자 질의, 2026-09-16 — 판정 관점을 기회 자체의 기준에 고정).
  let universeBlock = "없음 — 목표 시장 정의가 아직 확정되지 않았습니다.";
  if (opp?.target_universe_json) {
    try {
      const u = JSON.parse(opp.target_universe_json) as { definition?: string; criteria?: string[]; scope?: string };
      const lines = [
        u.definition ? `정의: ${u.definition}` : null,
        Array.isArray(u.criteria) && u.criteria.length > 0 ? `기준: ${u.criteria.join(" · ")}` : null,
        u.scope ? `범위: ${u.scope}` : null,
      ].filter(Boolean);
      if (lines.length > 0) universeBlock = lines.join("\n");
    } catch { /* 깨진 JSON은 무시 */ }
  }

  let gapBlock = "없음 — S3 필요 역량(갭) 레지스터가 비어 있습니다.";
  if (opp?.capability_gap_json) {
    try {
      const rows = parseGapRegister(opp.capability_gap_json).rows.filter((r) => r.capability);
      if (rows.length > 0) {
        gapBlock = rows
          .map((r) => `  - ${r.capability}${r.requiredLevel ? ` (요구 수준: ${r.requiredLevel})` : ""}${r.held?.status ? ` — 내부 보유: ${HELD_STATUS_LABEL[r.held.status] ?? r.held.status}` : ""}`)
          .join("\n");
      }
    } catch { /* 깨진 JSON은 무시 */ }
  }

  const techEval = targetEvalStates(oppId, targetId, auth.auth.userId)
    .filter((it) => it.category === "technical")
    .map((it) => `  - ${it.label}: ${it.state ? `${it.state.status}${it.state.note ? ` (${it.state.note})` : ""}` : "미판정"}`);
  const techEvalBlock = techEval.length > 0
    ? `후보 기술 평가 판정(ADR-0139, 사람이 확정한 값):\n${techEval.join("\n")}`
    : "없음 — 후보의 기술 평가가 아직 판정되지 않았습니다.";

  let disclosureTitles: string[] = [];
  if (company?.dart_corp_code) {
    try {
      const disc = await searchDisclosures(company.dart_corp_code, "recent", 12, 36);
      disclosureTitles = disc.disclosures.slice(0, 10).map((d) => `${d.rcept_dt} ${d.report_nm}`);
    } catch {
      // 공시 조회 실패는 치명적이지 않다.
    }
  }

  const securedBlock = [
    "== 기확보 정보 (이미 수집된 데이터 — 재검색 불필요) ==",
    `목표 시장 정의 (기회: ${opp?.name ?? oppId}) — t-03 지역 적합성은 이 정의의 지역 기준에 후보의 사업 거점이 부합하는지로 판정하고, 지역 지원·인센티브 관점은 부가 근거로만 참조:`,
    universeBlock,
    "",
    "S3 필요 역량 (역량 갭 레지스터) — t-05 역량 적합성·t-07 역량 보완성의 판정 기준:",
    gapBlock,
    "",
    "후보 기술 평가 판정 — t-05·t-07의 직접 근거:",
    techEvalBlock,
    "",
    `DART 재무 facts(5개년):`,
    financialBlock,
    "",
    "회사 AI 프로파일:",
    profileEvidenceBlock(profile, confirmedCompetitors),
    "",
    disclosureTitles.length > 0 ? `최근 공시 제목(3년):\n${disclosureTitles.map((t) => `  - ${t}`).join("\n")}` : "최근 공시 제목: 없음",
  ].join("\n");

  // ── 웹검색 근거 확보 — 기확보 재무로 판정 가능한 t-08(재무적 매력도)은
  // 검색하지 않는다(사용자 결정 2026-09-16). 검색어는 항목 문장 앞 40자가
  // 아니라 "회사명 + 항목 짧은 라벨"(+ 보조 절)로 만든다 — 문장 원문 쿼리는
  // 결과가 거의 없어 제안 누락의 주원인이었다(사용자 리포트, 2026-09-16).
  const securedItems = new Set<string>();
  const evidence = new Map<string, WebSource[]>();
  if (financialAvailable) {
    for (const it of openItems) {
      if (it.id === "t-08") {
        securedItems.add(it.id);
        evidence.set(it.id, [
          {
            title: "DART 재무 facts 5개년 (기확보 데이터)",
            url: company?.dart_corp_code ? `https://dart.fss.or.kr/dsab007/main.do?corpCode=${company.dart_corp_code}` : "https://dart.fss.or.kr",
            snippet: financialBlock,
          },
        ]);
      }
    }
  }
  const searchItems = openItems.filter((it) => !securedItems.has(it.id));
  const manifest: string[] = [];
  if (searchItems.length > 0 && isWebResearchConfigured()) {
    for (const it of searchItems) {
      // 충분한 검색(사용자 리포트, 2026-09-16) — 항목당 3개 쿼리 변형 × 항목당
      // 최대 5건. 짧은 라벨은 재현율, 보조 절·본문 키워드는 정밀도를 보완한다.
      const shortLabel = it.text.split(" — ")[0].trim();
      const subParts = (it.text.split(" — ")[1] ?? "").split(/[.,;·]/).map((s) => s.trim()).filter((s) => s.length >= 6);
      const queries = [
        `${target.company_name} ${shortLabel}`,
        subParts[0] ? `${target.company_name} ${subParts[0].slice(0, 30)}` : null,
        subParts[1] ? `${shortLabel} ${subParts[1].slice(0, 25)}` : null,
      ].filter((q): q is string => !!q);
      const sources = await researchSources(queries, 6);
      if (sources.length > 0) {
        evidence.set(it.id, sources);
        manifest.push(`${it.id} — ${it.text}`);
      }
    }
  } else if (searchItems.length > 0) {
    manifest.push(`(웹 검색 미설정 — ${searchItems.map((it) => it.id).join(", ")}는 기확보 근거로만 판정 시도)`);
  }
  // 근거가 전혀 없으면(기확보 3종 모두 부재 + 검색 결과 없음) LLM을 호출하지
  // 않는다 — 어떤 판정값도 날조하지 않는다.
  const securedAny = financialAvailable || !!profile || disclosureTitles.length > 0;
  if (evidence.size === 0 && !securedAny) {
    return ok(
      {
        source: "synthesis",
        provider: "deterministic",
        note: "기확보 정보와 웹 검색에서 판정 가능한 근거를 찾지 못했습니다 — 판정은 사람이 직접하세요.",
        drafts: {},
        manifest: [],
      },
      200,
      { no_grounding: true },
    );
  }

  // ── LLM 초안 — 근거가 있는 항목만 판정 ──
  const evidenceBlock = [...evidence.entries()]
    .map(([itemId, sources]) =>
      `${itemId}:\n${sources.map((s, i) => `  [${i + 1}] ${s.title}\n  URL: ${s.url}\n  ${s.snippet.slice(0, 200)}`).join("\n")}`,
    )
    .join("\n\n");
  const llmRes: LlmOrFallback = await completeOrFallback(
    [
      systemMessage("s7.screening_draft"),
      {
        role: "user" as const,
        content: [
          `대상 후보: ${target.company_name}`,
          "",
          securedBlock,
          "",
          "판정할 항목 (chk-target-screening) — 아래 전 항목을 판정하세요 (생략 금지):",
          ...openItems.map((it) => `${it.id} — ${it.text}`),
          "",
          "항목별 추가 검색 근거 (있는 항목만 표시 — 없는 항목은 위 기확보 정보로 판정):",
          evidenceBlock,
          "",
          "판정 척도 — 반드시 아래 5개 값 중 하나를 쓰세요:",
          "  confirmed  — 충족 (근거 명확): 근거가 요건을 직접 뒷받침한다",
          "  probable   — 충족 (추정): 간접 근거로 판단하며 반대 근거는 없다",
          "  partial    — 부분 충족: 요건 일부만 확인되거나 조건부로만 충족",
          "  unfulfilled— 미충족: 요건을 못 채우거나 방해하는 근거를 확인했다",
          "  insufficient — 근거 부족: 확보한 근거로는 판단 자체가 불가능하다 (추가 확인·DD 필요)",
          "기확보 정보만으로 판정 가능한 항목(예: t-08 재무적 매력도는 DART 재무 facts)은 검색 근거 없이도 판정하세요.",
          "판정 관점 앵커 — 이 세 항목은 일반 웹검색 문장보다 앵커 근거가 우선합니다:",
          "  t-03 지역 적합성  → 위 목표 시장 정의의 지역 기준에 후보의 사업 거점(본사·사업장)이 부합하는지",
          "  t-05 역량 적합성  → S3 필요 역량 목록과 후보 기술 평가 판정이 이를 뒷받침하는지",
          "  t-07 역량 보완성  → S3 갭(내부 보유 부족 역량)을 후보의 강점·기술이 채우는지, 기존 내부 역량과의 중복은 없는지",
          "정확히 판단하기 어려운 항목을 무리해서 confirmed/unfulfilled로 밀지 말고 probable/partial/insufficient를 쓰세요 — insufficient는 실패가 아니라 정직한 판정입니다.",
          'JSON만 반환: {"drafts":{"<항목id>":{"verdict":"confirmed|probable|partial|unfulfilled|insufficient","rationale":"근거 한 줄 — 어떤 근거에서 확인했는지","source_index":근거번호}}}',
          "모든 항목에 대해 drafts에 반드시 판정을 포함하세요 — 근거가 없으면 insufficient로 판정하고 rationale에 무엇을 확인했는지 쓰세요.",
        ].join("\n"),
      },
    ],
    () => "",
    {
      maxTokens: 1800,
      agent: {
        key: "brownfield-agent",
        purpose: "S7 스크리닝 판정 초안 — 항목별 검색 근거 기반",
        contextType: "opportunity",
        contextId: oppId,
      },
    },
  );

  appendAudit(db, { actor: auth.auth.userId, action: "target_screening.llm_draft", target: `${oppId}:${targetId}`, now: new Date().toISOString() });

  const drafts = parseScreeningDrafts(llmRes, evidence, openItems.map((it) => ({ id: it.id })));
  // 근거 구분 표시 — 웹검색 근거가 있는 항목은 "web", 기확보 정보만으로 판정된
  // 항목은 "secured"로 구분해 클라이언트가 저장 시 함께 보존하게 한다.
  for (const [itemId, d] of Object.entries(drafts)) {
    drafts[itemId] = { ...d, kind: evidence.has(itemId) && !securedItems.has(itemId) ? "web" : "secured" };
  }
  // 근거 타임라인 — 위원회 추천 검토 실행 기록(0109). 부가 기록이므로 실패해도
  // 응답을 막지 않는다(insertTargetEvidence 내부에서 흡수).
  insertTargetEvidence(db, {
    targetId,
    kind: "screening",
    title: `위원회 추천 검토 — 판정 제안 ${Object.keys(drafts).length}/${openItems.length}건`,
    detail: [
      ...Object.entries(drafts).map(([itemId, d]) => `${itemId} ${VERDICT_LABEL[d.verdict]} — ${d.rationale}`),
      ...(manifest.length > 0 ? [`수집: ${manifest.join(" · ")}`] : []),
    ].join("\n") || null,
    sourceKind: llmRes.source,
    createdBy: auth.auth.userId,
  });
  const unproposed = openItems.length - Object.keys(drafts).length;
  const note =
    Object.keys(drafts).length === 0
      ? "근거가 판정을 뒷받침하지 못해 초안을 만들 항목이 없습니다 — 판정은 사람이 직접하세요."
      : `${openItems.length}개 미판정 항목 중 ${Object.keys(drafts).length}개에 제안을 만들었습니다 (기확보 ${Object.values(drafts).filter((d) => d.kind === "secured").length} + 웹검색 ${Object.values(drafts).filter((d) => d.kind === "web").length})${unproposed > 0 ? ` — 나머지 ${unproposed}건은 근거 부족으로 제안 없음, 사람이 직접 판정하세요` : ""}. 확인·수정 뒤 "판정 저장"으로 확정하세요.`;
  return ok({ source: llmRes.source, provider: llmRes.provider, note, drafts, manifest }, 200, { drafted: Object.keys(drafts).length });
}
