// GET/POST /api/projects/[id]/reports — Wave B2 report history + renderer wrapper.
// POST persists a report_snapshot and, when formats are requested, invokes the
// existing python/report renderers without statically importing the CLI facade
// (that facade performs filesystem discovery which triggers Turbopack NFT
// trace warnings in production builds).
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { getDb } from "../../../../../../../db/client.ts";
import { ulid } from "../../../../../../../db/lib/ulid.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";

type ReportFormat = "docx" | "pdf" | "hwpx";
const FORMATS = new Set(["docx", "pdf", "hwpx"]);

async function renderSnapshotReport(markdownPath: string, formats: ReportFormat[], outDir: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["../../scripts/co-newbiz/report.ts", markdownPath, "--format", formats.join(","), "--out-dir", outDir], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`report renderer exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      // report.ts prints the summary as a (possibly pretty-printed) JSON
      // array as the LAST thing on stdout — parse from the final top-level
      // "[" to the end. Parsing inside try/catch: a throw in this event
      // handler would be an uncaughtException and leave the request hanging.
      try {
        const start = stdout.lastIndexOf("\n[");
        const jsonText = start === -1 ? stdout.trim() : stdout.slice(start + 1);
        resolve(JSON.parse(jsonText));
      } catch (e) {
        reject(new Error(`report renderer summary parse failed: ${(e as Error).message} — stdout tail: ${stdout.slice(-200)}`));
      }
    });
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const project = visibleProject(auth.auth, id, { includeClosed: true, includeDeleted: true });
  if (!project) return notFound();
  const db = getDb();
  const rows = db.query(
    `SELECT id, project_id, title, content_md, created_by, created_at
     FROM report_snapshot WHERE project_id = ? ORDER BY created_at DESC, id DESC`
  ).all(id) as Array<{ id: string }>;
  // ADR-0116 Phase 6: rendered files are surfaced next to their snapshot so
  // the UI can offer downloads without touching the filesystem itself.
  const renders = db.query(
    `SELECT r.snapshot_id, r.format, r.created_at FROM report_render r
     JOIN report_snapshot s ON s.id = r.snapshot_id
     WHERE s.project_id = ? ORDER BY r.created_at DESC`
  ).all(id) as Array<{ snapshot_id: string; format: string; created_at: string }>;
  return ok(
    { project: { id: project.id, project_no: project.project_no }, reports: rows, renders },
    200,
    { count: (rows as unknown[]).length, render_count: renders.length },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "보고서 스냅샷 생성은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  const project = visibleProject(auth.auth, id);
  if (!project) return notFound();
  const body = (await request.json().catch(() => null)) as { title?: string; content_md?: string; formats?: string[] } | null;
  const title = body?.title?.trim() || `${project.project_no} report`;
  const contentMd = body?.content_md?.trim() || `# ${title}\n\nProject: ${project.project_no}\n\nGenerated from co-newbiz report snapshot.`;
  const formats = (body?.formats ?? []).filter((f): f is ReportFormat => FORMATS.has(f));
  if ((body?.formats ?? []).length !== formats.length) return badRequest("invalid_format", "formats는 docx/pdf/hwpx만 허용합니다.");

  const db = getDb();
  const now = new Date().toISOString();
  const snapshotId = ulid();
  db.run(
    "INSERT INTO report_snapshot (id, project_id, title, content_md, created_by, created_at) VALUES (?,?,?,?,?,?)",
    [snapshotId, id, title, contentMd, auth.auth.userId, now],
  );
  appendAudit(db, { actor: auth.auth.userId, action: "report_snapshot_create", target: `${project.project_no}:${snapshotId}`, now });

  let renders: Array<{ format: string; output: string }> = [];
  if (formats.length > 0) {
    const outDir = join("render_out", id, snapshotId);
    mkdirSync(outDir, { recursive: true });
    const mdPath = join(outDir, "snapshot.md");
    writeFileSync(mdPath, contentMd, "utf8");
    try {
      const raw = (await renderSnapshotReport(mdPath, formats, outDir)) as Array<{ format: string; output: string }>;
      renders = raw;
      // Persist WHERE each rendered file lives — the download route serves
      // from these rows (path-containment-guarded), never from raw requests.
      for (const r of raw) {
        db.run(
          "INSERT INTO report_render (id, snapshot_id, format, file_path, created_at) VALUES (?,?,?,?,?)",
          [ulid(), snapshotId, r.format, r.output, now],
        );
      }
    } catch (err) {
      return badRequest("report_render_failed", err instanceof Error ? err.message : "보고서 렌더링 실패");
    }
  }
  return ok({ snapshot: { id: snapshotId, project_id: id, title, content_md: contentMd, created_by: auth.auth.userId, created_at: now }, renders }, 201, { render_count: renders.length });
}
