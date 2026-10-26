// H2 (review W1): label-map factories `(tr: TranslatorFn) => ({...})` that hold catalog keys must resolve them
// (resolveLabels) so a screen never renders a dotted key such as "stages.s67.constants.shortlist".
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveLabels } from "../../app/web-next/i18n/config.ts";

const ROOT = join(import.meta.dir, "../../app/web-next");
const KEY = /"(?:stages|common|pages)\.[\w.]+"/;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".next") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

/** Finds `const X = (tr: TranslatorFn)...=> ({ ... })` bodies (brace matched) that carry keys but never resolve them. */
export function findUnresolvedLabelMaps(src: string): string[] {
  const bad: string[] = [];
  const re = /const (\w+) = \(tr: TranslatorFn\)[^=\n]*=>\s*(resolveLabels\(tr,\s*)?\(?\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let d = 0, i = open;
    for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) break; }
    const body = src.slice(open, i + 1);
    if (KEY.test(body) && !m[2] && !/\btr\(/.test(body)) bad.push(m[1]);
  }
  return bad;
}

describe("label maps resolve catalog keys", () => {
  test("no label-map factory returns raw dotted keys", () => {
    const offenders: string[] = [];
    for (const f of [...walk(join(ROOT, "components")), ...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
      const bad = findUnresolvedLabelMaps(readFileSync(f, "utf8"));
      for (const b of bad) offenders.push(`${f.replace(ROOT, "")}:${b}`);
    }
    expect(offenders).toEqual([]);
  });

  test("detector fails on a seeded unresolved map", () => {
    const seeded = `const X = (tr: TranslatorFn): Record<string,string> => ({ a: "stages.s67.constants.shortlist" });`;
    expect(findUnresolvedLabelMaps(seeded)).toEqual(["X"]);
  });

  test("resolveLabels resolves nested keys and leaves plain text", () => {
    const tr = (k: string) => `T(${k})`;
    expect(resolveLabels(tr, { a: "common.exclude", b: { label: "stages.x.y", cls: "status-green" } })).toEqual({
      a: "T(common.exclude)",
      b: { label: "T(stages.x.y)", cls: "status-green" },
    });
  });
});
