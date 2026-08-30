// Process evaluation endpoint (read-only derived state — never persisted).
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { evaluateProcess } from "../../../../../lib/process-flow.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  return ok(evaluateProcess({ type: "project", id: project.id }), 200);
}
