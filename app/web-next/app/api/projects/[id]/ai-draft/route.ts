// AI draft endpoint — generates rationale drafts and evidence summaries for
// a deal from persisted data. Uses the LLM when configured (multi-provider,
// lib/llm.ts) and falls back to deterministic synthesis otherwise. Drafts
// are explicitly non-final: a human reviews/edits before anything is decided.
import { getDb } from "../../../../../../../db/client.ts";
import { completeOrFallback } from "../../../../../lib/llm.ts";
import { loadSpec } from "../../../../../lib/agent-orchestrator.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

function dealSnapshot(projectId: string, projectNo: string): string {
  const db = getDb();
  const lines: string[] = [`딜: ${projectNo}`];
  const rag = db
    .query("SELECT grade FROM rag_assessment WHERE project_id = ? AND dimension = 'overall' ORDER BY assessed_at DESC LIMIT 1")
    .get(projectId) as { grade: string } | null;
  lines.push(`- 종합 RAG: ${rag ? rag.grade.toUpperCase() : "미평가"}`);
  const runs = db.query("SELECT COUNT(*) c FROM run WHERE project_id = ?").get(projectId) as { c: number };
  const sims = db
    .query(
      `SELECT COUNT(*) c FROM simulation s JOIN run r ON r.id = s.run_id WHERE r.project_id = ?`,
    )
    .get(projectId) as { c: number };
  lines.push(`- 런 ${runs.c}건 · 시뮬레이션 ${sims.c}건`);
  const findings = db
    .query("SELECT COUNT(*) c FROM dd_finding WHERE project_id = ?")
    .get(projectId) as { c: number };
  lines.push(`- DD 조사내역 ${findings.c}건`);
  const checks = db
    .query(
      `SELECT checklist_id, status, COUNT(*) c FROM project_checklist_item_state
       WHERE project_id = ? GROUP BY checklist_id, status`,
    )
    .all(projectId) as Array<{ checklist_id: string; status: string; c: number }>;
  if (checks.length > 0) {
    lines.push(
      `- 체크리스트 판정: ${checks.map((c) => `${c.checklist_id.replace("chk-", "").replace("-checklist", "")} ${c.status}×${c.c}`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "AI drafts require the analyst role.");
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as {
    kind?: "checklist_item" | "gate_decision" | "evidence_summary";
    item_text?: string;
  } | null;
  const kind = body?.kind ?? "evidence_summary";

  const snapshot = dealSnapshot(project.id, project.project_no);
  let subject: string;
  if (kind === "checklist_item") {
    subject = `체크리스트 항목: ${body?.item_text ?? "(항목 미지정)"}`;
  } else if (kind === "gate_decision") {
    subject = "게이트 판정(Screening/Pre-FS/FS/DD) 근거";
  } else {
    subject = "딜 자료 요약";
  }

  const messages = [
    {
      role: "system" as const,
      content:
        "당신은 신규사업 검토 팀의 애널리스트 보조 AI입니다. 저장된 딜 데이터에 근거해 한국어 마크다운 초안을 작성합니다. 데이터에 없는 사실을 만들지 마세요.",
    },
    {
      role: "user" as const,
      content: [subject, "", "## 저장된 딜 데이터", snapshot].join("\n"),
    },
  ];

  const fallbackText = () => {
    if (kind === "evidence_summary") return snapshot;
    return `${subject}\n\n- 근거: 저장된 딜 데이터 기준 자동 합성 (LLM 미연결 시 결정론적 요약)`;
  };

  const out = await completeOrFallback(messages, fallbackText, { maxTokens: 1200 });
  return ok({ kind, text: out.text, source: out.source, provider: out.provider }, 200);
}
