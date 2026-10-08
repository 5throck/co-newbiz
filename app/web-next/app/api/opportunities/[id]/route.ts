// Single opportunity — update (status transitions, scoring, rationale).
// Status moves identified→assessed→selected|dropped; decided_by/decided_at
// are stamped when the row reaches a terminal-or-selected state.
import { getDb } from "../../../../../../db/client.ts";
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
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  const row = getDb()
    .query("SELECT * FROM opportunity WHERE id = ?")
    .get(id);
  if (!row) return notFound();
  return ok(row, 200);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Opportunity updates require the analyst role." }); if (denied) return denied; }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: string; market_scope?: string; value_chain_node?: string;
    market_size_krw_m?: number; growth_rate?: number;
    attractiveness_score?: number | null; synergy_score?: number | null;
    status?: string; rationale?: string;
  } | null;
  if (!body) return badRequest("invalid_request", "body required.");
  if (body.status === "dropped") {
    return fail(409, "typed_closure_required", "기회 제외(dropped)는 POST /api/opportunities/[id]/close에서 closureType·사유·학습 포착과 함께 수행해야 합니다 (ADR-0152).");
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
  const existing = db
    .query("SELECT id, status FROM opportunity WHERE id = ?")
    .get(id) as { id: string; status: string } | null;
  if (!existing) return notFound();

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
       decided_by = CASE WHEN ? THEN ? ELSE decided_by END,
       decided_at = CASE WHEN ? THEN ? ELSE decided_at END
     WHERE id = ?`,
    [body.name?.trim() ?? null, body.market_scope?.trim() ?? null, body.value_chain_node?.trim() ?? null,
      body.market_size_krw_m ?? null, body.growth_rate ?? null,
      attractiveness ?? null, synergy ?? null, body.status ?? null, body.rationale?.trim() ?? null,
      terminal ? 1 : 0, ctx.userId, terminal ? 1 : 0, now, id],
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
  { const denied = requireBusinessActor(ctx, "write", { viewerMessage: "Opportunity deletion requires the analyst role." }); if (denied) return denied; }
  const db = getDb();
  // ADR-0133 — production 모드에서는 딜 데이터 삭제(톰스톤 포함)를 전면 차단한다.
  // 관리자가 /admin/system-mode에서 development로 전환해야 다시 허용된다.
  if (getSystemMode(db) === "production") {
    return forbidden("production_mode_delete_blocked", "운영(production) 모드에서는 검토/안건 삭제가 차단됩니다 — 관리자가 시스템 모드를 development로 전환해야 합니다.");
  }
  const { id } = await params;
  const existing = db
    .query("SELECT id, name, project_id, status, market_scope, deleted_at FROM opportunity WHERE id = ?")
    .get(id) as
    | { id: string; name: string; project_id: string | null; status: string; market_scope: string | null; deleted_at: string | null }
    | null;
  if (!existing) return notFound();
  if (existing.deleted_at) return badRequest("already_deleted", "이 기회는 이미 삭제 표시되어 있습니다.");
  if (existing.project_id) {
    return badRequest(
      "opportunity_promoted",
      "이 기회는 프로젝트로 추진되어 있습니다. 프로젝트 개요에서 프로젝트를 삭제한 뒤 다시 시도하세요.",
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
          ? db
              .query("SELECT id, version_no FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1")
              .get(analysis.id) as { id: string; version_no: number } | undefined
          : undefined;
        return JSON.stringify([
          { industryId: existing.market_scope, analysisId: analysis?.id ?? null, versionId: version?.id ?? null, versionNo: version?.version_no ?? null },
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
  appendAudit(db, { actor: ctx.userId, action: "opportunity_delete", target: `${id}:${existing.name}`, now: new Date().toISOString() });
  return ok({ id, deleted: true });
}
