// @version 1.2.0
// 1.2.0: 2026-10-26 PM-approved follow-up round FU-B (design
// 2026-10-26-flows-ux-review-remediation-design, Design delta) — (a) the
// dynamic-key allowlist gains stageNameKey(...) (flow-graph's payload-stage-name
// resolver, the markerNoteKey pattern); (b) the pages.flows namespace joins the
// FILES map as translator var "tp" (flow-graph.tsx + blueprint-view.tsx consume
// pages.flows.stageNames.*); (c) a dedicated enumeration asserts every serving
// stage id resolves in BOTH catalogs, with the ko value echoing the flow.spec
// SSOT verbatim and the en value placeholder-free.
// 1.1.0: 2026-10-26 UX review F9 remediation support — (a) the dynamic-key
// allowlist gains markerNoteKey(...) (flow-graph's catalog-notes resolver);
// (b) expectParams is ICU-plural-aware — en values may carry "{p1, plural, …}"
// (design-pinned ledgerLine/detailsSummary), so the
// placeholder guard matches {p1} and {p1, alike instead of literal "{p1}" only.
// flows i18n resolution regression (2026-10-23 user screenshot report).
// The user's long-running dev server rendered RAW key paths
// (pages.flows.graph.trackCommon, …markers.noteLine, …legend.domains.*) inside the
// stage-flow graph nodes: the running process had cached a stale locales/ko.json
// module from before the graph block landed, so every graph t() call fell through
// next-intl's getMessageFallback to the dot-joined path. At HEAD the catalogs are
// complete and a fresh process resolves everything — this test pins that fact so a
// catalog-side regression (key dropped, mis-nested, or added to a component without
// a catalog entry) fails before it can ship another raw-key render.
//
// Harness design (follows i18n-catalog-gaps.test.ts conventions):
//   1. Statically extract every literal t("…") / tg("…") / tc("…") / tr("…") call
//      from the flows view sources, with the per-file translator→namespace map
//      (the same namespaces the components pass to useTranslations).
//   2. Expand every DYNAMIC call site — markerKey(kind, part), legend.domains.${d},
//      ADMIN_FORBIDDEN_KEY, PROPOSAL_TYPE_KEY[…], and the chip/window keys emitted
//      by flows-view-lib (exercised by calling the real emitters, not a mirror list).
//   3. Assert every key resolves to a non-empty string in BOTH the ko AND en
//      catalogs — individually, which is stronger than the runtime view
//      (i18n/request.ts deep-merges ko under the active locale, so a missing en key
//      would silently render Korean; a missing ko key is the raw-path bug itself).
//   4. Assert interpolation placeholders: every {param} the component passes must
//      appear in both locale values (guards "{count}" vs "{p1}" drift).
//   5. Drift guard: any t-family call whose first argument is NOT a string literal
//      and NOT on the known dynamic-expression allowlist fails the test — a new
//      dynamic key family must be added to the enumeration here.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ko from "../../app/web-next/locales/ko.json";
import en from "../../app/web-next/locales/en.json";
import { SPEC_STAGES } from "../../app/web-next/lib/spec-activities.generated.ts";
import {
  classifiedByChip,
  DRY_RUN_DISCLOSURE_KEY,
  estimateFromLedger,
  expiryChip,
  gradeFromPreference,
  preferenceLabelKey,
  runStatusChip,
  sessionStatusChip,
  sourceChip,
  windowTokenKey,
} from "../../app/web-next/app/flows/flows-view-lib.ts";

type Catalog = Record<string, unknown>;

const FLOWS_ROOT = join(import.meta.dirname, "../../app/web-next/app/flows");

/** file (under app/flows) → translator variable → namespace prefix ("" = root). */
const FILES: Record<string, Record<string, string>> = {
  "page.tsx": { t: "pages.flows.flowsAdmin" },
  // tp = pages.flows — the FU-B stageNames namespace (payload stage names are
  // resolved chrome-side through stageNameKey/stageDisplay, flow-graph.tsx).
  "blueprint-view.tsx": { t: "pages.flows.blueprint", tg: "pages.flows.graph", tp: "pages.flows", tc: "common" },
  "flow-graph.tsx": { tg: "pages.flows.graph", tp: "pages.flows" },
  "ledger-view.tsx": { t: "pages.flows.ledger", tc: "common", tr: "" },
  "run-expansion.tsx": { t: "pages.flows.runExpansion", tc: "common", tr: "" },
  "dry-run/page.tsx": { t: "pages.flows.dryRunSession", tc: "common", tr: "" },
  "dry-run/suggestion-panel.tsx": { t: "pages.flows.dryRunSession" },
  "dry-run/[sessionId]/page.tsx": { t: "pages.flows.dryRunSession", tc: "common", tr: "" },
};

