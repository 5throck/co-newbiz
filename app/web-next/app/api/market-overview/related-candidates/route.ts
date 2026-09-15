// 가치사슬 연계 후보 산업 조회 (S1 분석·재분석 모달용). 대상 산업과 연관된
// 산업 후보를 두 출처에서 모은다: (1) 가치사슬 연계(structural 이하 전 hop,
// ADR-0126), (2) 최신 S1 분석 payload의 산업 사슬 방향(Step 1 산출).
// industry_id나 name 중 하나로 대상을 지정한다 — 신규 분석(마스터 미등록)은
// name만 있어도 payload/링크가 없어 빈 후보를 돌려준다(모달에 안내 표시).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../../lib/envelope.ts";
import { completeOrFallback } from "../../../../lib/llm.ts";
import { isWebResearchConfigured, researchSources } from "../../../../lib/web-research.ts";
import { sanitizeRelatedProposals } from "../../../../lib/value-chain-proposals.ts";
import { promptAgent, systemMessage } from "../../../../lib/prompts.ts";

interface Candidate {
  name_ko: string; industry_id: string | null; relation: string; note: string | null; source: "link" | "analysis" | "proxy";
  // ADR-0129 — source:"link" 후보에 한해 채워진다. proxy_link.source(사람이
  // 등록했는지/승인했는지)와 proxy_link.status(활성/은퇴)를 UI가 구분할 수
  // 있게 한다. 기존 discriminator(candidate.source: link/analysis/proxy)와
  // 이름 충돌을 피하기 위해 별도 필드명을 쓴다.
  linkSource?: string;
  linkStatus?: string;
}
const norm = (s: string) => s.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, "").replace(/산업$/, "");

function loadStoredCandidates(industry: { id: string; name_ko: string } | null): Candidate[] {
  if (!industry) return [];
  const db = getDb();
  const candidates: Candidate[] = [];
  const seen = new Set<string>([norm(industry.name_ko)]);

  // (1) 가치사슬 연계 — 이미 승인·태깅된 링크의 상대 산업만. relation이
  // NULL인 레거시 미태깅 행(ADR-0126 시절 등록, ADR-0129 검토 큐 대상)은
  // 사람이 아직 전방/전전방/후방/후후방 중 하나로 확인하지 않은 상태이므로
  // 여기 포함시키면 안 된다 — 포함시키면 재분석 모달이 이를 "이미 등록된
  // 연계"로 오인해 강제 잠금(locked) 처리해버린다(레거시 검토 전 자동 확정
  // 방지, 산업 상세 화면의 레거시 검토 큐에서만 다뤄야 한다).
  const links = db
    .query(
      `SELECT i.name_ko, pl.evidence_ref, pl.relation, pl.source AS link_source, pl.status AS link_status
       FROM proxy_link pl
       JOIN md_industry i ON i.id = CASE WHEN pl.to_industry_id = ? THEN pl.from_industry_id ELSE pl.to_industry_id END
       WHERE (pl.from_industry_id = ? OR pl.to_industry_id = ?) AND pl.status = 'active' AND pl.relation IS NOT NULL`,
    )
    .all(industry.id, industry.id, industry.id) as Array<{
    name_ko: string; evidence_ref: string; relation: string; link_source: string; link_status: string;
  }>;
  for (const l of links) {
    const key = norm(l.name_ko);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      name_ko: l.name_ko,
      industry_id: (db.query("SELECT id FROM md_industry WHERE name_ko = ?").get(l.name_ko) as { id: string } | null)?.id ?? null,
      relation: l.relation,
      note: l.evidence_ref,
      source: "link",
      linkSource: l.link_source,
      linkStatus: l.link_status,
    });
  }

  // (2) 최신 S1 분석의 산업 사슬 방향 (Step 1 LLM 산출)
  const latest = db
    .query(
      `SELECT v.payload FROM market_sizing_version v
       JOIN market_sizing_analysis a ON a.id = v.analysis_id
       WHERE a.industry_id = ? AND a.status = 'completed'
       ORDER BY v.version_no DESC LIMIT 1`,
    )
    .get(industry.id) as { payload: string } | null;
  if (latest) {
    try {
      const parsed = JSON.parse(latest.payload) as {
        matrix?: { chainDirection?: { relatedIndustries?: Array<{ relation?: string; name?: string; note?: string }> } };
      };
      for (const r of parsed.matrix?.chainDirection?.relatedIndustries ?? []) {
        const n = (r.name ?? "").trim();
        const key = norm(n);
        if (!n || n === "—" || !key || seen.has(key)) continue;
        seen.add(key);
        const master = db.query("SELECT id FROM md_industry WHERE name_ko = ?").get(n) as { id: string } | null;
        candidates.push({
          name_ko: n,
          industry_id: master?.id ?? null,
          relation: r.relation ?? "연관",
          note: r.note ?? null,
          source: "analysis",
        });
      }
    } catch { /* payload 파싱 실패 — 링크 후보만 반환 */ }
  }
  return candidates;
}

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const db = getDb();

  const industryId = url.searchParams.get("industry_id");
  const name = url.searchParams.get("name")?.trim();
  const industry = (industryId
    ? db.query("SELECT id, name_ko FROM md_industry WHERE id = ?").get(industryId)
    : name
      ? db.query("SELECT id, name_ko FROM md_industry WHERE name_ko = ?").get(name)
      : null) as { id: string; name_ko: string } | null;

  const candidates = loadStoredCandidates(industry);
  return ok({ industry, candidates }, 200, { count: candidates.length });
}

