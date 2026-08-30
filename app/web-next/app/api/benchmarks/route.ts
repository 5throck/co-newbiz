// Benchmark case library — browsable by any authenticated user; filters by
// deal type / industry / region / year via query params. Managed (create /
// update / delete) by admins under /api/admin/benchmarks.
import { getDb } from "../../../../../db/client.ts";
import { authenticate } from "../../../lib/auth.ts";
import { ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const dealType = url.searchParams.get("deal_type");
  const industry = url.searchParams.get("industry");
  const region = url.searchParams.get("region");
  const year = url.searchParams.get("deal_year");
  const q = url.searchParams.get("q");

  const clauses: string[] = [];
  const args: unknown[] = [];
  if (dealType) { clauses.push("deal_type = ?"); args.push(dealType); }
  if (industry) { clauses.push("industry LIKE ?"); args.push(`%${industry}%`); }
  if (region) { clauses.push("region LIKE ?"); args.push(`%${region}%`); }
  if (year) { clauses.push("deal_year = ?"); args.push(Number(year)); }
  if (q) { clauses.push("(title LIKE ? OR summary_ko LIKE ?)"); args.push(`%${q}%`, `%${q}%`); }

  const rows = getDb()
    .query(
      `SELECT id, title, industry, region, deal_type, deal_year, deal_size_krw_m,
              summary_ko, key_metrics_json, source_ref, created_by, created_at
       FROM benchmark_case
       ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""}
       ORDER BY deal_year DESC, created_at DESC`,
    )
    .all(...args);
  return ok(rows, 200, { count: (rows as unknown[]).length });
}
