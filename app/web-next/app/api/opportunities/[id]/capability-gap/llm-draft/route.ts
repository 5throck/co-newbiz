// S3 필요 역량 "추가 제안" — 요구(필요) 쪽만 제안한다: 시너지 영역에서 도출한 새 필요 역량 행과,
// 비어 있는 필요도·필요 수준 초안(근거 basis 포함). 보유 판정·보유 수준·보유 근거는 건드리지
// 않는다 — 그쪽은 `holding-check` 라우트(프로필 + 외부 검색)가 맡는다(결정자 분리 2026-10-14).
// 산출은 제안 전용이며 저장(PUT /capability-gap)은 사람의 행위다(경계 #2). DB에는 쓰지 않는다.
// 비어 있지 않은 사람 입력값은 덮어쓰지 않는다(빈 칸만 채움).
import { getDb } from "../../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeDetailed, isLlmConfigured } from "../../../../../../lib/llm.ts";
import { route } from "../../../../../../lib/route.ts";
import { normalizeGapRows, type CapabilityGapRow } from "../../../../../../lib/capability-gap.ts";
import { countMissingRequirement, missingReport, type DraftMark } from "../../../../../../lib/capability-gap-necessity-draft.ts";
import { failureSuffix, runRequirementDraft } from "../../../../../../lib/capability-requirement-draft.ts";
import type { LlmCall } from "../../../../../../lib/llm-json.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "필요 역량 수준 LLM 초안 생성은 analyst 역할 이상이어야 합니다." }); if (denied) return denied; }
    const { id } = await params;
    const db = getDb();
    const opp = db
      .query("SELECT id, name, market_scope, sketch_json, capability_gap_json FROM opportunity WHERE id = ?")
      .get(id) as { id: string; name: string; market_scope: string | null; sketch_json: string | null; capability_gap_json: string | null } | undefined;
    if (!opp) return notFound();

    // 현재 행 — 본문 rows(화면의 저장 전 편집 상태)가 있으면 그것을 기준으로, 없으면 저장된
    // 레지스터를 쓴다. 행이 없으면 400(먼저 행을 작성/시드하세요). 어느 쪽이든 DB에는 쓰지 않는다.
    let current: CapabilityGapRow[] = [];
    let bodyRows: unknown = null;
    try { bodyRows = ((await request.json()) as { rows?: unknown } | null)?.rows ?? null; } catch { /* empty body */ }
    if (Array.isArray(bodyRows)) current = normalizeGapRows(bodyRows);
    if (current.length === 0) {
      try {
        current = normalizeGapRows(((JSON.parse(opp.capability_gap_json ?? "{}") as { rows?: unknown }).rows ?? []) as unknown);
      } catch { /* malformed — treat as empty */ }
    }

    // S3 연계 — 위 시너지 분석(2026-09-15 사용자 요구: 연계 시너지 영역과 필요
    // 역량 수준의 연결)의 우선 시너지 영역(Short List 우선)을 근거로 함께
    // 제공한다. LLM은 이 영역을 채우는 데 필요한 역량을 새 행(source:
    // "synergy_area")으로 추가 제안할 수 있다 — 제안일 뿐 저장은 사람의 행위.
    let synergyAreasText = "";
    const areaNames: string[] = [];
    try {
      const synVersion = db
        .query(
          `SELECT v.payload FROM synergy_version v
           JOIN synergy_analysis sa ON sa.id = v.analysis_id
           WHERE sa.opportunity_id = ? AND sa.status = 'completed'
           ORDER BY v.version_no DESC LIMIT 1`,
        )
        .get(id) as { payload: string } | undefined;
      if (synVersion) {
        const p = JSON.parse(synVersion.payload) as {
          marketLinkage?: { synergyAreas?: Array<{ area?: string; opportunity?: string; risk?: string }> };
          shortList?: Array<{ area?: string; verdict?: string; reason?: string }>;
        };
        const areas = [
          ...(p.shortList ?? []).filter((s) => s.area),
          ...(p.marketLinkage?.synergyAreas ?? []).filter((a) => a.area && !(p.shortList ?? []).some((s) => s.area === a.area)),
        ].slice(0, 8);
        if (areas.length > 0) {
          for (const a of areas) if (a.area) areaNames.push(a.area);
          synergyAreasText = areas
            .map((a, i) => {
              const shortlist = "verdict" in a ? a.verdict?.includes("Short") : false;
              return `${i + 1}. ${a.area}${shortlist ? " (선별)" : ""} — 기회: ${(a as { opportunity?: string }).opportunity ?? "—"} · 위험: ${(a as { risk?: string }).risk ?? "—"}`;
            })
            .join("\n");
        }
      }
    } catch { /* malformed synergy payload — 영역 근거 없이 진행 */ }

    // 행이 없어도 시너지 영역이 있으면 새 행 제안은 가능하다 — 둘 다 없으면 제안할 근거가 없다.
    if (current.length === 0 && !synergyAreasText) {
      return badRequest("no_rows", "제안할 근거가 없습니다 — 완료된 시너지 분석(시너지 영역)이 없고 필요 역량 행도 없습니다. 시너지 분석을 실행하거나 행을 직접 추가하세요.");
    }

    const drafts: Record<string, DraftMark> = {};
    const missingBefore = countMissingRequirement(current);
    let proposedNew = 0;
    let rows: CapabilityGapRow[] = current.map((r) => ({ ...r, held: { ...r.held } }));
    let source: "llm" | "synthesis" = "synthesis";
    let note: string;
    if (isLlmConfigured()) {
      // Batched + per-item validated (lib/capability-requirement-draft.ts, lib/llm-json.ts): one bad item or a
      // truncated reply never discards the rest, and the note reports partial success honestly.
      const call: LlmCall = async (messages, maxTokens) => {
        try {
          const r = await completeDetailed(messages, { maxTokens, agent: promptAgent("s3.capability_gap_draft") });
          return { ok: true, text: r.text, finishReason: r.finishReason };
        } catch (err) {
          return { ok: false, text: "", reason: err instanceof Error ? err.message.slice(0, 80) : "call_failed" };
        }
      };
      const out = await runRequirementDraft({ system: systemMessage("s3.capability_gap_draft"), ctx: { oppName: opp.name, marketScope: opp.market_scope, synergyAreasText }, current, call });
      rows = out.rows;
      Object.assign(drafts, out.drafts);
      proposedNew = out.proposedNew;
      source = out.answered ? "llm" : "synthesis";
      note = `${proposedNew > 0 ? `${proposedNew}개 필요 역량 제안 (AI) — ` : "새 행 제안 없음 — "}` +
        `${missingReport(missingBefore.total + 2 * proposedNew, countMissingRequirement(rows), out.answered ? "시너지 영역·요구 메모·프로필 근거가 값을 뒷받침하지 않아" : "LLM 응답을 쓸 수 없어")}` +
        `${failureSuffix(out)} 보유 판정은 "보유 판정 확인"으로. 검토·수정해 저장하세요(저장은 사람의 행위, 경계 #2).`;
    } else {
      // 결정론 폴백 — 시너지 영역명으로 행만 만들고(중복 제외), 필요도·필요 수준은 만들지 않는다.
      const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
      const have = new Set(rows.map((r) => norm(r.capability)));
      const seeded = areaNames
        .filter((n) => { const k = norm(n); if (!k || have.has(k)) return false; have.add(k); return true; })
        .slice(0, 5)
        .map((n): CapabilityGapRow => ({
          id: `gap-synarea-${ulid()}`, capability: n.trim().slice(0, 200), source: "synergy_area",
          requiredNote: `시너지 영역 "${n.trim().slice(0, 80)}"에서 도출 (결정론 폴백 — 역량명은 영역명을 그대로 옮긴 것이니 구체화하세요)`,
          held: { status: "unevaluated", holders: [], evidence: "" }, resolution: null,
          note: "결정론 시너지 영역 시드 — 사람이 확인해 확정하세요.", necessity: "", necessityScopeNote: "", requiredLevel: "", currentLevel: "",
        }));
      if (seeded.length > 0) rows = [...rows, ...seeded];
      proposedNew = seeded.length;
      note = `${seeded.length > 0 ? `LLM 미구성 — 시너지 영역 ${seeded.length}개를 필요 역량 행으로만 추가했습니다.` : "LLM 미구성 — 결정론 폴백은 필요도·필요 수준을 만들지 않습니다(행의 출처만으로 추정하지 않음)."} ` +
        missingReport(missingBefore.total + 2 * seeded.length, countMissingRequirement(rows), "LLM이 구성되지 않아 근거 없이 추정하지 않고");
    }

    const missing = countMissingRequirement(rows);
    return ok({ rows, source, note, drafts, missing: { before: missingBefore.total + 2 * proposedNew, after: missing.total, necessity: missing.necessity, requiredLevel: missing.requiredLevel } }, 200);
});
