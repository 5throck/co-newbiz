// POST /api/our-company/members/[memberId]/profile/overrides — analyst edit of 산업 노출 / 강점 / 약점 / 사업 평가.
// Requires a short reason; creates a NEW version (source_ref "analyst_edit"), marks edited items confirmed in the ledger, audits the user.
import { handleMemberProfileEdit } from "../../../../../../../lib/profile-edit-route.ts";
import { applyFieldOverrides } from "../../../../../../../lib/profile-analyst-edit.ts";

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  return handleMemberProfileEdit(request, memberId, (db, userId, body) => applyFieldOverrides(db, { kind: "member", id: memberId }, userId, body), { status: 201 });
}
