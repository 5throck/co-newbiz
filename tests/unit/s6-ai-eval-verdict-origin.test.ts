// @version 1.0.0
/** ADR-0200 PR-A UI: promote warning with unreviewed counts, origin badges, review action and rule-only accept on the
 * candidate detail evaluation tab, single-candidate AI 평가 replacing the retired draft, removed route/field usage,
 * ko/en parity. Static-render pattern as s6-ai-eval-render.test.ts. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

// biome-ignore lint/suspicious/noExplicitAny: test reads untyped module namespaces and JSON catalogs
type Loose = any;
const WEB = "../../app/web-next";
const ROOT = `${import.meta.dir}/../../app/web-next`;
const read = (p: string) => readFileSync(`${ROOT}/${p}`, "utf8");
const { renderToStaticMarkup } = (await import(`${WEB}/node_modules/react-dom/server.js`)) as Loose;
const { createElement } = (await import(`${WEB}/node_modules/react/index.js`)) as Loose;
const { NextIntlClientProvider } = (await import(`${WEB}/node_modules/next-intl`)) as Loose;
const ko = (await import(`${WEB}/locales/ko.json`)).default as Record<string, Loose>;
const en = (await import(`${WEB}/locales/en.json`)).default as Record<string, Loose>;
const promote = (await import(`${WEB}/components/stages/brownfield/AiEvalPromote.tsx`)) as Loose;
const badge = (await import(`${WEB}/components/brownfield-target/OriginBadge.tsx`)) as Loose;

const render = (el: unknown, locale: "ko" | "en" = "ko") =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages: locale === "ko" ? ko : en, timeZone: "Asia/Seoul" }, el),
  );

describe("B. promotion: warn with counts, never block", () => {
  const btn = (unreviewed: unknown, locale: "ko" | "en" = "ko") =>
    render(
      createElement(promote.PromoteButton, {
        companyName: "Acme",
        targetId: "t1",
        unreviewed,
        busy: false,
        onPromote: () => {},
      }),
      locale,
    );
  test("the button is a normal enabled promote button, with or without unreviewed verdicts (not blocked)", () => {
    for (const u of [
      { total: 0, financial: 0, technical: 0 },
      { total: 4, financial: 1, technical: 3 },
    ]) {
      const html = btn(u);
      expect(html).not.toContain("disabled");
      expect(html).toContain('aria-label="Acme 심사 종료 (최종 후보 목록 등록)"');
    }
  });
  test("the dialog text carries the warning, the per-category counts, a 항목 검토 link and a promote-anyway action", () => {
    expect(ko.stages.s67.aiEval.promoteUnreviewed.replace("{n}", "4")).toBe(
      "미검토 AI 판정 4건 포함 · 항목 검토 후 심사 종료를 권장합니다",
    );
    expect(en.stages.s67.aiEval.promoteUnreviewed).toContain("{n} unreviewed AI verdicts");
    const src = read("components/stages/brownfield/AiEvalPromote.tsx");
    expect(src).toContain('ta("promoteUnreviewed", { n: m.total })');
    expect(src).toContain('ta("unreviewedSplit", { fin: m.financial, tech: m.technical })');
    expect(src).toContain("reviewItemsHref(targetId)");
    // no dialog without something to warn about: unreviewed verdicts OR open S6 gaps (design
    // 2026-11-21-s67-completion-visibility — the gap warning rides the same confirm modal)
    expect(src).toContain("m.total > 0 || hasGaps ? setOpen(true) : onPromote()");
    expect(src).not.toMatch(/disabled=\{[^}]*unreviewed/); // never blocks on the count
  });
  test("unreviewedOf reads the counts from eval_summary", () => {
    const s = {
      financial: { score: 1, scoredWeight: 1, totalWeight: 1, unreviewed: 2 },
      technical: { score: 1, scoredWeight: 1, totalWeight: 1, unreviewed: 3 },
      combined: 1,
      unreviewed_total: 5,
    };
    expect(promote.unreviewedOf(s)).toEqual({ total: 5, financial: 2, technical: 3 });
    expect(promote.unreviewedOf(undefined)).toEqual({ total: 0, financial: 0, technical: 0 });
  });
  test("the shortlist call reports the response's unreviewed count; the longlist and the detail page both use PromoteButton", () => {
    expect(read("components/stages/brownfield/useBrownfieldTargets.ts")).toContain("return r.data.unreviewed ?? 0;");
    expect(read("components/stages/brownfield/LonglistSection.tsx")).toContain("<PromoteButton");
    expect(read("components/stages/brownfield/LonglistSection.tsx")).toContain('ta("promotedWithUnreviewed", { n })');
    expect(read("app/brownfield/targets/[targetId]/page.tsx")).toContain("<PromoteButton");
  });
  test("evalBrief suffix key exists in ko and en", () => {
    expect(ko.stages.s67.evalBrief.unreviewedSuffix).toBe("(AI 미검토 {n})");
    expect(en.stages.s67.evalBrief.unreviewedSuffix).toContain("{n}");
  });
});

describe("C. detail tab: origin badges (text + icon)", () => {
  const b = (source: string, assessedBy: string | null = null, locale: "ko" | "en" = "ko") =>
    render(createElement(badge.OriginBadge, { source, assessedBy }), locale);
  test("자동 규칙 / AI / 사람 each carry text and an aria-hidden icon", () => {
    expect(b("auto_rule")).toContain("자동 규칙");
    expect(b("auto_rule")).toContain('aria-hidden="true">⚙ ');
    expect(b("ai_draft")).toContain(">AI<");
    expect(b("ai_draft")).toContain('aria-hidden="true">✦ ');
    expect(b("human")).toContain("사람");
    expect(b("human")).toContain('aria-hidden="true">☻ ');
    expect(b("ai_draft", "김OO")).toContain("김OO");
    expect(b("ai_draft", null, "en")).toContain("Not reviewed by a person");
  });
  test("non-human origins are marked unreviewed in the tooltip, a person's verdict is not", () => {
    expect(b("auto_rule")).toContain("사람 검토 전");
    expect(b("human")).not.toContain("사람 검토 전");
  });
});

describe("C. detail tab: review action, rule-only accept, single-candidate AI 평가", () => {
  const tabOnly = read("components/brownfield-target/TargetEvalTab.tsx");
  const parts = read("components/brownfield-target/TargetEvalParts.tsx");
  const tab = `${tabOnly} ${parts}`.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")");
  const actions = read("components/brownfield-target/useTargetActions.ts");
  test("badge only on judged items; 확인 toggle only for non-human judged items; saving a bare 확인 keeps the status", () => {
    expect(tab).toContain('(it.state?.status ?? "pending") !== "pending" && (');
    expect(tab).toContain("<OriginBadge");
    expect(tab).toContain(
      'const reviewable = canAct && src !== "human" && (it.state?.status ?? "pending") !== "pending";',
    );
    expect(tab).toContain("editPending(it.id, { accept: !pending[it.id]?.accept })");
    expect(tab).toContain(
      "if (p.accept || (p.status !== undefined && p.status !== current)) await setEvalVerdict(it.id, p.status ?? current);",
    );
    // the bare accept sends no note / evidence (the server keeps them for an unchanged status)
    expect(actions).toMatch(/\.\.\.\(note !== undefined \? \{ note \} : \{\}\)/);
  });
  test("accept-rule button: auto_rule items only, per category, via the accept-rule route; no accept-all for AI items", () => {
    expect(tab).toContain('it.state?.verdict_source === "auto_rule" && it.state.status !== "pending"');
    expect(tab).toContain("ruleItems.length > 0");
    expect(tab).not.toContain('"ai_draft" &&'); // the bulk filter never selects AI items
    expect(actions).toContain("/eval-state/accept-rule");
    expect(actions).toContain("{ category }");
    expect(ko.stages.s67.aiEval.acceptAllRule.replace("{n}", "3")).toBe("자동 규칙 판정 3건 모두 확인");
    expect(en.stages.s67.aiEval.acceptAllRuleIntro).toContain("AI verdicts are not included");
  });
  test("unreviewed count in the tab header and per category", () => {
    expect(tab).toContain('data-testid="eval-unreviewed-total"');
    expect(tab).toContain("data-testid={`eval-unreviewed-$" + "{cat}`}");
    expect(tab).toContain('ta("unreviewed", { n: unreviewedTotal })');
  });
  test("the retired AI 초안 path is gone; AI 평가 reuses the S6 start dialog, hook and progress panel (target_ids:[id])", () => {
    for (const gone of [
      "generateEvalDraft",
      "saveDraftVerdicts",
      "evalDraft",
      "draftBusy",
      "eval-draft`",
      "EvalDraftResp",
    ]) {
      expect(tab + actions + read("components/brownfield-target/useTargetDetail.ts")).not.toContain(gone);
    }
    expect(tab).toContain("<AiEvalRowButton");
    expect(tab).toContain("useAiEval(");
    expect(tab).toContain("<AiEvalRunsPanel");
    expect(read("components/stages/brownfield/AiEvalRowButton.tsx")).toContain("onStart(value, [targetId])");
    expect(JSON.stringify(ko.components.brownfieldTarget.evalTab)).not.toContain("AI 초안");
  });
});

describe("D. removed usage and parity", () => {
  test("no UI code reads the removed provisional fields from eval_draft or posts to the removed routes", () => {
    const files = [
      "components/stages/brownfield/AiEvalChips.tsx",
      "components/stages/brownfield/AiEvalCoverage.tsx",
      "components/stages/brownfield/LonglistSection.tsx",
      "components/stages/brownfield/types.ts",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/provisional_score|proposed_count|unverified_count|confirmed_count/);
      expect(src).not.toMatch(/eval-draft-versions\/[^\n]*\/confirm/);
    }
    expect(existsSync(`${ROOT}/components/stages/brownfield/AiEvalRowConfirm.tsx`)).toBe(false);
    const types = read("components/stages/brownfield/aiEvalTypes.ts");
    const chip = types.slice(
      types.indexOf("export interface VersionChip"),
      types.indexOf("export interface EvalDraftView"),
    );
    expect(chip).not.toMatch(/provisional_score|proposed_count|unverified_count/);
    // the version rows (history) still carry their own counts server-side; the panel reads applied/reviewed
    expect(read("components/stages/brownfield/aiEvalTypes.ts")).toContain("applied_count: number;");
  });
  test("ko/en parity for the new keys and the eval tab / actions catalogs", () => {
    const flat = (o: Loose, p = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
    for (const ns of [
      (c: Loose) => c.stages.s67.aiEval,
      (c: Loose) => c.stages.s67.evalBrief,
      (c: Loose) => c.components.brownfieldTarget.evalTab,
      (c: Loose) => c.components.brownfieldTarget.useTargetActions,
    ]) {
      expect(flat(ns(en)).sort()).toEqual(flat(ns(ko)).sort());
    }
    for (const k of [
      "appliesDirectly",
      "partialMarker",
      "unreviewed",
      "originRule",
      "originAi",
      "originHuman",
      "acceptOne",
      "acceptAllRule",
      "promoteUnreviewed",
      "appliedReviewed",
    ]) {
      expect(ko.stages.s67.aiEval[k]).toBeTruthy();
      expect(en.stages.s67.aiEval[k]).toBeTruthy();
    }
  });
});
