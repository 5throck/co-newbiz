// POST /api/brownfield/[oppId]/universe-criteria-draft — S6 Target Universe
// 선정 기준 LLM 초안 (ADR-0118 계약). 입력 매니페스트는 flow.spec S6 선언
// 입력으로 한정한다: S1 시장분석(해당 산업의 최근 완료 버전), S3 필요 역량
// (opportunity.capability_gap_json, flow.spec v2.4.0), 현재 Long List 현황.
// 저장은 없다 — "적용"은 UniverseForm 입력만 채우고 Universe 저장(사람 클릭)으로
// 확정된다. S1·S3 근거가 전혀 없으면 LLM을 호출하지 않고 제안을 보류한다 —
// 근거 없는 기준을 날조하지 않는다.
//
// DEC-20261111-05 (design 2026-11-11-s6-universe-viability-criteria §3–§4):
// ① S1은 opportunity.sizing_version_id 고정 버전 우선 해석 사슬(pinned →
//   industry FK → name fallback FK 자기배제 → honest unset)을 따른다 —
//   market_scope 명칭 매칭이 이름만 같은 다른 산업 행을 골라 낡은 앵커를
//   인용하던 결함($38.66B vs $39.88B)을 고친다.
// ② 페이로드가 S1 선언 구조(세그먼트·지역·가치사슬 위치·정성 요인·단계별
//   재무)와 S3 전체 행(필요수준·보유·필요성·requiredNote 무손실)을 싣는다.
// ③ 출력 스키마에 viability(수익성·지속가능성 조건)가 생기고, 근거가 없으면
//   `검증 필요` + 필요 데이터 명시가 정직한 형태다. 응답 봉투는 프롬프트
//   버전 상수와 S1 근원(provenance)을 항상 실어 돌려준다(감사 행에 메타
//   컬럼이 없어 API 응답이 버전 운반체다).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, type LlmOrFallback } from "../../../../../lib/llm.ts";
import { systemMessage } from "../../../../../lib/prompts.ts";
import { trackConflictResponse } from "../../../../../lib/route-track-guard.ts";
import {
  buildDraftProvenance,
  readStageFinancials,
  resolveUniverseS1,
  s1ContextLines,
  s1ManifestLine,
  s1StructureLines,
  s1UnsetLabel,
  s3CapabilityLines,
  STALE_PIN_FALLBACK_LINE,
  stageFinancialsLines,
} from "../../../../../lib/brownfield-universe.ts";

// MINUTES_PROMPT 패턴의 호출점 버전 상수(lib/committee-chair.ts) — 프롬프트
// 레지스트리는 키별 버전을 추적하지 않으므로 제안 봉투가 버전 정체를 운반한다.
export const UNIVERSE_CRITERIA_PROMPT_VERSION = "s6.universe_criteria_draft@2";

