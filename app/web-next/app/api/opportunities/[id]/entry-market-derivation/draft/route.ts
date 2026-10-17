// POST /api/opportunities/[id]/entry-market-derivation/draft — ADR-0179
// amendment slice B (AI-recommendation addition, decider chat 2026-10-17):
// an analyst+ AI-RECOMMENDATION surface for the factor chain. The route
// builds an LLM prompt from the LINKED S1 series (declared scope, region
// weights, anchor sources with their as-of) plus the opportunity's
// person-set target scope and asks the model to DRAFT factor steps. Strict
// output validation uses the SAME rules as PUT (factor in (0,1], non-empty
// {source, as_of}, sane base chain, max steps); invalid model output is
// rejected, never coerced. THE ENDPOINT WRITES NOTHING — it returns the
// draft only; the person edits/sources/confirms it and the actual save
// stays the existing audited person PUT (boundary #2: AI output is a
// proposal, never auto-applied). The model is invoked ONLY on this
// person-initiated call — no automatic LLM call exists on any other path.
// Failure degrades to draft: null with an honest note, never blocking the
// panel.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { fail, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeDetailed, isLlmConfigured } from "../../../../../../lib/llm.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";
import {
  compareReachedScope,
  computeEntryMarketChain,
  confidenceLoweringCount,
  ENTRY_MARKET_SCOPE_NOTE,
  normalizeEntryMarketDerivationInput,
  parseTargetScopeJsonSafe,
  reachedScopeOf,
  REGION_DEFINITION_CAVEAT,
  type EntryMarketStep,
} from "../../../../../../lib/entry-market.ts";
import { extractSizingVersionScope } from "../../../../../../lib/anchor-scope.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "AI 배수 추천은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, target_scope_json AS scopeJson FROM opportunity WHERE id = ?").get(id) as
    | { id: string; scopeJson: string | null }
    | undefined;
  if (!opp) return notFound();
  const linked = readLinkedDraftContext(db, id);
  if (!linked) {
    return fail(409, "not_linked", "S1 시장규모 분석이 연결되지 않았습니다 — AI 배수 추천은 연결된 S1 버전을 근거로만 동작합니다.");
  }
  const targetScope = parseTargetScopeJsonSafe(opp.scopeJson);
  // ── LLM call: only on this person-initiated request; never automatic ──
  let draftSteps: EntryMarketStep[] | null = null;
  let source: "llm" | "unavailable" = "unavailable";
  let note: string;
  if (!isLlmConfigured()) {
    note = "LLM이 구성되지 않아 추천을 생성하지 못했습니다 — 패널은 정상 동작합니다.";
  } else {
    try {
      const res = await completeDetailed(
        [systemMessage("s2.entry_market_draft"), { role: "user" as const, content: buildDraftUserPrompt(linked.promptContext, targetScope) }],
        { maxTokens: 1600, agent: promptAgent("s2.entry_market_draft") },
      );
      // Strict validation with the SAME rules as PUT: one parse of the whole
      // chain — invalid model output is rejected whole, never coerced.
      const parsed = extractJsonObject(res.text);
      if (!parsed) throw new Error("모델 응답에서 JSON을 찾을 수 없습니다.");
      const { steps } = normalizeEntryMarketDerivationInput(parsed);
      draftSteps = steps;
      source = "llm";
      note = "AI 배수 추천 초안 — 모든 단계의 배율과 출처를 검증·보완한 뒤 저장하세요 (저장은 사람의 행위, 경계 #2).";
    } catch (err) {
      note = `AI 추천 생성 실패 — ${err instanceof Error ? err.message.slice(0, 140) : "호출 실패"} (패널은 정상 동작합니다; 초안 없음)`;
    }
  }
  return ok(
    {
      draft: draftSteps
        ? {
            steps: draftSteps.map((s) => ({ ...s, origin: "ai_suggested" as const })),
            computed: computeEntryMarketChain(linked.anchorValue, draftSteps),
            confidence_lowering_count: confidenceLoweringCount(draftSteps),
            scope_flag: { ...compareReachedScope(reachedScopeOf(draftSteps), targetScope), note: ENTRY_MARKET_SCOPE_NOTE },
          }
        : null,
      source,
      note,
      region_caveat: REGION_DEFINITION_CAVEAT,
    },
    200,
  );
}

