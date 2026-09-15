// S10 투자구조 설계 LLM 추천 (ADR-0118) — flow.spec S10 inputs(S8 채택 BC,
// S9 DD 발견사항, WACC·hurdle) + 자기 단계 현재 가설/재원 상태만 컨텍스트로
// 읽는다. 차량·지분·수단·4축 노트 초안을 제안하며 저장은 사람의 행위다.
// On-demand, 비영속, 폴백은 vehicle을 위조하지 않는다.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { listBusinessCases, latestAdoption } from "../../../../../lib/business-case.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";

const VEHICLES = ["direct", "spc", "holdco", "spinoff", "jv"] as const;

interface RecoPayload {
  vehicle: string | null;
  stake_type: string | null;
  instrument_mix: string | null;
  four_axis: { tax_structure_note: string; liability_isolation_note: string; financing_leverage_note: string; exit_structure_note: string };
  rationale_draft: string;
  key_evidence: string[];
  cautions: string[];
}

function normalize(raw: Record<string, unknown>): RecoPayload {
  const vehicle = String(raw.vehicle ?? "").trim().toLowerCase();
  const axis = (raw.four_axis ?? {}) as Record<string, unknown>;
  const note = (k: string) => String(axis[k] ?? "").trim().slice(0, 400);
  return {
    vehicle: (VEHICLES as readonly string[]).includes(vehicle) ? vehicle : null,
    stake_type: String(raw.stake_type ?? "").trim().slice(0, 120) || null,
    instrument_mix: String(raw.instrument_mix ?? "").trim().slice(0, 200) || null,
    four_axis: {
      tax_structure_note: note("tax_structure_note") || "검증 필요",
      liability_isolation_note: note("liability_isolation_note") || "검증 필요",
      financing_leverage_note: note("financing_leverage_note") || "검증 필요",
      exit_structure_note: note("exit_structure_note") || "검증 필요",
    },
    rationale_draft: String(raw.rationale_draft ?? "").trim().slice(0, 1500),
    key_evidence: Array.isArray(raw.key_evidence) ? raw.key_evidence.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 8) : [],
    cautions: Array.isArray(raw.cautions) ? raw.cautions.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 8) : [],
  };
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "검토/안건구조 추천 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();

  // 매니페스트 (flow.spec S10 inputs + 자기 단계 상태)
  const adoption = latestAdoption(id);
  const { cases } = listBusinessCases(id);
  const adoptedCase = adoption ? cases.find((c) => c.id === adoption.modelId) : undefined;
  const findings = db
    .query("SELECT category, description, value_impact FROM dd_finding WHERE project_id = ? ORDER BY created_at DESC LIMIT 6")
    .all(id) as Array<{ category: string; description: string; value_impact: string | null }>;
  const waccRows = db
    .query(
      `SELECT assumption_key, value FROM (
         SELECT assumption_key, value, ROW_NUMBER() OVER (PARTITION BY assumption_key ORDER BY as_of DESC, id DESC) AS rn
         FROM assumption WHERE assumption_key IN ('wacc','hurdle_irr')
       ) WHERE rn = 1`,
    )
    .all() as Array<{ assumption_key: string; value: string }>;
  const hypothesis = db
    .query("SELECT vehicle, stake_type, instrument_mix, four_axis_review_completed FROM deal_structure_hypothesis WHERE project_id = ? ORDER BY hypothesized_at DESC, id DESC LIMIT 1")
    .get(id) as { vehicle: string | null; stake_type: string | null; instrument_mix: string | null; four_axis_review_completed: number } | undefined;
  const financing = db
    .query("SELECT kind, COUNT(*) n, SUM(amount_krw_m) total FROM financing_sources_uses WHERE project_id = ? GROUP BY kind")
    .all(id) as Array<{ kind: string; n: number; total: number | null }>;

  const manifest = ["S8 채택 BC 요약", "S9 DD 발견사항", "WACC·hurdle", "자기 단계 가설·재원 현황"];
  const context = [
    `프로젝트: ${id}`,
    `\n[S8 채택 BC]\n${adoptedCase ? `${adoptedCase.name} (${adoptedCase.kind}${adoptedCase.scenario ? `, ${adoptedCase.scenario}` : ""})` : "채택 없음 — 생성·채택을 먼저 완료하세요"}`,
    `\n[S9 DD 발견사항]\n${findings.length > 0 ? findings.map((f) => `- [${f.category}] ${f.description.slice(0, 160)}${f.value_impact ? ` (가치영향: ${f.value_impact})` : ""}`).join("\n") : "없음"}`,
    `\n[WACC·hurdle]\n${waccRows.length > 0 ? waccRows.map((w) => `${w.assumption_key}: ${w.value}`).join("\n") : "없음"}`,
    `\n[자기 단계 현황]\n기존 가설: ${hypothesis ? `${hypothesis.vehicle ?? "?"} (4축 ${hypothesis.four_axis_review_completed ? "완료" : "미완료"})` : "없음"}\n재원: ${financing.length > 0 ? financing.map((f) => `${f.kind} ${f.total ?? 0}M(${f.n}건)`).join(", ") : "없음"}`,
  ].join("\n");

  let payload: RecoPayload;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  if (isLlmConfigured()) {
    const res = await completeOrFallback(
      [
        systemMessage("s8.deal_structure_recommendation"),
        {
          role: "user" as const,
          content:
            "이 프로젝트의 투자구조 가설 초안을 작성하세요. vehicle은 direct|spc|holdco|spinoff|jv 중 하나입니다.\n" +
            `JSON: {"vehicle":"direct|spc|holdco|spinoff|jv","stake_type":"지분 형태","instrument_mix":"수단 mix","four_axis":{"tax_structure_note":"절세","liability_isolation_note":"책임격리","financing_leverage_note":"레버리지","exit_structure_note":"엑싯"},"rationale_draft":"구조 근거 3~5문장(S4·S8·S9 인용)","key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
        },
      ],
      () => "",
      { maxTokens: 2000, agent: promptAgent("s8.deal_structure_recommendation") },
    );
    if (res.source === "llm") {
      const start = res.text.indexOf("{");
      const end = res.text.lastIndexOf("}");
      let raw: unknown = null;
      if (start !== -1 && end > start) {
        try { raw = JSON.parse(res.text.slice(start, end + 1)) as unknown; } catch { raw = null; }
      }
      if (raw) {
        payload = normalize(raw as Record<string, unknown>);
        source = "llm";
        provider = res.provider;
        note = "LLM 제안 — 폼에 반영해 수정한 뒤 사람이 저장합니다 (경계 #2).";
      } else {
        payload = synthesisFallback(adoption != null);
        note = "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
      }
    } else {
      payload = synthesisFallback(adoption != null);
      note = "LLM 호출 실패 — 결정론 폴백으로 대체했습니다.";
    }
  } else {
    payload = synthesisFallback(adoption != null);
    note = "LLM 미구성 — 결정론 폴백(vehicle 권고 없음). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }

  appendAudit(db, { actor: ctx.userId, action: "deal_structure_recommendation.generate", target: `${id}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, recommendation: payload }, 200);
});

function synthesisFallback(hasAdoption: boolean): RecoPayload {
  return {
    vehicle: null,
    stake_type: null,
    instrument_mix: null,
    four_axis: {
      tax_structure_note: "검증 필요 — 결정론 폴백은 4축 노트를 생성하지 않습니다.",
      liability_isolation_note: "검증 필요",
      financing_leverage_note: "검증 필요",
      exit_structure_note: "검증 필요",
    },
    rationale_draft: hasAdoption
      ? "결정론 폴백 — 채택 BC가 존재합니다. 구조 권고는 LLM 구성 후 생성하거나 사람이 직접 작성하세요."
      : "결정론 폴백 — 채택 BC가 없어 구조 권고 근거가 부족합니다. S8 채택을 먼저 완료하세요.",
    key_evidence: [],
    cautions: ["LLM 미구성 또는 실패 — vehicle·4축 권고는 포함되지 않았습니다."],
  };
}
