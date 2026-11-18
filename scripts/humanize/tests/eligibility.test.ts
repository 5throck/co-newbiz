// @version 1.0.0
import { describe, expect, test } from "bun:test";
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

  test("lang_reason and humanize: skip frontmatter exclude", () => {
    expect(ok({ text: `---\nlang: ko\nlang_reason: legal\n---\n${ORIGINAL_PARAGRAPH}` }).rule).toContain("lang_reason");
    expect(ok({ text: `---\nhumanize: skip\n---\n${ORIGINAL_PARAGRAPH}` }).rule).toContain("humanize: skip");
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
