// Briefing pack (E1, ADR-0104 §pipeline) — deterministic Markdown the auto
// pipeline attaches to every paused_for_human notification, so the human
// reviewer starts the committee deliberation from one artifact: process
// snapshot, track advisory, charter, DD/IC status, and deep links.
import type { Database } from "bun:sqlite";
import { evaluateProcess, type ProcessEntity } from "./process-flow.ts";
import { computeTrackAdvisory } from "./track-advisory.ts";

export function buildBriefingPack(db: Database, entity: ProcessEntity): string {
  const lines: string[] = [];
  const evaluation = evaluateProcess(entity);
  const label = entity.type === "project" ? evaluation.stages.find((s) => s.status === "current")?.name ?? "—" : entity.id;

  lines.push(`# 파이프라인 브리핑 팩 — ${entity.type}:${entity.id}`);
  lines.push("");
  lines.push(`- 트랙: ${evaluation.track ?? "미결정"}${evaluation.subTrack ? ` / ${evaluation.subTrack}` : ""}`);
  lines.push(`- 현재 단계: ${evaluation.currentStage ?? "—"} (${label}) · 다음: ${evaluation.nextStage ?? "—"}${evaluation.terminated ? " · KILL 종료" : ""}`);
  lines.push("- 게이트: " + Object.entries(evaluation.gateStatus).map(([g, v]) => `${g}=${v}`).join(", "));
  lines.push("");

  if (evaluation.blockers.length) {
    lines.push("## 차단 요건");
    for (const b of evaluation.blockers) lines.push(`- ${b}`);
    lines.push("");
  }

  lines.push("## 단계별 상태");
  for (const s of evaluation.stages) {
    lines.push(`- ${s.id} ${s.name}: ${s.status}`);
  }
  lines.push("");

  // Track advisory (opportunity branch) — the S4 decision evidence.
  const oppId = entity.type === "opportunity"
    ? entity.id
    : (db.query("SELECT source_opportunity_id AS id FROM md_project WHERE id = ?").get(entity.id) as { id: string | null } | undefined)?.id ?? null;
  if (oppId) {
    try {
      const advisory = computeTrackAdvisory(db, oppId);
      lines.push("## 트랙 어드바이저");
      lines.push(`- 권고: ${advisory.recommendedTrack} (greenfield ${advisory.greenfieldScore} : brownfield ${advisory.brownfieldScore})`);
      for (const s of advisory.signals) lines.push(`- [${s.leans}] ${s.label} — ${s.note}`);
      for (const t of advisory.reReviewTriggers) lines.push(`- 재검토: ${t}`);
      lines.push("");
    } catch { /* advisory is best-effort context */ }
  }

  lines.push("---");
  lines.push("이 팩은 파이프라인이 자동 생성한 요약입니다. 판정과 승인은 사람의 몫입니다 (경계 #2).");
  return lines.join("\n");
}
