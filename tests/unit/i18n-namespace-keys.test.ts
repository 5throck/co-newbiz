// Guards the "double namespace" bug class: a translator bound to namespace X
// (useTranslations("X") / getTranslations("X")) called with a key that
// already starts with "X." resolves to X.X.* and throws MISSING_MESSAGE.
// Also checks every statically-bound call resolves in ko.json and en.json.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../app/web-next");
const ko = JSON.parse(readFileSync(join(ROOT, "locales/ko.json"), "utf8"));
const en = JSON.parse(readFileSync(join(ROOT, "locales/en.json"), "utf8"));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.(test|generated)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
};

const resolves = (cat: unknown, path: string): boolean => {
  let cur: unknown = cat;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(seg in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === "string";
};

const BIND = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)")?\s*\)/g;

export function scanNamespaceKeys(): { doubled: string[]; unresolved: string[] } {
  const doubled: string[] = [];
  const unresolved: string[] = [];
  for (const file of ["app", "components", "lib"].flatMap((d) => walk(join(ROOT, d)))) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(ROOT.length + 1);
    const binds = new Map<string, string[]>();
    for (const m of src.matchAll(BIND)) binds.set(m[1], [...(binds.get(m[1]) ?? []), m[2] ?? ""]);
    for (const [v, nss] of binds) {
      const call = new RegExp(`(?<![\\w.])${v}\\(\\s*"([A-Za-z][\\w.]*)"`, "g");
      for (const m of src.matchAll(call)) {
        const key = m[1];
        const line = src.slice(0, m.index).split("\n").length;
        const ok = nss.some((ns) => resolves(ko, ns ? `${ns}.${key}` : key) && resolves(en, ns ? `${ns}.${key}` : key));
        if (ok) continue;
        if (nss.some((ns) => ns && key.startsWith(`${ns}.`))) doubled.push(`${rel}:${line} ${v}("${key}")`);
        else unresolved.push(`${rel}:${line} ${v}("${key}") in ns ${JSON.stringify(nss)}`);
      }
    }
    // translators passed as parameters are scoped to "common" by every caller
    for (const m of src.matchAll(/(?<![\w.])(tc|tCommon)\(\s*"common\.([\w.]+)"/g)) {
      if (binds.get(m[1])?.includes("common")) doubled.push(`${rel}:${src.slice(0, m.index).split("\n").length} ${m[1]}("common.${m[2]}")`);
    }
  }
  return { doubled, unresolved };
}

describe("i18n namespace-scoped keys", () => {
  const r = scanNamespaceKeys();
  test("no translator is called with its own namespace prefix", () => {
    expect(r.doubled).toEqual([]);
  });
  test("every statically bound key resolves in ko and en", () => {
    expect(r.unresolved).toEqual([]);
  });
});
