// Project activity timeline — the deal's persisted workflow artifacts in one
// reverse-chronological feed: model runs, simulations, DD checklist
// assessments, DD findings, RAG assessments, review stages, and report
// snapshots. Read-only projection; each entry links its actor and timestamp
// so "누가 언제 무엇을 했는지" stays answerable from the UI alone.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

interface ActivityEntry {
  ts: string;
  kind: string;
  label: string;
  actor: string | null;
  ref: string;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const db = getDb();
  const entries: ActivityEntry[] = [];

  for (const r of db
    .query("SELECT id, label, created_by, created_at FROM run WHERE project_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(project.id) as Array<{ id: string; label: string | null; created_by: string; created_at: string }>) {
    entries.push({ ts: r.created_at, kind: "run", label: `모델 런: ${r.label ?? "(제목 없음)"}`, actor: r.created_by, ref: r.id });
  }
  for (const s of db
    .query(
      `SELECT s.id, s.iterations, s.created_at, r.created_by FROM simulation s JOIN run r ON r.id = s.run_id
       WHERE r.project_id = ? ORDER BY s.created_at DESC LIMIT 50`,
    )
    .all(project.id) as Array<{ id: string; iterations: number; created_at: string; created_by: string }>) {
    entries.push({ ts: s.created_at, kind: "simulation", label: `시뮬레이션 실행 (${s.iterations}회)`, actor: s.created_by, ref: s.id });
  }
  for (const a of db
    .query(
      "SELECT checklist_id, item_id, status, assessed_by, assessed_at FROM project_checklist_item_state WHERE project_id = ? ORDER BY assessed_at DESC LIMIT 100",
    )
    .all(project.id) as Array<{ checklist_id: string; item_id: string; status: string; assessed_by: string; assessed_at: string }>) {
    entries.push({
      ts: a.assessed_at,
      kind: "dd_assessment",
      label: `DD 판정: ${a.checklist_id.replace("chk-", "").replace("-checklist", "")} ${a.item_id} → ${a.status}`,
      actor: a.assessed_by,
      ref: `${a.checklist_id}:${a.item_id}`,
    });
  }
  for (const f of db
    .query("SELECT id, category, description, created_at FROM dd_finding WHERE project_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(project.id) as Array<{ id: string; category: string; description: string; created_at: string }>) {
    entries.push({ ts: f.created_at, kind: "dd_finding", label: `조사내역 [${f.category}]: ${f.description.slice(0, 60)}`, actor: null, ref: f.id });
  }
  for (const r of db
    .query(
      "SELECT dimension, grade, assessed_at FROM rag_assessment WHERE project_id = ? ORDER BY assessed_at DESC LIMIT 20",
    )
    .all(project.id) as Array<{ dimension: string; grade: string; assessed_at: string }>) {
    entries.push({ ts: r.assessed_at, kind: "rag", label: `RAG 평가(${r.dimension}): ${r.grade.toUpperCase()}`, actor: null, ref: "" });
  }
  for (const r of db
    .query(
      `SELECT rs.stage, rs.result, rs.reviewer_agent_or_user AS reviewer, rs.created_at
       FROM review_stage rs JOIN run r ON r.id = rs.run_id
       WHERE r.project_id = ? ORDER BY rs.created_at DESC LIMIT 30`,
    )
    .all(project.id) as Array<{ stage: string; result: string; reviewer: string; created_at: string }>) {
    entries.push({ ts: r.created_at, kind: "review", label: `검토(${r.stage}): ${r.result} — ${r.reviewer}`, actor: r.reviewer, ref: "" });
  }
  for (const s of db
    .query("SELECT id, title, created_by, created_at FROM report_snapshot WHERE project_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(project.id) as Array<{ id: string; title: string; created_by: string; created_at: string }>) {
    entries.push({ ts: s.created_at, kind: "snapshot", label: `보고서 스냅샷: ${s.title}`, actor: s.created_by, ref: s.id });
  }

  entries.sort((a, b) => b.ts.localeCompare(a.ts));
  const limited = entries.slice(0, 100);
  return ok(limited, 200, { count: limited.length });
}
