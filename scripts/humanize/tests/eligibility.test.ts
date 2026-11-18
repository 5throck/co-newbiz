// @version 1.0.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classify, DENY_DIRS, hangulRatio, isHangulDominant, matchDenylist } from "../lib/eligibility";
import { ORIGINAL_PARAGRAPH } from "./fixtures/korean";

const ROOT = "/repo";
const ok = (extra: Partial<Parameters<typeof classify>[0]> = {}) =>
  classify({ text: ORIGINAL_PARAGRAPH, kind: "report", root: ROOT, ...extra });

describe("default-deny exclusions", () => {
  test("an eligible kind with no path is eligible", () => {
    expect(ok()).toEqual({ eligible: true });
  });

  test("an undeclared kind is excluded", () => {
    expect(ok({ kind: undefined }).eligible).toBe(false);
    expect(ok({ kind: "" }).eligible).toBe(false);
    expect(ok({ kind: "memo" }).eligible).toBe(false);
  });

  test("legal-opinion kind is excluded", () => {
    expect(ok({ kind: "legal-opinion" }).rule).toContain("legal-opinion");
  });

  test.each([...DENY_DIRS])("%s/** is excluded", (dir) => {
    expect(ok({ path: `${dir}/x_ko.md` }).eligible).toBe(false);
    expect(ok({ path: `${ROOT}/${dir}/deep/x.md` }).eligible).toBe(false);
  });

  test.each(["a.yaml", "a.yml", "a.json", "a.ts", "a.py", "CHANGELOG.md", "sub/CHANGELOG.md"])(
    "%s is excluded",
    (f) => {
      expect(ok({ path: f }).eligible).toBe(false);
    },
  );

  test("an eligible kind under docs/manuals/*_ko.md is eligible", () => {
    expect(ok({ kind: "manual-ko", path: "docs/manuals/admin-manual_ko.md" }).eligible).toBe(true);
    expect(ok({ kind: "wiki-ko", path: `${ROOT}/docs/manuals/x_ko.md` }).eligible).toBe(true);
  });

  test("docs/runbooks/*_ko.md stays excluded", () => {
    expect(ok({ kind: "manual-ko", path: "docs/runbooks/x_ko.md" }).eligible).toBe(false);
  });

  test("a path outside the project root is denied when it names a denied directory", () => {
    expect(matchDenylist("/elsewhere/policies/p.md", ROOT)).toBeDefined();
    expect(matchDenylist("/elsewhere/notes/p.md", ROOT)).toBeUndefined();
  });

  test("lang_reason: source-material (real Korean doc frontmatter shapes) is eligible", () => {
    const manual = `---\nlang: ko\nlang_reason: source-material\ncounterpart: business-manual.md\n---\n${ORIGINAL_PARAGRAPH}`;
    const wiki = `---\nlang: ko\nlang_reason: source-material\ndoc_type: reference\ntracks: [greenfield, brownfield]\nverified_on: 2026-11-18\n---\n${ORIGINAL_PARAGRAPH}`;
    const readme = `---\nsync_version: 1\ntranslated_from_hash: be3b08b9\nlang: ko\nlang_reason: source-material\n---\n${ORIGINAL_PARAGRAPH}`;
    expect(ok({ kind: "manual-ko", text: manual, path: "docs/manuals/business-manual_ko.md" }).eligible).toBe(true);
    expect(ok({ kind: "wiki-ko", text: wiki, path: "docs/wiki/ko/12-x.md" }).eligible).toBe(true);
    expect(ok({ kind: "wiki-ko", text: readme }).eligible).toBe(true);
  });

  test.each(["legal", "proper-noun", "unknown-value", ""])("lang_reason: %p is excluded", (v) => {
    const r = ok({ kind: "manual-ko", text: `---\nlang: ko\nlang_reason: ${v}\n---\n${ORIGINAL_PARAGRAPH}` });
    expect(r.eligible).toBe(false);
    expect(r.rule).toContain("lang_reason");
  });

  test("humanize: skip frontmatter excludes", () => {
    expect(ok({ text: `---\nhumanize: skip\n---\n${ORIGINAL_PARAGRAPH}` }).rule).toContain("humanize: skip");
  });

  test("real files: mcp-user-guide_ko and a wiki/ko page are eligible; runbooks stay excluded", () => {
    const root = resolve(import.meta.dir, "../../..");
    const read = (p: string) => readFileSync(resolve(root, p), "utf8");
    const guide = "docs/manuals/mcp-user-guide_ko.md";
    const wiki = "docs/wiki/ko/12-공통-화면-둘러보기.md";
    const rb = "docs/runbooks/deployment_ko.md";
    expect(classify({ text: read(guide), kind: "manual-ko", path: guide, root }).eligible).toBe(true);
    expect(classify({ text: read(wiki), kind: "wiki-ko", path: wiki, root }).eligible).toBe(true);
    expect(classify({ text: read(rb), kind: "manual-ko", path: rb, root }).eligible).toBe(false);
  });

  test("frontmatter legal-opinion, glossary and legal-counsel ownership exclude", () => {
    expect(ok({ text: `---\nkind: legal-opinion\n---\n${ORIGINAL_PARAGRAPH}` }).eligible).toBe(false);
    expect(ok({ text: `---\nkind: glossary\n---\n${ORIGINAL_PARAGRAPH}` }).eligible).toBe(false);
    expect(ok({ text: `---\nowner: legal-counsel\n---\n${ORIGINAL_PARAGRAPH}` }).eligible).toBe(false);
  });

  test("English-only and code-only inputs are excluded", () => {
    expect(ok({ text: "This is an English document with no Hangul at all." }).eligible).toBe(false);
    expect(ok({ text: "```ts\nconst a = 1;\n```\n" }).eligible).toBe(false);
  });

  test("Hangul dominance uses letters and a 30 percent default", () => {
    expect(hangulRatio("가나다 abc")).toBeCloseTo(0.5);
    expect(isHangulDominant("가 abcdefghi")).toBe(false);
    expect(isHangulDominant("가나 abcde")).toBe(false);
    expect(isHangulDominant("가나다 abcdefg")).toBe(true);
  });
});
