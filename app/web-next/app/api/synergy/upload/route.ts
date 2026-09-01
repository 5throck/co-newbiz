// 신용평가자료 등 근거 파일 업로드 — 비상장 회사 등록 시 첨부.
// 파일은 workspace/uploads/에 ULID 프리픽스로 저장하고, PDF·텍스트 파일은
// python/extract_upload_text.py로 텍스트를 추출해 <stored>.txt로 함께 저장한다.
// 파이프라인(synergy/company-profile)은 이 추출 텍스트를 근거 컨텍스트로 사용한다.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { authenticate } from "../../../../lib/auth.ts";
import { badRequest, forbidden, ok } from "../../../../lib/envelope.ts";
import { ulid } from "../../../../../../db/lib/ulid.ts";

const UPLOAD_DIR = join(process.cwd(), "..", "workspace", "uploads");
const MAX_SIZE = 20 * 1024 * 1024; // 20MB
const EXTRACTOR = join(process.cwd(), "..", "..", "python", "extract_upload_text.py");

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "파일 업로드는 analyst 역할 이상이어야 합니다.");

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return badRequest("invalid_request", "file (multipart)는 필수입니다.");
  if (file.size === 0 || file.size > MAX_SIZE) return badRequest("invalid_request", "파일은 0바이트 초과 20MB 이하여야 합니다.");

  const safeName = file.name.replace(/[^\w.\-가-힣 ]/g, "_").slice(0, 120);
  const stored = `${ulid()}-${safeName}`;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const savedPath = join(UPLOAD_DIR, stored);
  writeFileSync(savedPath, Buffer.from(await file.arrayBuffer()));

  // 텍스트 추출 — 성공하면 <stored>.txt로 저장 (파이프라인이 근거로 읽음)
  let extracted = false;
  let extractError: string | null = null;
  try {
    if (existsSync(EXTRACTOR)) {
      const out = execFileSync("python", [EXTRACTOR, savedPath], { encoding: "utf-8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
      if (out && out.trim().length > 0) {
        writeFileSync(`${savedPath}.txt`, out, "utf-8");
        extracted = true;
      } else {
        extractError = "텍스트를 추출하지 못했습니다 (스캔 PDF 또는 비지원 형식). 파일명은 근거로 기록됩니다.";
      }
    } else {
      extractError = "추출 스크립트가 없습니다 (python/extract_upload_text.py).";
    }
  } catch (err) {
    extractError = `텍스트 추출 실패: ${err instanceof Error ? err.message : String(err)}`;
  }

  return ok(
    { stored_as: stored, original_name: file.name, size: file.size, extracted, extract_error: extractError },
    201,
  );
}

/** 업로드된 파일의 추출 텍스트 — 파이프라인이 근거 컨텍스트로 사용한다. */
export function readExtractedText(storedAs: string): string | null {
  try {
    const p = join(UPLOAD_DIR, `${storedAs}.txt`);
    return existsSync(p) ? readFileSync(p, "utf-8").slice(0, 60_000) : null;
  } catch {
    return null;
  }
}

export const _uploadDir = UPLOAD_DIR;
