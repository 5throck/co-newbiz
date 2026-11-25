// DevRef (components/ui.tsx) is the "기술 참고" developer disclosure: internal ADR / flow.spec references.
// Rule: admin-only. Non-admin roles and signed-out/loading sessions render nothing.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../app/web-next/locales/en.json";
import ko from "../../app/web-next/locales/ko.json";

const WEB = join(import.meta.dirname, "../../app/web-next");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");

describe("DevRef is admin-only", () => {
  const src = read("components/ui.tsx");
  const body = src.slice(src.indexOf("export function DevRef"), src.indexOf("/* ── PageState"));

  test("reads the session and returns null unless the role is admin, before any markup", () => {
    expect(body).toContain("const { me } = useAuth();");
    expect(body).toContain('if (me?.role !== "admin") return null;');
    expect(body.indexOf('me?.role !== "admin"')).toBeLessThan(body.indexOf("<details"));
  });

  test("the component comment states the rule", () => {
    expect(src).toContain("Rule: admin-only.");
  });

  test("all three call sites go through the shared DevRef", () => {
    for (const p of [
      "components/stages/BusinessCaseStage.tsx",
      "components/brownfield-target/CompetitorRegistryBlock.tsx",
      "components/admin/console/GovernanceSections.tsx",
    ]) {
      const s = read(p);
      expect(s).toMatch(/import \{[^}]*\bDevRef\b[^}]*\} from "[./]+\/ui\.tsx"/);
      expect(s).toContain("<DevRef ");
    }
  });

  test("the disclosure summary key exists in ko and en", () => {
    for (const cat of [ko, en] as const) {
      const v = (cat as { components: { devRef: { summary: string } } }).components.devRef.summary;
      expect(typeof v).toBe("string");
      expect(v).not.toBe("");
    }
  });
});
