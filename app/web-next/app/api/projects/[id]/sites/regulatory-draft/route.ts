// POST /api/projects/[id]/sites/regulatory-draft — a k-law-grounded REGULATORY
// PRE-REVIEW DRAFT for one site candidate (2026-10-21, decider: "주소를 넣으면
// 건축법·인허가 사안 등 관련 법규를 검토할 수 있도록"). Reads the site row
// (address/region/name/notes), asks the legal-counsel LLM for a checklist-style
// draft, and RETURNS it — never persisted, never a legal conclusion: the
// final review is a person (+ k-law 원문 확인). Deterministic fallback lists
// the standard review axes without inventing statute specifics.
import { getDb } from "../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../db/lib/access-control.ts";
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { completeOrFallback } from "../../../../../../lib/llm.ts";
import { promptAgent, systemMessage } from "../../../../../../lib/prompts.ts";
import { route } from "../../../../../../lib/route.ts";

interface SiteRow {
  id: string; name: string; region_code: string | null; address: string | null;
  infra_notes: string | null; labor_notes: string | null; note: string | null;
}

interface RegulatoryDraft { synthesis: string; items: Array<{ area: string; issue: string; check: string }>; cautions: string[] }

function normalize(raw: Record<string, unknown>): RegulatoryDraft {
  const strList = (arr: unknown, max: number) =>
    Array.isArray(arr) ? arr.map((s) => String(s ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, max) : [];
  const items = Array.isArray(raw.items)
    ? (raw.items as Array<Record<string, unknown>>).slice(0, 12).map((it) => ({
        area: String(it.area ?? "").trim().slice(0, 80),
        issue: String(it.issue ?? "").trim().slice(0, 400),
        check: String(it.check ?? "").trim().slice(0, 300),
      })).filter((it) => it.area && it.issue)
    : [];
  return {
    synthesis: String(raw.synthesis ?? "").trim().slice(0, 2000),
    items,
    cautions: strList(raw.cautions, 6),
  };
}

function fallback(site: SiteRow): RegulatoryDraft {
  return {
    synthesis: `결정론 폴백 — "${site.name}" 부지의 법규 사전검토 축만 나열합니다(주소: ${site.address ?? "미기록"}). 건축법(건축허가·개발행위허가), 산업집적활성화법(입지 지정), 환경(배출시설 신고·환경영향), 소방·재해성능, 상하수도·전기·도로 인프라 계약, 해당 지자체 조례(세금 감면·고용 의무)를 k-law 원문 확인과 함께 검토하세요. LLM 구성 후 구체적 초안이 생성됩니다.`,
    items: [
      { area: "건축", issue: "건축허가·개발행위허가 대상 여부", check: "k-law 건축법 원문 + 지자체 확인 필요" },
      { area: "환경", issue: "배출시설 신고·환경영향 검토 대상 여부", check: "환경부 고시·지자체 확인 필요" },
      { area: "인허가 절차", issue: "소요 기간·순서(통합허가 인증제 대상 여부)", check: "지자체 민원실 확인 필요" },
    ],
    cautions: ["LLM 미구성 — 결정론 폴백입니다.", "법령 조항은 반드시 k-law 원문으로 확인하세요."],
  };
}

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", { viewerMessage: "법규 사전검토 초안 생성은 analyst 역할 이상이어야 합니다." });
  if (denied) return denied;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { site_id?: unknown } | null;
  const siteId = typeof body?.site_id === "string" ? body.site_id : "";
  if (!siteId) return badRequest("invalid_request", "site_id는 필수입니다.");
  const site = getDb()
    .query("SELECT id, name, region_code, address, infra_notes, labor_notes, note FROM site WHERE id = ? AND project_id = ?")
    .get(siteId, id) as SiteRow | undefined;
  if (!site) return notFound();

  const context = [
    `부지명: ${site.name}`,
    `주소: ${site.address ?? "미기록"}`,
    `지역 코드: ${site.region_code ?? "미기록"}`,
    site.infra_notes ? `인프라 확인 메모(상하수도·전기·도로·물류): ${site.infra_notes}` : null,
    site.labor_notes ? `인력 확인 메모(주변 학교·인력pool): ${site.labor_notes}` : null,
    site.note ? `비고: ${site.note}` : null,
  ].filter(Boolean).join("\n");

  const res = await completeOrFallback(
    [
      systemMessage("s10.site_regulatory_draft"),
      {
        role: "user" as const,
        content:
          "아래 부지 정보를 근거로 건축법·인허가 등 검토가 필요한 법규 사안 목록 초안을 작성하세요.\n" +
          'JSON: {"synthesis":"검토 관점 요약 2~4문장","items":[{"area":"건축|환경|용도지역|인허가 절차|기타","issue":"검토 사안","check":"사람이 확인할 방법"}],"cautions":["주의 사항"]}\n\n' +
          context,
      },
    ],
    () => JSON.stringify(fallback(site)),
    { maxTokens: 1800, agent: promptAgent("s10.site_regulatory_draft") },
  );
  let draft: RegulatoryDraft;
  let note: string;
  if (res.source === "llm") {
    const start = res.text.indexOf("{");
    const end = res.text.lastIndexOf("}");
    let raw: Record<string, unknown> | null = null;
    if (start !== -1 && end > start) {
      try { raw = JSON.parse(res.text.slice(start, end + 1)) as Record<string, unknown>; } catch { raw = null; }
    }
    draft = raw ? normalize(raw) : fallback(site);
    note = raw ? "LLM 초안 — k-law 원문 확인 후 사람이 확정합니다 (경계 #2)." : "LLM 응답 파싱 실패 — 결정론 폴백으로 대체했습니다.";
  } else {
    draft = fallback(site);
    note = "LLM 미구성 — 결정론 폴백(축 나열만). CO_NEWBIZ_LLM_* 구성 후 재생성하세요.";
  }
  appendAudit(getDb(), { actor: auth.auth.userId, action: "site_regulatory_draft.generate", target: `${id}:${siteId}:${res.source}`, now: new Date().toISOString() });
  return ok({ source: res.source, provider: res.provider, note, draft }, 200);
});
