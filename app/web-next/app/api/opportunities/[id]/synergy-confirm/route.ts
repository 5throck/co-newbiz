// S3 시너지 점수 사람 확정 (경계 #2) — synergy-pipeline이 완료 시 기록하는
// opportunity.synergy_score는 권고값(ADR-0090)이다. 이 라우트는 사람이 그
// 권고를 검토해 확정(필요하면 수정)하거나 철회하는 유일한 통로다. 확정 전
// 값은 S4 트랙 어드바이저에서 트랙 투표에 쓰이지 않는다(중립 정보 신호).
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

const now = () => new Date().toISOString();

type SynergyRow = {
  id: string;
  synergy_score: number | null;
  synergy_rationale: string | null;
  synergy_score_confirmed_at: string | null;
  synergy_score_confirmed_by: string | null;
};

type Db = ReturnType<typeof getDb>;

function getRow(db: Db, id: string): SynergyRow | undefined {
  return db
    .query("SELECT id, synergy_score, synergy_rationale, synergy_score_confirmed_at, synergy_score_confirmed_by FROM opportunity WHERE id = ?")
    .get(id) as SynergyRow | undefined;
}

function state(row: SynergyRow) {
  return {
    synergyScore: row.synergy_score,
    synergyRationale: row.synergy_rationale,
    confirmedAt: row.synergy_score_confirmed_at,
    confirmedBy: row.synergy_score_confirmed_by,
    confirmed: row.synergy_score_confirmed_at !== null,
    // 권고는 있지만 사람 확정이 없는 상태 — 모든 소비 표면이 동일 문구를 쓴다.
    unconfirmedNote: "사람 확정 전 권고값 — S3 시너지 화면에서 확정하면 트랙 판단 근거로 인정됩니다.",
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  const row = getRow(getDb(), id);
  if (!row) return notFound();
  return ok(state(row), 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Synergy-score confirmation requires the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { score?: unknown; rationale?: unknown } | null;

  const db = getDb();
  const row = getRow(db, id);
  if (!row) return notFound();

  // 확정 대상 점수 — 본문으로 수정 점수를 받으면 갱신하고, 없으면 기록된
  // 권고값을 그대로 확정한다. 권고도 수정 점수도 없으면 확정할 것이 없다.
  let score = row.synergy_score;
  if (body?.score !== undefined && body.score !== null && body.score !== "") {
    const n = Number(body.score);
    if (!Number.isFinite(n) || n < 0 || n > 100) return badRequest("invalid_request", "score must be a number between 0 and 100.");
    score = Math.round(n);
  }
  if (score === null || score === undefined) return badRequest("no_recommendation", "No synergy recommendation to confirm — send a score or complete the S3 analysis first.");
  const rationale = typeof body?.rationale === "string" && body.rationale.trim() ? body.rationale.trim().slice(0, 2000) : row.synergy_rationale;

  const at = now();
  db.run(
    "UPDATE opportunity SET synergy_score = ?, synergy_rationale = ?, synergy_score_confirmed_at = ?, synergy_score_confirmed_by = ? WHERE id = ?",
    [score, rationale ?? null, at, auth.auth.userId, id],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "synergy_score.confirm", target: `${id}:${score}`, now: at });
  return ok(state(getRow(db, id)!), 200);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Synergy-score confirmation revocation requires the analyst role or higher." }); if (denied) return denied; }
  const { id } = await params;
  const db = getDb();
  const row = getRow(db, id);
  if (!row) return notFound();
  if (!row.synergy_score_confirmed_at) return badRequest("not_confirmed", "No confirmation record exists.");
  const at = now();
  // 점수 자체는 남기고 확정 표시만 지운다 — 값은 권고 상태로 되돌아간다.
  db.run("UPDATE opportunity SET synergy_score_confirmed_at = NULL, synergy_score_confirmed_by = NULL WHERE id = ?", [id]);
  appendAudit(db, { actor: auth.auth.userId, action: "synergy_score.retract", target: id, now: at });
  return ok(state(getRow(db, id)!), 200);
}
