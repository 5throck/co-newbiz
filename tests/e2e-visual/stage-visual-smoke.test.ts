// @version 1.1.0
/**
 * v1.1.0 (2026-11-23, F-33 dispatch family / DEC-20261123-01 ruling 4): TRACK_SKIPPED_STAGES
 * is now DERIVED from STAGE_META.applicableTracks (app/web-next/lib/stage-meta.ts)
 * instead of a hand-copied static map. The static copy could go stale after an
 * applicableTracks amendment (ADR-0094/0095 class): the walk would either false-fail
 * on the old skip set or silently assert geometry the spec no longer declares. The
 * derived map always exercises the live spec, and a stage-id union assertion pins
 * the walked paths (7 deal + 5 project segments) to exactly the 12 STAGE_META ids —
 * an id change fails loudly instead of walking ghost paths. Same assertions as v1.0.0.
 *
 * Visual/layout smoke over the 12 stage paths, both tracks (T-20261022-050).
 *
 * Boots the production Next server against a scratch SQLite seeded with the
 * S1-S12 demo seeds (brownfield seedS1ToS12Demo + greenfield
 * seedGreenfieldS1ToS12Demo), logs in through the REAL login UI (the harness
 * generates runtime credentials — nothing secret is hardcoded or read from
 * env; E2E_VISUAL_ROLE only picks which bootstrap account to use, default
 * analyst), then visits the 12 stage paths per track and asserts the
 * head/strip/primary geometry invariants that the DOM-order contract test
 * (tests/unit/stage-screen-dom-contract.test.ts) locks structurally:
 *
 *   - the document's first h1 is the stage-head h1,
 *   - head → objective → handoff strip → rail vertical order,
 *   - the strip starts at the content's left edge (aligned with the h1),
 *   - project paths carry the StageTabs bar in the rail slot, deal paths do not,
 *   - the head primary action (다음: …) is right-aligned on the h1 row,
 *     vertically centred with it, and absent only on the terminal stage (S12)
 *     and on the stage the track skips (ADR-0094/0095: brownfield S5,
 *     greenfield S6/S7 — the TrackGate not-applicable notice hosts the action).
 *
 * Screenshots are written to tests/e2e-visual/screenshots/ (gitignored) with a
 * geometry snapshot JSON next to them. Screenshot pixel diffs are opt-in via
 * E2E_VISUAL_DIFF:
 *     unset    capture only (default local mode — no baselines needed)
 *     update   also (re)write the 8x8 aHash baselines under __screenshots__/
 *     check    assert each screenshot's aHash is within MAX_HAMMING of the
 *              committed baseline (CI mode; the workflow runs this job with
 *              continue-on-error so font/render drift cannot block merges)
 *
 * Run: bun run test:visual  (bun test tests/e2e-visual)
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startApp, type TestApp } from "../scenarios/_support/harness.ts";
import { launchBrowser, loginThroughUi, visit, type Session } from "../scenarios/_support/browser.ts";
import type { Browser } from "../scenarios/_support/playwright.ts";
import { getDb } from "../../db/client.ts";
import { seedS1ToS12Demo, seedGreenfieldS1ToS12Demo } from "../../scripts/co-newbiz/seed-s1-s12-demo.ts";
import { STAGE_META, type TrackId } from "../../app/web-next/lib/stage-meta.ts";
import { ahash, decodePngRgba, hamming } from "./_support/ahash.ts";

const OUT_DIR = join(import.meta.dirname, "screenshots");
const BASELINE_DIR = join(import.meta.dirname, "__screenshots__");
const DIFF_MODE = process.env.E2E_VISUAL_DIFF ?? ""; // "" | "update" | "check"
const ROLE = (process.env.E2E_VISUAL_ROLE ?? "analyst") as "analyst" | "admin";
/** Bits of difference tolerated by the aHash diff (of 64). Layout drift moves
 *  dozens; same-layout reruns (font raster, chart jitter) move a handful. */
const MAX_HAMMING = 12;

