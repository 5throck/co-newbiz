// POST /api/brownfield/[oppId]/targets/[targetId]/screening-draft — S7 스크리닝
// 판정(t-01~t-09) LLM 초안 (ADR-0118 계약). 웹검색 근거(lib/web-research.ts)를
// 후보 회사 × 체크리스트 항목 단위로 확보한 뒤, 근거가 있는 항목만 판정 초안을
// 만든다. 근거를 찾지 못한 항목은 판정하지 않고 null + "근거 부족" 사유를
// 반환한다 — 전 항목을 억지로 채우지 않는다. 검색 미설정이면 전체 미판정 폴백.
// 저장은 없다 — 초안은 사람이 확인·수정한 뒤 기존 POST .../targets/{targetId}
// (판정 저장)로 확정된다. 저장 경로는 LLM을 전혀 모른다.
import { getDb } from "../../../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../../../lib/auth.ts";
import { forbidden, notFound, ok } from "../../../../../../../lib/envelope.ts";
import { completeOrFallback, type LlmOrFallback } from "../../../../../../../lib/llm.ts";
import { isWebResearchConfigured, researchSources, type WebSource } from "../../../../../../../lib/web-research.ts";
import { screeningItems } from "../../../../../../../lib/brownfield-targets.ts";
import { systemMessage } from "../../../../../../../lib/prompts.ts";

