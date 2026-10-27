// S12 사후관리 모니터링 브리프 (ADR-0118) — flow.spec S12 inputs(IC 승인 결정,
// 실행 계획) + 자기 단계 기록(스코어카드·시너지 인증·핵심인재·전환 이력)만
// 컨텍스트로 읽는다. 투자 상태 평가·전환 제안 초안을 제안하며, 전환 결정
// (venture_transition_decision)은 사람이 기록한다. On-demand, 비영속.
import { effectiveState } from "../../../../../../../db/lib/gate-effective.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { completeOrFallback, isLlmConfigured } from "../../../../../lib/llm.ts";
import { route } from "../../../../../lib/route.ts";
import { promptAgent, systemMessage } from "../../../../../lib/prompts.ts";
import { buildRiskHeatmap, heatmapSnapshot } from "../../../../../lib/risk-heatmap.ts";

const TRANSITIONS = [
  "next_tranche_released",
  "held_evidence_incomplete",
  "graduate_to_core",
  "reduce_or_divest",
  "kill_with_learning_captured",
] as const;

interface BriefPayload {
  assessment_draft: string;
  risk_flags: string[];
  transition_suggestion: string | null;
  rationale_draft: string;
  learning_capture_draft: string;
  key_evidence: string[];
  cautions: string[];
}

