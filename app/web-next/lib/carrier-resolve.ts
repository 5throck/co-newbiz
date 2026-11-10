// Carrier resolution — flat S1~S7 route → deal-carrier redirect (route-cleanup
// follow-up design §4.2; serverized by D5/B-2, design
// 2026-11-11-admin-security-and-board-fixes §7).
//
// This module is the shared single source for both sides of the split:
//   - Server pages (app/{market,opportunities,synergy,greenfield,brownfield})
//     call planCarrierPage() + resolveCarriers() to own the AUTO-REDIRECT rules
//     (Rule 1 query carrier, Rule 3 single-carrier auto) before any HTML is
//     served — the client-fetch flash the review flagged is gone at the source.
//   - The client picker (components/CarrierGate.tsx) imports the constants and
//     the CarrierRow type from here. Deliberately NO "server-only" marker and
//     no runtime db import: the Database type below is a type-only import (erased
//     at build), so pulling the constants into a client bundle is safe.
import type { Database } from "bun:sqlite";
import type { ValidSession } from "../../../db/lib/accounts.ts";
import type { StageMetaId } from "./stage-meta.ts";

export type FlatRouteKey = "market" | "opportunities" | "synergy" | "greenfield" | "brownfield";

/** Flat route → deal-carrier stage tab (design §4.2 table). */
export const FLAT_ROUTE_STAGE: Record<FlatRouteKey, string> = {
  market: "s1",
  opportunities: "s2",
  synergy: "s3",
  greenfield: "s5",
  brownfield: "s6",
};

export const STAGE_IDS_BY_ROUTE: Record<FlatRouteKey, StageMetaId | StageMetaId[]> = {
  market: "S1",
  opportunities: "S2",
  synergy: "S3",
  greenfield: "S5",
  brownfield: ["S6", "S7"],
};

/** Track filter per flat route — undefined means any track (S1~S3). */
export const TRACK_BY_ROUTE: Partial<Record<FlatRouteKey, "greenfield" | "brownfield">> = {
  greenfield: "greenfield",
  brownfield: "brownfield",
};

/** One carrier row of the picker / auto-resolution — id+name+score only (design §7).
    `deleted_at` is optional: the server query never selects it, while the
    client's includePromoted=1 fallback fetch does (and filters on it). */
export interface CarrierRow {
  id: string;
  name: string;
  attractiveness_score?: number | null;
  synergy_score?: number | null;
  deleted_at?: string | null;
}

/** Next.js App Router async searchParams shape (page props). */
export type PageQuery = Record<string, string | string[] | undefined>;

function firstParam(v: string | string[] | undefined): string | null {
  if (v === undefined) return null;
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length > 0 ? s : null;
}

function buildExtraQuery(query: PageQuery, moved: boolean, route: FlatRouteKey): URLSearchParams {
  const extra = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    // The client redirectTarget deleted only opportunity/deal — parity: every
    // other query param rides along to /deals/{id}/{stage}.
    if (k === "opportunity" || k === "deal" || v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) extra.append(k, item);
  }
  // R2-A item 8: an automatic redirect is announced on the destination
  // (AppShell ?moved= notice). Rule 1 redirects carry no moved flag.
  if (moved) extra.set("moved", route);
  return extra;
}

/** Deal-carrier href for a flat route — other query params preserved, opportunity/deal dropped. */
export function carrierRedirectHref(
  route: FlatRouteKey,
  carrierId: string,
  query: PageQuery,
  opts: { moved?: boolean } = {},
): string {
  const qs = buildExtraQuery(query, opts.moved === true, route).toString();
  return `/deals/${encodeURIComponent(carrierId)}/${FLAT_ROUTE_STAGE[route]}${qs ? `?${qs}` : ""}`;
}

export type CarrierServerPlan =
  | {
      /** Server redirect fires before any render (Rule 1 or Rule 3). */
      kind: "redirect";
      href: string;
    }
  | {
      /** Picker/embedded render — client component. rows=null means "the server
      could not resolve (exemption hit or no valid session): fetch client-side
      as today" — behavior parity with the pre-D5 component. */
      kind: "picker";
      rows: CarrierRow[] | null;
    };

/**
 * Decide the server outcome of a flat carrier page, mirroring the client rules
 * in their exact order (design §7):
 *   1. Query carrier (?opportunity= / ?deal= alias) → redirect straight
 *      through, every other param preserved, no moved flag.
 *   2. Auto-resolution — otherwise, when the session is valid AND the query is
 *      not exempt (new=1 on market/opportunities, known_target=1 on
 *      opportunities): exactly one carrier → redirect with moved=<route>.
 *   3. Zero/many carriers, any exemption, or no valid session → the client
 *      picker (rows passed through when the server resolved them, null when it
 *      did not — a session-less visit renders the picker, never a server error).
 * `resolve` is lazy: one DB read per page view, only when rule 2 applies.
 */
export function planCarrierPage(opts: {
  route: FlatRouteKey;
  query: PageQuery;
  session: ValidSession | null;
  resolve: () => CarrierRow[];
}): CarrierServerPlan {
  const carrierId = firstParam(opts.query.opportunity) ?? firstParam(opts.query.deal);
  if (carrierId) return { kind: "redirect", href: carrierRedirectHref(opts.route, carrierId, opts.query) };

  // Wave C-3 (D-5): "start from a known target" lands on the S2 funnel itself —
  // the carrier is created there, so it must not be redirected into a deal.
  // R2-A item 1: "new review" links land on the working form directly.
  const startsKnownTarget = opts.route === "opportunities" && firstParam(opts.query.known_target) === "1";
  const startsNew = firstParam(opts.query.new) === "1" && (opts.route === "market" || opts.route === "opportunities");

  if (opts.session && !startsKnownTarget && !startsNew) {
    const rows = opts.resolve();
    if (rows.length === 1) {
      return { kind: "redirect", href: carrierRedirectHref(opts.route, rows[0].id, opts.query, { moved: true }) };
    }
    return { kind: "picker", rows };
  }
  return { kind: "picker", rows: null };
}

/**
 * Server-side carrier query — the exact production SQL of the client APIs it
 * replaces (design §7): any-track routes reuse the opportunities GET query
 * (api/opportunities/route.ts, status='selected', includePromoted=1 — promoted
 * rows with a project_id survive even after archival; genuinely deleted
 * opportunities never resurface); greenfield/brownfield reuse the track
 * routes' route_decision-filtered queries. One DB read per page view replaces
 * the client round-trip plus its fetch waterfall.
 */
export function resolveCarriers(route: FlatRouteKey, db: Database): CarrierRow[] {
  const track = TRACK_BY_ROUTE[route];
  if (track) {
    return db
      .query(
        `SELECT o.id, o.name, o.attractiveness_score, o.synergy_score
         FROM opportunity o
         WHERE o.deleted_at IS NULL
           AND EXISTS (
             SELECT 1 FROM route_decision rd WHERE rd.opportunity_id = o.id AND rd.track = ? AND rd.is_current = 1
           )
         ORDER BY o.created_at DESC`,
      )
      .all(track) as CarrierRow[];
  }
  return db
    .query(
      `SELECT id, name, attractiveness_score, synergy_score
       FROM opportunity
       WHERE status = 'selected'
         AND (deleted_at IS NULL OR project_id IS NOT NULL)
       ORDER BY created_at DESC`,
    )
    .all() as CarrierRow[];
}
