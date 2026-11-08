// Single opportunity — update (status transitions, scoring, rationale).
// Status moves identified→assessed→selected|dropped; decided_by/decided_at
// are stamped when the row reaches a terminal-or-selected state.
import { getDb } from "../../../../../../db/client.ts";
import { readEntryMarketRecord, readTargetScope } from "../../../../../../db/repositories/entry-market.repository.ts";
import { appendAudit } from "../../../../../../db/lib/access-control.ts";
import { getSystemMode } from "../../../../../../db/lib/system-mode.ts";
import { recordDealArchive } from "../../../../lib/deal-archive.ts";
import { authenticate, requireBusinessActor } from "../../../../lib/auth.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../lib/envelope.ts";

const STATUSES = new Set(["identified", "assessed", "selected", "dropped"]);

// Fetching by id is "I already know this row, show it to me" — unlike the
// list endpoint (GET /api/opportunities, which correctly hides deleted rows
// from active work views), a direct id lookup must still resolve a deleted
// or promoted-then-archived opportunity so its S1~S7 history (e.g. the S4
// route decision that led to its promotion) stays viewable. The caller
// decides how to present deleted_at (read-only banner, etc).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  {
    const denied = requireBusinessActor(auth.auth, "read");
    if (denied) return denied;
  }
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT * FROM opportunity WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return notFound();
  // ADR-0181 slice 1 — additive normalized entry-market fields. The frozen
  // JSON storage columns still ride the row for legacy rows, but the
  // normalized source of truth is the 0151 tables via the repository.
  return ok(
    {
      ...row,
      // authoritative "S4 confirmed": a current final route decision (ADR-0135; drafts are never current)
      route_confirmed: (
        db
          .query("SELECT EXISTS (SELECT 1 FROM route_decision WHERE opportunity_id = ? AND is_current = 1) AS c")
          .get(id) as { c: number }
      ).c,
      target_scope: readTargetScope(db, id),
      entry_market_meta: readEntryMarketRecord(db, id),
    },
    200,
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Opportunity updates require the analyst role.",
    });
    if (denied) return denied;
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    market_scope?: string;
    value_chain_node?: string;
    market_size_krw_m?: number;
    growth_rate?: number;
    attractiveness_score?: number | null;
    synergy_score?: number | null;
    status?: string;
    rationale?: string;
    industry_id?: string | null;
  } | null;
  if (!body) return badRequest("invalid_request", "body required.");
  if (body.status === "dropped") {
    return fail(
      409,
      "typed_closure_required",
      "Dropping an opportunity must go through POST /api/opportunities/[id]/close with closureType, reason, and learning capture (ADR-0152).",
    );
  }
  if (body.status && !STATUSES.has(body.status)) {
    return badRequest("invalid_request", `status must be one of ${[...STATUSES].join("|")}.`);
  }
  const score = (v: number | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (!Number.isInteger(v) || v < 0 || v > 100) throw new Error("scores must be integers 0-100");
    return v;
  };
  let attractiveness: number | null | undefined, synergy: number | null | undefined;
  try {
    attractiveness = score(body.attractiveness_score);
    synergy = score(body.synergy_score);
  } catch (err) {
    return badRequest("invalid_request", err instanceof Error ? err.message : "invalid score");
  }

  const db = getDb();
  const existing = db.query("SELECT id, status FROM opportunity WHERE id = ?").get(id) as {
    id: string;
    status: string;
  } | null;
  if (!existing) return notFound();
  // Wave C-3 (D-3): link (or, with null/"", unlink) the analysed S1 industry.
  const industryProvided = body.industry_id !== undefined;
  const industryId = body.industry_id?.trim() || null;
  if (industryId && !db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) {
    return badRequest("invalid_industry", "industry_id does not exist in md_industry.");
  }

  const now = new Date().toISOString();
  const terminal = body.status === "selected" || body.status === "dropped";
  db.run(
    `UPDATE opportunity SET
       name = COALESCE(?, name),
       market_scope = COALESCE(?, market_scope),
       value_chain_node = COALESCE(?, value_chain_node),
       market_size_krw_m = COALESCE(?, market_size_krw_m),
       growth_rate = COALESCE(?, growth_rate),
       attractiveness_score = COALESCE(?, attractiveness_score),
       synergy_score = COALESCE(?, synergy_score),
       status = COALESCE(?, status),
       rationale = COALESCE(?, rationale),
       industry_id = CASE WHEN ? THEN ? ELSE industry_id END,
       decided_by = CASE WHEN ? THEN ? ELSE decided_by END,
       decided_at = CASE WHEN ? THEN ? ELSE decided_at END
     WHERE id = ?`,
    [
      body.name?.trim() ?? null,
      body.market_scope?.trim() ?? null,
      body.value_chain_node?.trim() ?? null,
      body.market_size_krw_m ?? null,
      body.growth_rate ?? null,
      attractiveness ?? null,
      synergy ?? null,
      body.status ?? null,
      body.rationale?.trim() ?? null,
      industryProvided ? 1 : 0,
      industryId,
      terminal ? 1 : 0,
      ctx.userId,
      terminal ? 1 : 0,
      now,
      id,
    ],
  );
  appendAudit(db, {
    actor: ctx.userId,
    action: "opportunity_update",
    target: `${id}:${body.status ?? existing.status}`,
    now,
  });
  return ok({ id, status: body.status ?? existing.status });
}