function normalize(raw: Record<string, unknown>): BriefPayload {
  const suggestion = String(raw.transition_suggestion ?? "").trim();
  const strList = (arr: unknown, max: number) =>
    Array.isArray(arr) ? arr.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, max) : [];
  return {
    assessment_draft: String(raw.assessment_draft ?? "").trim().slice(0, 1500),
    risk_flags: strList(raw.risk_flags, 8),
    transition_suggestion: (TRANSITIONS as readonly string[]).includes(suggestion) ? suggestion : null,
    rationale_draft: String(raw.rationale_draft ?? "").trim().slice(0, 1500),
    learning_capture_draft: String(raw.learning_capture_draft ?? "").trim().slice(0, 1000),
    key_evidence: strList(raw.key_evidence, 8),
    cautions: strList(raw.cautions, 8),
  };
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "Monitoring-brief generation requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const db = getDb();

  // 매니페스트 (flow.spec S12 inputs + 자기 단계 기록)
  const project = db.query("SELECT project_name, track, current_stage_gate FROM md_project WHERE id = ?").get(id) as { project_name: string; track: string | null; current_stage_gate: string | null } | undefined;
  const scorecard = db
    .query("SELECT section, measure_key, target_value, actual_value, status FROM venture_scorecard WHERE project_id = ? ORDER BY created_at DESC LIMIT 15")
    .all(id) as Array<{ section: string; measure_key: string; target_value: string | null; actual_value: string | null; status: string | null }>;
  const certs = db
    .query("SELECT run_rate_bp, sustained_quarters, certified_by, signed_at FROM pmi_synergy_certification WHERE project_id = ? ORDER BY created_at DESC LIMIT 5")
    .all(id) as Array<{ run_rate_bp: number | null; sustained_quarters: number | null; certified_by: string | null; signed_at: string | null }>;
  const talent = db
    .query("SELECT role_ref, status, exit_date FROM pmi_key_talent WHERE project_id = ?")
    .all(id) as Array<{ role_ref: string; status: string; exit_date: string | null }>;
  const transitions = db
    .query("SELECT decision, rationale FROM venture_transition_decision WHERE project_id = ? ORDER BY created_at DESC LIMIT 3")
    .all(id) as Array<{ decision: string; rationale: string }>;
  const icGateRow = db
    .query("SELECT id, gate, decision, decided_by, rationale FROM gate_decision WHERE entity_type = 'project' AND entity_id = ? AND gate IN ('entity_ic','group_ic') ORDER BY decided_at DESC, id DESC LIMIT 1")
    .get(id) as { id: string; gate: string; decision: string; decided_by: string; rationale: string } | undefined;
  // ADR-0186 D6: an IC GO that still awaits its countersign is shown as such, never as an approval in force.
  const icGate = icGateRow
    ? { decision: effectiveState(db, id, icGateRow).awaiting ? `${icGateRow.decision} (awaiting countersign)` : icGateRow.decision, rationale: icGateRow.rationale }
    : undefined;

  const manifest = ["포트폴리오 스코어카드", "시너지 인증", "핵심인재 상태", "전환 이력", "IC 승인 결정", "리스크 히트맵 스냅샷"];
  // ADR-0122 #2 — the heatmap snapshot rides the quarterly briefing too (same server builder as S9/IC).
  const heatmap = heatmapSnapshot(buildRiskHeatmap(db, id), 5);
  const context = [
    `프로젝트: ${project?.project_name ?? id} (트랙 ${project?.track ?? "?"}, 단계 ${project?.current_stage_gate ?? "?"})`,
    `\n[IC 승인 결정]\n${icGate ? `${icGate.decision.toUpperCase()} — ${icGate.rationale.slice(0, 200)}` : "미기록"}`,
    `\n[스코어카드]\n${scorecard.length > 0 ? scorecard.map((s) => `- ${s.section}/${s.measure_key}: 목표 ${s.target_value ?? "?"} / 실적 ${s.actual_value ?? "?"} (${s.status ?? "?"})`).join("\n") : "없음"}`,
    `\n[시너지 인증]\n${certs.length > 0 ? certs.map((c) => `- run-rate ${c.run_rate_bp ?? "?"}bp / ${c.sustained_quarters ?? "?"}분기 지속 (${c.signed_at?.slice(0, 10) ?? "?"})`).join("\n") : "없음"}`,
    `\n[핵심인재]\n${talent.length > 0 ? talent.map((t) => `- ${t.role_ref}: ${t.status}${t.exit_date ? ` (퇴사 ${t.exit_date.slice(0, 10)})` : ""}`).join("\n") : "없음"}`,
    `\n[전환 이력]\n${transitions.length > 0 ? transitions.map((t) => `- ${t.decision}: ${t.rationale.slice(0, 160)}`).join("\n") : "없음"}`,
    `\n[리스크 히트맵 ${heatmap.snapshot_hash}]\n${heatmap.total > 0 ? `높음 ${heatmap.counts.high} / 중간 ${heatmap.counts.mid} / 낮음 ${heatmap.counts.low}\n${heatmap.top.map((t) => `- [${t.severity}] ${t.label}${t.mitigation ? ` — 완화: ${t.mitigation.slice(0, 80)}` : ""}`).join("\n")}` : "플로팅된 리스크 없음"}`,
  ].join("\n");

  let payload: BriefPayload;
  let source: "llm" | "synthesis" = "synthesis";
  let provider: string | null = null;
  let note: string;
  if (isLlmConfigured()) {
    const res = await completeOrFallback(
      [
        systemMessage("s12.monitoring_brief"),
        {
          role: "user" as const,
          content:
            "이 투자의 사후관리 모니터링 브리프를 작성하세요. transition_suggestion은 5-vocab 중 하나이거나 null입니다.\n" +
            `JSON: {"assessment_draft":"투자 상태 평가 초안 3~5문장(스코어카드·인증·인재 인용)","risk_flags":["..."],"transition_suggestion":null|"next_tranche_released|held_evidence_incomplete|graduate_to_core|reduce_or_divest|kill_with_learning_captured","rationale_draft":"전환 제안 근거","learning_capture_draft":"학습 정리 초안","key_evidence":["..."],"cautions":["..."]}\n\n${context}`,
        },
      ],
      () => "",
      { maxTokens: 2000, agent: promptAgent("s12.monitoring_brief") },
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
        note = "LLM 초안 — 반영해 수정한 뒤 사람이 전환 결정을 기록합니다 (경계 #2).";
      } else {
        payload = synthesisFallback(scorecard, certs, talent);
        note = "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
      }
    } else {
      payload = synthesisFallback(scorecard, certs, talent);
      note = "LLM 호출 실패 — 결정론 폴백으로 대체했습니다.";
    }
  } else {
    payload = synthesisFallback(scorecard, certs, talent);
    note = "LLM 미구성 — 결정론 폴백(전환 제안 없음). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }

  appendAudit(db, { actor: ctx.userId, action: "monitoring_brief.generate", target: `${id}:${source}`, now: new Date().toISOString() });
  return ok({ source, provider, note, manifest, brief: payload, risk_heatmap: heatmap }, 200);
});

function synthesisFallback(scorecard: unknown[], certs: unknown[], talent: unknown[]): BriefPayload {
  return {
    assessment_draft: `결정론 폴백 — 스코어카드 ${scorecard.length}건, 시너지 인증 ${certs.length}건, 핵심인재 ${talent.length}건이 기록되어 있습니다. 상태 평가·전환 제안 초안은 LLM 구성 후 생성하거나 사람이 직접 작성하세요.`,
    risk_flags: [],
    transition_suggestion: null,
    rationale_draft: "결정론 폴백 — 전환 제안은 데이터만으로 산출할 수 없어 null입니다 (사람이 판단하세요).",
    learning_capture_draft: "",
    key_evidence: [`스코어카드 ${scorecard.length}건 / 인증 ${certs.length}건 / 인재 ${talent.length}건`],
    cautions: ["LLM 미구성 또는 실패 — 전환 제안 초안은 포함되지 않았습니다."],
  };
}
