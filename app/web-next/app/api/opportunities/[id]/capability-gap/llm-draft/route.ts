// S3 역량 갭 LLM 초안 — 갭 레지스터의 각 필요 역량 행에 대해 그룹/계열사
// 프로필(strengths·industryExposure) 근거로 보유 상태(held) 초안을 제안한다.
// 산출은 제안 전용이며 저장(PUT /capability-gap)은 사람의 행위다(경계 #2).
// 보유 판정 근거는 그룹/계열사 프로필뿐 — 내부 역량 평가는 후속 보강 사항.
import { getDb } from "../../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../../lib/llm.ts";
import { route } from "../../../../../../lib/route.ts";
import { normalizeGapRows, type CapabilityGapRow } from "../../../../../../lib/capability-gap.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";

interface MemberLite { id: string; company_name: string; group_id: string }

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = authenticate(request);
    if (!auth.ok) return auth.response;
    if (auth.auth.role === "viewer") return forbidden("role_required", "필요 역량 수준 LLM 초안 생성은 analyst 역할 이상이어야 합니다.");
    const { id } = await params;
    const db = getDb();
    const opp = db
      .query("SELECT id, name, market_scope, sketch_json, capability_gap_json FROM opportunity WHERE id = ?")
      .get(id) as { id: string; name: string; market_scope: string | null; sketch_json: string | null; capability_gap_json: string | null } | undefined;
    if (!opp) return notFound();

    // 현재 행 — 저장된 레지스터가 없으면 400(먼저 행을 작성/시드하세요).
    let current: CapabilityGapRow[] = [];
    try {
      current = normalizeGapRows(((JSON.parse(opp.capability_gap_json ?? "{}") as { rows?: unknown }).rows ?? []) as unknown);
    } catch { /* malformed — treat as empty */ }
    if (current.length === 0) {
      return badRequest("no_rows", "필요 역량 수준 행이 없습니다 — 먼저 행을 추가하거나 S2 스케치에서 시드하세요.");
    }

    // 그룹/계열사 범위 — 이 기회에 연결된 최신 시너지 분석의 대상을 우선하고,
    // 없으면 그룹/계열사 레지스트리 전체를 근거로 쓴다.
    const allMembers = db.query("SELECT id, company_name, group_id FROM company_group_member").all() as MemberLite[];
    const syn = db
      .query("SELECT target_type, member_id, group_id FROM synergy_analysis WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(id) as { target_type: string; member_id: string | null; group_id: string | null } | undefined;
    let scoped = allMembers;
    if (syn?.target_type === "affiliate" && syn.member_id) scoped = allMembers.filter((m) => m.id === syn.member_id);
    else if (syn?.target_type === "group" && syn.group_id) scoped = allMembers.filter((m) => m.group_id === syn.group_id);

    // S3 연계 — 위 시너지 분석(2026-09-15 사용자 요구: 연계 시너지 영역과 필요
    // 역량 수준의 연결)의 우선 시너지 영역(Short List 우선)을 근거로 함께
    // 제공한다. LLM은 이 영역을 채우는 데 필요한 역량을 새 행(source:
    // "synergy_area")으로 추가 제안할 수 있다 — 제안일 뿐 저장은 사람의 행위.
    let synergyAreasText = "";
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
          synergyAreasText = areas
            .map((a, i) => {
              const shortlist = "verdict" in a ? a.verdict?.includes("Short") : false;
              return `${i + 1}. ${a.area}${shortlist ? " (선별)" : ""} — 기회: ${(a as { opportunity?: string }).opportunity ?? "—"} · 위험: ${(a as { risk?: string }).risk ?? "—"}`;
            })
            .join("\n");
        }
      }
    } catch { /* malformed synergy payload — 영역 근거 없이 진행 */ }

    const { loadLatestProfile } = await import("../../../../../../lib/company-profile-pipeline.ts");
    const profileLines: string[] = [];
    for (const m of scoped.slice(0, 10)) {
      const prof = loadLatestProfile(db, m.id);
      if (!prof) continue;
      const strengths = (prof.strengths ?? []).slice(0, 5).join(" / ");
      const exposures = (prof.industryExposure ?? []).slice(0, 6).join(" / ");
      profileLines.push(`- ${m.company_name}: 강점 — ${strengths || "기록 없음"} · 산업 노출 — ${exposures || "기록 없음"}`);
    }
    if (profileLines.length === 0) {
      return badRequest("no_profiles", "그룹/계열사 프로필이 없습니다 — 그룹/계열사 분석(our-company)을 먼저 실행하세요.");
    }

    const rowsText = current
      .map((r, i) => `${i + 1}. [${r.id}] ${r.capability}${r.requiredNote ? ` (${r.requiredNote})` : ""}`)
      .join("\n");
    const context = [
      `기회명: ${opp.name} / 시장: ${opp.market_scope ?? "미정"}`,
      synergyAreasText ? `\n[S3 연계 시너지 영역 — 선별(Short List) 우선]\n${synergyAreasText}` : "",
      `\n[판정 대상 필요 역량 행]\n${rowsText}`,
      `\n[그룹/계열사 보유 근거 — 프로필 최신 버전]\n${profileLines.join("\n")}`,
      "\n주의: 보유 판정은 위 그룹/계열사 프로필 근거로만 한다. 근거가 없으면 status를 unevaluated로 두고 holders를 비운다." +
        (synergyAreasText ? " 새 행 추가는 위 시너지 영역을 채우는 데 실제로 필요한 역량만, 영역명을 requiredNote에 인용해 제안한다." : ""),
    ].filter(Boolean).join("\n");

    let rows: CapabilityGapRow[] = current.map((r) => ({ ...r, held: { ...r.held } }));
    let source: "llm" | "synthesis" = "synthesis";
    let note: string;
    if (isLlmConfigured()) {
      const res = await completeOrFallback(
        [
          systemMessage("s3.capability_gap_draft"),
          {
            role: "user" as const,
            content:
              "각 필요 역량 행을 그룹/계열사 보유 근거와 대조해 보유 상태 초안을 판정하세요. status는 met|partial|unmet|unevaluated, holders는 보유 근거가 있는 회사명(제공된 이름 그대로), evidence는 근거 문장입니다." +
              (synergyAreasText
                ? "\n또한 시너지 영역 근거를 보고 이 영역을 채우는 데 필요한데 아래 행 목록에 없는 역량이 있으면 newRows로 추가 제안하세요(최대 5개, requiredNote에 영역명 인용). 이미 목록에 있는 역량은 중복 제안하지 않습니다."
                : "") +
              "\n" +
              'JSON: {"rows":[{"id":"원본 행 id 그대로","held":{"status":"met|partial|unmet|unevaluated","holders":["회사명"],"evidence":"프로필 근거 요약"}}]' +
              (synergyAreasText ? ',"newRows":[{"capability":"역량명","requiredNote":"시너지 영역 X에서 도출 — 사유"}]' : "") +
              "}\n\n" +
              context,
          },
        ],
        () => "",
        { maxTokens: 1600, agent: promptAgent("s3.capability_gap_draft") },
      );
      if (res.source === "llm") {
        const start = res.text.indexOf("{");
        const end = res.text.lastIndexOf("}");
        let parsed: { rows?: Array<Record<string, unknown>>; newRows?: Array<Record<string, unknown>> } | null = null;
        if (start !== -1 && end > start) {
          try { parsed = JSON.parse(res.text.slice(start, end + 1)) as { rows?: Array<Record<string, unknown>>; newRows?: Array<Record<string, unknown>> }; } catch { parsed = null; }
        }
        if (parsed?.rows) {
          const byId = new Map(parsed.rows.map((r) => [String(r?.id ?? ""), r]));
          rows = current.map((r) => {
            const draft = byId.get(r.id);
            if (!draft) return r;
            const heldRaw = (draft.held ?? {}) as Record<string, unknown>;
            const status = String(heldRaw.status ?? "").trim();
            const holders = Array.isArray(heldRaw.holders) ? heldRaw.holders.map((x) => String(x ?? "").trim().slice(0, 120)).filter(Boolean).slice(0, 6) : [];
            const evidence = String(heldRaw.evidence ?? "").trim().slice(0, 400);
            if (!["met", "partial", "unmet", "unevaluated"].includes(status)) return r;
            return {
              ...r,
              held: {
                status: status as CapabilityGapRow["held"]["status"],
                holders: status === "unevaluated" ? [] : holders,
                evidence: status === "unevaluated" ? "" : evidence,
              },
              note: r.note || "LLM 보유 판정 초안 — 사람이 확인해 확정하세요.",
            };
          });
          // 시너지 영역에서 도출된 새 행 — 기존 행과 중복되는 역량명은 제외하고
          // 미판정 상태로 추가한다(보유 판정도 다음 초안 실행 때 함께 이뤄진다).
          const existingCaps = new Set(rows.map((r) => r.capability.toLowerCase()));
          const newRows = (Array.isArray(parsed.newRows) ? parsed.newRows : [])
            .map((n) => ({ capability: String(n?.capability ?? "").trim().slice(0, 200), requiredNote: String(n?.requiredNote ?? "").trim().slice(0, 300) }))
            .filter((n) => n.capability && !existingCaps.has(n.capability.toLowerCase()))
            .slice(0, 5)
            .map((n) => ({
              id: `gap-synarea-${ulid()}`,
              capability: n.capability,
              source: "synergy_area" as const,
              requiredNote: n.requiredNote,
              held: { status: "unevaluated" as const, holders: [], evidence: "" },
              resolution: null,
              note: "LLM 시너지 영역 도출 초안 — 사람이 확인해 확정하세요.",
            }));
          if (newRows.length > 0) rows = [...rows, ...newRows];
          source = "llm";
          note = newRows.length > 0
            ? `필요 역량 추가 제안 ${newRows.length}건 + 보유 판정 초안 갱신 — 검토해 저장하세요(저장은 사람의 행위, 경계 #2).`
            : "보유 판정 초안 — 검토해 저장하세요(저장은 사람의 행위, 경계 #2).";
        } else {
          note = "LLM 응답 파싱 실패 — 행은 변경되지 않았습니다.";
        }
      } else {
        note = "LLM 호출 실패 — 행은 변경되지 않았습니다.";
      }
    } else {
      note = "LLM 미구성 — 결정론 폴백은 수준 값을 위조하지 않습니다. 사람이 프로필을 확인해 판정하세요.";
    }

    return ok({ rows, source, note }, 200);
});
