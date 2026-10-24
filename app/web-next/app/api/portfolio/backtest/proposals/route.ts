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
import { route } from "../../../../../lib/route.ts";
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

export const GET = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const bias = runBacktest(db, () => false).org.bias;
  const proposals = listProposals(db);
  return ok({ proposals, bias }, 200, { count: proposals.length });
});

export const POST = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Reliability-grade adjustment proposals/decisions requires the analyst role or higher." });
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const db = getDb();
  const now = new Date().toISOString();

  if (action === "propose") {
    const scope = body?.scope === "project" ? "project" : body?.scope === "org" ? "org" : null;
    if (!scope) return badRequest("invalid_request", "scope must be org or project.");
    const grade = typeof body?.proposed_grade === "string" ? body.proposed_grade.toUpperCase() : "";
    if (!GRADES.has(grade)) return badRequest("invalid_request", "proposed_grade must be one of: A | B | C.");
    const rationale = typeof body?.rationale === "string" ? body.rationale.trim() : "";
    if (rationale.length < 10) return badRequest("invalid_request", "rationale must be at least 10 characters — grade adjustment proposals cannot be recorded without a basis.");
    let projectId: string | null = null;
    if (scope === "project") {
      projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
      if (!projectId) return badRequest("invalid_request", "A project-scope proposal requires project_id.");
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
    if (!id) return badRequest("invalid_request", "id is required.");
    const decisionRationale = typeof body?.decision_rationale === "string" ? body.decision_rationale.trim() : "";
    if (decisionRationale.length < 5) return badRequest("invalid_request", "decision_rationale must be at least 5 characters.");
    const row = db.query("SELECT * FROM confidence_grade_adjustment_proposal WHERE id = ?").get(id) as ProposalRow | undefined;
    if (!row) return notFound();
    if (row.status !== "proposed") return badRequest("invalid_state", `A proposal already in ${row.status} cannot be decided again — submit a new proposal.`);
    // 2026-10-21 (decider: proceed with the remaining work) — two-person rule: the
    // person who filed the proposal cannot be the one who decides it.
    if (row.proposed_by === auth.auth.userId) return badRequest("self_decision_not_allowed", "A proposer cannot approve/reject their own proposal — another analyst+ must decide.");
    if (row.scope === "project" && row.project_id && !visibleProject(auth.auth, row.project_id, { includeClosed: true })) return notFound();
    const status = action === "approve" ? "approved" : "rejected";
    db.run(
      "UPDATE confidence_grade_adjustment_proposal SET status = ?, decided_by = ?, decided_at = ?, decision_rationale = ? WHERE id = ? AND status = 'proposed'",
      [status, auth.auth.userId, now, decisionRationale, id],
    );
    appendAudit(db, { actor: auth.auth.userId, action: `confidence_grade_adjustment.${status}`, target: `${row.scope}:${row.project_id ?? "org"}:${row.proposed_grade}:${id}`, now });
    return ok({ id, status, decided_by: auth.auth.userId, decided_at: now }, 200);
  }

  return badRequest("invalid_action", "action must be one of: propose | approve | reject.");
});
