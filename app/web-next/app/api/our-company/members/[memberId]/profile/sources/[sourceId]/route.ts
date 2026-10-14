// PATCH/DELETE /api/our-company/members/[memberId]/profile/sources/[sourceId] — edit or remove a HAND-ENTERED source only.
import { handleMemberProfileEdit } from "../../../../../../../../lib/profile-edit-route.ts";
import { removeManualSource, updateManualSource } from "../../../../../../../../lib/profile-analyst-edit.ts";

export async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string; sourceId: string }> }) {
  const { memberId, sourceId } = await params;
  return handleMemberProfileEdit(request, memberId, (db, userId, body) => updateManualSource(db, { kind: "member", id: memberId }, userId, sourceId, body));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ memberId: string; sourceId: string }> }) {
  const { memberId, sourceId } = await params;
  return handleMemberProfileEdit(request, memberId, (db, userId) => removeManualSource(db, { kind: "member", id: memberId }, userId, sourceId), { hasBody: false });
}
