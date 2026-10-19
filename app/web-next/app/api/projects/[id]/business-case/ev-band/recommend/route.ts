// POST /api/projects/[id]/business-case/ev-band/recommend — EV/Revenue 밴드 AI
// 추천 초안 (2026-10-19 decider direction). Analyst+ RECOMMENDATION surface for
// the person-only band confirmation: builds an LLM prompt from the brownfield
// subject target (name, latest annual revenue from DART) plus the reference
// screening band and any currently confirmed band, and asks the model to DRAFT
// {min, max, default, rationale, source}. Strict output validation uses the
// SAME rules as the person-only band POST (validateEvBandInput — default inside
// the band, rationale ≥10자, source ≥3자); invalid model output is rejected,
// never coerced, with ONE repair retry feeding the validator's Korean error
// back. THE ENDPOINT WRITES NOTHING — the person reviews/edits/confirms
// through the existing audited band POST (boundary #2: AI output is a
// proposal, never auto-applied). The model is invoked ONLY on this
// person-initiated call; failure degrades to draft: null with an honest note.
import { getDb } from "../../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../../lib/auth.ts";
import { fail, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { completeDetailed, isLlmConfigured } from "../../../../../../../lib/llm.ts";
import { promptAgent, systemMessage } from "../../../../../../../lib/prompts.ts";
import {
  ACQUISITION_EV_REVENUE_BAND,
  resolveConfirmedEvBand,
  validateEvBandInput,
  EvBandValidationError,
} from "../../../../../../../lib/business-case-generator.ts";
import { caseInputsForTarget, listShortlistSubjects } from "../../../../../../../lib/business-case-generator.ts";

/** Extract the first JSON object from a model reply: whole-text → fenced block
 *  → first balanced brace group (string-aware). Same tolerance ladder as the
 *  S2 draft route (design §5.4 #2). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const attempts: string[] = [text];
  for (const m of text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)) attempts.push(m[1]);
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (escaped) { escaped = false; continue; }
      if (c === "\\") { escaped = true; continue; }
      if (c === '"') inString = !inString;
      if (inString) continue;
      if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) { attempts.push(text.slice(start, i + 1)); break; }
      }
    }
  }
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "AI 밴드 추천은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
  const { id } = await params;
  const db = getDb();
  const project = db
    .query("SELECT id, track, company_id, source_opportunity_id FROM md_project WHERE id = ?")
    .get(id) as { id: string; track: string | null; company_id: string | null; source_opportunity_id: string | null } | undefined;
  if (!project) return notFound();

  // Subject target + revenue anchor — the same resolution the BEP route uses.
  // Without a brownfield subject the recommendation has nothing real to anchor
  // on, so it 409s honestly instead of drafting from thin air.
  const subjects = project.source_opportunity_id ? listShortlistSubjects(db, project.source_opportunity_id) : [];
  const picked = (project.company_id ? subjects.find((t: { companyId: string | null }) => t.companyId === project.company_id) : undefined) ?? subjects[0] ?? null;
  if (!picked) {
    return fail(409, "no_subject", "브라운필드 대상이 없습니다 — AI 밴드 추천은 Short List 대상의 매출을 근거로만 동작합니다.");
  }
  const inputs = caseInputsForTarget(id, { id: picked.id, companyId: picked.companyId });
  const revenueKrwM = inputs.revenueAnchor?.krwM ?? null;
  const revenueSource = inputs.revenueAnchor?.source ?? null;

  const confirmed = resolveConfirmedEvBand(db, id);
  // ── LLM call: only on this person-initiated request; never automatic ──
  let draft: { min: number; max: number; default?: number; rationale: string; source: string } | null = null;
  let llmSource: "llm" | "unavailable" = "unavailable";
  let note: string;
  if (!isLlmConfigured()) {
    note = "LLM이 구성되지 않아 추천을 생성하지 못했습니다 — 밴드 확정은 정상 동작합니다.";
  } else {
    let lastFailure: string | null = null;
    const userPrompt = [
      `대상 회사: ${picked.name}`,
      revenueKrwM !== null ? `대상 최신 연매출: ${Math.round(revenueKrwM).toLocaleString("ko-KR")} 백만원 (${revenueSource})` : "대상 연매출: 확인 불가",
      `참고 밴드 (출처 미확보 스크리닝 자리값): ${ACQUISITION_EV_REVENUE_BAND.min}–${ACQUISITION_EV_REVENUE_BAND.max}×`,
      confirmed ? `현재 확정 밴드: ${confirmed.min}–${confirmed.max}×${confirmed.default ? ` (기본 ${confirmed.default}×)` : ""}` : "현재 확정 밴드: 없음",
      "위 정보를 근거로 EV/Revenue 밴드 {min, max, default, rationale, source}를 초안하세요.",
      '출력 스키마: {"min": 숫자, "max": 숫자, "default": 숫자, "rationale": "10자 이상", "source": "3자 이상"}',
    ].join("\n");
    try {
      const res = await completeDetailed(
        [systemMessage("s8.ev_band_recommend"), { role: "user" as const, content: userPrompt }],
        { maxTokens: 800, agent: promptAgent("s8.ev_band_recommend") },
      );
      const parse = (text: string) => {
        lastFailure = null;
        const parsed = extractJsonObject(text);
        if (!parsed) { lastFailure = "모델 응답에서 JSON을 찾을 수 없습니다."; return null; }
        try {
          return validateEvBandInput({
            min: parsed.min, max: parsed.max, default: parsed.default ?? undefined, rationale: parsed.rationale, source: parsed.source,
          });
        } catch (err) {
          lastFailure = err instanceof Error ? err.message : String(err);
          return null;
        }
      };
      let v = parse(res.text);
      if (!v) {
        // One repair retry: feed the failing rule + rejected text back for corrected JSON only.
        const repair = await completeDetailed(
          [
            systemMessage("s8.ev_band_recommend"),
            {
              role: "user" as const,
              content: [
                "이전 응답이 검증 규칙에 맞지 않아 기각되었습니다.",
                `실패 사유: ${lastFailure ?? "JSON 파싱 실패"}`,
                "기각된 이전 응답:",
                res.text.slice(0, 1200),
                "검증 규칙을 모두 만족하는 수정된 JSON만 출력하세요 (설명·코드펜스 금지).",
              ].join("\n"),
            },
          ],
          { maxTokens: 800, agent: promptAgent("s8.ev_band_recommend") },
        );
        v = parse(repair.text);
      }
      if (!v) throw new Error(lastFailure ?? "모델 응답을 검증 규칙에 맞게 수정하지 못했습니다.");
      draft = v;
      llmSource = "llm";
      note = "AI 밴드 추천 초안 — 근거를 검증·보완한 뒤 밴드 확정하세요 (확정은 사람의 행위, 경계 #2).";
    } catch (err) {
      note = `AI 추천 생성 실패 — ${err instanceof Error ? err.message.slice(0, 140) : "호출 실패"} (밴드 확정은 정상 동작합니다; 초안 없음)`;
    }
  }
  return ok(
    {
      draft,
      source: llmSource,
      note,
      subject: { id: picked.id, name: picked.name },
      revenue: revenueKrwM !== null ? { krwM: Math.round(revenueKrwM), source: revenueSource } : null,
    },
    200,
  );
}
