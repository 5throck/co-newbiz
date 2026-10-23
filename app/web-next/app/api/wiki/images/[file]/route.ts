// 위키 캡처 이미지 서빙(읽기 전용). docs/wiki/ko/images/의 PNG를 fs에서
// 읽어 내린다 — public/ 복사(이중 SSOT)나 generated 번들 삽입(6.5MB)은 기각된
// 길이고, 프로덕션 런타임 이미지가 docs/를 싣는 것이 실측 근거다(2026-10-23
// 위키 인앱 뷰어 설계 D4). 파일명은 생성기가 박아 넣은 허용목록으로만
// 해석된다 — path.basename 정규화 후 목록 밖 이름(traversal 시도 포함)은
// 무조건 404다. 인증은 authenticate() — 같은 오리진 <img> 요청에 세션 쿠키가
// 자동 실리므로 인증 필요 이미지도 <img>로 그려진다(설계 D7).
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { authenticate } from "../../../../../lib/auth.ts";
import { resolveWikiImageFile } from "../../../../../lib/wiki.ts";
import { notFound } from "../../../../../lib/envelope.ts";

// import.meta.dirname은 Turbopack 번들링에서 생존하지 않는다(프로덕션 컨테이너
//에서 undefined — app/api/admin/adr/route.ts의 실측 주석 참고). cwd에서 위로
// 걸어 올라가 docs/wiki/ko/images 마커를 찾는다 — 같은 규율.
function resolveWikiImagesDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "docs", "wiki", "ko", "images");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), "docs", "wiki", "ko", "images");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { file } = await params;
  const name = resolveWikiImageFile(file);
  if (!name) return notFound(`No wiki image named ${name ?? file}.`);

  const filePath = path.join(resolveWikiImagesDir(), name);
  let bytes: Buffer;
  try {
    const st = statSync(filePath);
    // ETag는 크기+mtime(설계 D4) — 캡처는 같은 이름으로 덮어쓰이므로 immutable
    // 캐시는 재촬영이 묻히는 함정이다. 짧은 max-age + ETag 재검증으로 둔다.
    const etag = `"wiki-img-${st.size}-${Math.floor(st.mtimeMs)}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    bytes = readFileSync(filePath);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(st.size),
        "Cache-Control": "public, max-age=300",
        ETag: etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // 허용목록에 있지만 파일이 사라진 경우(투영 스테일) — 404가 정직한 답이다.
    return notFound(`No wiki image named ${name}.`);
  }
}
