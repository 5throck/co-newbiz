// deal-archive — point-in-time manifest writer for the deletion-mark model
// (deal-deletion-playbook). Nothing is physically deleted: closing/archiving
// or delete-marking a deal writes a manifest row recording WHO acted, WHICH
// members could see the deal at that moment (viewer allowlist), and WHICH
// market-sizing version the deal relied on. Market analyses are industry-keyed
// shared assets that keep evolving, so the manifest pins the exact version —
// market_sizing_version is append-only, and the pinned version id keeps the
// as-of view reachable forever.
import { ulid } from "../../../db/lib/ulid.ts";

export interface DealManifest {
  marketFreezeJson: string;
  memberUserIdsJson: string;
  mnpiFlag: number;
}

export function buildDealManifest(db: /* bun:sqlite Database */ any, projectId: string): DealManifest {
  const members = db.query("SELECT user_id FROM project_member WHERE project_id = ?").all(projectId) as Array<{
    user_id: string;
  }>;
  const mnpi = db
    .query("SELECT COALESCE(mnpi_flag, 0) AS f FROM project_classification WHERE project_id = ?")
    .get(projectId) as { f: number } | undefined;
  const industries = db
    .query("SELECT DISTINCT industry_id FROM project_industry WHERE project_id = ? AND superseded_by IS NULL")
    .all(projectId) as Array<{ industry_id: string }>;
  const marketFreeze = industries.map(({ industry_id }) => {
    const analysis = db
      .query("SELECT id FROM market_sizing_analysis WHERE industry_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(industry_id) as { id: string } | undefined;
    const version = analysis
      ? db
          .query("SELECT id, version_no FROM market_sizing_version WHERE analysis_id = ? ORDER BY version_no DESC LIMIT 1")
          .get(analysis.id) as { id: string; version_no: number } | undefined
      : undefined;
    return {
      industryId: industry_id,
      analysisId: analysis?.id ?? null,
      versionId: version?.id ?? null,
      versionNo: version?.version_no ?? null,
    };
  });
  return {
    memberUserIdsJson: JSON.stringify(members.map((m) => m.user_id)),
    mnpiFlag: mnpi?.f ?? 0,
    marketFreezeJson: JSON.stringify(marketFreeze),
  };
}

export function recordDealArchive(
  db: any,
  args: {
    kind: "archived" | "deleted";
    entityType: "project" | "opportunity";
    projectId?: string | null;
    opportunityId?: string | null;
    projectNo?: string | null;
    projectName?: string | null;
    track?: string | null;
    statusAtArchive?: string | null;
    actedBy: string;
    actedAt: string;
    reason?: string | null;
    manifest: DealManifest;
  },
): string {
  const id = ulid();
  db.run(
    `INSERT INTO deal_archive (id, kind, entity_type, project_id, opportunity_id, project_no, project_name,
       track, status_at_archive, market_freeze_json, member_user_ids_json, mnpi_flag, acted_by, acted_at, reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      args.kind,
      args.entityType,
      args.projectId ?? null,
      args.opportunityId ?? null,
      args.projectNo ?? null,
      args.projectName ?? null,
      args.track ?? null,
      args.statusAtArchive ?? null,
      args.manifest.marketFreezeJson,
      args.manifest.memberUserIdsJson,
      args.manifest.mnpiFlag,
      args.actedBy,
      args.actedAt,
      args.reason ?? null,
    ],
  );
  return id;
}
