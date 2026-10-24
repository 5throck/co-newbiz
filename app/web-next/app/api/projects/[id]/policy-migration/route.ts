// ADR-0161 retroactive application (design §8.1). GET — read-only preview of
// what ADR-0161 applies to this project, the stages already completed (kept
// recommended, never reopened) and the existing migration entry, if any.
// POST — HUMAN-ONLY (boundary #2): cookie session + CSRF, analyst+, project
// visibility, MNPI insider check, and the process owner only (the project
// lead). Records ONE append-only policy_migration audit entry with a required
// migration_note. Never re-pins project_policy_pin and never rewrites a row.
import { getDb } from "../../../../../../../db/client.ts";
import { requireInsiderIfMnpi } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { AGENT_KEYS } from "../../../../../lib/agent-registry.generated.ts";
import { currentPrincipal } from "../../../../../lib/mcp/principal-context.ts";
import { evaluateProcess } from "../../../../../lib/process-flow.ts";
import { adr0161Applicability, policyMigrationEntry, recordPolicyMigration } from "../../../../../lib/greenfield-execution.ts";

function completedStages(id: string): string[] {
  return evaluateProcess({ type: "project", id }).completedStages.filter((s) => Number(s.slice(1)) >= 8);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true })) return notFound();
  try {
    requireInsiderIfMnpi(getDb(), id, auth.auth.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  return ok({ applies: adr0161Applicability(id), completed_stages: completedStages(id), entry: policyMigrationEntry(id) }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.via !== "cookie" || currentPrincipal() || AGENT_KEYS.has(ctx.userId)) {
    return forbidden("human_only", "Only a human can record policy implementation (boundary #2).");
  }
  if (ctx.role === "viewer") return forbidden("role_required", "Requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  try {
    requireInsiderIfMnpi(getDb(), id, ctx.userId);
  } catch (e) {
    return forbidden("insider_required", (e as Error).message);
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const r = recordPolicyMigration({ projectId: id, migrationNote: body?.migration_note, completedStages: completedStages(id), actor: ctx.userId });
  if (!r.ok) {
    if (r.code === "invalid_request") return badRequest("invalid_request", r.message);
    if (r.code === "lead_required" || r.code === "agent_forbidden") return forbidden(r.code, r.message);
    return fail(409, r.code, r.message);
  }
  return ok({ audit_id: r.audit_id, applies: r.applies, entry: policyMigrationEntry(id) }, 201);
}
