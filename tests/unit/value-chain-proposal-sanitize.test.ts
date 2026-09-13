/**
 * Unit tests for the value-chain proposal sanitizer (design 2026-09-13,
 * methodology panel P0 — never silently drop a substitute relationship):
 *  - whitelist relations (전방|전전방|후방|후후방) pass as chain candidates;
 *  - 대체/보완 relations are routed to `substitutes` (6축 대체 위협 surface),
 *    not dropped;
 *  - unknown relations, empty names, and the target itself are dropped;
 *  - chain candidates cap at 6.
 */

import { test, expect, describe } from "bun:test";
import { sanitizeRelatedProposals } from "../../app/web-next/lib/value-chain-proposals.ts";

describe("sanitizeRelatedProposals", () => {
  test("whitelist relations become chain candidates", () => {
    const r = sanitizeRelatedProposals(
      [
        { relation: "전방", name: "토목·건설", note: "굴삭 서비스 수요처" },
        { relation: "후방", name: "유압식 브레이커", note: "부착 작업기 조달" },
        { relation: "전전방", name: "사회간접자본" },
        { relation: "후후방", name: "특수강" },
      ],
      "건설기계(굴삭기·스키드로더) 장비 운용",
    );
    expect(r.accepted.length).toBe(4);
    expect(r.substitutes.length).toBe(0);
    expect(r.dropped).toBe(0);
  });

  test("substitutes and complements are routed out, not dropped", () => {
    const r = sanitizeRelatedProposals(
      [
        { relation: "대체", name: "전기식 브레이커", note: "배기·소음 규제로 전환 압력 (검증 필요)" },
        { relation: "보완", name: "파쇄 부산물 재활용" },
      ],
      "유압식 브레이커",
    );
    expect(r.accepted.length).toBe(0);
    expect(r.substitutes.map((s) => s.name)).toEqual(["전기식 브레이커", "파쇄 부산물 재활용"]);
    expect(r.dropped).toBe(0);
  });

  test("target itself, empty names, and unknown relations are dropped", () => {
    const r = sanitizeRelatedProposals(
      [
        { relation: "전방", name: "유압식 브레이커" }, // == target
        { relation: "전방", name: "   " }, // empty
        { relation: "연관", name: "경쟁 장비 임대" }, // not in taxonomy, not 대체/보완
        { name: "관계 누락 산업" },
      ],
      "유압식 브레이커",
    );
    expect(r.accepted.length).toBe(0);
    expect(r.substitutes.length).toBe(0);
    expect(r.dropped).toBe(4);
  });

  test("chain candidates cap at 6; excess counts as dropped", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ relation: "전방", name: `수요처 ${i + 1}` }));
    const r = sanitizeRelatedProposals(items, "테스트 산업");
    expect(r.accepted.length).toBe(6);
    expect(r.dropped).toBe(2);
  });

  test("name matching ignores whitespace and case", () => {
    const r = sanitizeRelatedProposals([{ relation: "후방", name: "유압식브레이커" }], "유압식 브레이커");
    expect(r.accepted.length).toBe(0);
    expect(r.dropped).toBe(1);
  });
});
