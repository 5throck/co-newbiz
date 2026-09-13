// S4 진출방식 결정 — 초안 저장 (ADR-0124). "결정"(../route.ts POST)과 달리
// 완결성 검증이 없다 — 검토/안건을 정하지 못한 채로도, 채점이 미완인 채로도 저장할
// 수 있다. 기회당 열린 초안은 최대 1건(부분 유니크 인덱스로 강제)이라 항상
// upsert다. route_decision_score.intent가 NOT NULL이므로 intent가 아직
// 없으면 채점을 저장하지 않는다 — 없는 데이터를 있는 것처럼 만들지 않는다.
import { getDb } from "../../../../../../../../db/client.ts";
import { getDraftRouteDecision } from "../../../../../../../../db/repositories/route-decision.repository.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { route } from "../../../../../../lib/route.ts";

const TRACKS = ["greenfield", "brownfield"] as const;
const GF_SUB = ["existing_business_rbd", "intra_venture"] as const;
const BF_SUB = ["m_and_a", "jv", "strategic_investment", "minority_investment", "partnership", "rbd", "corporate_venture"] as const;
const INTENTS = ["integration", "capability_access"] as const;
const CRITERIA = ["control_need", "capability_criticality", "market_uncertainty", "integration_capacity", "speed_to_capability"] as const;

export const PUT = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return forbidden("role_required", "진출방식 결정 초안 저장은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    track?: string; sub_track?: string; rationale?: string; alternatives_considered?: string;
    intent?: string; scores?: Array<{ criterion?: string; score?: number; evidence_note?: string }>;
  } | null;

  const db = getDb();
  const opp = db.query("SELECT id FROM opportunity WHERE id = ?").get(id) as { id: string } | null;
  if (!opp) return notFound();

  // 값이 왔다면 형식은 검증한다 — 초안이라고 잘못된 값을 그냥 저장하지 않는다.
  const track = body?.track;
  if (track && !TRACKS.includes(track as typeof TRACKS[number])) {
    return badRequest("invalid_request", "track은 greenfield | brownfield 중 하나입니다.");
  }
  const subTrack = body?.sub_track?.trim() || null;
  if (subTrack && track === "greenfield" && !GF_SUB.includes(subTrack as typeof GF_SUB[number])) {
    return badRequest("invalid_request", "greenfield sub_track은 existing_business_rbd | intra_venture 중 하나입니다.");
  }
  if (subTrack && track === "brownfield" && !BF_SUB.includes(subTrack as typeof BF_SUB[number])) {
    return badRequest("invalid_request", "brownfield sub_track 값이 올바르지 않습니다.");
  }
  const intent = body?.intent || null;
  if (intent && !INTENTS.includes(intent as typeof INTENTS[number])) {
    return badRequest("invalid_request", "intent는 integration | capability_access 중 하나입니다.");
  }

  const now = new Date().toISOString();
  const existing = getDraftRouteDecision(id, db);
  const decisionId = existing?.id ?? ulid();

  if (existing) {
    db.run(
      `UPDATE route_decision SET track=?, sub_track=?, rationale=?, alternatives_considered=?, intent=?, updated_at=?
       WHERE id=?`,
      [track ?? existing.track, subTrack, body?.rationale?.trim() || null, body?.alternatives_considered?.trim() || null, intent, now, decisionId],
    );
  } else {
    if (!track) return badRequest("invalid_request", "초안을 새로 만들려면 track이 필요합니다.");
    db.run(
      `INSERT INTO route_decision (id, opportunity_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at, intent, status, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'draft',?)`,
      [decisionId, id, track, subTrack, body?.rationale?.trim() || null, body?.alternatives_considered?.trim() || null, ctx.userId, now, intent, now],
    );
  }

  // 채점은 intent가 있을 때만, 그리고 점수+근거가 모두 채워진 기준만 저장한다.
  db.run("DELETE FROM route_decision_score WHERE decision_id = ?", [decisionId]);
  if (intent && Array.isArray(body?.scores)) {
    for (const s of body.scores) {
      const criterion = String(s?.criterion ?? "");
      const score = Number(s?.score);
      const note = String(s?.evidence_note ?? "").trim();
      if (!CRITERIA.includes(criterion as typeof CRITERIA[number])) continue;
      if (!Number.isInteger(score) || score < 1 || score > 3) continue;
      if (!note) continue;
      db.run(
        `INSERT INTO route_decision_score (id, decision_id, intent, criterion, score, evidence_note, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [ulid(), decisionId, intent, criterion, score, note, now],
      );
    }
  }

  return ok({ id: decisionId, status: "draft", updated_at: now }, 200);
});
