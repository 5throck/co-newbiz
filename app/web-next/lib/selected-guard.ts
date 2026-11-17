// Server-side enforcement of opportunity.selection (owner decision 2026-11-17, N2).
// Several opportunity-scoped writes presuppose that the opportunity has been selected
// (the screening gate GO). Until now only route-decision / route-recommendation checked
// it, and the UI gated the rest; the server must not trust the UI (defense in depth).
//
// The envelope shape follows the existing REST contract: fail(409, code, message) with
// the ad-hoc code vocabulary the repo already uses (deal_shape_not_open, not_linked).
// The shared code for "the opportunity is not selected" is `not_selected`.
import type { Database } from "bun:sqlite";
import { fail } from "./envelope.ts";

export const NOT_SELECTED_CODE = "not_selected";

/** null = the write may proceed; otherwise a ready 409 `not_selected` response. */
export function notSelectedResponse(db: Database, opportunityId: string): Response | null {
  const row = db.query("SELECT status FROM opportunity WHERE id = ?").get(opportunityId) as
    | { status: string }
    | undefined;
  if (row && row.status === "selected") return null;
  return fail(
    409,
    NOT_SELECTED_CODE,
    "Only a selected opportunity can record this artifact — record the screening gate GO (selection) first.",
  );
}
