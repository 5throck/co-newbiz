// POST /api/projects/[id]/milestones/suggest — AI milestone RECOMMENDATIONS
// (2026-10-21, decider: "AI를 활용해 자동으로 진행할 수 있는 프로세스를 적극
// 반영"). Reads the project's track, adopted business case and the current
// milestone register, asks the LLM for 4–7 non-duplicate suggestions, and
// RETURNS them with computed due dates — never persisted: each suggestion
// becomes a milestone only when the person adds it through the existing
// audited POST. Deterministic fallback without an LLM (track-based axes).
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { MILESTONE_CATEGORIES, listMilestones, type MilestoneCategory } from "../../../../../../lib/milestones.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { completeOrFallback } from "../../../../../../lib/llm.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";
import { findAdoptedCase, listBusinessCases } from "../../../../../../lib/business-case.ts";
import { route } from "../../../../../../lib/route.ts";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "Milestone recommendation requires the analyst role or higher." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  const project = db.query("SELECT project_no, project_name, track FROM md_project WHERE id = ?").get(id) as
    | { project_no: string; project_name: string | null; track: string | null }
    | undefined;
  if (!project) return notFound();

  const adopted = findAdoptedCase(listBusinessCases(id));
  const existing = listMilestones(db, id).filter((m) => m.status !== "done").map((m) => m.title);
  const track = project.track ?? "unknown";
  const context = [
    `트랙: ${track}${track === "greenfield" ? " (연구개발 기반 사업화 — 기술 검증·인허가·사업화 관점)" : track === "brownfield" ? " (M&A 실사·PMI 관점 — 실사 종결·시너지·핵심인재·통합 관점)" : ""}`,
    `사업 케이스: ${adopted ? `${adopted.name} (시나리오 ${adopted.scenario ?? "?"})` : "미채택"}`,
    `기존 등록 마일스톤: ${existing.length > 0 ? existing.join(" · ") : "없음"}`,
  ].join("\n");

  const res = await completeOrFallback(
    [
      systemMessage("s12.milestone_suggest"),
      {
        role: "user" as const,
        content:
          "아래 정보를 근거로 마일스톤 4~7건을 추천하세요.\n" +
          'JSON: {"suggestions":[{"title":"실행 가능한 마일스톤 제목","category":"permit|certification|capex|contract|custom","due_in_days":180,"reason":"추천 사유 한 문장"}]}\n\n' +
          context,
      },
    ],
    () =>
      JSON.stringify({
        suggestions:
          track === "greenfield"
            ? [
                { title: "기술 검증(TRL) 목표 달성", category: "custom", due_in_days: 180, reason: "연구개발 기반 사업화의 선행 검증점" },
                { title: "주요 인허가 착수 완료", category: "permit", due_in_days: 270, reason: "사업화 리드타임의 병목" },
                { title: "초기 판매/파일럿 고객 확보", category: "contract", due_in_days: 365, reason: "사업화 신호 확인" },
              ]
            : [
                { title: "실사(DD) 종결 조건 충족", category: "custom", due_in_days: 120, reason: "M&A 실행 선행 조건" },
                { title: "핵심인재 잔류 계약 완료", category: "contract", due_in_days: 240, reason: "PMI 핵심 리스크" },
                { title: "시너지 1단계 인증", category: "custom", due_in_days: 420, reason: "통합 성과 검증점" },
              ],
      }),
    { maxTokens: 1200, agent: promptAgent("s12.milestone_suggest") },
  );

  let suggestions: Array<{ title: string; category: MilestoneCategory; due_date: string; due_in_days: number; reason: string }> = [];
  let source: "llm" | "synthesis" = res.source;
  let note = "LLM 추천 — 추가 버튼으로 등록하면 감사 로그가 남습니다 (경계 #2).";
  const today = Date.now();
  const build = (raw: Array<Record<string, unknown>>) =>
    (Array.isArray(raw) ? raw : [])
      .map((it) => {
        const title = String(it.title ?? "").trim().slice(0, 200);
        const days = Math.min(Math.max(Number(it.due_in_days ?? 180) || 180, 30), 730);
        const rawCategory = String(it.category ?? "custom");
        const category = (MILESTONE_CATEGORIES as readonly string[]).includes(rawCategory) ? (rawCategory as MilestoneCategory) : "custom";
        return { title, category, due_date: new Date(today + days * 86_400_000).toISOString().slice(0, 10), due_in_days: days, reason: String(it.reason ?? "").trim().slice(0, 300) };
      })
      .filter((it) => it.title);
  try {
    const start = res.text.indexOf("{");
    const end = res.text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const raw = JSON.parse(res.text.slice(start, end + 1)) as { suggestions?: unknown };
      suggestions = build((raw.suggestions ?? []) as Array<Record<string, unknown>>);
    }
  } catch { /* fall through to fallback suggestions */ }
  if (suggestions.length === 0) {
    suggestions = build((JSON.parse(res.text) as { suggestions?: Array<Record<string, unknown>> }).suggestions ?? []);
    note = "LLM 응답 파싱 실패 — 결정론 폴백 추천입니다.";
  }
  appendAudit(db, { actor: auth.auth.userId, action: "project_milestone.suggested", target: `${id}:${source}:${suggestions.length}`, now: new Date().toISOString() });
  return ok({ source, note, suggestions }, 200);
});
