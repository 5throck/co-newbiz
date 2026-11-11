// @version 1.0.0
// Authoring lead of the S3 required-capability register draft (ADR-0187 D5,
// finding H8; flow.spec 2.14.0 activities capability-register-greenfield /
// capability-register-brownfield). The register is one per opportunity and S3
// precedes the S4 route decision, so the draft prompt s3.capability_gap_draft is
// bound to greenfield-agent / S3.capability-register-greenfield (the catalog
// default) and the call is attributed to brownfield-agent once the recorded route
// is brownfield. A route decided later never rewrites past runs.
// Design 2026-11-11-route-decision-current-authority-design §9: the lead reads
// the ADR-0135 authority row (is_current=1) via the shared latestRouteDecision
// reader — a newer ADR-0124 draft (status='draft', never is_current=1) must not
// flip the attribution away from the flagged final.
import type { Database } from "bun:sqlite";
import { latestRouteDecision } from "./process-flow.ts";

export type CapabilityRegisterLead = "greenfield-agent" | "brownfield-agent";

// `db` stays in the signature for call-site stability; the shared reader owns
// its own getDb() handle (the same singleton).
export function capabilityRegisterLead(_db: Database, opportunityId: string): CapabilityRegisterLead {
  const row = latestRouteDecision(opportunityId);
  return row?.track === "brownfield" ? "brownfield-agent" : "greenfield-agent";
}
