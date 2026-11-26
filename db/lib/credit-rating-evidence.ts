// @version 1.1.0
/**
 * Resolution of the DISCLOSED credit rating of one company from its cached DART snapshots (ADR-0208 D2, design
 * 2026-11-26-wacc-credit-rating-spread section 5.1 step 6). Read-only: it never fetches. The collection that fills
 * the snapshots is app/web-next/lib/credit-rating-collector.ts.
 *
 * Rules (registry `disclosed`): corporate bonds of the domestic agencies only; per agency the latest rating, across
 * agencies the LOWEST; older than `stale_months` carries a stale flag (the rating stays visible and applicable).
 * Two evidence sources feed it: the newest business report (rating section + issuance table) and the OpenDART
 * debt-securities registrations (`bdrs`, rating "at issuance"). Fresh evidence beats stale evidence; among the
 * candidates the lower rating wins, and when both sources exist and differ both are returned (`alternative`).
 * A parse that found nothing is reported by its recorded status, never as "unrated".
 *
 * Ladder (ADR-0208 amendment 2026-11-26): corporate-bond rating (above) -> credit-bureau ISSUER rating (the yearly
 * 기업신용평가 table of the newest business report) -> synthetic (slice 3) -> default. The bureau rung is a LOWER
 * confidence basis (`basis: "bureau"`): it is used when there is no FRESH corporate-bond rating and the bureau rating
 * itself is fresh; a stale bond rating is preferred over a stale bureau rating, a fresh bureau rating over a stale
 * bond rating. The latest bureau rating wins (rated_on); several bureaus on that date: the lowest.
 */
import type { Database } from "bun:sqlite";
import {
  listCreditRatingSnapshots,
  type CreditRatingSnapshotRow,
  type CreditSnapshotSourceKind,
} from "../repositories/dart-credit-rating.repository.ts";
import {
  CREDIT_RATING_PARSER_VERSION,
  selectRating,
  type AgencyRating,
  selectBureauRating,
  type CreditRatingRow,
  type SelectedBureauRating,
  type SelectedRating,
} from "./credit-rating-disclosure.ts";
import type { CreditRatingRegistry } from "./credit-spread-map.ts";

/** Why no disclosed rating is available (the rung falls through; never "unrated"). */
export type DisclosedMissStatus =
  | "no_dart_corp_code"
  | "rating_not_collected"
  | "not_disclosed"
  | "section_present_no_bond_rating"
  | "section_absent"
  | "parse_failed"
  | "not_zip"
  | "no_bond_rating";

export interface DisclosedRatingChoice {
  rating: string;
  rated_on: string;
  stale: boolean;
  agencies: AgencyRating[];
  source_kind: CreditSnapshotSourceKind;
  snapshot_id: string;
  source_rcept_no: string;
}

/** What the bureau rung adds to a choice: who rated, the cash-flow grade, and every row of the rating date. */
export interface BureauEvidence {
  /** Registry bureau id of the picked row (null: unnamed or unregistered bureau). */
  agency: string | null;
  agency_raw: string | null;
  /** True when the agency was inherited from an earlier table row rather than stated in the row. */
  agency_carried: boolean;
  /** Cash-flow grade as filed (CR-3, C+, B); a separate scale, never the rating. */
  cashflow_grade: string | null;
  /** Every selectable bureau row of the rating date. */
  rows: Array<{ agency: string | null; agency_raw: string | null; grade: string; cashflow_grade: string | null }>;
}

export type DisclosedRatingResult =
  | (DisclosedRatingChoice & {
      ok: true;
      basis: "disclosed";
      instrument: "corporate_bond";
      alternative: DisclosedRatingChoice | null;
      bureau: null;
    })
  | (DisclosedRatingChoice & {
      ok: true;
      basis: "bureau";
      instrument: "issuer_bureau";
      alternative: null;
      bureau: BureauEvidence;
    })
  | { ok: false; status: DisclosedMissStatus };

interface Tagged {
  row: CreditRatingRow;
  snapshot: CreditRatingSnapshotRow;
}

function rowsOf(snapshot: CreditRatingSnapshotRow): CreditRatingRow[] {
  try {
    const v = JSON.parse(snapshot.ratings_json) as unknown;
    return Array.isArray(v) ? (v as CreditRatingRow[]) : [];
  } catch {
    return [];
  }
}

function choose(tagged: Tagged[], registry: CreditRatingRegistry, now: Date): DisclosedRatingChoice | null {
  const sel: SelectedRating | null = selectRating(
    tagged.map((t) => t.row),
    registry,
    now,
  );
  if (!sel) return null;
  const ref = tagged.find((t) => t.row === sel.picked) as Tagged;
  return {
    rating: sel.rating,
    rated_on: sel.rated_on,
    stale: sel.stale,
    agencies: sel.agencies,
    source_kind: ref.snapshot.source_kind,
    snapshot_id: ref.snapshot.id,
    source_rcept_no: ref.snapshot.source_rcept_no,
  };
}

