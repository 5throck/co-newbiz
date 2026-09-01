// S4 진출방식 결정 (route decision) — selected 기회에 대한 트랙(GF/BF) +
// 라우트 유형 기록. flow.spec v2.0.0: Greenfield(S5 역량 평가) / Brownfield(S6 대상
// 후보 발굴)의 분기점. S4 완료 산출물 "트랙 결정(GF/BF)·근거".
import { getDb } from "../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";

const TRACKS = ["greenfield", "brownfield"] as const;
const GF_SUB = ["existing_business_rbd", "intra_venture"] as const;
const BF_SUB = ["m_and_a", "jv", "strategic_investment", "minority_investment", "partnership", "rbd", "corporate_venture"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDb();
  const opp = db.query("SELECT id, name, status FROM opportunity WHERE id = ?").get(id) as
    | { id: string; name: string; status: string }
    | null;
  if (!opp) return notFound();
  const decisions = db
    .query(
      `SELECT id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at
       FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC`,
    )
    .all(id);
  return ok({ opportunity: opp, decisions }, 200, { count: decisions.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "진출방식 결정은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    track?: string; sub_track?: string; rationale?: string; alternatives_considered?: string;
  } | null;
  const track = body?.track;
  const rationale = body?.rationale?.trim();
  if (!track || !TRACKS.includes(track as typeof TRACKS[number])) return badRequest("invalid_request", "track은 greenfield | brownfield 중 하나입니다.");
  if (!rationale) return badRequest("invalid_request", "rationale(근거)은 필수입니다.");
  const subTrack = body?.sub_track?.trim() || null;
  const gfSubs = [...GF_SUB];
  if (track === "greenfield" && subTrack && !gfSubs.includes(subTrack as typeof GF_SUB[number])) {
    return badRequest("invalid_request", "greenfield sub_track은 existing_business_rbd | intra_venture 중 하나입니다.");
  }
  if (track === "brownfield" && subTrack && !BF_SUB.includes(subTrack as typeof BF_SUB[number])) {
    return badRequest("invalid_request", "brownfield sub_track은 m_and_a | jv | strategic_investment | minority_investment | partnership | rbd | corporate_venture 중 하나입니다.");
  }

  const db = getDb();
  const opp = db.query("SELECT id, status FROM opportunity WHERE id = ?").get(id) as
    | { id: string; status: string }
    | null;
  if (!opp) return notFound();
  if (opp.status !== "selected") return badRequest("invalid_request", "선별(selected)된 기회만 진출방식을 결정할 수 있습니다.");

  const decisionId = ulid();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [decisionId, id, track, subTrack, rationale, body?.alternatives_considered?.trim() || null, ctx.userId, now],
  );
  appendAudit(db, { actor: ctx.userId, action: "route_decision.create", target: id, now });

  return ok({ id: decisionId, track, sub_track: subTrack, rationale, decided_at: now }, 201);
}

