// Project charter (ADR-0104) — GET: the charter with version history; POST:
// an amendment (append-only new version, C3). Member-visible only.
import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { appendCharterAmendment } from "../../../../../lib/project-charter.ts";
import { badRequest, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

interface CharterFile {
  project_name?: string | null;
  charter_confirmed_at?: string | null;
  versions: Array<Record<string, unknown>>;
}

function readCharter(projectId: string): CharterFile | null {
  const row = getDb().query("SELECT charter_json, charter_confirmed_at, project_name FROM md_project WHERE id = ?").get(projectId) as
    | { charter_json: string | null; charter_confirmed_at: string | null; project_name: string | null }
    | undefined;
  if (!row) return null;
  let versions: Array<Record<string, unknown>> = [];
  try {
    const parsed = row.charter_json ? (JSON.parse(row.charter_json) as CharterFile) : { versions: [] };
    versions = parsed.versions ?? [];
  } catch {
    versions = [];
  }
  return { project_name: row.project_name, charter_confirmed_at: row.charter_confirmed_at, versions };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  // 아카이브(보관/삭제 표시) 프로젝트도 원본 열람이 가능해야 한다 — 읽기는 허용,
  // 쓰기(POST)는 open 전용 조회로 차단된다.
  if (!visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true })) return notFound();
  const charter = readCharter(id);
  if (!charter) return notFound();
  return ok(charter, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role === "viewer") return badRequest("role_required", "차터 변경은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(ctx, id)) return notFound();
  const body = (await request.json().catch(() => null)) as
    | { note?: string; patch?: { entryScope?: string; purpose?: string; kpis?: Array<{ key: string; label: string; target: string }> } }
    | null;
  if (!body?.note?.trim()) return badRequest("invalid_request", "note(변경 사유)는 필수입니다 — 스코프 크리프 추적을 위해 기록됩니다.");
  try {
    const result = appendCharterAmendment(getDb(), id, {
      builtBy: ctx.userId,
      note: body.note.trim(),
      patch: {
        entryScope: body.patch?.entryScope,
        purpose: body.patch?.purpose,
        kpis: body.patch?.kpis,
      },
    });
    appendAudit(getDb(), { actor: ctx.userId, action: "project_charter.amend", target: `${id}:v${result.version}`, now: new Date().toISOString() });
    return ok(result, 201);
  } catch (err) {
    return badRequest("charter_amend_failed", err instanceof Error ? err.message : "Charter amendment failed.");
  }
}
