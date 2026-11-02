// 관리자 — 스케줄 작업 실행 이력 (ADR-0091 CRUD 보강; ADR-0189 P7 extension, design
// 2026-10-29-scheduled-jobs-design §4.1 runs row: the migration-0183 columns the detail screen
// needs — trigger, actor, env, rows_read/written/changed, attempt — plus a computed duration and
// `?page=&limit=` paging. Backward-compatible: the previous fields (job_key, runs[].started_at/
// finished_at/status/error, success_rate, meta.count) keep their semantics; the new columns are
// additive and `total` joined for the pager.)
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface RunRow {
  started_at: string;
  finished_at: string | null;
  status: string;
  error: string | null;
  trigger: string | null;
  actor: string | null;
  env: string | null;
  rows_read: number | null;
  rows_written: number | null;
  rows_changed: number | null;
  attempt: number | null;
}

function parsePaging(url: URL): { page: number; limit: number } | { error: string } {
  const pageRaw = url.searchParams.get("page");
  const limitRaw = url.searchParams.get("limit");
  const page = pageRaw === null ? 1 : Number(pageRaw);
  const limit = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isInteger(page) || page < 1) return { error: "page must be an integer >= 1." };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: `limit must be an integer between 1 and ${MAX_LIMIT}.` };
  }
  return { page, limit };
}

export async function GET(request: Request, { params }: { params: Promise<{ jobKey: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const { jobKey } = await params;
  const paging = parsePaging(new URL(request.url));
  if ("error" in paging) return badRequest("invalid_request", paging.error);
  const db = getDb();
  const exists = db.query("SELECT 1 FROM schedule_job WHERE job_key = ?").get(jobKey);
  if (!exists) return notFound();
  const total = (db.query("SELECT COUNT(*) AS n FROM job_run WHERE job_key = ?").get(jobKey) as { n: number }).n;
  const runs = db
    .query(
      `SELECT started_at, finished_at, status, error, "trigger" AS trigger, actor, env,
              rows_read, rows_written, rows_changed, attempt
       FROM job_run WHERE job_key = ?
       ORDER BY started_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(jobKey, paging.limit, (paging.page - 1) * paging.limit) as RunRow[];
  const withDuration = runs.map((r) => {
    const started = Date.parse(r.started_at);
    const finished = r.finished_at === null ? NaN : Date.parse(r.finished_at);
    const duration = Number.isNaN(started) || Number.isNaN(finished) ? null : finished - started;
    return { ...r, duration };
  });
  const success = withDuration.filter((r) => r.status === "success").length;
  return ok(
    {
      job_key: jobKey,
      runs: withDuration,
      // Backward-compat: computed over the returned page (previous semantics).
      success_rate: withDuration.length ? Math.round((success / withDuration.length) * 100) : null,
      page: paging.page,
      limit: paging.limit,
      total,
    },
    200,
    { count: withDuration.length, total, page: paging.page, limit: paging.limit },
  );
}
