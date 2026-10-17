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
//
// Redesign slice 3 (2026-10-17 entry-market flow redesign, §5.4): draft
// reliability. The user prompt's JSON template is a VALID JSON literal with a
// numeric factor (the old `0.0-1.0` prose placeholder taught models to emit
// string factors the strict validator rejects whole); extraction tries
// whole-text -> fenced block -> first balanced object; and ONE repair retry
// runs on strict-validation failure, feeding the validator's Korean error
// back for corrected JSON only (design §OD-5 accepts the retry cost). The
// strict validation rules are unchanged — invalid output is still rejected,
// never coerced.
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
import { lazyAutoLinkOnRead } from "../../../../../../lib/sizing-auto-link.ts";

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
  if (linked === null || !linked.ok) {
    if (linked !== null && linked.code === "anchor_unavailable") {
      return fail(
        409,
        "anchor_unavailable",
        "연결된 S1 시장규모 버전에 앵커 값(1차년도 총계)이 없습니다 — AI 배수 추천은 앵커 값이 있는 S1 버전을 근거로만 동작합니다. 연결 자체는 되어 있습니다.",
      );
    }
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
      let steps = draftStepsFromReply(res.text);
      if (!steps) {
        // One repair retry (design §5.4 #3): feed the failing rule and the
        // rejected text back for corrected JSON only — still strictly
        // validated, still writes nothing.
        const repair = await completeDetailed(
          [
            systemMessage("s2.entry_market_draft"),
            { role: "user" as const, content: buildRepairUserPrompt(res.text, lastDraftFailure ?? "모델 응답에서 JSON을 찾을 수 없습니다.") },
          ],
          { maxTokens: 1600, agent: promptAgent("s2.entry_market_draft") },
        );
        steps = draftStepsFromReply(repair.text);
      }
      if (!steps) throw new Error(lastDraftFailure ?? "모델 응답을 검증 규칙에 맞게 수정하지 못했습니다.");
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
 *  year-1 anchor value. Null when unlinked (409 not_linked) or the
 *  opportunity itself is gone.
 *
 *  2026-10-17 decider-feedback fix: this read now applies the SAME
 *  lazyAutoLinkOnRead as readSizingLink (the path the card's 자동 연결 chip
 *  sees) — a pre-existing opportunity whose link existed only as a pending
 *  lazy auto-link no longer 409s here while the chip says linked. And an
 *  anchor-less pinned version is a DISTINCT failure (code "anchor_unavailable")
 *  instead of collapsing into the misleading generic not_linked. */
interface DraftPromptContext {
  declared_scope: { regions: readonly string[]; segments: readonly string[]; unit_basis: string | null } | null;
  regions: Array<{ code: string; label: string; weight: number }>;
  anchor_sources: Array<{ label: string; estimate: number; as_of: string | null }>;
}
type DraftContext =
  | { ok: true; anchorValue: number; promptContext: DraftPromptContext }
  | { ok: false; code: "not_linked" | "anchor_unavailable" };

function readLinkedDraftContext(db: ReturnType<typeof getDb>, opportunityId: string): DraftContext | null {
  const select = () =>
    db
      .query(
        "SELECT o.sizing_analysis_id AS analysisId, o.sizing_version_id AS versionId, mv.payload AS payload FROM opportunity o LEFT JOIN market_sizing_version mv ON mv.id = o.sizing_version_id WHERE o.id = ?",
      )
      .get(opportunityId) as { analysisId: string | null; versionId: string | null; payload: string | null } | undefined;
  let row = select();
  if (!row) return null;
  if (!row.analysisId || !row.versionId) {
    // Same lazy auto-link the card's chip path (readSizingLink) applies.
    lazyAutoLinkOnRead(db, opportunityId, new Date().toISOString());
    row = select();
    if (!row) return null;
  }
  if (!row.versionId || !row.payload) return { ok: false, code: "not_linked" };
  type DraftMatrix = { anchor?: { sources?: Array<{ label?: unknown; estimate?: unknown; asOf?: unknown }>; total?: unknown }; regions?: Array<{ code?: unknown; label?: unknown; weight?: unknown }>; scope?: unknown };
  let matrix: DraftMatrix | null = null;
  try {
    matrix = JSON.parse(row.payload) as DraftMatrix;
  } catch {
    return { ok: false, code: "anchor_unavailable" };
  }
  if (!matrix || typeof matrix !== "object") return { ok: false, code: "anchor_unavailable" };
  const anchorValue = typeof matrix.anchor?.total === "number" ? matrix.anchor.total : null;
  if (anchorValue == null || anchorValue <= 0) return { ok: false, code: "anchor_unavailable" };
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
  return { ok: true as const, anchorValue, promptContext };
}

/** The valid JSON output instruction (redesign slice 3, design §5.4 #1):
 *  a concrete, parseable example with a NUMERIC factor literal plus an
 *  explicit factor-is-a-number rule — replacing the old prose placeholder
 *  (`0.0-1.0 배율`) that taught models to emit string factors. */
export function draftOutputInstruction(): string {
  return [
    "JSON만 출력합니다 (설명·코드펜스 금지). 출력 예시 (유효한 JSON):",
    '{"steps":[{"base":"s1_anchor","factor":0.35,"source":"앵커 지역 범위 중 사업 대상 지역 비중 추정 (검증 필요)","as_of":"2026-06","region_tags":["we"],"segment_tags":[]},{"base":"step:0","factor":0.4,"source":"대상 세그먼트 시장 비율 추정 (검증 필요)","as_of":"2026-06","region_tags":[],"segment_tags":["seg"]}]}',
    "규칙: factor는 JSON 숫자 리터럴(예: 0.35)이며 문자열이 아닙니다. 모든 단계에 비어있지 않은 source와 as_of를 넣고, 첫 단계 base는 \"s1_anchor\", 두 번째 단계부터는 직전 단계를 가리키는 \"step:0\", \"step:1\", ... (0부터 시작), 단계는 최대 6개입니다.",
  ].join("\n");
}

export function buildDraftUserPrompt(ctx: DraftPromptContext, targetScope: { regions: readonly string[]; segments: string[] } | null): string {
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
    draftOutputInstruction(),
  ].join("\n");
}

