// Portfolio pipeline (D1/D2) — every promoted project's S8~S11 stage + gate
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
  const aging = listGateAging(db, { minAgeDays: 1 }).filter((r) =>
    projects.some((p) => p.projectId === r.entityId),
  );
  return ok({ projects, aging }, 200, { count: projects.length });
}
