// Regression guard for the table column sizing system
// (docs/designs/2026-10-11-table-column-sizing-system-design.md, A.5).
// Static scan of the web-next .tsx sources and styles.css; no browser needed.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "./app/web-next";
const css = readFileSync(`${ROOT}/app/styles.css`, "utf8");
// i18n (design 2026-10-23-i18n-ui-adoption): migrated tables label themselves
// through catalog keys, so the locators below match the key call sites and the
// dedicated test at the bottom pins each key to its original Korean label.
const koCatalog = await import("../../app/web-next/locales/ko.json");

function koOf(key: string): string {
  const v = key.split(".").reduce<unknown>((acc, k) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), koCatalog);
  if (typeof v !== "string") throw new Error(`ko catalog key not found: ${key}`);
  return v;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

interface TableInfo {
  key: string; // file#ordinal
  file: string;
  line: number;
  className: string;
  block: string; // <table ... </table>
  scrollWrapped: boolean;
  headerCells: number; // unconditional <th in the first header row
  headerCellsMax: number; // including conditional ones (`cond && <th`)
}

function classNameOf(openTag: string): string {
  const m = openTag.match(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

function scanTables(): TableInfo[] {
  const tables: TableInfo[] = [];
  for (const path of walk(ROOT).sort()) {
    const src = readFileSync(path, "utf8");
    const file = relative(ROOT, path);
    const lines = src.split("\n");
    let ordinal = 0;
    for (const m of src.matchAll(/<table\b/g)) {
      ordinal += 1;
      const start = m.index ?? 0;
      const end = src.indexOf("</table>", start);
      const block = src.slice(start, end === -1 ? undefined : end);
      const openTag = block.slice(0, block.indexOf(">") + 1);
      const line = src.slice(0, start).split("\n").length;
      // Heuristic: a .table-scroll element opens within 15 lines above (or on) the <table> line.
      const above = lines.slice(Math.max(0, line - 16), line).join("\n");
      // Header width = widest <thead> row, counting colSpan (a numeric expression such as
      // `note ? 2 : 3` contributes its min to headerCells and its max to headerCellsMax); `&& <th` cells are optional.
      const headRows = block.match(/<thead[\s\S]*?<\/thead>/)?.[0].match(/<tr\b[\s\S]*?<\/tr>/g) ?? [];
      let headerCellsMax = 0;
      let lo = 0;
      if (headRows.length === 0) {
        const firstTr = block.match(/<tr\b[\s\S]*?<\/tr>/)?.[0] ?? "";
        headerCellsMax = (firstTr.match(/<th\b/g) ?? []).length;
        lo = headerCellsMax - (firstTr.match(/&&\s*<th\b/g) ?? []).length;
      }
      for (const tr of headRows) {
        let rowLo = 0;
        let rowHi = 0;
        for (const m of tr.matchAll(/(&&\s*)?<th\b((?:[^>]|=>)*)>/g)) {
          const expr = m[2].match(/colSpan=\{([^}]*)\}/)?.[1];
          const nums = expr ? (expr.match(/\d+/g) ?? ["1"]).map(Number) : [1];
          rowHi += Math.max(...nums);
          if (!m[1]) rowLo += Math.min(...nums);
        }
        headerCellsMax = Math.max(headerCellsMax, rowHi);
        lo = Math.max(lo, rowLo);
      }
      tables.push({
        key: `${file}#${ordinal}`,
        file,
        line,
        className: classNameOf(openTag),
        block,
        scrollWrapped: /table-scroll/.test(above),
        headerCells: lo,
        headerCellsMax,
      });
    }
  }
  return tables;
}

/** Tables that intentionally stay content-sized (design B.1). Each needs a reason. */
const CONTENT_SIZED_TABLES: Array<{ file: string; className: string; reason: string }> = [
  { file: "", className: "param-table", reason: "Two-column key/value table; the value column is numeric nowrap" },
  { file: "", className: "report-table", reason: "Variable year columns (DART financials); scroll-first inside .table-scroll" },
];

const allowlisted = (t: TableInfo) =>
  CONTENT_SIZED_TABLES.some((a) => (a.file === "" || t.file.includes(a.file)) && t.className.includes(a.className));

/**
 * Audited tables (design B, rows 1-14) that must adopt table-fixed-pct. `match` is a fragment of the
 * table's aria-label call site (a literal for unconverted pages, a catalog key name for i18n-migrated
 * components — resolved labels are pinned in MIGRATED_TABLE_LABELS below). A row leaves
 * KNOWN_OFFENDERS in the batch that migrates it.
 */
const AUDITED_TABLES: Array<{ file: string; match: string }> = [
  { file: "components/stages/OpportunityFunnelStage.tsx", match: "opportunityFunnelList" },
  { file: "components/stages/DdStage.tsx", match: "p1Checklist" },
  { file: "components/stages/brownfield/ShortlistSection.tsx", match: "andCommitteeRecommendation2" },
  { file: "components/stages/CapabilityJudgementTable.tsx", match: "capabilityAttainabilityTable" },
  { file: "components/stages/market/SizingMarketTabs.tsx", match: "competitiveStructureKeyCompanies" },
  { file: "app/agents/page.tsx", match: "rosterTitle" },
  { file: "app/settings/connected-apps/page.tsx", match: "patTableAria" },
  { file: "app/deals/page.tsx", match: "pages.deals.agingTableAria" },
  { file: "components/stages/EstablishmentPanel.tsx", match: "establishmentExecutionStepStatus" },
  { file: "app/projects/[id]/backtest/page.tsx", match: "tableAria" },
  { file: "app/projects/[id]/charter/page.tsx", match: "kpiSectionAria" },
  { file: "components/stages/brownfield/LonglistSection.tsx", match: "fullCandidateList2" },
  { file: "app/strategy/page.tsx", match: "w-full border-collapse" },
];

/** i18n: migrated aria-label keys → the original Korean labels, pinned in locales/ko.json. */
const MIGRATED_TABLE_LABELS: Array<[string, string]> = [
  ["stages.s2.stage.opportunityFunnelList", "기회 퍼널 목록"],
  ["stages.s9.stage.p1Checklist", "{p1} 체크리스트"],
  ["stages.s67.shortlistSection.andCommitteeRecommendation2", "사전 검토 · 위원회 추천"],
  ["components.capabilityJudgement.table.capabilityAttainabilityTable", "필요 역량 달성 가능성 표"],
  ["stages.s1.sizingMarketTabs.competitiveStructureKeyCompanies", "경쟁 구조 — 주요 기업"],
  ["common.competitiveStructureKeyCompanies", "경쟁 구조 — 주요 기업"],
  ["stages.s11.establishment.establishmentExecutionStepStatus", "설립 실행 단계 현황"],
  ["stages.s67.longlistSection.fullCandidateList2", "후보 전체 목록"],
  ["stages.s4.decisionTab.routeDecisionHistory", "진출방식 결정 이력"],
  ["stages.s4.evalTab.requiredCapabilityLevelRegisterS3", "필요 역량 수준 레지스터 (S3 연계)"],
  ["stages.s3.synergyListSection.companyListInAnalysisScope", "분석 대상 회사 목록"],
  ["common.keyReviewAreas", "주요 검토 영역"],
  ["stages.s8.wacc.betaPanel.peerPublishedBeta", "동종사 공표 베타"],
  ["pages.connectedApps.patTableAria", "개인 API 토큰 목록"],
  ["pages.agents.rosterTitle", "에이전트 로스터"],
  ["pages.agents.stepsTableAria", "체인 단계별 실행 기록"],
  ["pages.projects.backtest.tableAria", "백테스트"],
  ["pages.projects.charter.kpiSectionAria", "KPI 사전 확정"],
  ["pages.projects.share.tableAria", "공유 링크"],
];

const WIDE_TABLE_HEADER_CELLS = 6; // same threshold as the design-lint table-sizing/no-bare-wide-table rule

/**
 * Ratchet: today's known offenders. Entries may only be removed (the test fails when an entry no
 * longer offends, so the list shrinks as batches land) and must be empty after batch 3.
 *  - `no-scroll:<file>#<n>`   table (n-th <table in file) with 6+ header cells and no .table-scroll wrapper
 *  - `auto-wide:<file>:<match>`  audited table that is not yet table-fixed-pct
 *  - `css:<selector>`         column class declaring width auto / 100%
 */
const KNOWN_OFFENDERS: string[] = [
  // batch 3 landed — the rollout is complete; the list must stay empty.
]

function offenders(tables: TableInfo[]): string[] {
  const found: string[] = [];
  for (const t of tables) {
    if (allowlisted(t)) continue;
    if (!t.scrollWrapped && t.headerCellsMax >= WIDE_TABLE_HEADER_CELLS) found.push(`no-scroll:${t.key}`);
  }
  for (const a of AUDITED_TABLES) {
    const hit = tables.filter((t) => t.file === a.file && (t.block.slice(0, 400).includes(a.match)));
    if (hit.length === 0) found.push(`audited-table-missing:${a.file}:${a.match}`);
    else if (!hit.some((t) => t.className.includes("table-fixed-pct"))) found.push(`auto-wide:${a.file}:${a.match}`);
  }
  for (const [selector] of columnWidthRules()) found.push(`css:${selector}`);
  return found.sort();
}

/** CSS rules on column classes / th that declare `width: auto` or `width: 100%`. */
function columnWidthRules(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const body = m[2];
    if (selector.startsWith("@") || selector.startsWith("/*")) continue;
    if (selector.includes("param-table")) continue; // allowlisted key/value table (mobile stack)
    if (!/(?:^|[\s,>])th\b|\.col-[\w-]+|\.[\w]+-col-[\w-]+/.test(selector)) continue;
    if (/(?:^|[;\s])width:\s*(auto|100%)\s*(;|$)/.test(body)) out.push([selector.replace(/\s+/g, " "), body]);
  }
  return out;
}

