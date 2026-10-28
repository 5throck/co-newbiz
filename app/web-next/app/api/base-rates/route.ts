// GET /api/base-rates — read-only reference-class base rates (ADR-0187 D2,
// migration 0181) for assumption-audit (S3), the S8 valuation sanity check and
// the risk-officer red-team. Organisation reference data (not project-scoped):
// any business role may read; admin is rejected (requireBusinessActor, ADR-0146). Every row carries its
// provenance; an empty class is `not_available`, never a defaulted value.
// Writes only through scripts/co-newbiz/import-base-rates.ts.
import { getDb } from "../../../../../db/client.ts";
import { listReferenceClasses, lookupBaseRates } from "../../../../../db/lib/base-rate.ts";
import { authenticate, requireBusinessActor } from "../../../lib/auth.ts";
import { badRequest, ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const url = new URL(request.url);
  const key = url.searchParams.get("reference_class_key");
  const metric = url.searchParams.get("metric");
  const db = getDb();
  if (key === null) {
    const classes = listReferenceClasses(db);
    return ok({ reference_classes: classes }, 200, { count: classes.length });
  }
  if (!key.trim() || key.length > 200) return badRequest("invalid_request", "reference_class_key must be 1-200 characters.");
  if (metric !== null && (!metric.trim() || metric.length > 200)) return badRequest("invalid_request", "metric must be 1-200 characters.");
  const result = lookupBaseRates(db, key, metric);
  return ok(result, 200, { count: result.status === "available" ? result.rows.length : 0 });
}
