// Portfolio pipeline (D1/D2) — every promoted project's S8~S12 stage + gate
// snapshot, plus HOLD/kill gate aging across the portfolio. Member-visible
// only (each project is filtered through visibleProject; admins get an empty
// list per ADR-0091 role separation).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { visibleProject } from "../../../../lib/project-visibility.ts";
import { listGateAging, listProjectPipeline } from "../../../../lib/gate-aging.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const db = getDb();
  const projects = listProjectPipeline(db).filter((p) => visibleProject(auth.auth, p.projectId) !== null);
  // Opportunities are visible to every authenticated user (pre-project
  // intelligence, see api/opportunities/route.ts) — only project-type rows
  // need the per-project visibility filter. A prior version filtered every
  // row by `projects.some(p => p.projectId === r.entityId)`, which silently
  // dropped every opportunity-type row (an opportunity id never matches a
  // project id) — opportunity-level HOLD/KILL never reached the board or
  // dashboard, regardless of age.
  const visible = (r: { entityType: "opportunity" | "project"; entityId: string }) =>
    r.entityType === "opportunity" || projects.some((p) => p.projectId === r.entityId);
  // currentHolds: every recorded HOLD/KILL right now, any age. One list feeds
  // everything that needs "is this on hold" — the board's card badges and
  // HOLD filter, the dashboard's HOLD KPI, and the 진행 에이징 table
  // (sorted by ageDays, elapsed shown per row down to 0). A previous version
  // pre-filtered a separate `aging` list to >=1 day old for that table, which
  // made the table say "no HOLD/KILL in progress" on the very page showing a
  // HOLD badge for something decided today — same data, two contradictory
  // answers depending on which endpoint field you read.
  const currentHolds = listGateAging(db, { minAgeDays: 0 }).filter(visible);
  return ok({ projects, currentHolds }, 200, { count: projects.length });
}
