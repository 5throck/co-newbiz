// POST /api/projects/[id]/reports/compose — build the IC-report Markdown
// draft (ADR-0116 Phase 6, approved mockup 2026-09-11-reports-composer).
// Read-only over the same data surface as the IC package route; the draft is
// returned to the composer textarea — nothing is persisted until the human
// saves the snapshot.
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { route } from "../../../../../../lib/route.ts";
import { composeProjectReport } from "../../../../../../lib/report-composer.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "보고서 초안 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const composed = composeProjectReport(getDb(), id, project.project_no, project.project_name ?? project.project_no);
  return ok({ title: composed.title, content_md: composed.markdown, sections: composed.sections }, 200, {
    section_count: composed.sections.length,
  });
});