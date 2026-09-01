// 그룹/계열사 분석 — 계열사 근거 파일(신용평가자료 등) 업로드.
// 시너지 정합성 업로드와 동일한 extract_upload_text.py 파이프라인으로 텍스트를 추출한다.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../../db/lib/ulid.ts";

const UPLOAD_DIR = join(process.cwd(), "..", "workspace", "uploads");
const MAX_SIZE = 20 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "파일 업로드는 analyst 역할 이상이어야 합니다.");
  const { memberId } = await params;
  const db = getDb();
  const member = db
    .query("SELECT id, company_name FROM company_group_member WHERE id = ?")
    .get(memberId) as { id: string; company_name: string } | null;
  if (!member) return notFound();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("invalid_request", "file (multipart)는 필수입니다.");
  if (file.size === 0 || file.size > MAX_SIZE) return badRequest("invalid_request", "파일은 0바이트 초과 20MB 이하여야 합니다.");

  const safeName = file.name.replace(/[^\w.\-가-힣 ]/g, "_").slice(0, 120);
  const stored = `${ulid()}-${safeName}`;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(join(UPLOAD_DIR, stored), Buffer.from(await file.arrayBuffer()));

  return ok({ stored_as: stored, original_name: file.name, size: file.size, member_id: memberId, company: member.company_name }, 201);
}
