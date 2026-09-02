// 누락된 DART corp code 채우기 — k-dart 직접 검색 → 웹 폴백 → 교차 검증.
// 검증된 코드만 기록한다 (validated=true; DART 직접 검색 결과는 원천 자체가 검증).
// 실행: bun app/web-next/scripts/fill-dart-codes.ts  (워크스페이스 루트에서)
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { resolveCorpCode, isDartConfigured } from "../lib/dart-client.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const db = new Database(join(ROOT, "db", "data", "co-newbiz.sqlite"));
db.run("PRAGMA foreign_keys = ON");

interface Target { table: "company_group_member" | "md_company"; id: string; name: string }

const members = (db.query("SELECT id, company_name FROM company_group_member WHERE dart_corp_code IS NULL").all() as Array<{ id: string; company_name: string }>)
  .map((r): Target => ({ table: "company_group_member", id: r.id, name: r.company_name }));
const companies = (db.query("SELECT id, name_ko FROM md_company WHERE dart_corp_code IS NULL").all() as Array<{ id: string; name_ko: string }>)
  .map((r): Target => ({ table: "md_company", id: r.id, name: r.name_ko }));
const targets = [...members, ...companies];

console.log(`DART 코드 누락 대상 ${targets.length}건 (DART 구성: ${isDartConfigured()})`);

for (const t of targets) {
  console.log(`
=== ${t.name} (${t.table})`);
  const r = await resolveCorpCode(t.name);
  if (r.corpCode && r.validated !== false) {
    console.log(`  ${r.resolvedVia} 경로: ${r.corpCode} (${r.corpName}) — validated=${r.validated}`);
    db.run(`UPDATE ${t.table} SET dart_corp_code = ? WHERE id = ?`, [r.corpCode, t.id]);
    console.log("  → 기록");
  } else {
    console.log(`  미확보 (${r.note ?? "비상장/비실존 가능성"}) — 기록 보류`);
  }
}

console.log("\n--- 결과");
for (const t of [...members, ...companies]) {
  const row = db.query(`SELECT dart_corp_code FROM ${t.table} WHERE id = ?`).get(t.id) as { dart_corp_code: string | null };
  console.log(`${t.name}: ${row.dart_corp_code ?? "미확보"}`);
}
db.close();
