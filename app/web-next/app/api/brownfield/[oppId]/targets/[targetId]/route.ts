// S7 대상 스크리닝 — 후보 수정(PATCH) / 체크리스트 판정 저장(POST).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { screeningSummary, type TargetRow } from "../../../../../../lib/brownfield-targets.ts";

const now = () => new Date().toISOString();

export async function PATCH(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "후보 수정은 analyst 역할 이상이어야 합니다.");
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as
    | { company_name?: string; dart_corp_code?: string | null; universe_note?: string | null }
    | null;
  const db = getDb();
  const existing = db
    .query("SELECT id FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { id: string } | undefined;
  if (!existing) return notFound();
  db.run(
    `UPDATE brownfield_target SET
       company_name = COALESCE(?, company_name),
       dart_corp_code = COALESCE(?, dart_corp_code),
       universe_note = COALESCE(?, universe_note),
       updated_at = ? WHERE id = ?`,
    [body?.company_name?.trim() || null, body?.dart_corp_code?.trim() || null, body?.universe_note?.trim() || null, now(), targetId],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "brownfield_target.update", target: `${oppId}:${targetId}`, now: new Date().toISOString() });
  return ok(db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId), 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "스크리닝 판정은 analyst 역할 이상이어야 합니다.");
  const { oppId, targetId } = await params;
  const body = (await request.json().catch(() => null)) as { states?: Record<string, string> } | null;
  const states = body?.states;
  if (!states || typeof states !== "object") return badRequest("invalid_request", "states(체크리스트 판정)는 필수입니다.");
  const valid = new Set(["pass", "fail", "na", "waived", "pending"]);
  for (const [k, v] of Object.entries(states)) {
    if (!valid.has(v)) return badRequest("invalid_request", `item ${k}의 판정이 올바르지 않습니다: ${v}`);
  }
  const db = getDb();
  const existing = db
    .query("SELECT screening_json FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { screening_json: string | null } | undefined;
  if (!existing) return notFound();
  const merged = { ...(existing.screening_json ? JSON.parse(existing.screening_json) : {}), ...states };
  db.run("UPDATE brownfield_target SET screening_json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(merged), now(), targetId]);
  appendAudit(db, { actor: auth.auth.userId, action: "brownfield_target.screening", target: `${oppId}:${targetId}`, now: new Date().toISOString() });
  const updated = db.query("SELECT * FROM brownfield_target WHERE id = ?").get(targetId) as unknown as TargetRow;
  return ok({ target: updated, screening_summary: screeningSummary(updated) }, 200);
}
