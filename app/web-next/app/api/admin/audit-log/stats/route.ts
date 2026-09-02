// 감사 로그 통계 — 일별 건수(30일)·주요 액션 Top N·주요 행위자 Top N (ADR-0091).
// 로그 원문은 필요 시 별도 조회(audit-log?filters)로 확인한다 — 전량 나열 금지.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { ok } from "../../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const db = getDb();

  const daily = db.query(
    `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
     FROM audit_log WHERE created_at >= date('now', '-29 days')
     GROUP BY day ORDER BY day`,
  ).all() as Array<{ day: string; count: number }>;

  const byAction = db.query(
    `SELECT action, COUNT(*) AS count FROM audit_log
     GROUP BY action ORDER BY count DESC LIMIT 10`,
  ).all() as Array<{ action: string; count: number }>;

  const byActor = db.query(
    `SELECT actor_user_id AS actor, COUNT(*) AS count FROM audit_log
     GROUP BY actor ORDER BY count DESC LIMIT 10`,
  ).all() as Array<{ actor: string; count: number }>;

  const total = (db.query("SELECT COUNT(*) AS c FROM audit_log").get() as { c: number }).c;

  return ok({ total, daily, byAction, byActor });
}
