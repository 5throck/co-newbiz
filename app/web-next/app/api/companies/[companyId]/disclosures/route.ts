// GET /api/companies/[companyId]/disclosures — DART 공시 목록 (후보 상세
// 화면용, 2026-09-15). dart-client.searchDisclosures의 프리셋(최근 공시/
// 사업보고서/정정/감사/자본변동)을 그대로 노출하고, 각 공시에 DART 뷰어 링크
// (viewer_url)를 붙여준다. 외부 데이터라 LLM 개입 없이 결정론 조회만 한다.
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../db/client.ts";
import { DISCLOSURE_PRESETS, searchDisclosures, type DisclosurePreset } from "../../../../../lib/dart-client.ts";

const VIEWER_BASE = "https://dart.fss.or.kr/dsaf007/1/view.do?rcpNo=";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { companyId } = await params;
  const db = getDb();
  const company = db.query("SELECT id, name_ko, dart_corp_code FROM md_company WHERE id = ?").get(companyId) as
    | { id: string; name_ko: string; dart_corp_code: string | null }
    | undefined;
  if (!company) return notFound();
  if (!company.dart_corp_code) {
    return ok({ company: { id: company.id, name_ko: company.name_ko }, dart_linked: false, presets: DISCLOSURE_PRESETS, disclosures: [] }, 200, { count: 0 });
  }
  const url = new URL(request.url);
  const presetParam = url.searchParams.get("preset") ?? "recent";
  if (!DISCLOSURE_PRESETS.some((p) => p.key === presetParam)) {
    return badRequest("invalid_preset", `preset는 ${DISCLOSURE_PRESETS.map((p) => p.key).join(" | ")} 중 하나입니다.`);
  }
  const result = await searchDisclosures(company.dart_corp_code, presetParam as DisclosurePreset["key"], 20);
  // DART 목록은 페이지네이션 겹침 등으로 같은 접수번호가 중복될 수 있다 — dedupe.
  const seen = new Set<string>();
  const disclosures = result.disclosures
    .filter((d) => {
      if (!d.rcept_no || seen.has(d.rcept_no)) return false;
      seen.add(d.rcept_no);
      return true;
    })
    .map((d) => ({
      ...d,
      viewer_url: d.rcept_no ? `${VIEWER_BASE}${d.rcept_no.replace(/-/g, "")}` : null,
    }));
  return ok(
    {
      company: { id: company.id, name_ko: company.name_ko, dart_corp_code: company.dart_corp_code },
      dart_linked: true,
      presets: DISCLOSURE_PRESETS,
      error: result.error ?? null,
      disclosures,
    },
    200,
    { count: disclosures.length },
  );
}
