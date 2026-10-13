// Guard: "Entity IC" / "Group IC" / "IC 심의" / "RAG 종합 등급" / "RAG 등급" are not used in the field. User-visible strings in
// app/web-next must use the Korean committee wording (glossary aliases keep the old forms resolvable).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const ROOT = join(import.meta.dir, "..", "..");
const WEB = join(ROOT, "app", "web-next");
const SKIP_DIRS = new Set(["node_modules", ".next", "tests", "e2e"]);
const FORBIDDEN = /Entity[ -]IC|Group[ -]IC|그룹 IC|IC ?심의|RAG 종합 등급|RAG 등급|종합 RAG/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.generated\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Drops block comments, JSX comments and line comments (identifiers and comments may keep the terms). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

describe("no Entity IC / Group IC term in visible strings", () => {
  test("app/web-next non-generated source", () => {
    const hits: string[] = [];
    for (const f of walk(WEB)) {
      stripComments(readFileSync(f, "utf-8")).split("\n").forEach((line, i) => {
        if (FORBIDDEN.test(line)) hits.push(`${f.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test("glossary keeps the old forms as aliases of the Korean term", () => {
    const biz = (yaml.load(readFileSync(join(ROOT, "glossary", "business.yaml"), "utf-8")) as any).terms;
    expect(biz["Entity IC"].ko).toBe("법인 투자심의위원회");
    expect(biz["Group IC"].ko).toBe("그룹 투자심의위원회");
    expect(biz["Entity IC"].aliases).toEqual(expect.arrayContaining(["Entity IC", "IC 심의"]));
    expect(biz["Group IC"].aliases).toEqual(expect.arrayContaining(["Group IC", "그룹 IC"]));
    const tech = (yaml.load(readFileSync(join(ROOT, "glossary", "technical.yaml"), "utf-8")) as any).terms;
    expect(tech["RAG Dimension"].aliases).toEqual(expect.arrayContaining(["RAG 종합 등급", "RAG 등급"]));
  });
});
