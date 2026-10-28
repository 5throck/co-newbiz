// report-composer.ts — deterministic IC-report draft builder (ADR-0116
// Phase 6; approved mockup 2026-09-11-reports-composer-ui-mockup_ko.html).
// Assembles the same data surface as the IC package route (adopted business
// case + dual-variant comparison, DD summary, RAG proposal, deal structure,
// gate history) plus the pipeline briefing pack, into Markdown the composer
// textarea prefills. Deterministic only — the draft is PROPOSAL text; the
// human edits and owns what gets saved.
import type { Database } from "bun:sqlite";
import { formatInteger } from "./format.ts";
import { findAdoptedCase, listBusinessCases, type BusinessCaseView } from "./business-case.ts";
import { ddCompletionSummary } from "./dd-checklist-tailor.ts";
import { evaluateProcess, latestGateDecisions, type GateId } from "./process-flow.ts";
import { buildBriefingPack } from "./briefing-pack.ts";
import { getHypotheses } from "../../../db/repositories/deal-structure-hypothesis.repository.ts";
import { financingTotals } from "../../../db/repositories/financing-plan.repository.ts";
import { financingCertainty } from "../../../db/repositories/financing-plan.repository.ts";
import { buildRiskHeatmap, heatmapSnapshot } from "./risk-heatmap.ts";
import { covenantHeadroom } from "./covenant-headroom.ts";
import { milestoneSummary } from "./milestones.ts";
import { icReviewStepsView } from "./ic-review-steps.ts";

export interface ComposedReport {
  title: string;
  markdown: string;
  sections: string[];
}

const pct = (v: number | null | undefined): string => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—");
const num = (v: number | null | undefined): string => (typeof v === "number" ? formatInteger(Math.round(v)) : "—");

