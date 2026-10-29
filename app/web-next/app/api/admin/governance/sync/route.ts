// Admin — "sync now" for the governance document registry. Applies the
// committed manifest (docs/governance/governance-registry.generated.json, kept
// current by `governance:sync` and gated by the variant audit) to governance_doc:
// a bounded upsert of ~60 rows, not a long job. The route never reads the repo
// tree, so it behaves the same in the Docker image. Admin only; audited
// (governance_sync) by applyGovernanceManifest.
import { getDb } from "../../../../../../../db/client.ts";
import { applyGovernanceManifest, type GovernanceManifest } from "../../../../../../../db/lib/governance-registry.ts";
import manifestJson from "../../../../../../../docs/governance/governance-registry.generated.json";
import { authenticate, requireAdmin } from "../../../../../lib/auth.ts";
import { ok } from "../../../../../lib/envelope.ts";

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const body = (await request.json().catch(() => null)) as { dry_run?: boolean } | null;
  const result = applyGovernanceManifest(getDb(), manifestJson as unknown as GovernanceManifest, {
    dryRun: body?.dry_run === true,
    actor: auth.auth.userId,
    via: "admin",
    now: new Date().toISOString(),
  });
  return ok({
    dry_run: result.dryRun,
    inserted: result.inserted,
    superseded: result.superseded,
    updated: result.updated,
    unchanged: result.unchanged,
    orphans: result.orphans,
    findings: result.findings,
    changes: result.docs.filter((d) => d.action !== "unchanged"),
  });
}