// ── catalog resolution (the request.ts lookup shape: nested-JSON leaf paths) ──
function lookup(catalog: Catalog, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Catalog)[k] : undefined), catalog);
}

/** Resolves = non-empty string leaf (a raw-path fallback can never satisfy this). */
function expectResolves(catalog: Catalog, locale: string, key: string): string {
  const v = lookup(catalog, key);
  expect([locale, key, typeof v]).toEqual([locale, key, "string"]);
  const s = v as string;
  expect([locale, key, s.length > 0]).toEqual([locale, key, true]);
  return s;
}

function expectResolvesBoth(key: string): void {
  expectResolves(ko as Catalog, "ko", key);
  expectResolves(en as Catalog, "en", key);
}

/** Every {param} the call site passes must survive in both locale values.
 *  ICU-plural aware (v1.1.0): a design-pinned en value may open an ICU clause
 *  ("{p1, plural, …}") instead of plain substitution ("{p1}") — both count. */
function expectParams(key: string, params: readonly string[]): void {
  for (const p of params) {
    const icuOrPlain = new RegExp(`\\{${p}[},]`);
    expect(lookup(ko as Catalog, key), `ko ${key} must contain {${p}}`).toMatch(icuOrPlain);
    expect(lookup(en as Catalog, key), `en ${key} must contain {${p}}`).toMatch(icuOrPlain);
  }
}

// ── call-site extraction (string-aware balanced-paren scan) ───────────────────
/** Returns the balanced span of the argument list starting just after the "(",
 *  skipping string literals so "(/flows/dry-run)" cannot end the span early. */
function argSpan(src: string, openIdx: number): [number, number] | null {
  let depth = 0;
  let i = openIdx; // index of "("
  let quote: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return [openIdx + 1, i]; // exclusive end
    }
  }
  return null;
}

/** First argument text (up to the top-level comma) of a call at openIdx. */
function firstArg(src: string, openIdx: number): string {
  const span = argSpan(src, openIdx);
  if (!span) return "";
  const args = src.slice(span[0], span[1]);
  // find the top-level comma (depth 0, outside strings)
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) return args.slice(0, i).trim();
  }
  return args.trim();
}

/** Interpolation param names of the values argument ({ p1: x, count: y } → p1,count). */
function paramNames(src: string, openIdx: number): string[] {
  const span = argSpan(src, openIdx);
  if (!span) return [];
  const args = src.slice(span[0], span[1]);
  const braces = args.indexOf("{");
  if (braces === -1) return [];
  const names = [...args.slice(braces).matchAll(/(\w+)\s*:/g)].map((m) => m[1]!);
  return [...new Set(names)];
}

interface CallSite {
  file: string;
  ns: string;
  key: string | null; // literal key (namespace-relative)
  params: string[];
  dynamic: string | null; // first-arg expression when not a literal
}

const TRANSLATOR_VARS = ["t", "tg", "tc", "tr", "tp"] as const;

function extractCalls(): CallSite[] {
  const out: CallSite[] = [];
  for (const [file, varMap] of Object.entries(FILES)) {
    const src = readFileSync(join(FLOWS_ROOT, file), "utf8");
    for (const v of TRANSLATOR_VARS) {
      if (!(v in varMap)) continue;
      const re = new RegExp(`(?<![\\w$.])${v}\\(`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const open = m.index + m[0].length - 1; // index of "("
        const arg1 = firstArg(src, open);
        const lit = /^"([^"]+)"$/.exec(arg1);
        out.push(
          lit
            ? { file, ns: varMap[v]!, key: lit[1]!, params: paramNames(src, open), dynamic: null }
            : { file, ns: varMap[v]!, key: null, params: [], dynamic: arg1.replace(/\s+/g, " ") },
        );
      }
    }
  }
  return out;
}

const CALLS = extractCalls();

/** Dynamic first-arg expressions the enumeration below covers. Anything else is
 *  drift: a new dynamic key family must be added to the explicit expansion. */
const DYNAMIC_ARG_ALLOWLIST =
  /^(ADMIN_FORBIDDEN_KEY|DRY_RUN_DISCLOSURE_KEY|windowKey|prefKey|k|PROPOSAL_TYPE_KEY\[[^\]]+\]|marker(?:Note)?Key\([^)]+\)|stageNameKey\([^)]+\)|`legend\.domains\.\$\{d\}`|[A-Za-z_$][\w$]*\.(key|titleKey|noteKey))$/;

