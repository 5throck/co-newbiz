// GET/POST /api/portfolio/backtest/proposals — data-confidence grade
// adjustment proposals (ADR-0123 #3: "grade adjustments are proposed,
// human-approved"; migration 0161). GET lists proposals with the current
// backtest bias; POST takes one action: `propose` (a person files a proposal —
// the bias statistics are captured server-side at filing time), `approve` or
// `reject` (a different person decides, with a rationale — the proposer cannot
// decide their own proposal). An APPROVED row lowers the
// RAG data-confidence cap (rag-service.approvedConfidenceAdjustment) — it can
// only tighten, never loosen (boundary #4). Analyst+ for every write, audited.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { runBacktest } from "../../../../../lib/backtest.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

const GRADES = new Set(["A", "B", "C"]);

export interface ProposalRow {
  id: string;
  scope: "org" | "project";
  project_id: string | null;
  proposed_grade: "A" | "B" | "C";
  bias_stats_json: string;
  rationale: string;
  status: "proposed" | "approved" | "rejected";
  proposed_by: string;
  proposed_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_rationale: string | null;
}

function listProposals(db: ReturnType<typeof getDb>): ProposalRow[] {
  return db
    .query("SELECT * FROM confidence_grade_adjustment_proposal ORDER BY proposed_at DESC, id DESC LIMIT 100")
    .all() as ProposalRow[];
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const bias = runBacktest(db, () => false).org.bias;
  const proposals = listProposals(db);
  return ok({ proposals, bias }, 200, { count: proposals.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "신뢰도 등급 조정 제안·결정은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const db = getDb();
  const now = new Date().toISOString();

  if (action === "propose") {
    const scope = body?.scope === "project" ? "project" : body?.scope === "org" ? "org" : null;
    if (!scope) return badRequest("invalid_request", "scope는 org 또는 project여야 합니다.");
    const grade = typeof body?.proposed_grade === "string" ? body.proposed_grade.toUpperCase() : "";
    if (!GRADES.has(grade)) return badRequest("invalid_request", "proposed_grade는 A | B | C 중 하나입니다.");
    const rationale = typeof body?.rationale === "string" ? body.rationale.trim() : "";
    if (rationale.length < 10) return badRequest("invalid_request", "rationale은 10자 이상이어야 합니다 — 등급 조정 제안은 근거 없이 기록될 수 없습니다.");
    let projectId: string | null = null;
    if (scope === "project") {
      projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
      if (!projectId) return badRequest("invalid_request", "project 범위 제안에는 project_id가 필요합니다.");
      if (!visibleProject(auth.auth, projectId, { includeClosed: true })) return notFound();
    }
    const backtest = runBacktest(db, (pid) => pid === projectId);
    const projectRow = projectId ? backtest.rows.find((r) => r.project_id === projectId) ?? null : null;
    const biasStats = { org: backtest.org, project: projectRow, captured_at: now };
    const id = ulid();
    db.run(
      `INSERT INTO confidence_grade_adjustment_proposal
         (id, scope, project_id, proposed_grade, bias_stats_json, rationale, status, proposed_by, proposed_at)
       VALUES (?,?,?,?,?,?,'proposed',?,?)`,
      [id, scope, projectId, grade, JSON.stringify(biasStats), rationale, auth.auth.userId, now],
    );
    appendAudit(db, { actor: auth.auth.userId, action: "confidence_grade_adjustment.proposed", target: `${scope}:${projectId ?? "org"}:${grade}:${id}`, now });
    return ok({ id, scope, project_id: projectId, proposed_grade: grade, status: "proposed", bias: backtest.org.bias }, 201);
  }

  if (action === "approve" || action === "reject") {
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return badRequest("invalid_request", "id는 필수입니다.");
    const decisionRationale = typeof body?.decision_rationale === "string" ? body.decision_rationale.trim() : "";
    if (decisionRationale.length < 5) return badRequest("invalid_request", "decision_rationale은 5자 이상이어야 합니다.");
    const row = db.query("SELECT * FROM confidence_grade_adjustment_proposal WHERE id = ?").get(id) as ProposalRow | undefined;
    if (!row) return notFound();
    if (row.status !== "proposed") return badRequest("invalid_state", `이미 ${row.status} 상태인 제안은 다시 결정할 수 없습니다 — 새 제안을 올리세요.`);
    // 2026-10-21 (decider: proceed with the remaining work) — two-person rule: the
    // person who filed the proposal cannot be the one who decides it.
    if (row.proposed_by === auth.auth.userId) return badRequest("self_decision_not_allowed", "제안자는 자신의 제안을 승인·반려할 수 없습니다 — 다른 analyst+가 결정해야 합니다.");
    if (row.scope === "project" && row.project_id && !visibleProject(auth.auth, row.project_id, { includeClosed: true })) return notFound();
    const status = action === "approve" ? "approved" : "rejected";
    db.run(
      "UPDATE confidence_grade_adjustment_proposal SET status = ?, decided_by = ?, decided_at = ?, decision_rationale = ? WHERE id = ? AND status = 'proposed'",
      [status, auth.auth.userId, now, decisionRationale, id],
    );
    appendAudit(db, { actor: auth.auth.userId, action: `confidence_grade_adjustment.${status}`, target: `${row.scope}:${row.project_id ?? "org"}:${row.proposed_grade}:${id}`, now });
    return ok({ id, status, decided_by: auth.auth.userId, decided_at: now }, 200);
  }

  return badRequest("invalid_action", "action은 propose | approve | reject 중 하나여야 합니다.");
}
