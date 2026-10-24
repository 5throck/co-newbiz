// POST /api/projects/[id]/proxy-chain/calibrate — run the statistical
// proxy-hop calibration for the project's industry pairs (ADR-0116 Phase 5).
// Spawns scripts/co-newbiz/newbiz.ts calibrate (the ADR-0006 methodology
// owner) per pair — the same pattern as the reports route spawning
// python/report. Series ids are EXPLICIT in the request body: there is no
// industry→series registry yet, so a pair without series guidance gets a 409
// listing exactly what to fetch. Requires ≥8 aligned observations per series.
import { spawn } from "node:child_process";
import { getDb } from "../../../../../../../../db/client.ts";
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../../lib/project-visibility.ts";
import { getLiveBindings } from "../../../../../../../../db/repositories/project-industry.repository.ts";
import { listLinks } from "../../../../../../../../db/repositories/value-chain-link.repository.ts";

interface CalibrateItem {
  from_industry_id: string;
  to_industry_id: string;
  from_series_id: string;
  to_series_id: string;
  period_from: string; // YYYY-MM
  period_to: string; // YYYY-MM
  evidence_ref?: string;
}

function runOne(item: CalibrateItem): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolvePromise) => {
    const args = [
      "scripts/co-newbiz/newbiz.ts", "calibrate",
      "--from-industry", item.from_industry_id,
      "--to-industry", item.to_industry_id,
      "--from-series", item.from_series_id,
      "--to-series", item.to_series_id,
      "--from", item.period_from,
      "--to", item.period_to,
    ];
    if (item.evidence_ref) args.push("--evidence-ref", item.evidence_ref);
    const proc = spawn("bun", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    proc.on("close", (code) => resolvePromise({ ok: code === 0, output: (stderr || stdout).slice(-500) }));
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "Statistical calibration requires the analyst role or higher.");
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();

  const body = (await request.json().catch(() => null)) as { items?: CalibrateItem[] } | null;

  // Resolve candidate pairs: live industry bindings ∪ value-chain link
  // endpoints. When the caller supplies explicit items (with series ids),
  // those run as-is; otherwise report the pairs and fail with guidance —
  // a silent no-op would hide the data dependency.
  const db = getDb();
  const bindings = getLiveBindings(id, db).map((b) => b.industry_id);
  const linkPairs = listLinks(db, id).map((l) => ({ from: l.from_industry_id, to: l.to_industry_id }));
  const boundPairs: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < bindings.length; i++) {
    for (let j = 0; j < bindings.length; j++) {
      if (i !== j) boundPairs.push({ from: bindings[i], to: bindings[j] });
    }
  }
  const pairs = body?.items?.length
    ? body.items.map((i) => ({ from: i.from_industry_id, to: i.to_industry_id }))
    : [...new Map(boundPairs.concat(linkPairs).map((p) => [`${p.from}->${p.to}`, p])).values()];

  if (pairs.length === 0) {
    return badRequest("no_pairs", "No industry pairs to calibrate — register industry bindings or value-chain links first.");
  }
  if (!body?.items?.length) {
    return badRequest(
      "series_required",
      `No observation series (series ids) given for ${pairs.length} industry pairs. Specify from_series_id/to_series_id and periods in the body items, or load data first via the series collection pipeline (fetch --source ...). Targets: ${pairs.map((p) => `${p.from}->${p.to}`).join(", ")}`,
    );
  }

  const results: Array<{ pair: string; ok: boolean; output: string }> = [];
  for (const item of body.items) {
    if (!item.from_industry_id || !item.to_industry_id || !item.from_series_id || !item.to_series_id || !item.period_from || !item.period_to) {
      return badRequest("invalid_item", "Each item in items must include from_industry_id, to_industry_id, from_series_id, to_series_id, period_from, and period_to.");
    }
    const r = await runOne(item);
    results.push({ pair: `${item.from_industry_id}→${item.to_industry_id}`, ok: r.ok, output: r.output });
  }
  const failed = results.filter((r) => !r.ok);
  return ok({ results }, 200, { total: results.length, failed: failed.length });
}