// ── dynamic key families ──────────────────────────────────────────────────────
// marker kinds + domain keys are derived from the flow-graph source itself, so a
// new marker kind or domain lands here automatically (single ownership).
const graphSrc = readFileSync(join(FLOWS_ROOT, "flow-graph.tsx"), "utf8");
const markerKinds = [...graphSrc.matchAll(/const MARKER_KIND_COLOR[^=]*=\s*\{([\s\S]*?)\}/g)][0]![1]
  .match(/(\w+)\s*:/g)!
  .map((s) => s.replace(/\s*:/, ""));
const domainKeys = [...graphSrc.matchAll(/const DOMAIN_KEYS = \[([^\]]*)\]/g)][0]![1]
  .split(",")
  .map((s) => s.trim().replace(/^"|"$/g, ""))
  .filter(Boolean);

// suggestion-panel's PROPOSAL_TYPE_KEY record values.
const panelSrc = readFileSync(join(FLOWS_ROOT, "dry-run/suggestion-panel.tsx"), "utf8");
const proposalTypeKeys = [...panelSrc.matchAll(/const PROPOSAL_TYPE_KEY[^=]*=\s*\{([\s\S]*?)\}/g)][0]![1]
  .match(/:\s*"([^"]+)"/g)!
  .map((s) => s.replace(/^:\s*"|"$/g, ""));

// Lib-emitted chip/window/disclosure keys — exercised through the real emitters
// (the same functions the views call), never a mirrored list.
const NOW = Date.parse("2026-10-25T00:00:00Z");
const emitterKeys: Array<{ key: string; params: string[] }> = [
  { key: runStatusChip("failed").key!, params: [] },
  { key: runStatusChip("succeeded").key!, params: [] },
  { key: runStatusChip("who-knows").key ?? "", params: [] }, // null-key fallback path (no catalog key)
  { key: classifiedByChip({ source: "synthesis", catalogMatched: false }).key, params: [] },
  { key: classifiedByChip({ source: "llm", catalogMatched: true }).key, params: [] },
  { key: classifiedByChip({ source: "llm", catalogMatched: false }).key, params: [] },
  { key: sessionStatusChip("active").key!, params: [] },
  { key: sessionStatusChip("closed").key!, params: [] },
  { key: gradeFromPreference("override").key, params: [] },
  { key: gradeFromPreference("base").key, params: [] },
  { key: gradeFromPreference("tie").key, params: [] },
  { key: gradeFromPreference(null).key, params: [] },
  { key: preferenceLabelKey("override")!, params: [] },
  { key: preferenceLabelKey("base")!, params: [] },
  { key: preferenceLabelKey("tie")!, params: [] },
  { key: sourceChip("llm").key, params: [] },
  { key: sourceChip(null).key, params: [] },
].filter((e) => e.key !== "");

// expiryChip: both branches (expiring-soon + expired) with their title params.
const expirySoon = expiryChip("2026-10-26T00:00:00Z", NOW)!; // +24h → expiringSoon
const expiryPast = expiryChip("2026-10-24T00:00:00Z", NOW)!; // −24h → expired
const costMeasured = estimateFromLedger({ runs: 3, llmCalls: 2, costUsd: 0.4, lastRunAt: null });
const costUnknown = estimateFromLedger({ runs: 0, llmCalls: 0, costUsd: null, lastRunAt: null });
const windowKeys = ["24h", "7d", "30d"].map((w) => windowTokenKey(w)!).map((k) => `pages.flows.ledger.${k}`);