/** The failing rule from the last strict validation (the Korean
 *  EntryMarketValidationError message) or extraction — surfaced in the
 *  repair prompt and, when everything fails, in the honest failure note. */
let lastDraftFailure: string | null = null;

/** Extract + strictly normalize a model reply into draft steps; null and a
 *  recorded failure reason when the reply does not pass (never coerced). */
function draftStepsFromReply(text: string): EntryMarketStep[] | null {
  lastDraftFailure = null;
  const parsed = extractJsonObject(text);
  if (!parsed) {
    lastDraftFailure = "모델 응답에서 JSON을 찾을 수 없습니다.";
    return null;
  }
  try {
    return normalizeEntryMarketDerivationInput(parsed).steps;
  } catch (err) {
    lastDraftFailure = err instanceof Error ? err.message : String(err);
    return null;
  }
}

/** The one repair-retry prompt (design §5.4 #3): the validator's Korean
 *  error message plus the rejected reply, corrected strict JSON only. */
export function buildRepairUserPrompt(rejectedText: string, failure: string): string {
  return [
    "이전 응답이 검증 규칙에 맞지 않아 기각되었습니다.",
    `실패 사유: ${failure}`,
    "기각된 이전 응답:",
    rejectedText.slice(0, 2000),
    "검증 규칙을 모두 만족하는 수정된 JSON만 출력하세요 (설명·코드펜스 금지). factor는 (0, 1] 범위의 JSON 숫자 리터럴이며 문자열이 아닙니다.",
    draftOutputInstruction(),
  ].join("\n");
}

/** Extract the first JSON object from a model reply (redesign slice 3,
 *  design §5.4 #2). Tolerant attempts, first parse wins: (1) whole-text
 *  parse, (2) a fenced ```json block, (3) the first balanced-brace object
 *  (string-aware, so prose between two brace groups no longer fails
 *  wholesale). null when none parses. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const attempts: string[] = [text];
  for (const m of text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)) attempts.push(m[1]);
  const balanced = firstBalancedObject(text);
  if (balanced !== null) attempts.push(balanced);
  for (const a of attempts) {
    try {
      const v = JSON.parse(a) as unknown;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // next attempt
    }
  }
  return null;
}

/** The substring of the first balanced `{...}` object in `text` (string and
 *  escape aware), or null when none closes. */
function firstBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