// POST — 1차 가치사슬 연계 산업 분석: 저장된 후보가 없을 때 LLM이 대상 산업의
// 가치사슬 인접 산업을 즉석 제안한다(analysis/proxy 출처 구분). 제안일 뿐
// 선택(모달 체크) 전까지는 산업 등록·분석이 일어나지 않는다(경계 #2).
export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "1차 가치사슬 연계 산업 분석은 analyst 역할 이상이어야 합니다.");
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const target = body?.name?.trim();
  if (!target) return badRequest("name_required", "산업명(name)은 필수입니다.");
  const db = getDb();
  const industry = db.query("SELECT id, name_ko FROM md_industry WHERE name_ko = ?").get(target) as { id: string; name_ko: string } | null;
  const stored = loadStoredCandidates(industry);

  // 사용자 결정 — 글로벌·증권 리포트를 1차 근거로 검색해 프롬프트에 주입한다
  // (TAVILY 미설정이면 생략).
  let research: Array<{ title: string; snippet: string }> = [];
  if (isWebResearchConfigured()) {
    try {
      const sources = await researchSources([
        `${target} 가치사슬 상류 하류 공급망 분석`,
        `${target} market value chain upstream suppliers downstream customers report`,
      ], 6);
      research = sources.slice(0, 6).map((s) => ({ title: s.title, snippet: s.snippet.slice(0, 400) }));
    } catch { /* 검색 실패 — LLM 선험으로 진행 */ }
  }

  // 방법론 패널(2026-09-13) — 판정 관점을 프롬프트에 명시한다: 분석 대상은
  // "이 산업에서 사업을 운영·수행하는 사업자"이며, 사업자가 조달(지불)하는
  // 산업이 후방, 사업자의 산출물에 지불하는 수요처가 전방이다. 산업명에 행위자
  // 유형(운용/제조/유통 등)이 있으면 그 관점을 따른다. 대체재·보완재(예: 유압식
  // 브레이커에 대한 전기식 브레이커)는 사슬 후보가 아니라 relation:"대체"로
  // 별도 표기한다 — 6축 연관성 분석의 대체 위협 영역(ADR-0025 경계).
  const actorSuffix = /운용|운영/.test(target) ? "장비·설비 운용" : /제조|제작/.test(target) ? "제조" : /유통|임대|렌탈/.test(target) ? "유통·임대" : null;
  const perspectiveRule =
    "판정 규칙(사업자 관점): 대상 산업에서 사업을 운영하는 사업자가 조달하기 위해 지불하는 산업(원자재·부품·장비·부착 작업기·정비 서비스 등)은 relation=\"후방\", " +
    "사업자의 산출물·서비스에 대해 지불하는 수요처는 relation=\"전방\", 그 각각의 2홉 상·하류는 후후방·전전방이다. " +
    (actorSuffix ? `이 대상은 '${actorSuffix}' 관점의 산업이다 — 반드시 그 관점에서 판정한다. ` : "") +
    "대체재·보완재(같은 수요를 대체하거나 함께 쓰이는 별도 장비·기술)는 relation=\"대체\"로 표기하고 사슬 후보에서 제외한다. " +
    "note에는 누가 무엇을 조달/공급하는지 거래 방향이 드러나게 한 문장 적고, 근거 없는 판단은 '검증 필요' 주석을 남긴다. ";

  const res = await completeOrFallback(
    [
      systemMessage("market.related_candidates"),
      {
        role: "user" as const,
        content:
          `산업 "${target}"의 가치사슬 인접 산업을 3~6개 제안하세요. ` +
          `JSON: {"relatedIndustries":[{"relation":"후방|전방|후후방|전전방|대체","name":"산업명(한국어, 산업으로 등록 가능한 명사형, 대상 산업 자신 제외)","note":"거래 방향이 드러나는 연관성 한 문장"}]} ` +
          perspectiveRule +
          `\n\n산업명: ${target}` +
          // 사용자 결정 — 외부 리서치(글로벌·증권 리포트)를 1차 근거로 주입
          (research.length > 0
            ? `\n\n[외부 리서치 근거 — 글로벌·증권 리포트 요약] 아래 근거에 나타난 산업 관계를 우선 참고하세요. note에 출처 제목을 인용하세요:\n` +
              research.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join("\n")
            : ""),
      },
    ],
    () =>
      JSON.stringify({
        relatedIndustries: [
          { relation: "후방", name: `${target} 원자재·소재 공급 산업`, note: "결정론 템플릿(검증 필요) — 상류 소재 공급 관계 가정" },
          { relation: "후방", name: `${target} 핵심 부품·장비 공급 산업`, note: "결정론 템플릿(검증 필요) — 부품·장비 조달 관계 가정" },
          { relation: "전방", name: `${target} 유통·설치 서비스 산업`, note: "결정론 템플릿(검증 필요) — 유통·시공 채널 가정" },
          { relation: "전방", name: `${target} 최종 수요처 산업`, note: "결정론 템플릿(검증 필요) — 최종 수요 산업 가정" },
        ],
      }),
    { temperature: 0.2, maxTokens: 2200, agent: promptAgent("market.related_candidates") },
  );
  let proposals: Array<{ relation?: string; name?: string; note?: string }> = [];
  const text = res.text.replace(/```json|```/g, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as {
        relatedIndustries?: Array<{ relation?: string; name?: string; note?: string }>;
      };
      proposals = parsed.relatedIndustries ?? [];
    } catch {
      // 잘림·불완전 JSON 구제 — 완결된 relatedIndustries 객체만 골라 담는다.
      for (const om of text.matchAll(/\{\s*"relation"\s*:[\s\S]*?"name"\s*:[\s\S]*?"note"\s*:[\s\S]*?\}/g)) {
        try {
          const o = JSON.parse(om[0]) as { relation?: string; name?: string; note?: string };
          if (o.name) proposals.push(o);
        } catch { /* 부분 객체 폐기 */ }
      }
    }
  }

  // Sanitizer(방법론 패널 P0) — 무음 drop 금지: 화이트리스트 관계는 사슬 후보,
  // 대체/보완은 substitutes로 분리 표출(6축 대체 위협 검토 대상), 그 외만 폐기.
  const sanitized = sanitizeRelatedProposals(proposals, target);

  const seen = new Set<string>([norm(target), ...stored.map((c) => norm(c.name_ko))]);
  const candidates: Candidate[] = [...stored];
  for (const r of sanitized.accepted) {
    const n = r.name;
    const key = norm(n);
    if (!n || !key || seen.has(key)) continue;
    seen.add(key);
    const master = db.query("SELECT id FROM md_industry WHERE name_ko = ?").get(n) as { id: string } | null;
    candidates.push({
      name_ko: n,
      industry_id: master?.id ?? null,
      relation: r.relation,
      note: (r.note ?? "") + (res.source === "llm" ? "" : " — 결정론 폴백"),
      source: "proxy",
    });
  }
  const substitutes = sanitized.substitutes
    .filter((s) => !seen.has(norm(s.name)))
    .map((s) => ({ name_ko: s.name, relation: s.relation, note: s.note ?? null }));
  return ok({ industry, candidates, substitutes }, 200, { count: candidates.length });
}
