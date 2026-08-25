// Port of app/server/governance.ts GET /api/procedures/resolve
import { resolveProcedure } from "../../../../../../scripts/co-newbiz/proc-resolve.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const procedure = url.searchParams.get("procedure");
  if (!procedure?.trim()) {
    return badRequest("invalid_request", "procedure query parameter is required.");
  }
  try {
    const result = resolveProcedure(procedure.trim(), {
      entity: url.searchParams.get("entity") || undefined,
      region: url.searchParams.get("region") || undefined,
    });
    return ok(result, 200, { step_count: result.steps.length });
  } catch {
    return notFound(`Procedure '${procedure}' not found.`);
  }
}
