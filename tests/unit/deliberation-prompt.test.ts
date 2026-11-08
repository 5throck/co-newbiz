/**
 * ADR-0196 phase A — responsive rounds: deliberationPrompt contents for round 1
 * vs round 2+, the paste cap, the flag-off byte-identity guarantee, and the
 * deterministic seats' extended position-meta tail.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  deliberationPrompt,
  estimateTokens,
  PEER_PASTE_TOKEN_CAP,
  type DeliberationPosition,
  type AgendaIssue,
} from "../../app/web-next/lib/deliberation.ts";
import { isCommitteeResponsive } from "../../app/web-next/lib/committee-flags.ts";
import { getCommitteeCallAgent } from "../../app/web-next/lib/committee-agents.ts";
import { parsePositionMeta } from "../../app/web-next/lib/committee-llm.ts";

const ENV = "CO_NEWBIZ_COMMITTEE_RESPONSIVE";
let saved: string | undefined;
beforeEach(() => { saved = process.env[ENV]; delete process.env[ENV]; });
afterEach(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; });

const member = { agentKey: "market-intelligence-agent" };
const round1: DeliberationPosition[] = [
  { memberKey: "market-intelligence-agent", positionMd: "MY OWN R1 STANCE" },
  { memberKey: "risk-officer", positionMd: "RISK R1 VERBATIM\n\n두 번째 문단 <!--position-meta:{\"recommendation\":\"kill\",\"confidence\":80}-->", recommendation: "kill", confidence: 80, vetoDissent: true },
  { memberKey: "legal-counsel", positionMd: "LEGAL R1 VERBATIM" },
];

describe("flag", () => {
  test("default off; only 1/true turn it on", () => {
    expect(isCommitteeResponsive()).toBe(false);
    process.env[ENV] = "0";
    expect(isCommitteeResponsive()).toBe(false);
    process.env[ENV] = "1";
    expect(isCommitteeResponsive()).toBe(true);
    process.env[ENV] = "TRUE";
    expect(isCommitteeResponsive()).toBe(true);
  });
});

describe("flag off — pre-ADR-0196 prompt, byte-identical", () => {
  test("round 1 and round 2 match the legacy text exactly", () => {
    const r1 = deliberationPrompt(member, "안건 A", [], 1);
    expect(r1).toBe("당신은 'market-intelligence-agent' 위원입니다. 아래 검토/안건에 대한 입장을 작성하세요.\n\n## 검토/안건\n안건 A");
    const r2 = deliberationPrompt(member, "안건 A", [round1], 2);
    expect(r2).toBe(
      [
        "당신은 'market-intelligence-agent' 위원입니다. 아래 검토/안건에 대한 입장을 작성하세요.",
        "",
        "## 검토/안건",
        "안건 A",
        "",
        "## 타 위원 이전 라운드 입장 (전문)",
        "",
        "### risk-officer",
        round1[1].positionMd,
        "",
        "### legal-counsel",
        "LEGAL R1 VERBATIM",
      ].join("\n"),
    );
    expect(r2).not.toContain("MY OWN R1 STANCE");
  });

  test("agenda option is ignored when responsive rounds are off", () => {
    const agenda: AgendaIssue[] = [{ id: "I1", title: "수요 전제" }];
    expect(deliberationPrompt(member, "안건 A", [round1], 2, { agenda })).toBe(deliberationPrompt(member, "안건 A", [round1], 2));
  });
});

describe("responsive rounds on", () => {
  test("round 1 is unchanged (topic only)", () => {
    const off = deliberationPrompt(member, "안건 A", [], 1);
    process.env[ENV] = "1";
    expect(deliberationPrompt(member, "안건 A", [], 1)).toBe(off);
    expect(deliberationPrompt(member, "안건 A", [], 1, { responsive: true })).toBe(off);
  });

  test("round 2 carries own previous position, peers verbatim, and the response contract", () => {
    const p = deliberationPrompt(member, "안건 A", [round1], 2, { responsive: true });
    expect(p).toContain("## 내 이전 입장 (라운드 1)");
    expect(p).toContain("MY OWN R1 STANCE");
    // Peers verbatim — full text, including the position-meta tail inside it.
    expect(p).toContain(round1[1].positionMd);
    expect(p).toContain("LEGAL R1 VERBATIM");
    // Own text appears once, only under the own-position heading.
    expect(p.split("MY OWN R1 STANCE").length - 1).toBe(1);
    // Contract: named peers, answer questions, stance-change line, meta fields.
    expect(p).toContain("## 응답 규칙 (라운드 2");
    expect(p).toContain("agree");
    expect(p).toContain("rebut");
    expect(p).toContain("ask");
    expect(p).toContain("지명 가능한 seat: risk-officer, legal-counsel");
    expect(p).toContain("지난 라운드에 당신에게 던져진 질문에는 모두 답하세요");
    expect(p).toContain("Stance change:");
    expect(p).toContain("responds_to");
    expect(p).toContain("stance_changed");
    // No agenda → no agenda section, no off-agenda line, no issues field.
    expect(p).not.toContain("## 안건 쟁점");
    expect(p).not.toContain("New issue:");
    expect(p).not.toContain('"issues"');
  });

  test("env flag alone switches the prompt (no opts)", () => {
    process.env[ENV] = "1";
    expect(deliberationPrompt(member, "안건 A", [round1], 2)).toContain("## 응답 규칙");
  });

  test("with an agenda: issues listed, stay-on-agenda + New issue rule, issues field", () => {
    const agenda: AgendaIssue[] = [
      { id: "I1", title: "수요 전제 신뢰도", raisedBy: ["risk-officer"], contested: true },
      { id: "I2", title: "인증 이전 가능성" },
    ];
    const p = deliberationPrompt(member, "안건 A", [round1], 2, { responsive: true, agenda });
    expect(p).toContain("## 안건 쟁점 (의장 제안)");
    expect(p).toContain("- I1: 수요 전제 신뢰도 (쟁점 분분; 제기: risk-officer)");
    expect(p).toContain("- I2: 인증 이전 가능성");
    expect(p).toContain("New issue:");
    expect(p).toContain('"issues":["I1"]');
    // Topic first, then agenda, then own position, then peers, then contract.
    const idx = (s: string) => p.indexOf(s);
    expect(idx("## 검토/안건")).toBeLessThan(idx("## 안건 쟁점"));
    expect(idx("## 안건 쟁점")).toBeLessThan(idx("## 내 이전 입장"));
    expect(idx("## 내 이전 입장")).toBeLessThan(idx("## 타 위원 이전 라운드 입장"));
    expect(idx("## 타 위원 이전 라운드 입장")).toBeLessThan(idx("## 응답 규칙"));
  });

  test("own previous position is the most recent one the member spoke", () => {
    const round2: DeliberationPosition[] = [
      { memberKey: "market-intelligence-agent", positionMd: "MY OWN R2 STANCE" },
      { memberKey: "risk-officer", positionMd: "RISK R2 VERBATIM" },
    ];
    const p = deliberationPrompt(member, "안건 A", [round1, round2], 3, { responsive: true });
    expect(p).toContain("## 내 이전 입장 (라운드 2)");
    expect(p).toContain("MY OWN R2 STANCE");
    expect(p).not.toContain("MY OWN R1 STANCE");
    expect(p).toContain("RISK R1 VERBATIM");
    expect(p).toContain("RISK R2 VERBATIM");
  });

  test("a member with no prior position gets no own-position section", () => {
    const p = deliberationPrompt({ agentKey: "newcomer" }, "안건 A", [round1], 2, { responsive: true });
    expect(p).not.toContain("## 내 이전 입장");
    expect(p).toContain("RISK R1 VERBATIM");
  });

  test("a single peer: contract names the one available seat (no impossible 'at least 2')", () => {
    const solo: DeliberationPosition[][] = [[
      { memberKey: "market-intelligence-agent", positionMd: "ME" },
      { memberKey: "risk-officer", positionMd: "RISK" },
    ]];
    const p = deliberationPrompt(member, "안건 A", solo, 2, { responsive: true });
    expect(p).toContain("위원 1명 이상을 seat key로 지명");
  });
});

describe("peer paste cap", () => {
  const big = (label: string) => `${label} ${"가".repeat(9000)}`; // ~6000 tokens by the Hangul estimate
  const mk = (r: number): DeliberationPosition[] => [
    { memberKey: "market-intelligence-agent", positionMd: `own r${r}` },
    { memberKey: "risk-officer", positionMd: big(`RISK-R${r}-FULL`), recommendation: "kill", confidence: 80, vetoDissent: true },
    { memberKey: "legal-counsel", positionMd: big(`LEGAL-R${r}-FULL`), recommendation: "go", confidence: 70, stanceChanged: true, respondsTo: [{ seat: "risk-officer", act: "rebut", issue: "I1" }] },
  ];

  test("estimator errs high for Hangul", () => {
    expect(estimateTokens("가".repeat(300))).toBe(200);
    expect(estimateTokens("a".repeat(400))).toBe(100);
    expect(PEER_PASTE_TOKEN_CAP).toBe(6000);
  });

  test("under the cap every round is verbatim", () => {
    const small = [round1, [
      { memberKey: "market-intelligence-agent", positionMd: "own r2" },
      { memberKey: "risk-officer", positionMd: "RISK R2 VERBATIM" },
    ]];
    const p = deliberationPrompt(member, "A", small, 3, { responsive: true });
    expect(p).toContain("RISK R1 VERBATIM");
    expect(p).toContain("RISK R2 VERBATIM");
    expect(p).not.toContain("분량 상한");
  });

  test("over the cap: latest round verbatim, earlier rounds collapse to position-meta lines", () => {
    const p = deliberationPrompt(member, "A", [mk(1), mk(2)], 3, { responsive: true });
    // Latest prior round (2) — always in full.
    expect(p).toContain(big("RISK-R2-FULL"));
    expect(p).toContain(big("LEGAL-R2-FULL"));
    // Earlier round (1) — text dropped, meta kept.
    expect(p).not.toContain("RISK-R1-FULL");
    expect(p).not.toContain("LEGAL-R1-FULL");
    expect(p).toContain("라운드 1 — 분량 상한으로 position-meta 요약만");
    expect(p).toContain('- risk-officer: {"recommendation":"kill","confidence":80,"veto_dissent":true}');
    expect(p).toContain('- legal-counsel: {"recommendation":"go","confidence":70,"responds_to":[{"seat":"risk-officer","act":"rebut","issue":"I1"}],"stance_changed":true}');
    // Own position and the contract are never capped.
    expect(p).toContain("own r2");
    expect(p).toContain("## 응답 규칙");
  });

  test("a single over-cap latest round is still delivered in full", () => {
    const p = deliberationPrompt(member, "A", [mk(1)], 2, { responsive: true, peerTokenCap: 10 });
    expect(p).toContain(big("RISK-R1-FULL"));
    expect(p).not.toContain("분량 상한");
  });

  test("collapsed meta falls back to the tail stored inside replayed position text", () => {
    const replay: DeliberationPosition[] = [
      { memberKey: "risk-officer", positionMd: `${big("OLD")}\n<!--position-meta:{"recommendation":"kill","confidence":80}-->` },
    ];
    const p = deliberationPrompt(member, "A", [replay, mk(2)], 3, { responsive: true, peerTokenCap: 100 });
    expect(p).toContain('- risk-officer: {"recommendation":"kill","confidence":80}');
    expect(p).not.toContain(big("OLD"));
  });
});

describe("deterministic seats emit the extended tail", () => {
  test("flag off: legacy tail, no ADR-0196 fields", async () => {
    const out = await getCommitteeCallAgent()("risk-officer", "안건");
    expect(out.respondsTo).toBeUndefined();
    expect(out.positionMd).not.toContain("responds_to");
    expect(out.positionMd).not.toContain("stance_changed");
  });

  test("flag on: empty responds_to, stance_changed=false, issues=[] — round-trips through parsePositionMeta", async () => {
    process.env[ENV] = "1";
    for (const seat of ["risk-officer", "legal-counsel", "unknown-seat"]) {
      const out = await getCommitteeCallAgent()(seat, "안건");
      expect(out.respondsTo).toEqual([]);
      expect(out.stanceChanged).toBe(false);
      expect(out.issues).toEqual([]);
      const parsed = parsePositionMeta(out.positionMd);
      expect(parsed).not.toBeNull();
      expect(parsed!.recommendation).toBe(out.recommendation);
      expect(parsed!.criteriaScores).toEqual(out.criteriaScores);
      expect(parsed!.respondsTo).toEqual([]);
      expect(parsed!.stanceChanged).toBe(false);
      expect(parsed!.issues).toEqual([]);
    }
  });

  test("deterministic seats are unaffected by prompt shape (round 2 responsive prompt works)", async () => {
    process.env[ENV] = "1";
    const prompt = deliberationPrompt({ agentKey: "risk-officer" }, "안건", [round1], 2);
    const out = await getCommitteeCallAgent()("risk-officer", prompt);
    expect(out.recommendation).toBe("kill");
    expect(out.vetoDissent).toBe(true);
  });
});
