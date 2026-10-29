// Port of app/server/admin.ts GET /api/admin/data-sources
import { getDb } from "../../../../../../db/client.ts";
import { SOURCE_ADAPTERS } from "../../../../../../scripts/co-newbiz/source-adapters.ts";
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { envKeySource, loadRootEnvPipelineKeys } from "../../../../lib/root-env.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  // The server's cwd is app/web-next, so the repo-root .env is not in
  // process.env unless imported here (allowlisted keys only, no values out).
  loadRootEnvPipelineKeys();
  const grades = new Map(
    (getDb().query("SELECT code, reliability_grade FROM md_source").all() as { code: string; reliability_grade: string }[]).map(
      (r) => [r.code.toLowerCase(), r.reliability_grade],
    ),
  );
  // 실제 자격증명 env var 이름은 소스마다 제각각이다(CO_NEWBIZ_ 접두사 규칙이
  // 아니다). source-adapters.ts의 credentialEnv가 유일한 정답 소스이다.
  return ok(
    Object.keys(SOURCE_ADAPTERS)
      .sort()
      .map((code) => {
        const keyVar = SOURCE_ADAPTERS[code]?.credentialEnv ?? null;
        const source = keyVar ? envKeySource(keyVar) : null;
        return {
          code,
          reliability_grade: grades.get(code) ?? null,
          key_var: keyVar,
          key_present: source !== null,
          key_source: source,
        };
      }),
  );
}
