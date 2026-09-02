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
// R4는 프로세스 단계 화면에만 적용 — 참조·운영 페이지(benchmarks/library/...)은 예외.
const STAGE_ROUTES = ["market", "opportunities", "our-company", "synergy", "route-decision", "greenfield", "brownfield"];
const IS_STAGE_PAGE = (f: string) => STAGE_ROUTES.some((r) => f.includes(r + "/page.tsx") || f.includes(r + "\page.tsx"));

for (const file of [...walkTsxs(APP_DIR), ...walkTsxs(COMPONENT_DIR)]) {
  const src = readFileSync(file, "utf-8");
  const lines = src.split("\n");

  lines.forEach((text, idx) => {
    const line = idx + 1;
    // R1 — 버튼 크기 2-size 규칙 (ADR-0083): btn-*에 임의 font-size 수식 금지
    const r1 = text.match(/btn-(?:ghost|danger|premium)\s+text-\[0\.\d+rem\]/);
    if (r1) add(file, line, "R1 button-size", `btn-*에 text-[...] 크기 수식 금지 — 기본 또는 btn-sm만 사용: ${r1[0].trim()}`);
    // R2 — 토큰 외 하드코딩 hex 색상 (ADR-0087 ②)
    const r2 = text.match(/["'(:]#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
    if (r2 && !file.includes("styles.css")) add(file, line, "R2 hard-coded-color", `hex 색상 직접 사용 금지 — 토큰(var(--*)/design-tokens.json) 경유: ${r2[0]}`);
    // R3 — SectionToolbar 우회 (ADR-0083): 페이지에서 헤더를 margin-left:auto로 직접 구성 금지
    if (IS_PAGE(file) && /marginLeft:\s*"auto"/.test(text) && !text.includes("lint-exempt")) {
      add(file, line, "R3 toolbar-bypass", `페이지 헤더에서 margin-left:auto 직접 구성 금지 — SectionToolbar 슬롯 사용`);
    }
    // R4 — 단계 화면 h1 직접 사용 금지 (ADR-0086): app/*/page.tsx에서 <h1> 금지
    if (IS_PAGE(file) && IS_STAGE_PAGE(file) && /<h1>/.test(text)) {
      add(file, line, "R4 stage-header", `페이지에서 <h1> 직접 사용 금지 — StageFrame이 단계 헤더를 렌더링`);
    }
    // R5 — window.confirm 금지 (ADR-0082): useConfirm()/ConfirmDialog 사용
    if (/window\.confirm/.test(text)) add(file, line, "R5 confirm", `window.confirm 금지 — useConfirm()/ConfirmDialog 사용 (ADR-0082)`);
    // R6 — 삭제 라벨 통일 (ADR-0082): 제거/기각 버튼 라벨 금지 (멀티라인 포함)
    const r6 = text.match(/>\s*(?:제거|기각)\s*</);
    if (r6) add(file, line, "R6 delete-label", `삭제 버튼 라벨은 "삭제"로 통일: ${r6[0].trim()}`);
    // R7 — 단계 화면 h1 직접 사용 (ADR-0086)
    if (IS_STAGE_PAGE(file) && /<h1>/.test(text)) {
      add(file, line, "R7 stage-h1", "단계 화면의 <h1>은 StageFrame이 렌더링합니다");
    }
    // R8 — 관리 콘솔 폼을 details/summary로 만들지 않기 (ADR-0082)
    if (/details[\s\S]{0,200}summary[^>]*>\s*\+/.test(text)) {
      add(file, line, "R8 details-create", "생성 폼은 details 접기 대신 ＝ 등록 토글 + sizing-new-form 사용");
    }
  });
}

for (const v of violations) console.log(`${v.rule}  ${v.file}:${v.line}  ${v.message}`);
console.log(`\n${violations.length === 0 ? "✅ design-lint 통과 — 위반 0건" : `❌ design-lint 위반 ${violations.length}건`}`);
process.exit(violations.length === 0 ? 0 : 1);