export function composeProjectReport(db: Database, projectId: string, projectNo: string, projectName: string): ComposedReport {
  const sections: string[] = [];
  const lines: string[] = [];

  // ── Adopted business case + dual-variant comparison (ADR-0117) ──
  const list = listBusinessCases(projectId);
  const { cases, adoption } = list;
  const adopted = findAdoptedCase(list);
  const simOf = (c: BusinessCaseView, p: string) => c.simulations.find((x) => x.percentile === p);
  lines.push(`# 투자 검토 보고서 — ${projectName}`);
  lines.push("");
  lines.push(`프로젝트: ${projectNo} · 작성 기준일: ${new Date().toISOString().slice(0, 10)} · 이 문서는 초안이며 판정과 승인은 사람의 몫입니다 (경계 #2).`);
  lines.push("");

  sections.push("Executive Summary");
  lines.push("## 1. Executive Summary");
  lines.push("");
  if (adopted) {
    const p50 = simOf(adopted, "p50");
    const p05 = simOf(adopted, "p05");
    lines.push(`- 채택된 사업 케이스: **${adopted.name}**${adopted.archived_at ? " [보관됨]" : ""} (${adopted.variant === "market_forward" ? "시장 기반" : "과거 기반"} · 채택자 ${adoption?.adoptedBy ?? "—"}${adoption?.adoptedAt ? `, ${adoption.adoptedAt.slice(0, 10)}` : ""})`);
    lines.push(`- NPV p05 ${num(p05?.npv_krw_m)} / p50 ${num(p50?.npv_krw_m)} / p95 ${num(simOf(adopted, "p95")?.npv_krw_m)} 백만 KRW · IRR ${pct(p50?.irr ?? null)}`);
    // Sibling-variant comparison — how much the growth assumption alone moves p50.
    const sibling = cases.find((c) => c.scenario === adopted.scenario && c.id !== adopted.id);
    if (sibling) {
      const sP50 = simOf(sibling, "p50")?.npv_krw_m ?? null;
      const aP50 = p50?.npv_krw_m ?? null;
      if (sP50 !== null && aP50 !== null && aP50 !== 0) {
        const diff = aP50 - sP50;
        lines.push(`- 관점 비교: ${sibling.variant === "historical" ? "과거 기반" : "시장 기반"} p50 ${num(sP50)} — 채택 관점 대비 ${diff >= 0 ? "+" : ""}${num(diff)} (${((diff / Math.abs(aP50)) * 100).toFixed(1)}%)`);
      }
    } else {
      // No target company (Green Field) means no past-based variant by design — do not ask for DART sync.
      lines.push(adopted.target_id === null
        ? "- 관점 비교: 시장 기반 단일 관점 (대상 회사 미연결 — 과거 기반 비교 없음)"
        : "- 관점 비교: 과거 기반 변형 없음 (대상 회사 연결 + DART 동기화 필요)");
    }
  } else {
    lines.push("- 채택된 사업 케이스가 없습니다 — 법인 투자심의위원회 심사 전 S8 채택이 필요합니다.");
  }
  lines.push("");

  sections.push("사업 케이스 상세");
  lines.push("## 2. 사업 케이스 상세");
  lines.push("");
  if (adopted) {
    for (const l of adopted.lines) {
      lines.push(`- ${l.category} · ${l.name}: ${num(l.annual_amount_krw_m)} 백만 KRW (y${l.start_year}${l.growth_rate ? `, 성장 ${(l.growth_rate * 100).toFixed(1)}%` : ""})`);
    }
    const note = parseNote(simOf(adopted, "p50")?.note);
    if (Object.keys(note).length > 0) {
      lines.push("");
      lines.push(`> 산출 근거: seed=${note.seed ?? "—"} · iterations=${note.iterations ?? "—"} · WACC ${note.wacc ?? "—"} (${note.wacc_source ?? "—"}${note.wacc_scope === "target" ? " · 대상별 세션" : ""}) · 성장 ${note.growth ?? "—"} (${note.growth_source ?? "—"}) · σ ${note.sigma ?? "—"} (${note.sigma_source ?? "—"})`);
    }
  } else {
    lines.push("(채택된 케이스 없음)");
  }
  lines.push("");

  sections.push("DD 요약");
  const dd = ddCompletionSummary(projectId);
  lines.push("## 3. 실사(DD) 완료 요약");
  lines.push("");
  lines.push(`- 완료 판정: ${dd.pending === 0 && dd.unassessed === 0 && dd.mandatoryUnmet === 0 ? "완료" : "미완료"} · 필수 항목 해소 현황은 실사 탭 참조`);
  lines.push("");

  sections.push("RAG 제안");
  lines.push("## 4. RAG 제안 (AI 제안 — 승인 아님)");
  lines.push("");
  const ragRows = db
    .query(
      `SELECT dimension, grade, rationale FROM (
         SELECT dimension, grade, rationale,
                ROW_NUMBER() OVER (PARTITION BY dimension ORDER BY assessed_at DESC, id DESC) AS rn
         FROM rag_assessment WHERE project_id = ?
       ) WHERE rn = 1`,
    )
    .all(projectId) as Array<{ dimension: string; grade: string; rationale: string }>;
  if (ragRows.length === 0) {
    lines.push("- RAG 평가 없음");
  } else {
    for (const r of ragRows) lines.push(`- ${r.dimension}: ${r.grade} — ${r.rationale}`);
  }
  lines.push("");

  sections.push("투자구조");
  lines.push("## 5. 투자구조 요약");
  lines.push("");
  try {
    const hyps = getHypotheses(projectId, db as unknown as Parameters<typeof getHypotheses>[1]);
    const latest = hyps[hyps.length - 1];
    if (latest) {
      lines.push(`- 자산/주식: ${latest.asset_or_stock} · 지분유형: ${latest.stake_type} · 법적 형태: ${latest.vehicle}`);
    } else {
      lines.push("- 등록된 투자구조 가설 없음");
    }
    const totals = financingTotals(projectId, db as unknown as Parameters<typeof financingTotals>[1]);
    lines.push(`- 자금조달: 조달 ${num(totals.sources)} / 운용 ${num(totals.uses)} 백만 KRW (균형 ${totals.sources === totals.uses ? "OK" : "불일치"})`);
  } catch {
    lines.push("- 투자구조 데이터 없음");
  }
  lines.push("");

  sections.push("진행 이력");
  // ADR-0186 D6: the history prints what was RECORDED, labelled when an IC GO still awaits its countersign.
  const gates = latestGateDecisions("project", projectId, { raw: true });
  lines.push("## 6. 의사결정 이력");
  lines.push("");
  const gateEntries = [...gates.entries()] as Array<[GateId, { decision: string; rationale: string; awaitingCountersign: boolean }]>;
  if (gateEntries.length === 0) {
    lines.push("- 기록된 의사결정 없음");
  } else {
    for (const [gate, v] of gateEntries) lines.push(`- ${gate}: ${v.decision}${v.awaitingCountersign ? " (awaiting countersign)" : ""} — ${v.rationale}`);
  }
  lines.push("");

  // Pipeline snapshot — blockers the reviewer must clear (same briefing the
  // pause notifications attach, per ADR-0104 E1).
  lines.push("## 7. 파이프라인 스냅샷");
  lines.push("");
  lines.push(buildBriefingPack(db, { type: "project", id: projectId }));
  lines.push("");

  // 2026-10-21 (decider: 보고서가 전체 진행결과를 구체적으로 담을 것) — S9~S12의
  // 실제 판정·수치를 섹션 8~11로 추가한다. 모두 기존 원장의 계산값이며, 근거 없는
  // 숫자는 만들지 않는다.
  sections.push("리스크 히트맵");
  lines.push("## 8. 리스크 히트맵 요약");
  lines.push("");
  try {
    const heat = heatmapSnapshot(buildRiskHeatmap(db, projectId), 5);
    if (heat.total === 0) {
      lines.push("- 플로팅된 리스크 없음 (DD·계약 CoC·클로백·커버넌트 기록 없음)");
    } else {
      lines.push(`- 항목 ${heat.total}건 — 높음 ${heat.counts.high} · 중간 ${heat.counts.mid} · 낮음 ${heat.counts.low} (스냅샷 ${heat.snapshot_hash})`);
      for (const t of heat.top) lines.push(`  - [${t.severity}] ${t.label} (${t.likelihood}×${t.impact}${t.assessed ? ", 사람 판정" : ""}${t.mitigation ? ` — 완화: ${t.mitigation}` : ""})`);
    }
  } catch {
    lines.push("- 리스크 히트맵 산출 실패");
  }
  lines.push("");

  sections.push("자금 확정성·커버넌트");
  lines.push("## 9. 자금 확정성 및 커버넌트 여력");
  lines.push("");
  try {
    const certainty = financingCertainty(projectId, db as unknown as Parameters<typeof financingCertainty>[1]);
    lines.push(`- 조달 ${certainty.source_lines}건 중 증빙 ${certainty.evidenced_lines}건 · 미증빙 ${certainty.unevidenced_lines}건 (${certainty.unevidenced_amount_krw_m} 백만 KRW)`);
    const cov = covenantHeadroom(db as unknown as Parameters<typeof covenantHeadroom>[0], projectId);
    if (cov.status === "computed") {
      for (const c of cov.covenants) lines.push(`- 커버넌트 ${c.covenant_key}: ${c.status}${c.min_headroom_pct != null ? ` (최소 여력 ${Math.round(c.min_headroom_pct * 1000) / 10}%)` : ""}`);
    } else {
      lines.push(cov.reason === "no_debt" ? "- 커버넌트 여력: 차입 없음" : `- 커버넌트 여력: 계산 불가 (근거 부족) — ${cov.message ?? ""}`);
    }
  } catch {
    lines.push("- 자금 데이터 없음");
  }
  lines.push("");

  sections.push("인허가·인증 현황");
  lines.push("## 10. 인허가·인증 현황");
  lines.push("");
  try {
    const permits = db.query("SELECT name, status FROM permit WHERE project_id = ? ORDER BY rowid").all(projectId) as Array<{ name: string; status: string }>;
    const certs = db.query("SELECT name, status FROM certification WHERE project_id = ? ORDER BY rowid").all(projectId) as Array<{ name: string; status: string }>;
    if (permits.length === 0 && certs.length === 0) lines.push("- 등록된 인허가·인증 없음");
    for (const p of permits) lines.push(`- [허가] ${p.name} — ${p.status}`);
    for (const c of certs) lines.push(`- [인증] ${c.name} — ${c.status}`);
  } catch {
    lines.push("- 인허가·인증 데이터 없음");
  }
  lines.push("");

  sections.push("마일스톤");
  lines.push("## 11. 마일스톤 요약");
  lines.push("");
  try {
    const ms = milestoneSummary(db, projectId);
    if (ms.total === 0) lines.push("- 등록된 마일스톤 없음");
    else lines.push(`- 전체 ${ms.total}건 — 지연 ${ms.overdue} · 임박 ${ms.due_soon} · 완료 ${ms.done}`);
  } catch {
    lines.push("- 마일스톤 데이터 없음");
  }
  lines.push("");

  sections.push("투자심사 절차 상태");
  lines.push("## 12. 투자심사 절차 단계");
  lines.push("");
  try {
    const steps = icReviewStepsView(db, projectId).entity;
    for (const s of steps) lines.push(`- step ${s.id} ${s.title}: ${s.status}`);
  } catch {
    lines.push("- 절차 단계 산출 실패");
  }
  lines.push("");

  const markdown = lines.join("\n");
  return {
    title: `투자 검토 보고서 — ${projectName}`,
    markdown,
    sections,
  };
}

function parseNote(note: string | null | undefined): Record<string, string> {
  if (!note) return {};
  const out: Record<string, string> = {};
  for (const part of note.split("; ")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
