// S5 자체 진출 — Greenfield 기회 목록 / 평가 저장 (greenfield-capability-assessment).
import { getDb } from "../../../../../db/client.ts";
import { ulid } from "../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../lib/envelope.ts";

const now = () => new Date().toISOString();

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const opps = db
    .query(
      `SELECT o.id, o.name, o.market_scope, o.synergy_score,
              (SELECT rd.sub_track FROM route_decision rd WHERE rd.opportunity_id = o.id AND rd.is_current = 1) AS sub_track,
              (SELECT g.updated_at FROM greenfield_assessment g WHERE g.opportunity_id = o.id ORDER BY g.updated_at DESC LIMIT 1) AS assessed_at
       FROM opportunity o
       WHERE o.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM route_decision rd WHERE rd.opportunity_id = o.id AND rd.track = 'greenfield' AND rd.is_current = 1
         )
       ORDER BY o.created_at DESC`,
    )
    .all() as Array<{ id: string; name: string; market_scope: string | null; synergy_score: number | null; sub_track: string | null; assessed_at: string | null }>;
  return ok({ opportunities: opps }, 200, { count: opps.length });
}
