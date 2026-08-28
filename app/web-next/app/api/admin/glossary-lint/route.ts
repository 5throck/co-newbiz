// GET /api/admin/glossary-lint — the undefined-term queue (ADR-0022's
// glossary-lint integration, admin console 용어집 관리 section). Runs the
// same report-only scanner as `bun scripts/co-newbiz/glossary-lint.ts`
// (skills/ + docs/ prose) on demand; report-only, never a gate — triage is
// the glossary-curator's judgement. Admin role.
import { authenticate, requireAdmin } from "../../../../lib/auth.ts";
import { ok } from "../../../../lib/envelope.ts";
import { lintGlossaryUsage } from "../../../../../../scripts/co-newbiz/glossary-lint.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const adminCheck = requireAdmin(auth.auth);
  if (adminCheck) return adminCheck;
  const result = lintGlossaryUsage();
  // The scanner is frequency-first; cap the rendered queue so the admin table
  // stays usable (2.6k+ findings across 300 files today) — the cap and total
  // are echoed in meta so nothing is silently hidden.
  const LIMIT = 200;
  const queue = result.undefined.slice(0, LIMIT);
  return ok(
    {
      scanned_files: result.scannedFiles,
      known_count: result.known.length,
      undefined: queue,
    },
    200,
    {
      scanned_files: result.scannedFiles,
      known_count: result.known.length,
      undefined_count: queue.length,
      undefined_total: result.undefined.length,
      truncated: result.undefined.length > queue.length,
    },
  );
}
