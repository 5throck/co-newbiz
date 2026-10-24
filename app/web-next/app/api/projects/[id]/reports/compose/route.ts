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
import { completeOrFallback } from "../../../../../../lib/llm.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Report-draft generation requires the analyst role or higher.");
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const composed = composeProjectReport(getDb(), id, project.project_no, project.project_name ?? project.project_no);
  // AI 자동화 — 경영 요약 초안을 LLM으로 작성해 본문 맨 앞에 삽입해 "반환"한다.
  // 저장은 사람이 스냅샷 저장으로 실행하며, LLM 실패·미구성 시 결정론 요약(§1)만 남는다.
  let contentMd = composed.markdown;
  let aiSummary: string | null = null;
  let aiNote = "경영 요약: LLM 미구성 — 결정론 요약(§1)을 사용하세요.";
  try {
    const res = await completeOrFallback(
      [
        systemMessage("s11.report_narration"),
        { role: "user" as const, content: "검토 팩트:\n" + composed.markdown.slice(0, 6000) + '\n\nJSON: {"summary":"경영진용 요약 3~5문장"}' },
      ],
      () => "",
      { maxTokens: 900, agent: promptAgent("s11.report_narration") },
    );
    if (res.source === "llm") {
      const start = res.text.indexOf("{");
      const end = res.text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        const raw = JSON.parse(res.text.slice(start, end + 1)) as { summary?: unknown };
        const summary = String(raw.summary ?? "").trim();
        if (summary) {
          aiSummary = summary;
          contentMd = `## 0. 경영 요약 (AI 초안 — 검토 필수)\n\n${summary}\n\n` + contentMd;
          aiNote = "경영 요약 초안을 삽입했습니다 — 검토·수정 후 저장하세요 (경계 #2).";
        }
      }
    }
  } catch {
    // narration is best-effort — the deterministic report stands on its own
  }
  return ok({ title: composed.title, content_md: contentMd, sections: composed.sections, ai_summary: aiSummary, ai_note: aiNote }, 200, {
    section_count: composed.sections.length,
  });
});