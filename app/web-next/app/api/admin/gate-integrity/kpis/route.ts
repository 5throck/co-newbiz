// GET /api/admin/gate-integrity/kpis?from=&to=&gate=&min_writes= - the gate-integrity KPIs G1-G12 (ADR-0186 P5,
// governance-operations section 4.1). Administrator only (the system-operator seat compliance-officer reviews through,
// same authorization as the other /api/admin governance reads); aggregate counts only - no rationale text and no
// project identifiers. Default period = the current calendar week (Monday 00:00Z to now); `from`/`to` are ISO dates or
// instants, `gate` limits the gate-scoped KPIs. Each KPI: { id, name, li, li_families, period, value, numerator,
// denominator, rate, breach: { breached, reasons[] }, note? }. Read-only.
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../../lib/envelope.ts";
import { buildGateIntegrityKpis, KPI_GATES } from "../../../../../lib/gate-integrity-kpis.ts";
import { route } from "../../../../../lib/route.ts";

const iso = (v: string | null): string | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export const GET = route(async (request: Request) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireAdmin(auth.auth);
  if (denied) return denied;
  const url = new URL(request.url);
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ((now.getUTCDay() + 6) % 7) * 86_400_000);
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const from = rawFrom ? iso(rawFrom) : monday.toISOString();
  const to = rawTo ? iso(rawTo) : new Date(now.getTime() + 1000).toISOString();
  if (!from || !to) return badRequest("invalid_request", "from and to must be ISO dates or instants.");
  if (from >= to) return badRequest("invalid_request", "from must be earlier than to.");
  const gate = url.searchParams.get("gate")?.trim() || null;
  if (gate && !(KPI_GATES as readonly string[]).includes(gate)) return badRequest("invalid_request", `gate must be one of: ${KPI_GATES.join(" | ")}.`);
  const mw = url.searchParams.get("min_writes");
  const minWrites = mw === null ? undefined : Number(mw);
  if (minWrites !== undefined && (!Number.isInteger(minWrites) || minWrites < 0)) return badRequest("invalid_request", "min_writes must be a non-negative integer.");
  const data = buildGateIntegrityKpis(getDb(), { from, to, gate, minWrites, now: now.toISOString() });
  return ok(data, 200, { count: data.kpis.length });
});