const tables = scanTables();

describe("table column sizing guard", () => {
  test("scanner finds the web-next tables", () => {
    expect(tables.length).toBeGreaterThan(50);
  });

  test("every fixed-percentage table has a ColGroup whose length matches its header cells", async () => {
    const problems: string[] = [];
    for (const t of tables.filter((x) => x.className.includes("table-fixed-pct"))) {
      const where = `${t.file}:${t.line}`;
      const m = t.block.match(/<ColGroup\s+widths=\{(.*)\}\s*\/>/);
      if (!m) {
        problems.push(`${where} fixed-pct table has no <ColGroup widths={...} />`);
        continue;
      }
      const src = readFileSync(join(ROOT, t.file), "utf8");
      const call = m[1].trim().match(/^([a-zA-Z]\w*)\(/);
      if (call) {
        // Computed preset (variable column count, e.g. a transposed checklist table): it must live
        // in the sibling constants.ts and sum to 100 for every plausible column count.
        const mod = (await import(join(process.cwd(), ROOT, t.file, "..", "constants.ts"))) as Record<string, (n: number) => number[]>;
        const fn = mod[call[1]];
        if (typeof fn !== "function") {
          problems.push(`${where} computed preset ${call[1]} not exported from constants.ts`);
          continue;
        }
        for (let n = 1; n <= 20; n++) {
          const w = fn(n);
          if (Math.abs(w.reduce((a, b) => a + b, 0) - 100) > 0.01 || w.some((x) => !(x > 0))) problems.push(`${where} ${call[1]}(${n}) is not a positive preset summing to 100`);
        }
        continue;
      }
      const names = m[1].match(/[A-Z][A-Z0-9_]+/g) ?? [];
      if (names.length === 0) {
        problems.push(`${where} ColGroup widths must reference a named *_COL_PCT preset`);
        continue;
      }
      for (const name of names) {
        // Preset may live in the same file or in the sibling constants module.
        const decl = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`);
        let arr = src.match(decl)?.[1];
        if (arr === undefined) {
          const dir = join(ROOT, t.file, "..");
          for (const f of readdirSync(dir)) {
            if (!/\.tsx?$/.test(f)) continue;
            arr = readFileSync(join(dir, f), "utf8").match(decl)?.[1];
            if (arr !== undefined) break;
          }
        }
        if (arr === undefined) {
          problems.push(`${where} preset ${name} not found`);
          continue;
        }
        const widths = arr.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
        const sum = widths.reduce((a, b) => a + b, 0);
        if (widths.some((w) => !(w > 0))) problems.push(`${where} ${name} has a non-positive width`);
        if (Math.abs(sum - 100) > 0.01) problems.push(`${where} ${name} sums to ${sum}, expected 100`);
        if (widths.length < t.headerCells || widths.length > t.headerCellsMax) {
          problems.push(`${where} ${name} has ${widths.length} widths but the header has ${t.headerCells}-${t.headerCellsMax} cells`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("fixed-percentage tables sit in a .table-scroll wrapper", () => {
    const unwrapped = tables.filter((t) => t.className.includes("table-fixed-pct") && !t.scrollWrapped).map((t) => `${t.file}:${t.line}`);
    expect(unwrapped).toEqual([]);
  });

  test("ratchet: known offenders only shrink, new tables must opt in", () => {
    const found = offenders(tables);
    const fresh = found.filter((f) => !KNOWN_OFFENDERS.includes(f));
    const stale = KNOWN_OFFENDERS.filter((k) => !found.includes(k));
    // New offender => wrap in .table-scroll / migrate to table-fixed-pct / add an allowlist reason.
    expect(fresh).toEqual([]);
    // Fixed offender => delete it from KNOWN_OFFENDERS (the list must reach empty after batch 3).
    expect(stale).toEqual([]);
  });

  test("batch 2 migrated tables keep the shared classes", () => {
    // Per-table source-reading checks: ColGroup presence and pct sums for fixed-pct tables are
    // covered generically above; here we pin each batch-2 table to its tmin token and the
    // long-text truncation classes so a later edit cannot silently drop them.
    const batch2: Array<{ file: string; label: string; tmin: string; expect: string[] }> = [
      { file: "components/stages/route-decision/DecisionTab.tsx", label: "routeDecisionHistory", tmin: "tmin-64", expect: ["table-fixed-pct", "cell-truncate"] },
      { file: "components/stages/route-decision/CompetitiveTab.tsx", label: "competitiveStructureKeyCompanies", tmin: "tmin-40", expect: ["table-fixed-pct", "cell-truncate"] },
      { file: "components/stages/route-decision/EvalTab.tsx", label: "requiredCapabilityLevelRegisterS3", tmin: "tmin-56", expect: ["table-fixed-pct"] },
      { file: "components/stages/CapabilityJudgementTable.tsx", label: "capabilityAttainabilityTable", tmin: "tmin-48", expect: ["table-fixed-pct"] },
      { file: "components/stages/market/SizingMarketTabs.tsx", label: "competitiveStructureKeyCompanies", tmin: "tmin-80", expect: ["table-fixed-pct", "cell-truncate"] },
      { file: "app/agents/page.tsx", label: "rosterTitle", tmin: "tmin-40", expect: ["table-fixed-pct"] },
      { file: "app/agents/page.tsx", label: "stepsTableAria", tmin: "tmin-48", expect: ["table-fixed-pct", "cell-truncate"] },
      { file: "app/deals/page.tsx", label: "pages.deals.agingTableAria", tmin: "tmin-48", expect: ["table-fixed-pct", "cell-truncate"] },
      { file: "app/settings/connected-apps/page.tsx", label: "patTableAria", tmin: "tmin-64", expect: ["table-fixed-pct", "cell-truncate"] },
      { file: "components/stages/synergy/SynergyListSection.tsx", label: "companyListInAnalysisScope", tmin: "tmin-56", expect: ["table-fixed-pct"] },
    ];
    const problems: string[] = [];
    for (const c of batch2) {
      const src = readFileSync(join(ROOT, c.file), "utf8");
      // Pick the <table ...> open tag that carries this aria-label (a section aria-label with the
      // same text can appear earlier in the file, so search open tags, not raw offsets).
      const openTag = [...src.matchAll(/<table\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(c.label));
      if (!openTag) { problems.push(c.file + ': table "' + c.label + '" not found'); continue; }
      if (!openTag.includes("table-fixed-pct")) problems.push(c.file + ': "' + c.label + '" missing table-fixed-pct');
      if (!openTag.includes(c.tmin)) problems.push(c.file + ': "' + c.label + '" missing ' + c.tmin);
      const blockStart = src.indexOf(openTag);
      const end = src.indexOf("</table>", blockStart);
      const block = src.slice(blockStart, end === -1 ? undefined : end + 8);
      if (!block.includes("<ColGroup")) problems.push(c.file + ': "' + c.label + '" missing ColGroup');
      for (const frag of c.expect) {
        if (frag === "table-fixed-pct") continue;
        if (!block.includes(frag)) problems.push(c.file + ': "' + c.label + '" missing ' + frag);
      }
    }
    expect(problems).toEqual([]);
  });


  test("batch 3 migrated tables keep the shared classes", () => {
    // Same per-table source pins as batch 2, for the batch-3 rollout.
    const batch3 = [
      { file: "app/projects/[id]/backtest/page.tsx", label: "tableAria", tmin: "tmin-40", expect: ["cell-truncate"] },
      { file: "app/projects/[id]/charter/page.tsx", label: "kpiSectionAria", tmin: "tmin-32", expect: [] },
      { file: "app/strategy/page.tsx", label: "w-full border-collapse", tmin: "tmin-56", expect: ["cell-clamp-3"] },
      { file: "components/stages/EstablishmentPanel.tsx", label: "establishmentExecutionStepStatus", tmin: "tmin-48", expect: [] },
      { file: "components/stages/brownfield/LonglistSection.tsx", label: "fullCandidateList2", tmin: "tmin-56", expect: ["cell-truncate"] },
      { file: "app/projects/[id]/proxy-chain/page.tsx", label: "tmin-64", tmin: "tmin-64", expect: [] },
      { file: "app/projects/[id]/proxy-chain/page.tsx", label: "tmin-56", tmin: "tmin-56", expect: [] },
      { file: "app/projects/[id]/share/page.tsx", label: "tableAria", tmin: "tmin-48", expect: ["cell-truncate"] },
      { file: "components/DataTab.tsx", label: "tmin-48", tmin: "tmin-48", expect: ["cell-truncate"] },
      { file: "components/stages/synergy/SynergyTabs.tsx", label: "keyReviewAreas", tmin: "tmin-56", expect: ["cell-truncate"] },
      { file: "components/wacc/BetaPanel.tsx", label: "peerPublishedBeta", tmin: "tmin-48", expect: [] },
    ];
    const problems: string[] = [];
    for (const c of batch3) {
      const src = readFileSync(join(ROOT, c.file), "utf8");
      const openTag = [...src.matchAll(/<table\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(c.label));
      if (!openTag) { problems.push(c.file + ': table "' + c.label + '" not found'); continue; }
      if (!openTag.includes("table-fixed-pct")) problems.push(c.file + ': "' + c.label + '" missing table-fixed-pct');
      if (!openTag.includes(c.tmin)) problems.push(c.file + ': "' + c.label + '" missing ' + c.tmin);
      const blockStart = src.indexOf(openTag);
      const end = src.indexOf("</table>", blockStart);
      const block = src.slice(blockStart, end === -1 ? undefined : end + 8);
      if (!block.includes("<ColGroup")) problems.push(c.file + ': "' + c.label + '" missing ColGroup');
      for (const frag of c.expect) {
        if (!block.includes(frag)) problems.push(c.file + ': "' + c.label + '" missing ' + frag);
      }
    }
    expect(problems).toEqual([]);
  });

  test("allowlist entries carry a reason", () => {
    for (const a of CONTENT_SIZED_TABLES) expect(a.reason.length).toBeGreaterThan(10);
  });

  // i18n: the batch locators above match key call sites; the human-visible
  // wording stays pinned here — every migrated aria-label key must resolve to
  // its original Korean label in the ko master catalog.
  test("migrated table aria-label keys resolve to the original Korean labels", () => {
    for (const [key, ko] of MIGRATED_TABLE_LABELS) expect(koOf(key)).toBe(ko);
  });

  test("shared sizing CSS exists and the mobile max-content rule excludes fixed-pct tables", () => {
    expect(css).toMatch(/\.table-fixed-pct \{ table-layout: fixed; width: 100%; min-width: var\(--table-min/);
    for (const t of ["32", "40", "48", "56", "64", "80"]) expect(css).toContain(`.table-fixed-pct.tmin-${t} { --table-min: ${t}rem; }`);
    expect(css).toContain(".cell-truncate {");
    expect(css).toContain(".cell-clamp-3 {");
    expect(css).toContain(".table-scroll .data-table:not(.table-fixed-pct) {");
  });
});