interface DraftCriteria {
  industry: string;
  region: string;
  size: string;
  viability: string;
  rationale: string;
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

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Whitelist-clamp the LLM's criteria object — never trusted raw. viability is
 * NOT required to parse (honest unset): an LLM that omits it yields "" and
 * the UI renders the field as unset rather than fabricating one (design
 * §4.4). Exported for the pure parse tests (house pattern: the same file's
 * normalizeLlmSuggestions / parseScreeningDrafts).
 */
export function parseDraftCriteria(c: Record<string, unknown> | null): DraftCriteria | null {
  if (!c) return null;
  const criteria: DraftCriteria = {
    industry: str(c.industry, 200),
    region: str(c.region, 200),
    size: str(c.size, 200),
    viability: str(c.viability, 400),
    rationale: str(c.rationale, 600),
  };
  return criteria.industry ? criteria : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Evaluation-criteria draft generation requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { oppId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, market_scope, capability_gap_json FROM opportunity WHERE id = ?").get(oppId) as
    | { id: string; name: string; market_scope: string | null; capability_gap_json: string | null }
    | undefined;
  if (!opp) return notFound();
  // T-20261022-038: the S6 draft suggestion is a brownfield-only surface. The client
  // gates it with TrackGate, but the server must not trust that — a greenfield route
  // decision makes the draft call 409 not_applicable_track before any LLM invocation
  // or audit write (mirror of T-20261022-007's S5 guard). No route decision yet stays
  // usable, same back-compat choice as the S5 route.
  const conflict = trackConflictResponse(
    db,
    oppId,
    "brownfield",
    "S6 선정 기준 초안 생성은 Brownfield Route에서만 할 수 있습니다 — 이 기회의 현재 Route 결정은 Greenfield입니다.",
  );
  if (conflict) return conflict;

  // ── 입력 매니페스트 (이 제안이 본 산출물) ──
  // DEC-20261111-05: pinned-first S1 resolution chain (§4.1).
  const manifest: string[] = [];
  const s1 = resolveUniverseS1(db, oppId);
  let s1Context = "";
  let structureContext: string[] = [];
  let financialContext: string[] = [];
  let stageFinancialRowCount = 0;
  if (s1.row) {
    // S1 identity + grade line, then the S1-declared structure blocks — every
    // line goes into the manifest AND the user message (§4.2).
    const s1Line = s1ManifestLine(s1);
    if (s1Line) manifest.push(s1Line);
    // QA condition 2 (DEC-20261111-05): a set-but-incomplete pin is discarded
    // and the resolution replaced it — say so in the manifest instead of
    // silently falling through (design §4.1 step 1). Inside this branch the
    // resolution is pinned/industry_fk/name_fallback; pinDiscarded is false
    // for "pinned" by construction, so this keys the fall-through exactly.
    if (s1.pinDiscarded) manifest.push(STALE_PIN_FALLBACK_LINE);
    s1Context = s1ContextLines(s1).join("\n");
    structureContext = s1StructureLines(s1.row.payload);
    manifest.push(...structureContext);
    // Value-chain stage financials (fact_industry, ADR-0066 plane) — 0 rows
    // emits the honest gap line naming the producing S1 activity (§4.3).
    const stageFinancialRows = readStageFinancials(db, s1.row.industry_id);
    stageFinancialRowCount = stageFinancialRows.length;
    financialContext = stageFinancialsLines(stageFinancialRows);
    manifest.push(...financialContext);
  } else {
    // Honest unset — the gate-brief §9.4 labels; no anchor is quoted and the
    // draft may still run on S3 evidence alone.
    manifest.push(s1UnsetLabel(db, oppId));
  }

  let capabilityContext = "";
  if (opp.capability_gap_json) {
    const { lines, total } = s3CapabilityLines(opp.capability_gap_json);
    if (total > 0) {
      manifest.push("S3 필요 역량 (역량 갭 레지스터)");
      manifest.push(...lines);
      capabilityContext = lines.join("\n");
    }
  }
  const longListCount = (
    db
      .query("SELECT COUNT(*) c FROM brownfield_target WHERE opportunity_id = ? AND status != 'excluded'")
      .get(oppId) as { c: number }
  ).c;
  manifest.push("Long List 현황");
  const existingDefinition = (
    db.query("SELECT target_universe_json FROM opportunity WHERE id = ?").get(oppId) as {
      target_universe_json: string | null;
    }
  ).target_universe_json;

  // S1·S3 근거가 모두 없으면 LLM을 부르지 않는다 — 근거 없는 기준 날조 방지.
  // provenance는 제안된 것이 없다는 뜻으로 null이다 (§4.4).
  if (!s1Context && !capabilityContext) {
    return ok(
      {
        source: "synthesis",
        provider: "deterministic",
        note: "제안에 필요한 S1 시장분석·S3 필요 역량 산출물이 아직 없습니다 — 먼저 S1 분석을 완료하거나 S3 역량 갭을 작성하세요.",
        criteria: null,
        manifest,
        prompt_version: UNIVERSE_CRITERIA_PROMPT_VERSION,
        provenance: null,
      },
      200,
      { no_grounding: true },
    );
  }

  const userContent = [
    `검토/안건: ${opp.name}`,
    s1Context,
    ...structureContext,
    ...financialContext,
    capabilityContext,
    `현재 Long List: ${longListCount}건 (제외 제외)`,
    existingDefinition ? `기존 정의(참고): ${existingDefinition.slice(0, 200)}` : "",
    "",
    "위 근거로 대상 후보(Long List)의 선정 기준을 제안하세요. JSON만 반환:",
    '{"criteria":{"industry":"산업 범위 (한 문장)","region":"지역 범위 (한 문장)","size":"규모 조건 (한 문장)","viability":"수익성·지속가능성 조건 (1~3문장 — 근거 없으면 검증 필요 + 필요 데이터 명시)","rationale":"이 기준을 제안한 근거 2~3문장 — S1/S3 산출물을 인용"}}',
  ]
    .filter(Boolean)
    .join("\n");

  const llmRes: LlmOrFallback = await completeOrFallback(
    [systemMessage("s6.universe_criteria_draft"), { role: "user" as const, content: userContent }],
    () => "",
    {
      maxTokens: 800,
      agent: {
        key: "brownfield-agent",
        purpose: "S6 유니버스 선정 기준 초안 — S1·S3 산출물 기반 제안 (수익성·지속가능성 축 포함)",
        contextType: "opportunity",
        contextId: oppId,
      },
    },
  );

  appendAudit(db, {
    actor: auth.auth.userId,
    action: "universe_criteria.draft",
    target: oppId,
    now: new Date().toISOString(),
  });

  // provenance는 제안 봉투(비오류 200)에 항상 실린다 — 해석 실패·폴백 봉투에도
  // S1 근원과 단계 재무 유무를 그대로 운반한다 (§4.4).
  const chainFinancials: "present" | "absent" = stageFinancialRowCount > 0 ? "present" : "absent";
  const provenance = buildDraftProvenance(s1, chainFinancials);

  if (llmRes.source !== "llm") {
    return ok(
      {
        source: "synthesis",
        provider: llmRes.provider,
        note: "LLM 호출 실패 — 결정론 폴백으로는 근거 없는 기준을 만들지 않습니다.",
        criteria: null,
        manifest,
        prompt_version: UNIVERSE_CRITERIA_PROMPT_VERSION,
        provenance,
      },
      200,
      { no_grounding: true },
    );
  }
  const parsed = parseJson(llmRes.text);
  const criteria = parseDraftCriteria((parsed?.criteria ?? null) as Record<string, unknown> | null);
  if (!criteria) {
    return ok(
      {
        source: "llm",
        provider: llmRes.provider,
        note: "LLM 응답을 해석하지 못했습니다 — 다시 생성해 보세요.",
        criteria: null,
        manifest,
        prompt_version: UNIVERSE_CRITERIA_PROMPT_VERSION,
        provenance,
      },
      200,
      { parse_failed: true },
    );
  }
  return ok(
    {
      source: "llm",
      provider: llmRes.provider,
      note: null,
      criteria,
      manifest,
      prompt_version: UNIVERSE_CRITERIA_PROMPT_VERSION,
      provenance,
    },
    200,
    { drafted: true },
  );
}
