// design 2026-11-21-s67-completion-visibility — Handoff implementation note:
// "Client qualification helper for the detail screen mirrors longListCandidateGaps;
// pin parity with a unit test feeding identical fixtures to both and asserting
// equal gap sets (the server `gaps` field stays authoritative for the s67 screen)."
//
// The engine helper (lib/brownfield-targets.ts) reads its discovery evidence from
// the DB, the client helper (lib/target-qualification.ts) reads the detail
// payload's `evidence` array — the same rows feed both here via an in-memory
// SQLite holding only the table the helper queries.
import { test, expect, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { longListCandidateGaps, type TargetRow } from "../../app/web-next/lib/brownfield-targets.ts";
import { clientCandidateGaps } from "../../app/web-next/lib/target-qualification.ts";

function scratchDb(rows: Array<{ target_id: string; kind: string; source_url: string | null; detail: string | null }>) {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE brownfield_target_evidence (id TEXT PRIMARY KEY, target_id TEXT, kind TEXT, title TEXT, detail TEXT, source_url TEXT, source_kind TEXT, created_by TEXT, created_at TEXT)",
  );
  const ins = db.query(
    "INSERT INTO brownfield_target_evidence (id, target_id, kind, title, detail, source_url, source_kind, created_by, created_at) VALUES (?, ?, ?, '', ?, ?, NULL, NULL, '')",
  );
  for (const [i, r] of rows.entries()) ins.run(`e-${i}`, r.target_id, r.kind, r.detail, r.source_url);
  return db;
}

interface Fixture {
  id: string;
  company_name: string;
  dart_corp_code: string | null;
  universe_note: string | null;
  company_id: string | null;
  discovery_source?: string;
  proposal_accepted_at?: string | null;
  evidence?: Array<{ kind: string; source_url: string | null; detail: string | null }>;
}

const CASES: Fixture[] = [
  // fully qualified
  {
    id: "t1",
    company_name: "qualified",
    dart_corp_code: "0012345",
    universe_note: "fits",
    company_id: "c1",
    discovery_source: "manual",
    proposal_accepted_at: null,
    evidence: [{ kind: "discovery", source_url: "https://example.com/a", detail: null }],
  },
  // the diagnosis state: no universe note, no discovery evidence → both gaps
  {
    id: "t2",
    company_name: "태웅",
    dart_corp_code: null,
    universe_note: null,
    company_id: null,
    discovery_source: "manual",
    proposal_accepted_at: null,
    evidence: [],
  },
  // attributes met via company_id alone; source met only by an accepted proposal
  {
    id: "t3",
    company_name: "proposal",
    dart_corp_code: null,
    universe_note: "note",
    company_id: "c3",
    discovery_source: "master_proposal",
    proposal_accepted_at: "2026-11-20T00:00:00Z",
    evidence: [],
  },
  // accepted-proposal-looking row WITHOUT acceptance is still a source gap
  {
    id: "t4",
    company_name: "unaccepted",
    dart_corp_code: "0099",
    universe_note: "note",
    company_id: null,
    discovery_source: "web_proposal",
    proposal_accepted_at: null,
    evidence: [],
  },
  // source met by a note-only discovery row (URL empty) — trimmed whitespace counts
  {
    id: "t5",
    company_name: "note-only",
    dart_corp_code: "0077",
    universe_note: "note",
    company_id: null,
    discovery_source: "manual",
    proposal_accepted_at: null,
    evidence: [{ kind: "discovery", source_url: null, detail: "  업계 기사에서 확인  " }],
  },
  // empty-string evidence rows do NOT qualify (the engine's TRIM != '' rule)
  {
    id: "t6",
    company_name: "blank-evidence",
    dart_corp_code: "0066",
    universe_note: "note",
    company_id: null,
    discovery_source: "manual",
    proposal_accepted_at: null,
    evidence: [
      { kind: "discovery", source_url: "   ", detail: "" },
      { kind: "precheck", source_url: "https://example.com/b", detail: "not discovery" },
    ],
  },
  // blank universe note (whitespace only) → attributes gap
  {
    id: "t7",
    company_name: "blank-note",
    dart_corp_code: "0055",
    universe_note: "   ",
    company_id: null,
    discovery_source: "manual",
    proposal_accepted_at: null,
    evidence: [{ kind: "discovery", source_url: "https://example.com/c", detail: null }],
  },
];

function engineRow(f: Fixture): TargetRow & { company_id: string | null } {
  return {
    id: f.id,
    opportunity_id: "opp",
    company_name: f.company_name,
    dart_corp_code: f.dart_corp_code,
    universe_note: f.universe_note,
    status: "pending",
    rank: null,
    exclusion_reason: null,
    screening_json: null,
    screening_evidence_json: null,
    created_at: "2026-11-21T00:00:00.000Z",
    updated_at: "2026-11-21T00:00:00.000Z",
    company_id: f.company_id,
    discovery_source: (f.discovery_source ?? "manual") as TargetRow["discovery_source"],
    proposal_accepted_at: f.proposal_accepted_at ?? null,
  };
}

describe("clientCandidateGaps mirrors longListCandidateGaps (design 2026-11-21 parity pin)", () => {
  test("identical fixtures → identical gap sets", () => {
    for (const f of CASES) {
      const db = scratchDb((f.evidence ?? []).map((e) => ({ target_id: f.id, ...e })));
      const engine = longListCandidateGaps(engineRow(f), db);
      const client = clientCandidateGaps(
        f,
        (f.evidence ?? []).map((e, i) => ({ id: `e-${i}`, ...e })),
      );
      expect([...client].sort()).toEqual([...engine].sort());
      db.close();
    }
  });
  test("the seeded 태웅 state reads ['attributes','source'] on both sides", () => {
    const f = CASES[1];
    const db = scratchDb([]);
    expect(longListCandidateGaps(engineRow(f), db)).toEqual(["attributes", "source"]);
    expect(clientCandidateGaps(f, [])).toEqual(["attributes", "source"]);
    db.close();
  });
  test("missing discovery_source reads as manual (older payloads stay conservative)", () => {
    const f = { ...CASES[4], discovery_source: undefined };
    const evidence = (f.evidence ?? []).map((e, i) => ({ id: `e-${i}`, ...e }));
    const db = scratchDb(
      evidence.map((e) => ({ target_id: f.id, kind: e.kind, source_url: e.source_url, detail: e.detail })),
    );
    expect(longListCandidateGaps(engineRow(f), db)).toEqual([]);
    expect(clientCandidateGaps(f, evidence)).toEqual([]);
    db.close();
  });
});
