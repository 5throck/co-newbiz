// @version 1.0.0
// `wacc_status` - the DISPLAY contract of ADR-0186 D8: every output that depends on the discount rate (business case,
// NPV / IRR tables, simulation, gate brief, IC package, monitoring brief) carries this object so the UI can label it
// "provisional discount rate" until the WACC subject, WACC and hurdle are human-confirmed. It blocks nothing by itself;
// the blocking rules (S8 completion, fs GO) live behind the `wacc` flag family and read the same helper.
import type { Database } from "bun:sqlite";
import { getDb } from "../../../db/client.ts";
import { resolveWaccConfirmation, type WaccMissingItem } from "../../../db/lib/wacc-confirmation.ts";

export interface WaccStatusView {
  /** `provisional` until the WACC subject, WACC and hurdle IRR are all user-confirmed. */
  status: "confirmed" | "provisional";
  /** Catalog reason code (`gateIntegrity.wacc.reason.<code>`); null when confirmed. */
  reason: "wacc_unconfirmed" | "wacc_subject_not_target" | null;
  /** Which of wacc_subject | wacc | hurdle_irr is not yet confirmed (empty when confirmed). */
  missing: WaccMissingItem[];
  /** The application subject recorded on the project (promoter | target | project_newco), or null. */
  subject: string | null;
  /** project = the project-level session; target = the selected target's own session (ADR-0156). */
  scope: "project" | "target";
  /** Display-only plausibility warnings: wacc_not_below_hurdle when the confirmed WACC is at or above the hurdle IRR. */
  warnings: Array<"wacc_not_below_hurdle">;
}

export function waccStatusView(projectId: string, db: Database = getDb()): WaccStatusView {
  const c = resolveWaccConfirmation(db, projectId);
  return {
    status: c.status,
    reason: c.reason,
    missing: c.missing,
    subject: c.subject,
    scope: c.scope.kind,
    warnings: c.wacc_value !== null && c.hurdle_value !== null && c.wacc_value >= c.hurdle_value ? ["wacc_not_below_hurdle"] : [],
  };
}
