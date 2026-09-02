// DART 고유번호(corp_code) 전체 덤프 수동 갱신 CLI — k-dart P1-1 (ADR: k-dart 고도화).
// corpCode.xml.zip을 강제로 재다운로드해 db/data/dart-corpcode-cache.json을 갱신한다.
// 차단(HTML 응답) 시 기존 캐시를 보존하고 결과를 보고한다.
// 실행: bun app/web-next/scripts/dart-sync-corp-codes.ts
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { searchCorpCodesWithMeta, dartBudgetUsed, isDartConfigured } from "../lib/dart-client.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const db = new Database(join(ROOT, "db", "data", "co-newbiz.sqlite"), { readonly: true });
const cacheRow = db.query("SELECT 1 FROM md_company LIMIT 1").get(); // 경로 존재 확인용 (db/data 디렉터리)
void cacheRow;
db.close();

console.log(`DART 구성: ${isDartConfigured()}`);
console.log("고유번호 전체 덤프 강제 갱신을 시도합니다…");

const meta = await searchCorpCodesWithMeta("삼성전자", 3); // 덤프 로드 트리거 + 정상성 검증용 프로브
console.log(`프로브(삼성전자 직접 검색): ${meta.results.length > 0 ? `성공 — ${meta.results.map((r) => `${r.corp_name}/${r.corp_code}`).join(", ")}` : `실패(${meta.error ?? "무응답"})`}`);

const { readFileSync, existsSync, statSync } = await import("node:fs");
const candidates = [
  join(ROOT, "db", "data", "dart-corpcode-cache.json"),
  join(process.cwd(), "db", "data", "dart-corpcode-cache.json"),
];
const cachePath = candidates.find((c) => existsSync(c));
if (cachePath) {
  const parsed = JSON.parse(readFileSync(cachePath, "utf-8")) as { fetched_at: string; row_count?: number; rows: unknown[] };
  console.log(`캐시: ${cachePath}`);
  console.log(`  갱신 시각: ${parsed.fetched_at} · 행 수: ${parsed.row_count ?? parsed.rows.length}`);
} else {
  console.log("캐시 없음 — corpCode.xml.zip이 계속 차단되면 웹 폴백 체인(resolveCorpCode)이 대신합니다.");
}
console.log(`호출 예산 사용: ${dartBudgetUsed().calls}/${dartBudgetUsed().budget}`);
