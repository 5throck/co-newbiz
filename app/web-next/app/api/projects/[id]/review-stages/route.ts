// GET/POST /api/projects/:id/review-stages — the 3-stage review pipeline's
// persistence layer (design §10.1-2: AI 1st -> AI 2nd, from a DIFFERENT
// domain than the 1st-stage author -> human final). The review_stage table
// existed since db/migrations/0011 but had no repository/API/UI consumer
// anywhere (design doc §20.3, 2026-08-28 audit) — this route is that
// consumer.
//
// unverified_items_json is required on every write (never defaulted to
// "[]" silently) — the design's "no PASS stamp" rule means an AI reviewer
// must explicitly declare what it could NOT check, even if the answer is
// an empty list; omitting the field entirely is refused, not defaulted.
//
// Cross-domain enforcement (design §5.7): an ai_2nd stage is rejected if
// its reviewer_domain matches the run's ai_1st stage reviewer_domain — a
// same-domain reviewer only counts as a repeated 1st-stage pass, never a
// real 2nd stage, because author and reviewer would share the same blind
// spots.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id");

  const db = getDb();
  const rows = runId
    ? db
        .query(
          `SELECT rs.id, rs.run_id, rs.stage, rs.reviewer_agent_or_user, rs.reviewer_domain, rs.unverified_items_json, rs.result, rs.created_at
           FROM review_stage rs JOIN run r ON r.id = rs.run_id
           WHERE rs.run_id = ? AND r.project_id = ? ORDER BY rs.created_at`,
        )
        .all(runId, project.id)
    : db
        .query(
          `SELECT rs.id, rs.run_id, rs.stage, rs.reviewer_agent_or_user, rs.reviewer_domain, rs.unverified_items_json, rs.result, rs.created_at
           FROM review_stage rs JOIN run r ON r.id = rs.run_id
           WHERE r.project_id = ? ORDER BY rs.created_at DESC`,
        )
        .all(project.id);
  return ok(rows, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  const { id } = await params;
  const project = visibleProject(ctx, id);
  if (!project) return notFound();
  if (ctx.role === "viewer") return forbidden("role_required", "Review stages are recorded by analysts.");

  const body = (await request.json().catch(() => null)) as
    | {
      run_id?: string;
      stage?: string;
      reviewer_agent_or_user?: string;
      reviewer_domain?: string;
      unverified_items?: string[];
      result?: string;
    }
    | null;
  if (!body?.run_id?.trim()) return badRequest("invalid_request", "run_id is required.");
  if (body.stage !== "ai_1st" && body.stage !== "ai_2nd" && body.stage !== "human_final") {
    return badRequest("invalid_request", "stage must be one of ai_1st | ai_2nd | human_final.");
  }
  if (!body.reviewer_agent_or_user?.trim()) return badRequest("invalid_request", "reviewer_agent_or_user is required.");
  if (!Array.isArray(body.unverified_items)) {
    return badRequest(
      "invalid_request",
      "unverified_items must be an array (possibly empty) — the reviewer must explicitly declare what it could not check, never omit the field.",
    );
  }

  const db = getDb();
  const run = db.query("SELECT id, project_id FROM run WHERE id = ?").get(body.run_id) as { id: string; project_id: string } | null;
  if (!run || run.project_id !== project.id) return badRequest("invalid_request", "run_id does not belong to this project.");

  if (body.stage === "ai_2nd") {
    const firstStage = db
      .query("SELECT reviewer_domain FROM review_stage WHERE run_id = ? AND stage = 'ai_1st' ORDER BY created_at LIMIT 1")
      .get(body.run_id) as { reviewer_domain: string | null } | null;
    if (firstStage?.reviewer_domain && body.reviewer_domain && firstStage.reviewer_domain === body.reviewer_domain) {
      return badRequest(
        "same_domain_review",
        `An ai_2nd review from the same domain ("${body.reviewer_domain}") as the ai_1st reviewer only counts as a repeated 1st-stage pass, per design §5.7 — a real 2nd stage requires a different domain.`,
      );
    }
  }

  const now = new Date().toISOString();
  const rowId = ulid();
  db.run(
    "INSERT INTO review_stage (id, run_id, stage, reviewer_agent_or_user, reviewer_domain, unverified_items_json, result, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [rowId, body.run_id, body.stage, body.reviewer_agent_or_user.trim(), body.reviewer_domain?.trim() || null, JSON.stringify(body.unverified_items), body.result?.trim() || null, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "review_stage_create", target: `${project.id}:${body.run_id}:${body.stage}`, now });
  return ok({ id: rowId }, 201);
}
