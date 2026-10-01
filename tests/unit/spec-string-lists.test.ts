/**
 * Guards against YAML list items that silently parse as objects (e.g. an
 * unquoted "word: text" item), which rendered as "[object Object]" in
 * docs/process-flow.md.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import * as yaml from "js-yaml";

const STRING_LIST_FIELDS = [
  "completionCriteria",
  "requiredArtifacts",
  "inputs",
  "outputs",
  "entryCriteria",
  "decisionCriteria",
  "killCriteria",
];

function nonStringItems(doc: any): string[] {
  const bad: string[] = [];
  for (const kind of ["stages", "gates"] as const) {
    for (const node of doc[kind] ?? []) {
      for (const field of STRING_LIST_FIELDS) {
        const list = node[field];
        if (list === undefined) continue;
        if (!Array.isArray(list)) {
          bad.push(`${kind}.${node.id}.${field}: not an array`);
          continue;
        }
        list.forEach((item: unknown, i: number) => {
          if (typeof item !== "string") bad.push(`${kind}.${node.id}.${field}[${i}]`);
        });
      }
    }
  }
  return bad;
}

describe("flow.spec.yaml string lists", () => {
  test("every list item in string-list fields is a string", () => {
    const doc = yaml.load(readFileSync("process/flow.spec.yaml", "utf8"));
    expect(nonStringItems(doc)).toEqual([]);
  });

  test("detector catches the unquoted 'word: text' form", () => {
    const sample = yaml.load(
      "stages:\n  - id: X\n    completionCriteria:\n      - brownfield: 대상 분석이 존재한다\n",
    );
    expect(nonStringItems(sample)).toEqual(["stages.X.completionCriteria[0]"]);
  });
});