const DEAL_STAGES = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;
// S8 carries the explicit `?tab=financial` (design 2026-11-21-s8-overview-tab § Defect
// Remediation 2026-11-23): the bare /business-case URL now redirects to the project 개요
// page, which has no `main .stage-head h1` — the explicit tab keeps this walk on the S8
// business-case workspace (the exact screen the bare URL rendered before the ruling).
const PROJECT_SEGMENTS: Array<[stage: string, seg: string]> = [
  ["S8", "business-case?tab=financial"],
  ["S9", "dd"],
  ["S10", "deal-structure"],
  ["S11", "ic-review"],
  ["S12", "portfolio"],
];
/** S12 is the terminal stage — the head next-action is hidden there by design. */
const TERMINAL_STAGES = new Set(["S12"]);
/** ADR-0094/0095 applicableTracks — the track-skipped stage (brownfield skips S5,
 *  greenfield skips S6/S7) shows the TrackGate not-applicable notice instead of the
 *  working screen; the notice hosts the single primary action (go to the stage that
 *  applies), so the stage head shows none (the gf-06 pattern).
 *  v1.1.0: derived from the SSOT (STAGE_META.applicableTracks) rather than a static
 *  copy — an applicableTracks amendment flows into these assertions on the next run
 *  instead of the walk exercising a stale skip set. Each track must still skip at
 *  least one stage (asserted below): the two-track branching contract of
 *  ADR-0094/0095 says the S5..S7 spine is partitioned, and an empty skip set means
 *  that contract changed — which must fail here, not silently re-shape the walk. */
const TRACKS: TrackId[] = ["greenfield", "brownfield"];
const TRACK_SKIPPED_STAGES: Record<string, Set<string>> = Object.fromEntries(
  TRACKS.map((track) => [
    track,
    new Set(STAGE_META.filter((s) => !s.applicableTracks.includes(track)).map((s) => s.id)),
  ]),
);

let app: TestApp;
let browser: Browser;
let session: Session;

