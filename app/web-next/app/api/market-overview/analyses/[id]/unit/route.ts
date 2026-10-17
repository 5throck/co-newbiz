// PUT /api/market-overview/analyses/[id]/unit — ADR-0181 follow-up: the S1
// analysis declares the market-size UNIT at analysis time (analyst+ write,
// audited). The declaration updates the analysis column AND patches the
// LATEST version's payload scope declaration ONLY (unit_basis field) — the
// estimation data (anchor, baselines, CAGRs) is never touched, and a
// changelog note records the declaration change. Validation follows the
// ADR-0181 unit vocabulary: krw_m_year | units_year | <ccy>_[mb]_year; NULL
// resets to the pipeline convention (usd_b_year).
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, callPathOf, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { UNIT_BASIS_PATTERN } from "../../../../../../lib/target-scope.ts";

const CONVENTION_UNIT = "usd_b_year";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  { const d = requireBusinessActor(ctx, "write", { viewerMessage: "시장 규모 단위 선언은 analyst 역할 이상이어야 합니다." }); if (d) return d; }
  const { id } = await params;
  const db = getDb();
  const row = db
    .query("SELECT id, unit_basis FROM market_sizing_analysis WHERE id = ?")
    .get(id) as { id: string; unit_basis: string | null } | undefined;
  if (!row) return notFound();
  const body = (await request.json().catch(() => null)) as unknown;
  if (typeof body !== "object" || body === null) return badRequest("invalid_request", "단위 선언 요청이 아닙니다.");
  const raw = (body as Record<string, unknown>).unit_basis;
  if (raw !== undefined && raw !== null && (typeof raw !== "string" || !UNIT_BASIS_PATTERN.test(raw))) {
    return badRequest("invalid_request", "unit_basis는 krw_m_year / units_year / <통화>_[mb]_year 형태여야 합니다 (예: usd_b_year).");
  }
  const declared: string = typeof raw === "string" ? raw : CONVENTION_UNIT;
  const now = new Date().toISOString();

  db.transaction(() => {
    db.run("UPDATE market_sizing_analysis SET unit_basis = ? WHERE id = ?", [raw ?? null, id]);
    // Patch the LATEST version's payload scope DECLARATION only - estimation
    // data stays byte-identical. A changelog note records the change.
    const latest = db
      .query("SELECT id, version_no, payload, changelog FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1")
      .get(id) as { id: string; version_no: number; payload: string; changelog: string | null } | undefined;
    if (latest) {
      const root = JSON.parse(latest.payload) as Record<string, unknown>;
      const patchScope = (holder: Record<string, unknown>): void => {
        const scope = (typeof holder.scope === "object" && holder.scope !== null ? holder.scope : {}) as Record<string, unknown>;
        scope.unit_basis = declared;
        holder.scope = scope;
      };
      patchScope(root);
      if (typeof root.matrix === "object" && root.matrix !== null && !Array.isArray(root.matrix)) patchScope(root.matrix as Record<string, unknown>);
      const note = `단위 선언 변경 → ${declared} (${ctx.userId}, ${now.slice(0, 10)}) — 선언만 갱신, 추정 데이터 불변`;
      const changelog = latest.changelog ? `${latest.changelog}; ${note}` : note;
      db.run("UPDATE market_sizing_version SET payload = ?, changelog = ? WHERE id = ?", [JSON.stringify(root), changelog, latest.id]);
    }
    appendAudit(db, { actor: ctx.userId, action: "market_sizing_unit.write", target: `${id}@${callPathOf(ctx)}`, now });
  })();
  return ok({ analysis_id: id, unit_basis: raw ?? null, declared }, 200);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const row = db.query("SELECT unit_basis FROM market_sizing_analysis WHERE id = ?").get(id) as
    | { unit_basis: string | null }
    | undefined;
  if (!row) return notFound();
  return ok({ analysis_id: id, unit_basis: row.unit_basis, declared: row.unit_basis ?? CONVENTION_UNIT }, 200);
}
