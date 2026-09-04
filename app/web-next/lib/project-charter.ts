// Project charter builder (ADR-0104) — assembles a structured charter from
// the artifacts that already exist at promotion time, so "어떤 프로젝트인지"
// is answered on the project row itself, not re-derived from the opportunity.
// Track-specific sections: greenfield = market-entry plan (capability /
// channel / milestones), brownfield = investment case (target / stake /
// staged commitment). KPIs declared here are the pre-commit the S11 venture
// scorecard evaluates against (C2).
import type { Database } from "bun:sqlite";

export interface CharterKpi {
  key: string;
  label: string;
  target: string;
}

export interface CharterVersion {
  version: number;
  built_by: string;
  built_at: string;
  source: "promotion" | "amendment";
  note?: string;
  purpose: string;
  marketScope: string | null;
  valueChainNode: string | null;
  track: string | null;
  subTrack: string | null;
  intent: string | null;
  totalScore: number | null;
  trackRationale: string | null;
  entryScope: string;
  kpis: CharterKpi[];
}

const clamp = (s: string | null | undefined, n = 400): string => (s ?? "").trim().slice(0, n) || "";

export function buildProjectCharter(
  db: Database,
  opts: { opportunityId: string; track: "greenfield" | "brownfield" | null; builtBy: string; now: string },
): { name: string; charter: CharterVersion } {
  const opp = db.query("SELECT name, market_scope, value_chain_node FROM opportunity WHERE id = ?")
    .get(opts.opportunityId) as { name: string; market_scope: string | null; value_chain_node: string | null } | undefined;
  const route = db
    .query(
      `SELECT sub_track, rationale, intent, total_score FROM route_decision
       WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1`,
    )
    .get(opts.opportunityId) as
    | { sub_track: string | null; rationale: string | null; intent: string | null; total_score: number | null }
    | undefined;

  let entryScope = "";
  const kpis: CharterKpi[] = [];
  if (opts.track === "greenfield") {
    const gf = db
      .query("SELECT entry_strategy, capability_gaps_json FROM greenfield_assessment WHERE opportunity_id = ? ORDER BY updated_at DESC LIMIT 1")
      .get(opts.opportunityId) as { entry_strategy: string | null; capability_gaps_json: string | null } | undefined;
    entryScope = clamp(gf?.entry_strategy, 600) || "진출전략 미기록";
    let gaps: Array<{ capability?: string; resolution?: string }> = [];
    try { gaps = gf?.capability_gaps_json ? JSON.parse(gf.capability_gaps_json) : []; } catch { /* unparseable */ }
    for (const g of gaps.slice(0, 3)) {
      if (g.capability) kpis.push({ key: `gap:${g.capability.slice(0, 24)}`, label: `역량 해소 — ${g.capability}`, target: clamp(g.resolution, 120) || "해소 방안 확인" });
    }
    kpis.push({ key: "entry_revenue", label: "진출 매출 기준선 설정", target: "첫 분기 채널별 매출 기록" });
  } else if (opts.track === "brownfield") {
    const shortlist = db
      .query(
        `SELECT company_name, rank FROM brownfield_target
         WHERE opportunity_id = ? AND status = 'shortlisted' ORDER BY rank LIMIT 3`,
      )
      .all(opts.opportunityId) as Array<{ company_name: string; rank: number | null }>;
    entryScope = shortlist.length
      ? `쇼트리스트: ${shortlist.map((s) => `${s.company_name}${s.rank ? ` (#${s.rank})` : ""}`).join(", ")}`
      : "쇼트리스트 미보유";
    kpis.push({ key: "deal_structure", label: "투자 구조 확정", target: "대상·지분·단계별 투입 계획 확정" });
    kpis.push({ key: "dd_closure", label: "데이터룸 DD 완료", target: "보류 항목 0건" });
  } else {
    entryScope = "트랙 미결정";
  }

  const name = `${opp?.name ?? "프로젝트"}${route?.sub_track ? ` — ${route.sub_track}` : ""}`;
  const charter: CharterVersion = {
    version: 1,
    built_by: opts.builtBy,
    built_at: opts.now,
    source: "promotion",
    purpose: clamp(opp?.name, 200) + (route?.rationale ? ` — ${clamp(route.rationale, 300)}` : ""),
    marketScope: clamp(opp?.market_scope, 120) || null,
    valueChainNode: clamp(opp?.value_chain_node, 120) || null,
    track: opts.track,
    subTrack: route?.sub_track ?? null,
    intent: route?.intent ?? null,
    totalScore: route?.total_score ?? null,
    trackRationale: clamp(route?.rationale, 400) || null,
    entryScope,
    kpis,
  };
  return { name, charter };
}

/** S11 bridge (C2) — charter KPI pre-commits, newest charter wins. */
export function getCharterKpis(db: Database, projectId: string): CharterKpi[] {
  const row = db.query("SELECT charter_json FROM md_project WHERE id = ?").get(projectId) as
    | { charter_json: string | null }
    | undefined;
  if (!row?.charter_json) return [];
  try {
    const parsed = JSON.parse(row.charter_json) as { versions?: CharterVersion[] } | CharterVersion[];
    const versions = Array.isArray(parsed) ? parsed : parsed.versions ?? [];
    const latest = versions[versions.length - 1];
    return latest?.kpis ?? [];
  } catch {
    return [];
  }
}

/** Append an amendment as a new version (C3 — scope creep is traceable). */
export function appendCharterAmendment(
  db: Database,
  projectId: string,
  opts: { builtBy: string; note: string; patch: Partial<Pick<CharterVersion, "entryScope" | "kpis" | "purpose">> },
): { version: number } {
  const row = db.query("SELECT charter_json FROM md_project WHERE id = ?").get(projectId) as
    | { charter_json: string | null }
    | undefined;
  const parsed = row?.charter_json ? (JSON.parse(row.charter_json) as { versions?: CharterVersion[] }) : { versions: [] as CharterVersion[] };
  const versions = parsed.versions ?? [];
  const latest = versions[versions.length - 1];
  if (!latest) throw new Error("charter_amendment_failed: no base charter — promote the project first.");
  const amended: CharterVersion = {
    ...latest,
    version: latest.version + 1,
    built_by: opts.builtBy,
    built_at: new Date().toISOString(),
    source: "amendment",
    note: opts.note,
    ...opts.patch,
  };
  versions.push(amended);
  db.run("UPDATE md_project SET charter_json = ? WHERE id = ?", [JSON.stringify({ versions }), projectId]);
  return { version: amended.version };
}
