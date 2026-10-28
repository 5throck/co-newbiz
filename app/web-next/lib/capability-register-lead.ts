// @version 1.0.0
// Authoring lead of the S3 required-capability register draft (ADR-0187 D5,
// finding H8; flow.spec 2.14.0 activities capability-register-greenfield /
// capability-register-brownfield). The register is one per opportunity and S3
// precedes the S4 route decision, so the draft prompt s3.capability_gap_draft is
// bound to greenfield-agent / S3.capability-register-greenfield (the catalog
// default) and the call is attributed to brownfield-agent once the recorded route
// is brownfield. A route decided later never rewrites past runs.
import type { Database } from "bun:sqlite";

export type CapabilityRegisterLead = "greenfield-agent" | "brownfield-agent";

export function capabilityRegisterLead(db: Database, opportunityId: string): CapabilityRegisterLead {
  const row = db
    .query("SELECT track FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1")
    .get(opportunityId) as { track: string } | undefined;
  return row?.track === "brownfield" ? "brownfield-agent" : "greenfield-agent";
}
