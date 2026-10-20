// GET /api/portfolio/learnings — the kill-with-learning corpus (ADR-0150
// criterion 6) for the S1/S2 surfaces. ?track=greenfield|brownfield and
// ?industry= narrow it; ?limit= caps rows (≤200). Display-only: the base-rate
// judgement stays with risk-officer/people. Project identity is withheld for
// non-members (same rule as the backtest); the lesson text is org-level.
import { getDb } from "../../../../../../db/client.ts";
import { authenticate } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { killLearnings } from "../../../../lib/learnings.ts";
import { visibleProject } from "../../../../lib/project-visibility.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const corpus = killLearnings(getDb(), {
    track: url.searchParams.get("track"),
    industryId: url.searchParams.get("industry"),
    limit: Number(url.searchParams.get("limit") ?? 50) || 50,
    visible: (pid) => Boolean(visibleProject(auth.auth, pid, { includeClosed: true, includeDeleted: true })),
  });
  return ok(corpus, 200, { count: corpus.rows.length });
}
