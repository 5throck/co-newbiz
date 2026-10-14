// POST /api/our-company/members/[memberId]/profile/sources — add a hand-entered source (URL optional, title, pasted excerpt).
// Creates a new profile version with the entry in dataSources.userSources; profile text is NOT changed.
import { handleMemberProfileEdit } from "../../../../../../../lib/profile-edit-route.ts";
import { addManualSource } from "../../../../../../../lib/profile-analyst-edit.ts";

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  return handleMemberProfileEdit(request, memberId, (db, userId, body) => addManualSource(db, { kind: "member", id: memberId }, userId, body), { status: 201 });
}