function chooseBureau(
  snapshot: CreditRatingSnapshotRow,
  registry: CreditRatingRegistry,
  now: Date,
): { choice: DisclosedRatingChoice; evidence: BureauEvidence } | null {
  const sel: SelectedBureauRating | null = selectBureauRating(rowsOf(snapshot), registry, now);
  if (!sel) return null;
  const rows = sel.latest.map((r) => ({
    agency: r.agency,
    agency_raw: r.agency_raw,
    grade: r.grade as string,
    cashflow_grade: r.cashflow_grade_raw ?? null,
  }));
  return {
    choice: {
      rating: sel.rating,
      rated_on: sel.rated_on,
      stale: sel.stale,
      agencies: sel.latest
        .filter((r) => r.agency !== null)
        .map((r) => ({
          agency: r.agency as string,
          grade: r.grade as string,
          rated_on: r.rated_on as string,
          outlook: r.outlook,
          source: r.source,
        })),
      source_kind: snapshot.source_kind,
      snapshot_id: snapshot.id,
      source_rcept_no: snapshot.source_rcept_no,
    },
    evidence: {
      agency: sel.agency,
      agency_raw: sel.agency_raw,
      agency_carried: sel.agency_carried,
      cashflow_grade: sel.cashflow_grade_raw,
      rows,
    },
  };
}

/** Disclosed rating of `corpCode` from the cached snapshots (current parser version). `now` drives the stale flag. */
export function resolveDisclosedRating(
  db: Database,
  corpCode: string | null,
  registry: CreditRatingRegistry,
  now: Date,
): DisclosedRatingResult {
  if (!corpCode) return { ok: false, status: "no_dart_corp_code" };
  const snapshots = listCreditRatingSnapshots(db, corpCode, CREDIT_RATING_PARSER_VERSION);
  if (snapshots.length === 0) return { ok: false, status: "rating_not_collected" };

  // Newest business report only (older reports repeat or predate its rows); every debt-securities filing.
  const reportSnap = snapshots.find((s) => s.source_kind === "business_report") ?? null;
  const reportTagged: Tagged[] =
    reportSnap && reportSnap.status === "parsed"
      ? rowsOf(reportSnap).map((row) => ({ row, snapshot: reportSnap }))
      : [];
  const bdrsTagged: Tagged[] = snapshots
    .filter((s) => s.source_kind === "debt_securities_filing" && s.status === "parsed")
    .flatMap((s) => rowsOf(s).map((row) => ({ row, snapshot: s })));

  const r1 = choose(reportTagged, registry, now);
  const r2 = choose(bdrsTagged, registry, now);
  const candidates = [r1, r2].filter((c): c is DisclosedRatingChoice => c !== null);
  const bureau = reportSnap && reportSnap.status === "parsed" ? chooseBureau(reportSnap, registry, now) : null;
  const bureauResult = (): DisclosedRatingResult | null =>
    bureau
      ? {
          ok: true,
          ...bureau.choice,
          basis: "bureau",
          instrument: "issuer_bureau",
          alternative: null,
          bureau: bureau.evidence,
        }
      : null;
  const hasFreshBond = candidates.some((c) => !c.stale);
  if (!hasFreshBond && bureau && !bureau.choice.stale) return bureauResult() as DisclosedRatingResult;
  if (candidates.length === 0) {
    const viaBureau = bureauResult();
    if (viaBureau) return viaBureau; // stale bureau rating, no bond rating at all
    if (reportSnap) {
      // `parsed` with no selectable row cannot happen (the writer's status is derived from the rows); fall to unknown.
      const st = reportSnap.status === "parsed" ? "no_bond_rating" : reportSnap.status;
      return { ok: false, status: st };
    }
    return { ok: false, status: "no_bond_rating" };
  }
  const fresh = candidates.filter((c) => !c.stale);
  const pool = fresh.length > 0 ? fresh : candidates;
  const rank = (c: DisclosedRatingChoice) => registry.scale.indexOf(c.rating);
  const best = [...pool].sort(
    (a, b) => rank(b) - rank(a) || (a.rated_on < b.rated_on ? 1 : -1),
  )[0] as DisclosedRatingChoice;
  const other = candidates.find((c) => c !== best) ?? null;
  return {
    ok: true,
    ...best,
    basis: "disclosed",
    instrument: "corporate_bond",
    alternative: other && other.rating !== best.rating ? other : null,
    bureau: null,
  };
}
