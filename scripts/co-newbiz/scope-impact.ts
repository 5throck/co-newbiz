// @version 1.0.0
/**
 * scope-impact.ts — read-only report for DEC-20261013-05.
 *
 * Usage: bun scripts/co-newbiz/scope-impact.ts --db <path-to-sqlite-copy>
 *
 * Lists projects whose effective date (MIN(created_at, earliest non-overlay
 * policy pin)) is on/after 2026-07-01, with track, the latest dd gate decision,
 * later gate rows, and whether the by-date S9 scope is pinned off (a valid,
 * non-stale dd decision exists). The database is opened readonly; run it on a
 * backup copy.
 */
import { Database } from "bun:sqlite";

const SCOPE_DATE = "2026-07-01";
const OVERLAY_DOCS = ["ovl-greenfield-workspace-scope", "ovl-brownfield-workspace-scope"];
const LATER = ["entity_ic", "group_ic"];

const i = process.argv.indexOf("--db");
const path = i >= 0 ? process.argv[i + 1] : undefined;
if (!path) {
  console.error("usage: bun scripts/co-newbiz/scope-impact.ts --db <path>");
  process.exit(2);
}
const db = new Database(path, { readonly: true });

const projects = db
  .query(
    `SELECT p.id, p.project_no, p.track, p.created_at,
            (SELECT MIN(pinned_at) FROM project_policy_pin WHERE project_id = p.id AND policy_doc_id NOT IN (${OVERLAY_DOCS.map(() => "?").join(",")})) AS first_pin
     FROM md_project p ORDER BY p.created_at`,
  )
  .all(...OVERLAY_DOCS) as Array<{ id: string; project_no: string; track: string | null; created_at: string | null; first_pin: string | null }>;

const gates = db.query(
  `SELECT g.gate, g.decision, g.decided_at, (s.decision_id IS NOT NULL) AS stale
   FROM gate_decision g LEFT JOIN gate_decision_stale s ON s.decision_id = g.id
   WHERE g.entity_type = 'project' AND g.entity_id = ? ORDER BY g.decided_at, g.id`,
);
const optIn = db.query("SELECT 1 FROM project_policy_pin WHERE project_id = ? AND policy_doc_id IN (?, ?) AND superseded_by IS NULL LIMIT 1");

let shown = 0;
for (const p of projects) {
  const created = p.created_at ?? "";
  const eff = p.first_pin !== null && p.first_pin < created ? p.first_pin : created;
  if (eff < SCOPE_DATE) continue;
  shown += 1;
  const rows = gates.all(p.id) as Array<{ gate: string; decision: string; decided_at: string; stale: number }>;
  const dd = rows.filter((r) => r.gate === "dd");
  const validDd = dd.filter((r) => !r.stale);
  const latestDd = validDd[validDd.length - 1];
  const later = rows.filter((r) => LATER.includes(r.gate)).map((r) => `${r.gate}:${r.decision}${r.stale ? "(stale)" : ""}`);
  const pinned = validDd.length > 0;
  const opted = !!optIn.get(p.id, ...OVERLAY_DOCS);
  console.log(
    `${p.project_no}  track=${p.track ?? "-"}  effective=${eff.slice(0, 10)}  dd=${latestDd ? `${latestDd.decision}@${latestDd.decided_at.slice(0, 10)}` : dd.length ? "stale-only" : "none"}  later=[${later.join(", ")}]  opt_in=${opted}  pinned=${pinned ? "YES (by-date scope off)" : "no (by-date scope applies)"}`,
  );
}
console.log(`${shown} of ${projects.length} projects on/after ${SCOPE_DATE}`);
db.close();
