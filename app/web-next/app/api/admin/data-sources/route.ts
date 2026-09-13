// Port of app/server/admin.ts GET /api/admin/data-sources
import { getDb } from "../../../../../../db/client.ts";
import { SOURCE_ADAPTERS } from "../../../../../../scripts/co-newbiz/source-adapters.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const sources = getDb()
    .query("SELECT code, reliability_grade, created_at FROM md_source ORDER BY code")
    .all() as { code: string; reliability_grade: string; created_at: string }[];
  return ok(
    sources.map((s) => {
      // 실제 자격증명 env var 이름은 소스마다 제각각이다(DART_API_KEY,
      // KOSIS_API_KEY, LAW_API_OC 등 — CO_NEWBIZ_ 접두사 규칙이 아니다).
      // source-adapters.ts의 credentialEnv가 유일한 정답 소스이므로 여기서
      // 문자열을 다시 만들어내지 않고 그대로 재사용한다.
      const keyVar = SOURCE_ADAPTERS[s.code]?.credentialEnv ?? null;
      return {
        code: s.code,
        reliability_grade: s.reliability_grade,
        key_var: keyVar,
        key_present: keyVar !== null && Boolean(process.env[keyVar]?.trim()),
      };
    }),
  );
}
