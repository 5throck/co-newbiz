// 가치사슬 연계 후보 산업 조회 (S1 분석·재분석 모달용). 대상 산업과 연관된
// 산업 후보를 두 출처에서 모은다: (1) 가치사슬 연계(structural 이하 전 hop,
// ADR-0126), (2) 최신 S1 분석 payload의 산업 사슬 방향(Step 1 산출).
// industry_id나 name 중 하나로 대상을 지정한다 — 신규 분석(마스터 미등록)은
// name만 있어도 payload/링크가 없어 빈 후보를 돌려준다(모달에 안내 표시).
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../../lib/envelope.ts";
import { completeOrFallback } from "../../../../lib/llm.ts";

interface Candidate { name_ko: string; industry_id: string | null; relation: string; note: string | null; source: "link" | "analysis" | "proxy" }
const norm = (s: string) => s.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, "").replace(/산업$/, "");

function loadStoredCandidates(industry: { id: string; name_ko: string } | null): Candidate[] {
  if (!industry) return [];
  const db = getDb();
  const candidates: Candidate[] = [];
  const seen = new Set<string>([norm(industry.name_ko)]);

  // (1) 가치사슬 연계 — 이미 승인된 링크의 상대 산업
  const links = db
    .query(
      `SELECT i.name_ko,
              CASE WHEN pl.to_industry_id = ? THEN 'upstream' ELSE 'downstream' END AS direction,
              pl.evidence_ref
       FROM proxy_link pl
       JOIN md_industry i ON i.id = CASE WHEN pl.to_industry_id = ? THEN pl.from_industry_id ELSE pl.to_industry_id END
       WHERE pl.from_industry_id = ? OR pl.to_industry_id = ?`,
    )
    .all(industry.id, industry.id, industry.id, industry.id) as Array<{ name_ko: string; direction: "upstream" | "downstream"; evidence_ref: string }>;
  for (const l of links) {
    const key = norm(l.name_ko);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      name_ko: l.name_ko,
      industry_id: (db.query("SELECT id FROM md_industry WHERE name_ko = ?").get(l.name_ko) as { id: string } | null)?.id ?? null,
      relation: l.direction === "upstream" ? "후방" : "전방",
      note: l.evidence_ref,
      source: "link",
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

// POST — 1차 프록시 산업 분석: 저장된 후보가 없을 때 LLM이 대상 산업의
// 가치사슬 인접 산업을 즉석 제안한다(analysis/proxy 출처 구분). 제안일 뿐
// 선택(모달 체크) 전까지는 산업 등록·분석이 일어나지 않는다(경계 #2).
export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "1차 프록시 분석은 analyst 역할 이상이어야 합니다.");
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const target = body?.name?.trim();
  if (!target) return badRequest("name_required", "산업명(name)은 필수입니다.");
  const db = getDb();
  const industry = db.query("SELECT id, name_ko FROM md_industry WHERE name_ko = ?").get(target) as { id: string; name_ko: string } | null;
  const stored = loadStoredCandidates(industry);

  const res = await completeOrFallback(
    [
      { role: "system" as const, content: "당신은 가치사슬 분석가입니다. 제공된 산업의 상류(원자재·부품 공급)와 하류(수요처) 인접 산업을 제안하세요. 근거 없는 판단은 주석으로 '검증 필요'를 남깁니다. JSON만 반환합니다." },
      {
        role: "user" as const,
        content:
          `산업 "${target}"의 가치사슬 인접 산업을 3~6개 제안하세요. ` +
          `JSON: {"relatedIndustries":[{"relation":"후방|전방|후후방|전전방","name":"산업명(한국어, 산업으로 등록 가능한 명사형)","note":"연관성 한 문장"}]} ` +
          `position이 없어도 되니 상류·하류를 고르게 담으세요.\n\n산업명: ${target}`,
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
    { maxTokens: 1200, agent: { key: "market-intelligence-agent", purpose: "1차 프록시 산업 분석 — 가치사슬 인접 산업 제안" } },
  );
  let proposals: Array<{ relation?: string; name?: string; note?: string }> = [];
  try {
    const parsed = JSON.parse(res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1)) as {
      relatedIndustries?: Array<{ relation?: string; name?: string; note?: string }>;
    };
    proposals = parsed.relatedIndustries ?? [];
  } catch { /* 폴백 없음 — 저장된 후보만 반환 */ }

  const seen = new Set<string>([norm(target), ...stored.map((c) => norm(c.name_ko))]);
  const candidates: Candidate[] = [...stored];
  for (const r of proposals) {
    const n = (r.name ?? "").trim();
    const key = norm(n);
    if (!n || !key || seen.has(key)) continue;
    seen.add(key);
    const master = db.query("SELECT id FROM md_industry WHERE name_ko = ?").get(n) as { id: string } | null;
    candidates.push({
      name_ko: n,
      industry_id: master?.id ?? null,
      relation: r.relation ?? "연관",
      note: (r.note ?? "") + (res.source === "llm" ? "" : " — 결정론 폴백"),
      source: "proxy",
    });
  }
  return ok({ industry, candidates }, 200, { count: candidates.length });
}
