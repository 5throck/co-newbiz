// S3 필요 역량 "추가 제안" — 요구(필요) 쪽만 제안한다: 시너지 영역에서 도출한 새 필요 역량 행과,
// 비어 있는 필요도·필요 수준 초안(근거 basis 포함). 보유 판정·보유 수준·보유 주체는 건드리지
// 않는다 — 그쪽은 `holding-check` 라우트(프로필 + 외부 검색)가 맡는다(결정자 분리 2026-10-14).
// 산출은 제안 전용이며 저장(PUT /capability-gap)은 사람의 행위다(경계 #2). DB에는 쓰지 않는다.
// 비어 있지 않은 사람 입력값은 덮어쓰지 않는다(빈 칸만 채움).
import { getDb } from "../../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../../lib/llm.ts";
import { route } from "../../../../../../lib/route.ts";
import { normalizeGapRows, type CapabilityGapRow } from "../../../../../../lib/capability-gap.ts";
import { applyNecessityDraft, normalizeNecessityDraft, type DraftMark } from "../../../../../../lib/capability-gap-necessity-draft.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";

const NECESSITY_PROMPT =
  "\n필요도(necessity)는 필수(essential)=이 역량 없이는 사업을 진행할 수 없음, 부분 필수(partial_essential)=일부 기능·단계·지역에서만 필요(그 범위를 necessityScopeNote에 120자 이내로 기술), 선택(optional)=있으면 유리하나 필수는 아님입니다. 필요 수준(requiredLevel)은 사업을 위해 도달해야 할 구체적 상태를 1-2문장(400자 이내)으로 씁니다. 이미 값이 있는 행은 건드리지 말고(비어 있는 칸만 제안), 근거(basis.necessity / basis.requiredLevel)에는 시너지 영역·요구 메모·프로필 근거를 인용해 왜 그렇게 판단했는지 씁니다. 근거가 뒷받침하지 않으면 해당 값을 비웁니다.";

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

    const rowsText = current.length === 0 ? "(행 없음 — 시너지 영역에서 newRows만 제안)" : current
      .map((r, i) => `${i + 1}. [${r.id}] ${r.capability}${r.requiredNote ? ` (${r.requiredNote})` : ""} | 필요도: ${r.necessity || "비어 있음"} | 필요 수준: ${r.requiredLevel.trim() ? "입력됨(건드리지 말 것)" : "비어 있음"}`)
      .join("\n");
    const context = [
      `기회명: ${opp.name} / 시장: ${opp.market_scope ?? "미정"}`,
      synergyAreasText ? `\n[S3 연계 시너지 영역 — 선별(Short List) 우선]\n${synergyAreasText}` : "",
      `\n[필요 역량 행]\n${rowsText}`,
      "\n주의: 필요도·필요 수준은 위 시너지 영역·요구 메모가 뒷받침할 때만 제안하고, 근거가 없으면 비워 둔다(사실을 만들지 않는다). 보유 판정·보유 수준은 이 단계에서 다루지 않는다." +
        (synergyAreasText ? " 새 행 추가는 위 시너지 영역을 채우는 데 실제로 필요한 역량만, 영역명을 requiredNote에 인용해 제안한다." : ""),
    ].filter(Boolean).join("\n");

    const drafts: Record<string, DraftMark> = {};
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
              "각 필요 역량 행에 대해, 비어 있는 필요도와 필요 수준만 초안으로 제안하세요(보유 판정·보유 수준·보유 주체는 제안하지 않습니다). " +
              NECESSITY_PROMPT +
              (synergyAreasText
                ? "\n또한 시너지 영역 근거를 보고 이 영역을 채우는 데 필요한데 아래 행 목록에 없는 역량이 있으면 newRows로 추가 제안하세요(최대 5개, requiredNote에 영역명 인용). 이미 목록에 있는 역량은 중복 제안하지 않습니다."
                : "") +
              "\n" +
              'JSON: {"rows":[{"id":"원본 행 id 그대로","necessity":"essential|partial_essential|optional|(비움)","necessityScopeNote":"부분 필수일 때만 범위","requiredLevel":"필요 수준(1-2문장)|(비움)","basis":{"necessity":"왜 이 필요도인가(영역·요구 메모 인용)","requiredLevel":"무엇을 근거로 이 수준인가"}}]' +
              (synergyAreasText ? ',"newRows":[{"capability":"역량명","requiredNote":"시너지 영역 X에서 도출 — 사유","necessity":"...","necessityScopeNote":"...","requiredLevel":"...","basis":{"necessity":"...","requiredLevel":"..."}}]' : "") +
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
        if (parsed?.rows || parsed?.newRows) {
          const byId = new Map((parsed.rows ?? []).map((r) => [String(r?.id ?? ""), r]));
          rows = current.map((r) => {
            const draft = byId.get(r.id);
            if (!draft) return r;
            // 필요도·필요 수준 — 빈 칸만 채운다(사람이 입력한 값은 그대로).
            const nd = applyNecessityDraft(r, normalizeNecessityDraft(draft));
            if (nd.mark) drafts[r.id] = nd.mark;
            return nd.row;
          });
          // 시너지 영역에서 도출된 새 행 — 기존 행과 중복되는 역량명은 제외하고 미판정·보유 칸
          // 비움 상태로 추가한다(보유 판정은 "보유 판정 확인"이 따로 맡는다).
          const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
          const existingCaps = new Set(rows.map((r) => norm(r.capability)));
          const newRows = (Array.isArray(parsed.newRows) ? parsed.newRows : [])
            .map((n) => ({ capability: String(n?.capability ?? "").trim().slice(0, 200), requiredNote: String(n?.requiredNote ?? "").trim().slice(0, 300), draft: normalizeNecessityDraft(n) }))
            .filter((n) => n.capability && !existingCaps.has(norm(n.capability)))
            .slice(0, 5)
            .map((n) => {
              const base: CapabilityGapRow = {
                id: `gap-synarea-${ulid()}`,
                capability: n.capability,
                source: "synergy_area" as const,
                requiredNote: n.requiredNote,
                held: { status: "unevaluated" as const, holders: [], evidence: "" },
                resolution: null,
                note: "LLM 시너지 영역 도출 초안 — 사람이 확인해 확정하세요.",
                necessity: "" as const,
                necessityScopeNote: "",
                requiredLevel: "",
                currentLevel: "",
              };
              const nd = applyNecessityDraft(base, n.draft);
              if (nd.mark) drafts[base.id] = nd.mark;
              return nd.row;
            });
          if (newRows.length > 0) rows = [...rows, ...newRows];
          source = "llm";
          const filled = Object.keys(drafts).length;
          note = newRows.length > 0
            ? `${newRows.length}개 필요 역량 추가 제안, 필요도·필요 수준 자동 입력 ${filled}건(초안) — 보유 판정은 "보유 판정 확인"으로. 검토·수정해 저장하세요(저장은 사람의 행위, 경계 #2).`
            : `필요도·필요 수준 초안 ${Object.keys(drafts).length}건 — 빈 칸만 채웠습니다. 근거가 부족한 값은 비워 뒀습니다. 검토·수정해 저장하세요(저장은 사람의 행위, 경계 #2).`;
        } else {
          note = "LLM 응답 파싱 실패 — 행은 변경되지 않았습니다.";
        }
      } else {
        note = "LLM 호출 실패 — 행은 변경되지 않았습니다.";
      }
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
      note = seeded.length > 0
        ? `LLM 미구성 — 시너지 영역 ${seeded.length}개를 필요 역량 행으로만 추가했습니다. 필요도·필요 수준은 근거 없이 추정하지 않아 비워 뒀으니 직접 입력하세요.`
        : "LLM 미구성 — 결정론 폴백은 필요도·필요 수준을 만들지 않고 비워 둡니다(행의 출처만으로 추정하지 않음). 사람이 직접 입력하세요.";
    }

    return ok({ rows, source, note, drafts }, 200);
});
