// HTTP glue for typed closure (ADR-0152): shared by the project and
// opportunity close routes so the error contract cannot drift between them.
import {
  type ClosureError,
  CLOSURE_TYPES_BY_ENTITY,
  type ClosureEntityType,
  type ClosureType,
} from "../../../db/repositories/closure.repository.ts";
import { badRequest, fail, forbidden, notFound } from "./envelope.ts";
import { AGENT_KEYS } from "./agent-registry.generated.ts";

/** Agent persona ids — never a valid human closer/decider (boundary #1/#2). */
export const AGENT_IDS: ReadonlySet<string> = AGENT_KEYS;

export interface CloseBody {
  closureType: ClosureType;
  basisId?: string;
  closureReason: string;
  learningCapture?: string;
}

/** Parse + shape-check the POST body. Returns an error Response or the body. */
export function parseCloseBody(
  raw: unknown,
  entityType: ClosureEntityType,
): { body: CloseBody } | { response: Response } {
  const b = (raw ?? null) as Record<string, unknown> | null;
  const type = typeof b?.closureType === "string" ? b.closureType : "";
  if (!(CLOSURE_TYPES_BY_ENTITY[entityType] as readonly string[]).includes(type)) {
    return {
      response: badRequest(
        "invalid_request",
        `closureType must be one of ${CLOSURE_TYPES_BY_ENTITY[entityType].join("|")}.`,
      ),
    };
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    body: {
      closureType: type as ClosureType,
      basisId: str(b?.basisId) || undefined,
      closureReason: str(b?.closureReason),
      learningCapture: str(b?.learningCapture) || undefined,
    },
  };
}

export function closureErrorResponse(err: ClosureError): Response {
  switch (err.code) {
    case "precondition_failed":
      return fail(409, "precondition_failed", `Missing precondition record(s): ${err.missing.join(", ")}.`);
    case "already_closed":
    case "invalid_state":
      return fail(409, err.code, err.message);
    case "agent_forbidden":
      return forbidden("agent_forbidden", err.message);
    case "not_found":
      return notFound();
    default:
      return badRequest("invalid_request", err.message);
  }
}
