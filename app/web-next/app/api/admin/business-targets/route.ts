// Admin CRUD for the business-target standards (md_business_target, migration
// 0082 / ADR-0114) — group-common and affiliate-specific criteria consumed by
// the fs-gate evidence table. Admin-only (same bar as the master-data route);
// deletes are tombstones (0081 convention). The API speaks STORED units: money
// in KRW millions (ADR-0061), ratios for percentages, years as numbers — unit
// conversion belongs to the UI.
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { badRequest, ok } from "../../../../lib/envelope.ts";
import {
  CUSTOM_METRIC_KEY,
  METRIC_PRESETS,
  parseDirection,
  parseTargetValue,
  createBusinessTarget,
  deleteBusinessTarget,
  listBusinessTargets,
  updateBusinessTarget,
  type TargetDirection,
} from "../../../../lib/business-targets.ts";

const PRESET_KEYS = new Set(METRIC_PRESETS.map((p) => p.key));

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const rows = listBusinessTargets();
  return ok({ targets: rows, presets: METRIC_PRESETS }, 200, { count: rows.length });
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const body = (await request.json().catch(() => null)) as {
    group_id?: string;
    member_id?: string | null;
    metric_key?: string;
    label?: string | null;
    direction?: string;
    target_value?: number | string;
  } | null;
  if (!body?.group_id?.trim()) return badRequest("invalid_request", "group_id는 필수입니다.");
  const direction = parseDirection(body.direction);
  if (!direction) return badRequest("invalid_direction", "direction은 gte | lte 중 하나입니다.");
  const targetValue = parseTargetValue(body.target_value);
  if (targetValue == null) return badRequest("invalid_value", "target_value는 0 이상의 숫자여야 합니다.");
  const metricKey = body.metric_key?.trim() ?? "";
  if (!PRESET_KEYS.has(metricKey) && metricKey !== CUSTOM_METRIC_KEY) {
    return badRequest("invalid_metric", `metric_key는 ${[...PRESET_KEYS, CUSTOM_METRIC_KEY].join(" | ")} 중 하나입니다.`);
  }
  // Preset metrics carry their canonical label; only custom rows name themselves.
  const label = metricKey === CUSTOM_METRIC_KEY ? body.label?.trim() || "" : null;
  const result = createBusinessTarget({
    groupId: body.group_id.trim(),
    memberId: body.member_id?.trim() || null,
    metricKey,
    label,
    direction,
    targetValue,
    actor: auth.auth.userId,
  });
  if (!result.ok) {
    const messages: Record<string, string> = {
      unknown_group: "존재하지 않는 그룹입니다.",
      unknown_member: "해당 그룹에 속한 계열사가 아닙니다.",
      custom_label_required: "사용자 지정 지표에는 지표명이 필요합니다.",
      duplicate_target: "같은 범위·같은 지표의 기준이 이미 등록되어 있습니다 — 기존 행을 수정하세요.",
      invalid_value: "기준값이 올바르지 않습니다.",
      insert_failed: "등록에 실패했습니다.",
    };
    return badRequest(result.code, messages[result.code] ?? "등록에 실패했습니다.");
  }
  return ok({ id: result.id }, 201);
}

export async function PUT(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    direction?: string;
    target_value?: number | string;
  } | null;
  if (!body?.id?.trim()) return badRequest("invalid_request", "id는 필수입니다.");
  const direction = body.direction !== undefined ? parseDirection(body.direction) : undefined;
  if (body.direction !== undefined && !direction) return badRequest("invalid_direction", "direction은 gte | lte 중 하나입니다.");
  const targetValue = body.target_value !== undefined ? parseTargetValue(body.target_value) : undefined;
  if (body.target_value !== undefined && targetValue == null) return badRequest("invalid_value", "target_value는 0 이상의 숫자여야 합니다.");
  const result = updateBusinessTarget({ id: body.id.trim(), direction: direction ?? undefined, targetValue: targetValue ?? undefined, actor: auth.auth.userId });
  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: "존재하지 않는 기준 행입니다.",
      invalid_value: "기준값이 올바르지 않습니다.",
      no_fields: "수정할 필드가 없습니다.",
    };
    return badRequest(result.code, messages[result.code] ?? "수정에 실패했습니다.");
  }
  return ok({ id: body.id.trim() });
}

export async function DELETE(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const body = (await request.json().catch(() => null)) as { id?: string; reason?: string } | null;
  if (!body?.id?.trim()) return badRequest("invalid_request", "id는 필수입니다.");
  const result = deleteBusinessTarget(body.id.trim(), auth.auth.userId, body.reason?.trim() ?? "");
  if (!result.ok) return badRequest(result.code, "이미 삭제되었거나 존재하지 않는 기준 행입니다.");
  return ok({ id: body.id.trim() });
}