/** The LINKED S1 draft context: the pinned version's declared scope, the
 *  matrix's region weights, the anchor sources with their as-of, and the
 *  year-1 anchor value. Null when unlinked (409 not_linked). */
function readLinkedDraftContext(db: ReturnType<typeof getDb>, opportunityId: string) {
  const row = db
    .query(
      "SELECT mv.payload AS payload FROM opportunity o LEFT JOIN market_sizing_version mv ON mv.id = o.sizing_version_id WHERE o.id = ?",
    )
    .get(opportunityId) as { payload: string | null } | undefined;
  if (!row?.payload) return null;
  type DraftMatrix = { anchor?: { sources?: Array<{ label?: unknown; estimate?: unknown; asOf?: unknown }>; total?: unknown }; regions?: Array<{ code?: unknown; label?: unknown; weight?: unknown }>; scope?: unknown };
  let matrix: DraftMatrix | null = null;
  try {
    matrix = JSON.parse(row.payload) as DraftMatrix;
  } catch {
    return null;
  }
  if (!matrix || typeof matrix !== "object") return null;
  if (!matrix || typeof matrix !== "object") return null;
  const anchorValue = typeof matrix.anchor?.total === "number" ? matrix.anchor.total : null;
  if (anchorValue == null || anchorValue <= 0) return null;
  const scope = extractSizingVersionScope(row.payload);
  const promptContext = {
    declared_scope: scope
      ? { regions: scope.regions, segments: scope.segments, unit_basis: scope.unit_basis }
      : null,
    regions: Array.isArray(matrix.regions)
      ? matrix.regions
          .filter((r): r is { code: string; label: string; weight: number } =>
            typeof r?.code === "string" && typeof r?.label === "string" && typeof r?.weight === "number")
          .map((r) => ({ code: r.code, label: r.label, weight: r.weight }))
      : [],
    anchor_sources: Array.isArray(matrix.anchor?.sources)
      ? matrix.anchor.sources
          .filter((s): s is { label: string; estimate: number; asOf?: string } =>
            typeof s?.label === "string" && typeof s?.estimate === "number")
          .map((s) => ({ label: s.label, estimate: s.estimate, as_of: typeof s.asOf === "string" ? s.asOf : null }))
      : [],
  };
  return { anchorValue, promptContext };
}

function buildDraftUserPrompt(ctx: NonNullable<ReturnType<typeof readLinkedDraftContext>>["promptContext"], targetScope: { regions: readonly string[]; segments: string[] } | null): string {
  const scopeLine = ctx.declared_scope
    ? `선언 범위: 지역 ${ctx.declared_scope.regions.join(", ")}${ctx.declared_scope.segments.length ? ` · 세그먼트 ${ctx.declared_scope.segments.join(", ")}` : ""}${ctx.declared_scope.unit_basis ? ` · 단위 ${ctx.declared_scope.unit_basis}` : ""}`
    : "선언 범위: 미기재";
  const regions = ctx.regions.length > 0 ? ctx.regions.map((r) => `- ${r.label} (${r.code}): 가중치 ${r.weight}%`).join("\n") : "- 없음";
  const sources = ctx.anchor_sources.length > 0
    ? ctx.anchor_sources.map((s) => `- ${s.label}: ${s.estimate}${s.as_of ? ` (기준 ${s.as_of})` : ""}`).join("\n")
    : "- 없음";
  const target = targetScope
    ? `지역 ${targetScope.regions.join(", ")}${targetScope.segments.length ? ` · 세그먼트 ${targetScope.segments.join(", ")}` : ""}`
    : "미설정";
  return [
    "연결된 S1 시장규모 분석과 기회의 대상 범위를 근거로, S2 진입 시장 도출 사슬의 배율 인자 단계를 초안하세요.",
    "",
    `[S1 앵커]`,
    scopeLine,
    `[지역 구성과 가중치]`,
    regions,
    `[앵커 출처]`,
    sources,
    `[기회의 대상 범위 (사람 설정)]`,
    target,
    "",
    `JSON만 출력: {"steps":[{"base":"s1_anchor","factor":0.0-1.0 배율,"source":"출처 문장","as_of":"YYYY-MM-DD","note":"선택","region_tags":["..."],"segment_tags":["..."]}, ...]}`,
  ].join("\n");
}

/** Extract the first JSON object from a model reply (tolerant of prose
 *  fences); null when none parses. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
