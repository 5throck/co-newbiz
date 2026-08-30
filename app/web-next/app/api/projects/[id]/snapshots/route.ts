// Report snapshots — persist the current state of a deal's analysis as a
// point-in-time markdown record (조사결과 영속화). POST assembles the snapshot
// from persisted data only (runs, simulations, RAG, DD checklist progress,
// review stages); GET lists; each snapshot is immutable once written.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { DD_WORKSPACE_CHECKLISTS, getChecklistItems } from "../../../../../lib/library.ts";

const nf = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

function buildSnapshotMarkdown(projectId: string, projectNo: string, actor: string): string {
  const db = getDb();
  const lines: string[] = [];
  const now = new Date();
  lines.push(`# 신규사업 검토 스냅샷 — ${projectNo}`);
  lines.push("");
  lines.push(`- 작성: ${actor} / ${now.toISOString().slice(0, 16).replace("T", " ")} (UTC)`);

  // RAG overall
  const rag = db
    .query(
      "SELECT grade, assessed_at FROM rag_assessment WHERE project_id = ? AND dimension = 'overall' ORDER BY assessed_at DESC, id DESC LIMIT 1",
    )
    .get(projectId) as { grade: string; assessed_at: string } | null;
  lines.push(`- 종합 RAG: ${rag ? `${rag.grade.toUpperCase()} (${rag.assessed_at.slice(0, 10)})` : "미평가"}`);

  // Gate stage
  const proj = db.query("SELECT current_stage_gate FROM md_project WHERE id = ?").get(projectId) as
    | { current_stage_gate: string | null }
    | null;
  lines.push(`- 현재 게이트: ${proj?.current_stage_gate ?? "-"}`);

  // Runs
  const runs = db
    .query("SELECT label, created_by, created_at, superseded_by FROM run WHERE project_id = ? ORDER BY created_at DESC LIMIT 5")
    .all(projectId) as Array<{ label: string | null; created_by: string; created_at: string; superseded_by: string | null }>;
  lines.push("", "## 모델 런 이력");
  if (runs.length === 0) lines.push("- 없음");
  for (const r of runs) {
    lines.push(`- ${r.created_at.slice(0, 16).replace("T", " ")} · ${r.label ?? "(제목 없음)"} · ${r.created_by}${r.superseded_by ? " (superseded)" : ""}`);
  }

  // Simulations (NPV)
  const sims = db
    .query(
      `SELECT s.id, s.iterations, s.discount_rate, s.created_at, r.label AS run_label, sr.p05, sr.p50, sr.p95, sr.mean
       FROM simulation s JOIN run r ON r.id = s.run_id
       LEFT JOIN simulation_result sr ON sr.simulation_id = s.id AND sr.metric = 'npv'
       WHERE r.project_id = ? ORDER BY s.created_at DESC LIMIT 5`,
    )
    .all(projectId) as Array<{ id: string; iterations: number; discount_rate: number; created_at: string; run_label: string | null; p05: number | null; p50: number | null; p95: number | null; mean: number | null }>;
  lines.push("", "## 시뮬레이션 (NPV, KRM)");
  if (sims.length === 0) lines.push("- 없음");
  for (const s of sims) {
    lines.push(
      `- ${s.created_at.slice(0, 16).replace("T", " ")} · ${s.iterations}회 · 할인율 ${(s.discount_rate * 100).toFixed(1)}% · P05 ${s.p05 !== null ? nf.format(s.p05) : "-"} / 평균 ${s.mean !== null ? nf.format(s.mean) : "-"}`,
    );
  }

  // DD checklist progress
  lines.push("", "## DD 체크리스트 진척");
  for (const [kind, checklistId] of Object.entries(DD_WORKSPACE_CHECKLISTS)) {
    const items = getChecklistItems(checklistId);
    if (!items || items.length === 0) continue;
    const ids = items.map((i) => i.id);
    const states = db
      .query(
        `SELECT item_id, status FROM project_checklist_item_state
         WHERE project_id = ? AND checklist_id = ?`,
      )
      .all(projectId, checklistId) as Array<{ item_id: string; status: string }>;
    const byId = new Map(states.map((s) => [s.item_id, s.status]));
    const assessed = ids.filter((i) => byId.get(i) && byId.get(i) !== "pending").length;
    const mandatoryOpen = items.filter((i) => i.mandatory && !["pass", "na", "waived"].includes(byId.get(i.id) ?? "pending"));
    lines.push(`- ${kind.toUpperCase()}: ${assessed}/${items.length} 판정, 필수 미충족 ${mandatoryOpen.length}건`);
  }

  // DD findings count
  const findingCount = db
    .query("SELECT COUNT(*) AS c FROM dd_finding WHERE project_id = ?")
    .get(projectId) as { c: number };
  lines.push("", `## 실사 조사내역: ${findingCount.c}건`, "");

  // Review stages
  const reviews = db
    .query("SELECT rs.stage, rs.reviewer_agent_or_user AS reviewer, rs.created_at AS decided_at, r.project_id FROM review_stage rs JOIN run r ON r.id = rs.run_id WHERE r.project_id = ? ORDER BY rs.created_at DESC LIMIT 3")
    .all(projectId) as Array<{ stage: string; reviewer: string; decided_at: string }>;
  lines.push("## 검토 현황");
  if (reviews.length === 0) lines.push("- 없음");
  for (const r of reviews) lines.push(`- ${r.stage} · ${r.reviewer} · ${r.decided_at.slice(0, 10)}`);

  lines.push("", "> 본 스냅샷은 작성 시점의 저장된 분석 결과를 그대로 기록한 것입니다.");
  return lines.join("\n");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const rows = getDb()
    .query(
      "SELECT id, title, created_by, created_at FROM report_snapshot WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(project.id);
  return ok(rows, 200, { count: (rows as unknown[]).length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") {
    return forbidden("role_required", "Report snapshots are created by analysts.");
  }
  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  const now = new Date();
  const title =
    body?.title?.trim() ||
    `스냅샷 ${now.toISOString().slice(0, 16).replace("T", " ")}`;

  const contentMd = buildSnapshotMarkdown(project.id, project.project_no, ctx.userId);
  if (!contentMd.trim()) return badRequest("empty_snapshot", "Snapshot assembly produced no content.");

  const db = getDb();
  const snapId = ulid();
  db.run(
    "INSERT INTO report_snapshot (id, project_id, title, content_md, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [snapId, project.id, title, contentMd, ctx.userId, now.toISOString()],
  );
  appendAudit(db, { actor: ctx.userId, action: "report_snapshot_create", target: `${project.project_no}:${snapId}`, now: now.toISOString() });
  return ok({ id: snapId, title, created_at: now.toISOString() }, 201);
}
