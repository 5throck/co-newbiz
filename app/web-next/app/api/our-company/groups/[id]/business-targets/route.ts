// Business-target standards of one group (md_business_target, migration 0082,
// ADR-0114 as amended by ADR-0191): group-common rows (member_id null) and
// affiliate-specific rows, managed from the /our-company group screen.
// Same permission model as the sibling /api/our-company/groups* routes
// (ADR-0146): reads = any business actor, writes = analyst+; the admin role is
// rejected (system administration never reads business content). Deletes are
// tombstones (0081 convention). The API speaks STORED units: money in KRW
// millions (ADR-0061), ratios for percentages, years as numbers.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import {
  CUSTOM_METRIC_KEY,
  METRIC_PRESETS,
  parseDirection,
  parseTargetValue,
  createBusinessTarget,
  deleteBusinessTarget,
  listBusinessTargets,
  updateBusinessTarget,
} from "../../../../../../lib/business-targets.ts";

const PRESET_KEYS = new Set(METRIC_PRESETS.map((p) => p.key));
type Ctx = { params: Promise<{ id: string }> };

function groupExists(id: string): boolean {
  return !!getDb().query("SELECT id FROM company_group WHERE id = ? AND deleted_at IS NULL").get(id);
}

export async function GET(request: Request, { params }: Ctx) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { id } = await params;
  if (!groupExists(id)) return notFound();
  const rows = listBusinessTargets(id);
  return ok({ targets: rows, presets: METRIC_PRESETS }, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: Ctx) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Registering business targets requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    member_id?: string | null;
    metric_key?: string;
    label?: string | null;
    direction?: string;
    target_value?: number | string;
  } | null;
  if (!groupExists(id)) return notFound();
  const direction = parseDirection(body?.direction);
  if (!direction) return badRequest("invalid_direction", "direction must be one of: gte | lte.");
  const targetValue = parseTargetValue(body?.target_value);
  if (targetValue == null) return badRequest("invalid_value", "target_value must be a number >= 0.");
  const metricKey = body?.metric_key?.trim() ?? "";
  if (!PRESET_KEYS.has(metricKey) && metricKey !== CUSTOM_METRIC_KEY) {
    return badRequest("invalid_metric", `metric_key must be one of: ${[...PRESET_KEYS, CUSTOM_METRIC_KEY].join(" | ")}.`);
  }
  // Preset metrics carry their canonical label; only custom rows name themselves.
  const label = metricKey === CUSTOM_METRIC_KEY ? body?.label?.trim() || "" : null;
  const result = createBusinessTarget({
    groupId: id,
    memberId: body?.member_id?.trim() || null,
    metricKey,
    label,
    direction,
    targetValue,
    actor: auth.auth.userId,
  });
  if (!result.ok) {
    const messages: Record<string, string> = {
      unknown_group: "The group does not exist.",
      unknown_member: "The affiliate does not belong to this group.",
      custom_label_required: "A custom metric needs a metric name.",
      duplicate_target: "A target for the same scope and metric already exists - edit the existing row.",
      invalid_value: "The target value is invalid.",
      insert_failed: "Registration failed.",
    };
    return badRequest(result.code, messages[result.code] ?? "Registration failed.");
  }
  return ok({ id: result.id }, 201);
}

export async function PUT(request: Request, { params }: Ctx) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Editing business targets requires the analyst role or higher." });
  if (denied) return denied;
  const { id: groupId } = await params;
  const body = (await request.json().catch(() => null)) as { id?: string; direction?: string; target_value?: number | string } | null;
  if (!groupExists(groupId)) return notFound();
  if (!body?.id?.trim()) return badRequest("invalid_request", "id is required.");
  const direction = body.direction !== undefined ? parseDirection(body.direction) : undefined;
  if (body.direction !== undefined && !direction) return badRequest("invalid_direction", "direction must be one of: gte | lte.");
  const targetValue = body.target_value !== undefined ? parseTargetValue(body.target_value) : undefined;
  if (body.target_value !== undefined && targetValue == null) return badRequest("invalid_value", "target_value must be a number >= 0.");
  const result = updateBusinessTarget({
    id: body.id.trim(),
    groupId,
    direction: direction ?? undefined,
    targetValue: targetValue ?? undefined,
    actor: auth.auth.userId,
  });
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "The target row does not exist.",
      invalid_value: "The target value is invalid.",
      no_fields: "There are no fields to update.",
    };
    return badRequest(result.code, messages[result.code] ?? "Update failed.");
  }
  return ok({ id: body.id.trim() });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Deleting business targets requires the analyst role or higher." });
  if (denied) return denied;
  const { id: groupId } = await params;
  const body = (await request.json().catch(() => null)) as { id?: string; reason?: string } | null;
  if (!groupExists(groupId)) return notFound();
  if (!body?.id?.trim()) return badRequest("invalid_request", "id is required.");
  const result = deleteBusinessTarget(body.id.trim(), auth.auth.userId, body.reason?.trim() ?? "", groupId);
  if (!result.ok) return badRequest(result.code, "The criterion row is already deleted or does not exist.");
  return ok({ id: body.id.trim() });
}
