// S3 "보유 판정 확인 (AI)" — 보유 쪽만 제안한다: 보유 판정 / 보유 수준 / 보유 주체·근거.
// 근거는 그룹/계열사 프로필(회사 정보) + 제한된 외부 웹 검색이며 인용이 필수다. 근거가 없으면
// 미판정·빈 칸으로 두고 이유를 응답 note에 적는다. 웹 텍스트는 신뢰할 수 없는 데이터다.
// 제안 전용 — DB에는 쓰지 않으며 저장(PUT /capability-gap)은 사람의 행위다(경계 #2).
// 본문: { rows?, rowId?, webSearch? }. 기본(rowId 없음)은 미판정이거나 보유 수준/근거가 빈
// 행만 대상으로 빈 칸만 채운다. rowId가 있으면 그 한 행을 새로 확인해 proposals[rowId]로 돌려주고
// (사람이 "적용"을 눌러야 반영), 행 자체는 바꾸지 않는다. 웹 검색 게이트는 S6 웹검색 제안과
// 같다: analyst 이상 + lib/web-research.ts 설정(TAVILY_API_KEY 또는 DDG 폴백, WEB_SEARCH_DDG_ENABLED).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../../lib/llm.ts";
import { route } from "../../../../../../lib/route.ts";
import { normalizeGapRows, type CapabilityGapRow } from "../../../../../../lib/capability-gap.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";
import { applyHeldDraft, normalizeCitedHeldDraft, SEARCH_ROW_CAP, type CitedHeld, type DraftMark } from "../../../../../../lib/capability-gap-necessity-draft.ts";
import { buildHoldingPrompt, gatherHoldingSources, holdingNote, needsHoldingCheck, type HoldingCounts } from "../../../../../../lib/capability-holding-check.ts";

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

    let body: { rows?: unknown; rowId?: unknown; webSearch?: unknown } = {};
    try { body = ((await request.json()) as typeof body | null) ?? {}; } catch { /* empty body */ }
    let current: CapabilityGapRow[] = Array.isArray(body.rows) ? normalizeGapRows(body.rows) : [];
    if (current.length === 0) {
      try { current = normalizeGapRows(((JSON.parse(opp.capability_gap_json ?? "{}") as { rows?: unknown }).rows ?? []) as unknown); } catch { /* malformed */ }
    }
    if (current.length === 0) return badRequest("no_rows", "필요 역량 수준 행이 없습니다 — 먼저 행을 추가하거나 S2 스케치에서 시드하세요.");
    const rowId = typeof body.rowId === "string" ? body.rowId : null;
    const single = rowId ? current.find((r) => r.id === rowId) : null;
    if (rowId && !single) return badRequest("unknown_row", "확인할 행을 찾을 수 없습니다.");
    const targets = single ? [single] : current.filter(needsHoldingCheck).slice(0, 30);
    if (targets.length === 0) {
      return ok({ rows: current, proposals: {}, drafts: {}, source: "synthesis", note: "확인할 행이 없습니다 — 모든 행에 보유 판정·보유 수준·근거가 이미 있습니다. 한 행만 다시 확인하려면 행의 \"다시 확인\"을 쓰세요.", counts: { proposed: 0, insufficient: 0, profile: 0, web: 0 } }, 200);
    }

    // 그룹/계열사 범위 — 이 기회의 최신 시너지 분석 대상을 우선, 없으면 레지스트리 전체.
    const allMembers = db.query("SELECT id, company_name, group_id FROM company_group_member").all() as MemberLite[];
    const syn = db
      .query("SELECT target_type, member_id, group_id FROM synergy_analysis WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(id) as { target_type: string; member_id: string | null; group_id: string | null } | undefined;
    let scoped = allMembers;
    if (syn?.target_type === "affiliate" && syn.member_id) scoped = allMembers.filter((m) => m.id === syn.member_id);
    else if (syn?.target_type === "group" && syn.group_id) scoped = allMembers.filter((m) => m.group_id === syn.group_id);
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

    const search = await gatherHoldingSources(targets, profileNames.length > 0 ? profileNames : scoped.map((m) => m.company_name), opp.market_scope, body.webSearch !== false);
    if (profileLines.length === 0 && search.sources.length === 0) {
      return badRequest("no_evidence", "근거가 없습니다 — 그룹/계열사 프로필이 없고 외부 검색 결과도 없습니다. 그룹/계열사 분석(our-company)을 먼저 실행하세요." + (search.failureNote ? ` (${search.failureNote})` : ""));
    }

    const counts: HoldingCounts = { proposed: 0, insufficient: 0, profile: 0, web: 0 };
    const drafts: Record<string, DraftMark> = {};
    const proposals: Record<string, (CitedHeld & { reason?: string }) | { status: "unevaluated"; reason: string }> = {};
    let rows = current.map((r) => ({ ...r, held: { ...r.held } }));
    let source: "llm" | "synthesis" = "synthesis";
    let note: string;
    if (isLlmConfigured()) {
      const res = await completeOrFallback(
        [
          systemMessage("s3.capability_gap_draft"),
          { role: "user" as const, content: buildHoldingPrompt({ oppName: opp.name, marketScope: opp.market_scope, rows: targets, profileLines, search }) },
        ],
        () => "",
        { maxTokens: 3200, agent: promptAgent("s3.capability_gap_draft") },
      );
      if (res.source === "llm") {
        const start = res.text.indexOf("{");
        const end = res.text.lastIndexOf("}");
        let parsed: { rows?: Array<Record<string, unknown>> } | null = null;
        if (start !== -1 && end > start) { try { parsed = JSON.parse(res.text.slice(start, end + 1)); } catch { parsed = null; } }
        if (parsed?.rows) {
          source = "llm";
          const byId = new Map(parsed.rows.map((r) => [String(r?.id ?? ""), r]));
          for (const t of targets) {
            const cited = normalizeCitedHeldDraft(byId.get(t.id), { allowedSources: search.perRow[t.id] ?? [], sources: search.sources, profileNames });
            if (!cited) { counts.insufficient++; proposals[t.id] = { status: "unevaluated", reason: "프로필·검색 근거가 이 판정을 뒷받침하지 않아 미판정으로 둡니다." }; continue; }
            counts.proposed++;
            if (cited.origins.includes("profile")) counts.profile++;
            counts.web += cited.web.length;
            proposals[t.id] = cited;
            if (!single) {
              const idx = rows.findIndex((r) => r.id === t.id);
              const ap = applyHeldDraft(rows[idx], cited, null);
              rows[idx] = ap.row;
              if (ap.mark) drafts[t.id] = ap.mark;
            }
          }
          note = holdingNote({ counts, search, webEnabled: body.webSearch !== false, targeted: targets.length });
        } else {
          note = "LLM 응답 파싱 실패 — 행은 변경되지 않았습니다.";
        }
      } else {
        note = "LLM 호출 실패 — 행은 변경되지 않았습니다.";
      }
    } else {
      note = "LLM 미구성 — 결정론 폴백은 보유 판정·보유 수준을 만들지 않습니다. 사람이 프로필을 확인해 판정하세요.";
    }
    return ok({ rows, proposals, drafts, source, note, counts, search: { queries: search.queries, sources: search.sources.length, failureNote: search.failureNote, rowCap: SEARCH_ROW_CAP } }, 200);
});