// ── tests ─────────────────────────────────────────────────────────────────────
describe("flows i18n resolution — every consumed key resolves in ko AND en (no raw-path fallback)", () => {
  test("call-site extraction found keys in every view file (harness sanity)", () => {
    expect(Object.keys(FILES).length).toBe(8);
    for (const file of Object.keys(FILES)) {
      expect(CALLS.some((c) => c.file === file && c.key !== null), `${file} literal keys`).toBe(true);
    }
    // The graph block is the 2026-10-23 raw-key regression surface — pin a floor.
    // 15 literal keys at introduction: 11 in flow-graph.tsx (svgTitle, svgDesc,
    // trackCommon, nodeTitle, activityCount, markers.dotTitle/nodeLabel/noteLine,
    // legend.title/dot/marker) + 4 in blueprint-view.tsx (sectionAria/Title/Hint,
    // markerChip). The dynamic families (markerKey, legend.domains.${d}) are
    // enumerated separately below.
    const graphKeys = CALLS.filter((c) => c.ns === "pages.flows.graph" && c.key).map((c) => c.key);
    expect(graphKeys.length).toBeGreaterThanOrEqual(15);
  });

  test("every literal t()/tg()/tc()/tr() key resolves in both catalogs, placeholders intact", () => {
    for (const c of CALLS) {
      if (c.key === null) continue;
      const full = c.ns ? `${c.ns}.${c.key}` : c.key;
      expectResolvesBoth(full);
      if (c.params.length > 0) expectParams(full, c.params);
    }
  });

  test("dynamic call sites are all on the enumerated families (drift guard)", () => {
    const unknown = CALLS.filter((c) => c.dynamic !== null && !DYNAMIC_ARG_ALLOWLIST.test(c.dynamic!));
    expect(
      unknown.map((c) => `${c.file}: ${c.dynamic}`),
      "new dynamic t() argument — extend the dynamic families in this test",
    ).toEqual([]);
  });

  test("marker kinds × short/legend and legend.domains.* resolve (graph markers/legend)", () => {
    expect(markerKinds.sort()).toEqual(["affinity", "override", "scoped"]);
    for (const kind of markerKinds) {
      for (const part of ["short", "legend"] as const) {
        const full = `pages.flows.graph.markers.${kind}.${part}`;
        expectResolvesBoth(full);
      }
    }
    expect(domainKeys.sort()).toEqual(["_core", "_shared", "functional", "industry", "region", "technical"]);
    for (const d of domainKeys) expectResolvesBoth(`pages.flows.graph.legend.domains.${d}`);
  });

  test("stageNames.* resolves for every serving stage in both catalogs — ko echoes the flow.spec SSOT verbatim (FU-B)", () => {
    // FU-B (2026-10-26 PM-approved follow-up): flow.spec stage names are payload
    // data served verbatim by /api/flows, so they leaked Korean into the EN view.
    // The chrome resolves pages.flows.stageNames.<stageId> through stageNameKey
    // (the markerNoteKey pattern: t.has() lookup, payload fallback) — the SSOT
    // stays flow.spec and the API contract stays untouched; a stage without a
    // catalog key degrades to the payload name. The projection itself is pinned
    // to the spec by tests/unit/process-flow.test.ts, so echoing SPEC_STAGES
    // here transitively pins the catalog to flow.spec verbatim.
    for (const s of SPEC_STAGES) {
      const key = `pages.flows.stageNames.${s.id}`;
      const koValue = expectResolves(ko as Catalog, "ko", key);
      expect(koValue, `ko ${key} must echo the flow.spec name verbatim (ko-master SSOT)`).toBe(s.name);
      const enValue = expectResolves(en as Catalog, "en", key);
      expect(enValue, `en ${key} must be placeholder-free prose`).not.toMatch(/[{}]/);
    }
  });

  test("ADMIN_FORBIDDEN_KEY and PROPOSAL_TYPE_KEY resolve in their namespaces", () => {
    expectResolvesBoth("pages.flows.flowsAdmin.adminForbidden");
    expectResolvesBoth("pages.flows.ledger.adminForbidden");
    expectResolvesBoth("pages.flows.dryRunSession.adminForbidden");
    expect(proposalTypeKeys.length).toBe(2);
    for (const k of proposalTypeKeys) expectResolvesBoth(`pages.flows.dryRunSession.${k}`);
  });

  test("flows-view-lib-emitted chip keys resolve in both catalogs", () => {
    for (const e of emitterKeys) expectResolvesBoth(e.key);
    for (const k of windowKeys) expectResolvesBoth(k);
    expectResolvesBoth(DRY_RUN_DISCLOSURE_KEY);
  });

  test("parametrized emitters (expiry chips, cost estimates) keep their placeholders", () => {
    expectResolvesBoth(expirySoon.key);
    expectResolvesBoth(expirySoon.titleKey);
    expectParams(expirySoon.titleKey, Object.keys(expirySoon.titleParams));
    expectResolvesBoth(expiryPast.key);
    expectResolvesBoth(expiryPast.titleKey);
    expectParams(expiryPast.titleKey, Object.keys(expiryPast.titleParams));
    expectResolvesBoth(costMeasured.noteKey);
    expectParams(costMeasured.noteKey, Object.keys(costMeasured.noteParams));
    expectResolvesBoth(costUnknown.noteKey);
    expectParams(costUnknown.noteKey, Object.keys(costUnknown.noteParams));
  });
});
