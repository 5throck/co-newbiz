// S6~S7 브라운필드 경로 — Brownfield route 결정된 기회 목록.
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const opps = db
    .query(
      `SELECT o.id, o.name, o.market_scope, o.synergy_score,
              (SELECT rd.track FROM route_decision rd WHERE rd.opportunity_id = o.id ORDER BY rd.decided_at DESC, rd.id DESC LIMIT 1) AS track,
              (SELECT rd.sub_track FROM route_decision rd WHERE rd.opportunity_id = o.id ORDER BY rd.decided_at DESC, rd.id DESC LIMIT 1) AS sub_track,
              (SELECT COUNT(*) FROM brownfield_target bt WHERE bt.opportunity_id = o.id) AS target_count,
              (SELECT COUNT(*) FROM brownfield_target bt WHERE bt.opportunity_id = o.id AND bt.status = 'shortlisted') AS shortlist_count
       FROM opportunity o
       WHERE EXISTS (
         SELECT 1 FROM route_decision rd WHERE rd.opportunity_id = o.id AND rd.track = 'brownfield'
       )
       ORDER BY o.created_at DESC`,
    )
    .all() as Array<{
    id: string; name: string; market_scope: string | null; synergy_score: number | null;
    track: string | null; sub_track: string | null; target_count: number; shortlist_count: number;
  }>;
  return ok({ opportunities: opps }, 200, { count: opps.length });
}