interface ItemDraft {
  verdict: "pass" | "fail" | "na" | "waived";
  rationale: string;
  source_url: string | null;
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const VERDICTS = new Set(["pass", "fail", "na", "waived"]);

/** LLM 응답 → 항목별 초안 (순수 함수, 테스트 가능성을 위해 export).
 * 화이트리스트 정규화: verdict enum 검증, 근거 인용(source_index)으로 출처
 * 복원, 근거·판정 없는 항목은 초안 자체를 만들지 않는다. */
export function parseScreeningDrafts(
  llmRes: LlmOrFallback,
  evidence: Map<string, WebSource[]>,
  openItems: Array<{ id: string }>,
): Record<string, ItemDraft> {
  const drafts: Record<string, ItemDraft> = {};
  if (llmRes.source !== "llm") return drafts;
  const parsed = parseJson(llmRes.text);
  const raw = (parsed?.drafts ?? null) as Record<string, Record<string, unknown>> | null;
  if (!raw) return drafts;
  for (const it of openItems) {
    const d = raw[it.id];
    if (!d) continue;
    const verdict = typeof d.verdict === "string" && VERDICTS.has(d.verdict) ? (d.verdict as ItemDraft["verdict"]) : null;
    if (!verdict) continue; // 근거·판정 없는 항목은 초안도 없다
    const srcIdx = typeof d.source_index === "number" ? Math.floor(d.source_index) - 1 : -1;
    const sources = evidence.get(it.id) ?? [];
    const src = srcIdx >= 0 && srcIdx < sources.length ? sources[srcIdx] : (sources[0] ?? null);
    drafts[it.id] = {
      verdict,
      rationale: typeof d.rationale === "string" ? d.rationale.trim().slice(0, 300) : "",
      source_url: src?.url ?? null,
    };
  }
  return drafts;
}

export async function POST(request: Request, { params }: { params: Promise<{ oppId: string; targetId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "판정 초안 생성은 analyst 역할 이상이어야 합니다.");
  const { oppId, targetId } = await params;
  const db = getDb();
  const opp = db.query("SELECT id FROM opportunity WHERE id = ?").get(oppId) as { id: string } | undefined;
  if (!opp) return notFound();
  const target = db
    .query("SELECT id, company_name, screening_json FROM brownfield_target WHERE id = ? AND opportunity_id = ?")
    .get(targetId, oppId) as { id: string; company_name: string; screening_json: string | null } | undefined;
  if (!target) return notFound();

  const items = screeningItems();
  if (items.length === 0) return notFound();
  // 이미 사람이 판정한 항목은 초안 대상에서 제외한다 — 초안은 미판정만 채운다.
  const saved = target.screening_json ? (JSON.parse(target.screening_json) as Record<string, string>) : {};
  const openItems = items.filter((it) => {
    const st = saved[it.id];
    return !st || st === "pending";
  });
  if (openItems.length === 0) {
    return ok(
      { source: "synthesis", provider: "deterministic", note: "모든 항목이 이미 판정되어 있습니다 — 사람이 저장한 판정을 유지합니다.", drafts: {}, manifest: [] },
      200,
      { nothing_to_draft: true },
    );
  }

  // 검색 미설정이면 전체 미판정 — 어떤 판정값도 날조하지 않는다.
  if (!isWebResearchConfigured()) {
    return ok(
      {
        source: "synthesis",
        provider: "deterministic",
        note: "실시간 웹 검색이 설정되지 않았습니다 — 판정 초안 대신 근거 수집을 건너뜁니다. 판정은 사람이 직접하세요.",
        drafts: {},
        manifest: [],
      },
      200,
      { no_grounding: true },
    );
  }

  // ── 항목별 검색 근거 확보 (회사 × 항목) ──
  const manifest: string[] = [];
  const evidence = new Map<string, WebSource[]>();
  for (const it of openItems) {
    const sources = await researchSources([`${target.company_name} ${it.text.slice(0, 40)}`], 3);
    if (sources.length > 0) {
      evidence.set(it.id, sources);
      manifest.push(`${it.id} — ${it.text}`);
    }
  }
  if (evidence.size === 0) {
    return ok(
      {
        source: "synthesis",
        provider: "deterministic",
        note: "웹 검색에서 근거를 찾지 못했습니다 — 판정은 사람이 직접하세요.",
        drafts: {},
        manifest: [],
      },
      200,
      { no_grounding: true },
    );
  }

  // ── LLM 초안 — 근거가 있는 항목만 판정 ──
  const evidenceBlock = [...evidence.entries()]
    .map(([itemId, sources]) =>
      `${itemId}:\n${sources.map((s, i) => `  [${i + 1}] ${s.title}\n  URL: ${s.url}\n  ${s.snippet.slice(0, 200)}`).join("\n")}`,
    )
    .join("\n\n");
  const llmRes: LlmOrFallback = await completeOrFallback(
    [
      systemMessage("s7.screening_draft"),
      {
        role: "user" as const,
        content: [
          `대상 후보: ${target.company_name}`,
          "",
          "판정할 항목 (chk-target-screening):",
          ...openItems.filter((it) => evidence.has(it.id)).map((it) => `${it.id} — ${it.text}`),
          "",
          "각 항목별 검색 근거:",
          evidenceBlock,
          "",
          'JSON만 반환: {"drafts":{"<항목id>":{"verdict":"pass|fail|na|waived","rationale":"근거 한 줄 — 어떤 근거에서 확인했는지","source_index":근거번호}}}',
          "근거가 판정을 뒷받침하지 않는 항목은 drafts에서 아예 빼거나 verdict를 null로 두세요.",
        ].join("\n"),
      },
    ],
    () => "",
    {
      maxTokens: 1200,
      agent: {
        key: "brownfield-agent",
        purpose: "S7 스크리닝 판정 초안 — 항목별 검색 근거 기반",
        contextType: "opportunity",
        contextId: oppId,
      },
    },
  );

  appendAudit(db, { actor: auth.auth.userId, action: "target_screening.llm_draft", target: `${oppId}:${targetId}`, now: new Date().toISOString() });

  const drafts = parseScreeningDrafts(llmRes, evidence, openItems.map((it) => ({ id: it.id })));
  const note =
    Object.keys(drafts).length === 0
      ? "근거가 판정을 뒷받침하지 못해 초안을 만들 항목이 없습니다 — 판정은 사람이 직접하세요."
      : `LLM이 ${Object.keys(drafts).length}개 항목의 판정 초안을 만들었습니다 — 확인·수정 뒤 "판정 저장"으로 확정하세요.`;
  return ok({ source: llmRes.source, provider: llmRes.provider, note, drafts, manifest }, 200, { drafted: Object.keys(drafts).length });
}