beforeAll(async () => {
  app = await startApp("visual-smoke", {
    seed: async ({ dbPath, adminId, analystId }) => {
      // Both-track demo fixture (the seeds run the migrations themselves), then
      // grant the login account project access so the /projects/** screens
      // render for it (the seeds grant the admin the lead role already).
      const bf = seedS1ToS12Demo(dbPath);
      const gf = await seedGreenfieldS1ToS12Demo(dbPath);
      const loginId = ROLE === "admin" ? adminId : analystId;
      const db = getDb(dbPath);
      const now = new Date().toISOString();
      for (const projectId of [bf.projectId, gf.projectId]) {
        db.run(
          "INSERT OR IGNORE INTO project_member (project_id, user_id, project_role, granted_by, granted_at, need_to_know_basis) VALUES (?, ?, 'member', 'e2e-visual', ?, 'visual smoke')",
          [projectId, loginId, now],
        );
      }
    },
  });
  browser = await launchBrowser();
  session = await loginThroughUi(browser, app, ROLE);
}, 900_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Geometry {
  firstH1IsFrameH1: boolean;
  head: Box | null;
  h1: Box | null;
  obj: Box | null;
  strip: Box | null;
  rail: Box | null;
  tabsBar: Box | null;
  cta: Box | null;
  stripSummary: string | null;
  notice: string | null;
}

/** All invariants are evaluated inside the page in one pass. */
const GEO_SNIPPET = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const main = document.querySelector("main");
  const head = main ? main.querySelector(".stage-head") : null;
  const h1 = main ? main.querySelector("h1") : null;
  const obj = main ? main.querySelector(".stage-head + p") : null;
  const strip = main ? main.querySelector("details.handoff-panel") : null;
  const rail = main ? main.querySelector('nav[aria-label="Stages"]') : null;
  const tabsBar = main ? main.querySelector(".stage-tabs-bar") : null;
  const cta = head ? head.querySelector("a.btn-primary") : null;
  // TrackGate not-applicable notice (deal paths only): the working screen is replaced
  // by a .card[role=note] hosting the go-to-the-stage-that-applies action.
  const notice = main ? main.querySelector('div.card[role="note"]') : null;
  return {
    firstH1IsFrameH1: !!h1 && !!head && head.contains(h1),
    head: box(head),
    h1: box(h1),
    obj: box(obj),
    strip: box(strip),
    rail: box(rail),
    tabsBar: box(tabsBar),
    cta: box(cta),
    stripSummary: strip ? (strip.querySelector("summary")?.textContent ?? "").trim() : null,
    notice: notice ? (notice.textContent ?? "").trim() : null,
  };
})()`;

function expectGeometry(track: string, stage: string, geo: Geometry, slot: "deal" | "project"): void {
  const label = `${track} ${stage}`;
  if (!geo.firstH1IsFrameH1) throw new Error(`${label}: the document's first h1 is not the stage-head h1`);
  const missing = (["head", "h1", "obj", "strip", "rail"] as const).filter((k) => geo[k] === null);
  if (missing.length > 0) throw new Error(`${label}: frame segments missing (${missing.join(", ")})`);
  const { h1, obj, strip, rail, head } = geo as { h1: Box; obj: Box; strip: Box; rail: Box; head: Box };
  // Sane heading size (two-tier type scale; catches font-token regressions).
  expect(h1.h).toBeGreaterThanOrEqual(16);
  expect(h1.h).toBeLessThanOrEqual(96);
  // Head order: h1 above the objective above the strip above the rail.
  expect(h1.y).toBeLessThan(obj.y);
  expect(obj.y).toBeLessThan(strip.y);
  expect(strip.y).toBeLessThan(rail.y);
  // The strip starts at the content's left edge, aligned with the h1.
  expect(Math.abs(strip.x - h1.x)).toBeLessThanOrEqual(8);
  expect(geo.stripSummary ?? "").toContain("입력과 출력");
  // Rail slot: project screens own a StageTabs bar (rail slot), deal screens do not.
  if (slot === "project") {
    if (!geo.tabsBar) throw new Error(`${label}: StageTabs bar missing from the rail slot`);
    expect(geo.tabsBar.y).toBeGreaterThan(strip.y);
    expect(geo.tabsBar.y).toBeGreaterThanOrEqual(rail.y);
  } else {
    expect(geo.tabsBar).toBeNull();
  }
  // Head primary action: right-aligned on the h1 row, centred with it;
  // absent exactly on the terminal stage and on the other track's stage —
  // there the TrackGate not-applicable notice hosts the single primary action.
  if (TERMINAL_STAGES.has(stage)) {
    expect(geo.cta).toBeNull();
  } else if (TRACK_SKIPPED_STAGES[track]?.has(stage)) {
    expect(geo.cta).toBeNull();
    if (!(geo.notice ?? "").includes("적용되지 않는 단계"))
      throw new Error(`${label}: TrackGate not-applicable notice missing`);
    expect(geo.notice ?? "").toContain("트랙의 다음 단계");
  } else {
    if (!geo.cta) throw new Error(`${label}: head primary action missing`);
    expect(Math.abs(geo.cta.y + geo.cta.h / 2 - (h1.y + h1.h / 2))).toBeLessThanOrEqual(24);
    expect(geo.cta.x).toBeGreaterThanOrEqual(h1.x);
    expect(head.x + head.w - (geo.cta.x + geo.cta.w)).toBeLessThanOrEqual(12);
  }
}

