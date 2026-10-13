// @version 1.0.0
/**
 * Asserts the agreed Korean term list is registered in glossary/*.yaml (the
 * user-manual defect D-17 / W1-29) and that the generated UI projection stays
 * in sync with the YAML for those terms.
 */

import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const ROOT = join(import.meta.dir, "..", "..");

interface Term {
  ko: string;
  aliases?: string[];
}

function loadYamlTerms(): Record<string, Term> {
  const all: Record<string, Term> = {};
  for (const f of readdirSync(join(ROOT, "glossary")).filter((n) => n.endsWith(".yaml") && !n.startsWith("_"))) {
    const doc = yaml.load(readFileSync(join(ROOT, "glossary", f), "utf8")) as { terms?: Record<string, Term> };
    Object.assign(all, doc.terms ?? {});
  }
  return all;
}

const AGREED_KO = [
  "신규 사업",
  "인력/조직 계획",
  "중점 투자 분야",
  "현상 유지안",
  "투자 주체",
  "설립 법인 형태",
  "투자심의 자료",
  "법인 투자심의위원회",
  "그룹 투자심의위원회",
  "종합 등급",
  "전략 제휴",
  "게이트",
  "면제 요청",
  "AI 작성·검토 전",
  "법무 검토됨",
  "확정",
];

test("every agreed Korean term is registered as a canonical ko name", () => {
  const kos = new Set(Object.values(loadYamlTerms()).map((t) => t.ko));
  for (const ko of AGREED_KO) expect(kos.has(ko)).toBe(true);
});

test("previous display names remain as aliases", () => {
  const terms = loadYamlTerms();
  expect(terms["Stage Gate"].aliases).toContain("스테이지 게이트");
  expect(terms["Waiver"].aliases).toContain("예외 승인");
  expect(terms["Partnership"].aliases).toContain("파트너십");
});

test("generated UI projection contains the agreed terms", () => {
  const src = readFileSync(join(ROOT, "app/web-next/lib/glossary-data.generated.ts"), "utf8");
  for (const ko of AGREED_KO) expect(src).toContain(`"ko": "${ko}"`);
});
