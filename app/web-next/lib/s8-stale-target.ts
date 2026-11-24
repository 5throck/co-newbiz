// ADR-0206 - shared refusal for downstream consumers that must not run on a stale S8 record.
// The selection / adoption rows are never altered; a consumer that would build a recommendation or
// a suggestion from the adopted case answers 409 target_not_shortlisted until a human re-selects the
// target and re-adopts a case. Read-only: the staleness comes from lib/business-case.ts.
import { resolveS8Staleness } from "./business-case.ts";
import { fail } from "./envelope.ts";

/** 409 target_not_shortlisted when the latest selection or adoption of the project is stale; null otherwise. */
export function staleTargetDenied(projectId: string): Response | null {
  const st = resolveS8Staleness(projectId);
  if (!st.any) return null;
  return fail(
    409,
    "target_not_shortlisted",
    "The selected/adopted target is no longer on the Short List; re-select the target and re-adopt a business case before generating from it.",
    { selection: st.selection, adoption: st.adoption, target_ids: st.target_ids },
  );
}