// Delete an opportunity — analyst+ only. Deletion is a deletion mark, never a
// row removal (deal-deletion-playbook): the S1–S7 chain stays fully inspectable
// for audit. Blocked while promoted (delete the project first — its mark covers
// the source opportunity); a lightweight deal_archive manifest keeps the
// point-in-time record. Screening/committee chain rows persist untouched.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  {
    const denied = requireBusinessActor(ctx, "write", {
      viewerMessage: "Opportunity deletion requires the analyst role.",
    });
    if (denied) return denied;
  }
  const db = getDb();
  // ADR-0133 — production 모드에서는 딜 데이터 삭제(톰스톤 포함)를 전면 차단한다.
  // 관리자가 /admin/system-mode에서 development로 전환해야 다시 허용된다.
  if (getSystemMode(db) === "production") {
    return forbidden(
      "production_mode_delete_blocked",
      "Review/case deletion is blocked in production mode — an admin must switch the system mode to development.",
    );
  }
  const { id } = await params;
  const existing = db
    .query("SELECT id, name, project_id, status, market_scope, deleted_at FROM opportunity WHERE id = ?")
    .get(id) as {
    id: string;
    name: string;
    project_id: string | null;
    status: string;
    market_scope: string | null;
    deleted_at: string | null;
  } | null;
  if (!existing) return notFound();
  if (existing.deleted_at) return badRequest("already_deleted", "This opportunity is already soft-deleted.");
  if (existing.project_id) {
    return badRequest(
      "opportunity_promoted",
      "This opportunity is already being pursued as a project. Delete the project from the project overview and retry.",
    );
  }
  const now = new Date().toISOString();
  // 시장분석 연결 고정 — market_scope가 산업을 가리킨다면 당시 최신 버전을 manifest에 기록
  const marketFreeze = existing.market_scope
    ? (() => {
        const analysis = db
          .query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? ORDER BY created_at DESC LIMIT 1")
          .get(existing.market_scope) as { id: string } | undefined;
        const version = analysis
          ? (db
              .query(
                "SELECT id, version_no FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1",
              )
              .get(analysis.id) as { id: string; version_no: number } | undefined)
          : undefined;
        return JSON.stringify([
          {
            industryId: existing.market_scope,
            analysisId: analysis?.id ?? null,
            versionId: version?.id ?? null,
            versionNo: version?.version_no ?? null,
          },
        ]);
      })()
    : JSON.stringify([]);
  const manifest = { marketFreezeJson: marketFreeze, memberUserIdsJson: JSON.stringify([ctx.userId]), mnpiFlag: 0 };
  db.transaction(() => {
    db.run("UPDATE opportunity SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?", [
      now,
      ctx.userId,
      `deleted by ${ctx.userId}`,
      id,
    ]);
    recordDealArchive(db, {
      kind: "deleted",
      entityType: "opportunity",
      opportunityId: id,
      projectName: existing.name,
      track: null,
      statusAtArchive: existing.status,
      actedBy: ctx.userId,
      actedAt: now,
      reason: null,
      manifest,
    });
  })();
  appendAudit(db, {
    actor: ctx.userId,
    action: "opportunity_delete",
    target: `${id}:${existing.name}`,
    now: new Date().toISOString(),
  });
  return ok({ id, deleted: true });
}