describe("stage-path visual/layout smoke (both tracks, 12 paths each)", () => {
  // Seeded fixture ids, read from the scratch DB after startApp seeded it.
  const trackIds = (): Array<{ track: string; opp: string; proj: string }> => {
    const rows = app.readDb(
      (d) =>
        d
          .query(
            `SELECT o.id AS opp, o.project_id AS proj,
                  (SELECT rd.track FROM route_decision rd WHERE rd.opportunity_id = o.id AND rd.is_current = 1) AS track
             FROM opportunity o WHERE o.project_id IS NOT NULL`,
          )
          .all() as Array<{ track: string; opp: string; proj: string }>,
    );
    const bf = rows.find((r) => r.track === "brownfield");
    const gf = rows.find((r) => r.track === "greenfield");
    if (!bf || !gf) throw new Error(`seed fixture incomplete: ${JSON.stringify(rows)}`);
    return [{ ...bf }, { ...gf }];
  };

  test("both tracks: 12 stage paths each keep the head/strip/primary geometry", async () => {
    mkdirSync(OUT_DIR, { recursive: true });
    if (DIFF_MODE !== "" && !existsSync(BASELINE_DIR)) mkdirSync(BASELINE_DIR, { recursive: true });
    const snapshots: Record<string, unknown> = {};
    // Diff-mode findings are collected across the whole walk so the geometry
    // gate always runs to completion before the diff summary fails.
    const diffIssues: string[] = [];

    // Spec-tie (v1.1.0): the walked stage ids must be exactly the 12 STAGE_META
    // ids — a stage-id or path-table change fails here instead of the walk
    // silently skipping (or double-covering) a stage.
    const walkedStageIds = [
      ...DEAL_STAGES.map((s) => s.toUpperCase()),
      ...PROJECT_SEGMENTS.map(([stage]) => stage),
    ].sort();
    expect(walkedStageIds).toEqual(STAGE_META.map((s) => s.id).sort());
    // Two-track branching contract (ADR-0094/0095): every track skips at least
    // one spine stage; an applicableTracks edit that empties a skip set must
    // fail loudly (see TRACK_SKIPPED_STAGES).
    for (const track of TRACKS) {
      expect(
        TRACK_SKIPPED_STAGES[track].size,
        `${track} skips no stage — applicableTracks contract changed`,
      ).toBeGreaterThan(0);
    }

    for (const { track, opp, proj } of trackIds()) {
      const paths: Array<{ stage: string; path: string; slot: "deal" | "project" }> = [
        ...DEAL_STAGES.map((s) => ({ stage: s.toUpperCase(), path: `/deals/${opp}/${s}`, slot: "deal" as const })),
        ...PROJECT_SEGMENTS.map(([stage, seg]) => ({
          stage,
          path: `/projects/${proj}/${seg}`,
          slot: "project" as const,
        })),
      ];
      expect(paths).toHaveLength(12);

      for (const { stage, path, slot } of paths) {
        const page = session.page;
        await visit(page, app, path);
        await page.waitForSelector("main .stage-head h1", { state: "visible", timeout: 30_000 });
        // Let charts/fonts settle so the screenshot is a fair baseline.
        await page.waitForTimeout(800);

        const geo = (await page.evaluate(GEO_SNIPPET)) as Geometry;
        expectGeometry(track, stage, geo, slot);

        const key = `${track}-${stage}`;
        const pngPath = join(OUT_DIR, `${key}.png`);
        const shot = await page.screenshot({ path: pngPath });
        const img = decodePngRgba(new Uint8Array(shot));
        const hash = ahash(img);
        snapshots[key] = { path, geometry: geo, width: img.width, height: img.height, ahash: hash.toString(16) };

        if (DIFF_MODE === "update") {
          writeFileSync(
            join(BASELINE_DIR, `${key}.json`),
            `${JSON.stringify({ path, width: img.width, height: img.height, ahash: hash.toString(16) }, null, 2)}\n`,
          );
        } else if (DIFF_MODE === "check") {
          const baselinePath = join(BASELINE_DIR, `${key}.json`);
          if (!existsSync(baselinePath)) {
            diffIssues.push(`${key}: no aHash baseline (commit one generated with E2E_VISUAL_DIFF=update)`);
          } else {
            const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
              width: number;
              height: number;
              ahash: string;
            };
            const distance = hamming(BigInt(`0x${baseline.ahash}`), hash);
            if (distance > MAX_HAMMING) {
              diffIssues.push(
                `${key}: screenshot aHash drift ${distance} > ${MAX_HAMMING} bits (baseline ${baseline.ahash}, got ${hash.toString(16)})`,
              );
            }
          }
        }
      }
    }
    writeFileSync(join(OUT_DIR, "geometry.json"), `${JSON.stringify(snapshots, null, 2)}\n`);
    if (DIFF_MODE === "check" && diffIssues.length > 0) {
      throw new Error(`screenshot diff findings (${diffIssues.length}):\n${diffIssues.join("\n")}`);
    }
  }, 900_000);
});
