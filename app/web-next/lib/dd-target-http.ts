// HTTP glue for the ADR-0157 DD target axis: maps a DdTargetError onto the
// standard error envelope so every DD route answers an unopened / invalid
// target the same way (409 dd_target_not_open, 400 otherwise).
import { fail } from "./envelope.ts";
import { DdTargetError, resolveDdScope } from "./dd-target.ts";

export function ddTargetErrorResponse(err: DdTargetError): Response {
  return fail(err.status, err.code, err.message);
}

/** Resolve a request-supplied target_id into a scope or the ready-made error response. */
export function scopeOrResponse(projectId: string, raw: unknown): { targetId: string | null } | { response: Response } {
  const scope = resolveDdScope(projectId, raw);
  if (!scope.ok) return { response: ddTargetErrorResponse(scope.error) };
  return { targetId: scope.targetId };
}
