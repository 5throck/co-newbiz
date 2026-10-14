// GET /api/projects/[id]/s8-lens-summary — both S8 lens statuses (기술적 타당성 /
// 재무적 타당성) for the summary strip, the FS gate brief and the target
// comparison (ADR-0169). Read-only decision support: 충족 / 주의 / 미판정, never a
// grade cap or a gate block. Visibility is deny-by-default (non-members 404).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate, requireBusinessActor } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { buildS8LensSummary } from "../../../../../lib/s8-lens-summary.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  { const denied = requireBusinessActor(auth.auth, "read"); if (denied) return denied; }
  const { id } = await params;
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  return ok(buildS8LensSummary(getDb(), id), 200);
}
