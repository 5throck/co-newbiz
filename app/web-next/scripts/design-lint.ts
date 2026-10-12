// design-lint — ADR-0087/0083/0082 준수 검증 게이트.
// 검사 대상: app/**/*.tsx (page/layout/컴포넌트). 위반 발견 시 non-zero exit.
// 실행: bun scripts/design-lint.ts  (package.json "lint:design")
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const APP_DIR = join(import.meta.dir, "..", "app");
const COMPONENT_DIR = join(import.meta.dir, "..", "components");

interface Violation { file: string; line: number; rule: string; message: string }

function walkTsxs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walkTsxs(p, out);
    else if (e.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const violations: Violation[] = [];
const add = (file: string, line: number, rule: string, message: string) =>
  violations.push({ file: file.replace(/\\/g, "/"), line, rule, message });

const IS_PAGE = (f: string) => /[\\/]app[\\/].+page\.tsx$/.test(f);
// R4는 프로세스 단계 화면(StageFrame 규약 화면)에만 적용 — 참조·운영 페이지와
// 목록/개요 페이지(benchmarks/library/projects 목록·개요)는 예외.
const STAGE_ROUTES = [
  "market", "opportunities", "our-company", "synergy", "route-decision", "greenfield", "brownfield",
  "pipeline",
  "projects/[id]/business-case", "projects/[id]/dd", "projects/[id]/deal-structure",
  "projects/[id]/ic-review", "projects/[id]/portfolio", "projects/[id]/charter", "projects/[id]/process",
];
const IS_STAGE_PAGE = (f: string) => STAGE_ROUTES.some((r) => f.includes(r + "/page.tsx") || f.includes(r + "\page.tsx"));

for (const file of [...walkTsxs(APP_DIR), ...walkTsxs(COMPONENT_DIR)]) {
  const src = readFileSync(file, "utf-8");
  const lines = src.split("\n");

  lines.forEach((text, idx) => {
    const line = idx + 1;
    // R1 — 버튼 크기 2-size 규칙 (ADR-0083): btn-*에 임의 font-size 수식 금지
    const r1 = text.match(/btn-(?:ghost|danger|premium)\s+text-\[0\.\d+rem\]/);
    if (r1) add(file, line, "R1 button-size", `btn-*에 text-[...] 크기 수식 금지 — 기본 또는 btn-sm만 사용: ${r1[0].trim()}`);
    // R2 — 토큰 외 하드코딩 색상 (ADR-0087 ②): hex·rgba·hsl 직접 사용 금지
    const r2 = text.match(/["'(:]#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b|rgba?\(\s*\d|hsl\(/);
    if (r2 && !file.includes("styles.css")) add(file, line, "R2 hard-coded-color", `색상 직접 사용 금지 — 토큰(var(--*)/design-tokens.json) 경유: ${r2[0]}`);
    // R3 — SectionToolbar 우회 (ADR-0083): 페이지에서 헤더를 margin-left:auto로 직접 구성 금지
    if (IS_PAGE(file) && /marginLeft:\s*"auto"/.test(text) && !text.includes("lint-exempt")) {
      add(file, line, "R3 toolbar-bypass", `페이지 헤더에서 margin-left:auto 직접 구성 금지 — SectionToolbar 슬롯 사용`);
    }
    // R4 — 단계 화면 h1 직접 사용 금지 (ADR-0086): StageFrame이 단계 헤더를 렌더링
    if (IS_PAGE(file) && IS_STAGE_PAGE(file) && /<h1[\s>]/.test(text)) {
      add(file, line, "R4 stage-header", `페이지에서 <h1> 직접 사용 금지 — StageFrame이 단계 헤더를 렌더링`);
    }
    // R5 — window.confirm 금지 (ADR-0082): useConfirm()/ConfirmDialog 사용
    if (/window\.confirm/.test(text)) add(file, line, "R5 confirm", `window.confirm 금지 — useConfirm()/ConfirmDialog 사용 (ADR-0082)`);
    // R6 — 삭제 라벨 통일 (ADR-0082): 레코드 삭제 버튼의 "제거" 라벨 금지.
    // "기각"은 제안·심사 판정(rejected)의 도메인 어휘이므로 삭제가 아니라 허용한다.
    const r6 = text.match(/>\s*제거\s*</);
    if (r6) add(file, line, "R6 delete-label", `삭제 버튼 라벨은 "삭제"로 통일: ${r6[0].trim()}`);
  });

  // R8 — 관리 콘솔 폼을 details/summary로 만들지 않기 (ADR-0082).
  // 파일 전체를 대상으로 검사한다 (details와 ＋ 토글이 서로 다른 줄에 있어도 탐지).
  const r8 = src.match(/<details[\s\S]{0,400}?<summary[^>]*>[\s\S]{0,200}?\+[^<]*<\/summary>/);
  if (r8) add(file, 1, "R8 details-create", "생성 폼은 details 접기 대신 ＝ 등록 토글 + sizing-new-form 사용");



  // R10 — 테이블 열 폭 시스템 (table-sizing rollout, A.5). 넓은 표(헤더 6+,
  // WIDE_TABLE_HEADER_CELLS와 동일 기준)의 .data-table 표는 반드시 table-fixed-pct
  // (ColGroup 고정 %)여야 하고, th에 하드코딩 폭 클래스(w-[3.5rem] 등)를 쓰지 않는다
  // — ColGroup/table-fixed-pct/tmin-*/cell-truncate 공용 시스템 사용. 정말 불가한
  // 표만 표 시작 5줄 이내의 {/* table-sizing: skip */} 마커로 예외를 문서화한다.
  for (const m of src.matchAll(/<table\b[^>]*>/g)) {
    const line = src.slice(0, m.index).split("\n").length;
    const above = lines.slice(Math.max(0, line - 6), line).join("\n");
    if (above.includes("table-sizing: skip")) continue;
    const openTag = m[0];
    const blockEnd = src.indexOf("</table>", m.index);
    const block = src.slice(m.index, blockEnd === -1 ? undefined : blockEnd);
    const firstTr = block.match(/<tr\b[\s\S]*?<\/tr>/)?.[0] ?? "";
    const headerCellsMax = (firstTr.match(/<th\b/g) ?? []).length;
    if (openTag.includes("data-table") && !openTag.includes("table-fixed-pct") && headerCellsMax >= 6) {
      add(file, line, "R10 table-sizing", `헤더 6+ .data-table 표에 table-fixed-pct 누락 — 공용 시스템(ColGroup 고정 % + .table-scroll, 필요시 tmin-*/cell-truncate)으로 이전. 불가한 표는 바로 위에 {/* table-sizing: skip */} 마커`);
    }
    const thHardWidth = block.match(/<th\b[^>]*className="[^"]*\bw-\[\d/);
    if (thHardWidth && headerCellsMax >= 6) {
      add(file, line, "R10 table-sizing", `넓은 표 th에 하드코딩 폭 클래스(w-[...]) 금지 — ColGroup 고정 % 사용`);
    }
  }

  // R9 — 테이블 th/td col-* 정합성 (ADR-0088: 헤더 정렬은 셀 정렬과 일치).
  // col-num/col-label/col-type/col-text는 th와 td 양쪽에 미러링되어야 한다.
  // 한쪽에만 있으면 열 정렬이 어긋나거나 죽은 클래스가 된다. 조건부 열·map 렌더에도
  // 동작하도록 열 인덱스 매칭 대신 표 단위 클래스 존재 대칭성으로 검사한다.
  for (const m of src.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    const colCls = (tag: string) =>
      new Set([...m[0].matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].flatMap((t) => t[0].match(/col-(?:num|label|type|text)/g) ?? []));
    const thCls = colCls("th");
    const tdCls = colCls("td");
    const line = src.slice(0, m.index).split("\n").length;
    for (const c of thCls) if (!tdCls.has(c)) add(file, line, "R9 table-align", `<th>의 ${c}가 같은 표의 <td>에는 없음 — th/td 양쪽에 미러링 (ADR-0088)`);
    for (const c of tdCls) if (!thCls.has(c)) add(file, line, "R9 table-align", `<td>의 ${c}가 같은 표의 <th>에는 없음 — th/td 양쪽에 미러링 (ADR-0088)`);
  }
}

for (const v of violations) console.log(`${v.rule}  ${v.file}:${v.line}  ${v.message}`);
console.log(`\n${violations.length === 0 ? "✅ design-lint 통과 — 위반 0건" : `❌ design-lint 위반 ${violations.length}건`}`);
process.exit(violations.length === 0 ? 0 : 1);
