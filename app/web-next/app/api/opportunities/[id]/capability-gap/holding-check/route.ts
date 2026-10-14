// S3 "보유 판정 확인 (AI)" — 보유 쪽만 제안한다: 보유 판정 / 보유 수준 / 보유 근거.
// 근거는 그룹/계열사 프로필(회사 정보) + 제한된 외부 웹 검색이며 인용이 필수다. 근거가 없으면
// 미판정·빈 칸으로 두고 이유를 응답 note에 적는다. 웹 텍스트는 신뢰할 수 없는 데이터다.
// 제안 전용 — DB에는 쓰지 않으며 저장(PUT /capability-gap)은 사람의 행위다(경계 #2).
// 본문: { rows?, webSearch? }. 미판정이거나 보유 수준/근거가 빈 행만 대상으로 빈 칸만 채운다
// (단일 행 다시 확인 모드는 없다 — 채워진 행을 갱신하려면 사람이 직접 수정한다). 웹 검색 게이트는 S6 웹검색 제안과
// 같다: analyst 이상 + lib/web-research.ts 설정(TAVILY_API_KEY 또는 DDG 폴백, WEB_SEARCH_DDG_ENABLED).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeDetailed, isLlmConfigured } from "../../../../../../lib/llm.ts";
import { route } from "../../../../../../lib/route.ts";
import { normalizeGapRows, type CapabilityGapRow } from "../../../../../../lib/capability-gap.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";
import { SEARCH_ROW_CAP, type DraftMark } from "../../../../../../lib/capability-gap-necessity-draft.ts";
import type { LlmCall } from "../../../../../../lib/llm-json.ts";
import { runHoldingCheck } from "../../../../../../lib/capability-holding-run.ts";
import { gatherHoldingSources, needsHoldingCheck, type HoldingCounts } from "../../../../../../lib/capability-holding-check.ts";

interface MemberLite { id: string; company_name: string; group_id: string }

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "보유 판정 확인(AI)은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
    const { id } = await params;
    const db = getDb();
    const opp = db
      .query("SELECT id, name, market_scope, capability_gap_json FROM opportunity WHERE id = ?")
      .get(id) as { id: string; name: string; market_scope: string | null; capability_gap_json: string | null } | undefined;
    if (!opp) return notFound();

    let body: { rows?: unknown; webSearch?: unknown } = {};
    try { body = ((await request.json()) as typeof body | null) ?? {}; } catch { /* empty body */ }
    let current: CapabilityGapRow[] = Array.isArray(body.rows) ? normalizeGapRows(body.rows) : [];
    if (current.length === 0) {
      try { current = normalizeGapRows(((JSON.parse(opp.capability_gap_json ?? "{}") as { rows?: unknown }).rows ?? []) as unknown); } catch { /* malformed */ }
    }
    if (current.length === 0) return badRequest("no_rows", "필요 역량 수준 행이 없습니다 — 먼저 행을 추가하거나 S2 스케치에서 시드하세요.");
    const targets = current.filter(needsHoldingCheck).slice(0, 30);
    if (targets.length === 0) {
      return ok({ rows: current, drafts: {}, source: "synthesis", note: "확인할 행이 없습니다 — 모든 행에 보유 판정·보유 수준·근거가 이미 있습니다.", counts: { proposed: 0, insufficient: 0, profile: 0, web: 0 } }, 200);
    }

    // 그룹/계열사 범위 — 이 기회의 최신 시너지 분석 대상을 우선, 없으면 레지스트리 전체.
    const allMembers = db.query("SELECT id, company_name, group_id FROM company_group_member").all() as MemberLite[];
    const syn = db
      .query("SELECT target_type, member_id, group_id FROM synergy_analysis WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(id) as { target_type: string; member_id: string | null; group_id: string | null } | undefined;
    let scoped = allMembers;
    let scopeNote = "";
    if (syn?.target_type === "affiliate" && syn.member_id) scoped = allMembers.filter((m) => m.id === syn.member_id);
    else if (syn?.target_type === "group" && syn.group_id) scoped = allMembers.filter((m) => m.group_id === syn.group_id);
    else scopeNote = "이 기회에 연결된 그룹·계열사 시너지 분석이 없어 등록된 모든 회사의 프로필을 근거 후보로 썼습니다.";
    const { loadLatestProfile } = await import("../../../../../../lib/company-profile-pipeline.ts");
    const profileLines: string[] = [];
    const profileNames: string[] = [];
    for (const m of scoped.slice(0, 10)) {
      const prof = loadLatestProfile(db, { kind: "member", id: m.id });
      if (!prof) continue;
      profileNames.push(m.company_name);
      const strengths = (prof.strengths ?? []).slice(0, 5).join(" / ");
      const exposures = (prof.industryExposure ?? []).slice(0, 6).join(" / ");
      profileLines.push(`- ${m.company_name}: 강점 — ${strengths || "기록 없음"} · 산업 노출 — ${exposures || "기록 없음"}`);
    }

    const profileScope = profileNames.length > 0 ? `사용한 프로필 ${profileNames.length}곳(${profileNames.slice(0, 3).join(", ")}${profileNames.length > 3 ? " 외" : ""})` : `프로필이 있는 회사 0곳(등록 회사 ${scoped.length}곳 중)`;
    const search = await gatherHoldingSources(targets, profileNames.length > 0 ? profileNames : scoped.map((m) => m.company_name), opp.market_scope, body.webSearch !== false);
    if (profileLines.length === 0 && search.sources.length === 0) {
      return badRequest("no_evidence", `근거가 없습니다 — ${profileScope}이고 외부 검색 결과도 없습니다. 그룹/계열사 분석(our-company)으로 프로필을 만들거나 웹 검색(TAVILY_API_KEY 또는 WEB_SEARCH_DDG_ENABLED)을 설정하세요.` + (search.failureNote ? ` (${search.failureNote})` : ""));
    }

    const call: LlmCall = async (messages, maxTokens) => {
      try {
        const r = await completeDetailed(messages, { maxTokens, agent: promptAgent("s3.capability_gap_draft") });
        return { ok: true, text: r.text, finishReason: r.finishReason };
      } catch (err) {
        return { ok: false, text: "", reason: err instanceof Error ? err.message.slice(0, 80) : "call_failed" };
      }
    };
    const { rows, drafts, source, note, counts } = isLlmConfigured()
      ? await runHoldingCheck({ system: systemMessage("s3.capability_gap_draft"), oppName: opp.name, marketScope: opp.market_scope, current, targets, profileLines, profileNames, search, profileScope, scopeNote, webEnabled: body.webSearch !== false, call })
      : { rows: current, drafts: {} as Record<string, DraftMark>, source: "synthesis" as const, counts: { proposed: 0, insufficient: 0, profile: 0, web: 0 } as HoldingCounts, note: "LLM 미구성 — 결정론 폴백은 보유 판정·보유 수준을 만들지 않습니다. 사람이 프로필을 확인해 판정하세요." };
    return ok({ rows, drafts, source, note, counts, search: { queries: search.queries, sources: search.sources.length, failureNote: search.failureNote, rowCap: SEARCH_ROW_CAP } }, 200);
});
