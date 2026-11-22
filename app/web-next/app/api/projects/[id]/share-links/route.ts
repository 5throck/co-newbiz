import { getDb } from "../../../../../../../db/client.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

// GET/POST/DELETE /api/projects/[id]/share-links — external safe-share
// management (ADR-0123 #4). Snapshots only (payload_json), never live data;
// expiry ≤ 30 days; revocation is immediate; every access is logged.
// MNPI gate (review F-11, FR-SEC-06/ADR-0040): creating a link on an
// mnpi_flag=1 project is refused with 403 mnpi_share_blocked — a share link
// is unauthenticated external delivery (GET /api/share/[token] needs no
// session), and MNPI never leaves the wall through it, whatever the member's
// insider status (tier-consistent option per security-model §6; the stricter
// of the two options the review offered — blanket refusal, not insider-gated).
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const rows = getDb()
    .query(
      `SELECT l.id, l.title, l.recipient, l.expires_at, l.revoked_at, l.created_by, l.created_at,
              (SELECT COUNT(*) FROM share_access a WHERE a.link_id = l.id) AS access_count
       FROM share_link l WHERE l.project_id = ? ORDER BY l.created_at DESC`,
    )
    .all(id);
  return ok({ links: rows }, 200, { count: rows.length });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer")
    return forbidden("role_required", "Creating share links requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const classification = getDb().query("SELECT mnpi_flag FROM project_classification WHERE project_id = ?").get(id) as {
    mnpi_flag: number;
  } | null;
  if (classification?.mnpi_flag === 1) {
    return forbidden(
      "mnpi_share_blocked",
      "MNPI-flagged projects cannot be shared via external links (FR-SEC-06 / ADR-0040).",
    );
  }
  const body = (await request.json().catch(() => null)) as {
    title?: string;
    payload?: unknown;
    recipient?: string;
    expires_in_days?: number;
  } | null;
  if (!body?.title?.trim() || !body?.recipient?.trim() || body.payload === undefined) {
    return badRequest("fields_required", "title·recipient·payload is required.");
  }
  const days = Math.min(Math.max(body.expires_in_days ?? 7, 1), 30);
  const now = new Date();
  const expires = new Date(now.getTime() + days * DAY_MS).toISOString();
  const rid = ulid();
  const token = ulid();
  getDb().run(
    `INSERT INTO share_link (id, project_id, title, payload_json, recipient, token, expires_at, watermark, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      rid,
      id,
      body.title.trim(),
      JSON.stringify(body.payload),
      body.recipient.trim(),
      token,
      expires,
      `${body.recipient.trim()} · ${now.toISOString().slice(0, 10)}`,
      auth.auth.userId,
      now.toISOString(),
    ],
  );
  appendAudit(getDb(), {
    actor: auth.auth.userId,
    action: "share_link.create",
    target: `${id}:${rid}`,
    now: now.toISOString(),
  });
  return ok({ id: rid, token, expires_at: expires }, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer")
    return forbidden("role_required", "Revoking share links requires the analyst role or higher.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const url = new URL(request.url);
  const linkId = url.searchParams.get("link_id");
  if (!linkId) return badRequest("link_required", "The link_id query parameter is required.");
  const row = getDb().query("SELECT id FROM share_link WHERE id = ? AND project_id = ?").get(linkId, id);
  if (!row) return notFound();
  getDb().run("UPDATE share_link SET revoked_at = ? WHERE id = ?", [new Date().toISOString(), linkId]);
  appendAudit(getDb(), {
    actor: auth.auth.userId,
    action: "share_link.revoke",
    target: `${id}:${linkId}`,
    now: new Date().toISOString(),
  });
  return ok({ revoked: true }, 200);
}
