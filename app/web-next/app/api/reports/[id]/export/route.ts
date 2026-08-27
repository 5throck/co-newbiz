// Reports export — renders a report document to docx / hwpx / pdf via the
// shared report renderer (scripts/co-newbiz/report.ts -> python/report/*).
// The `document` table stores only the run linkage + section hash, so the
// exported markdown is a generated summary of the document's metadata; the
// full narrative body is produced by the analysis pipeline that writes the
// document row (documented as a follow-up, not fabricated here).
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { notFound, ok } from "../../../../../lib/envelope.ts";
import { renderReport, type ReportFormat } from "../../../../../../../scripts/co-newbiz/report.ts";

const CONTENT_TYPE: Record<ReportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  hwpx: "application/vnd.hancom.hwpx",
  pdf: "application/pdf",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "docx") as ReportFormat;
  if (!["docx", "hwpx", "pdf"].includes(format)) {
    return ok({ error: "unsupported format" }, 400);
  }

  const doc = getDb()
    .query(
      `SELECT d.id AS id, d.run_id AS run_id, r.project_id AS project_id, r.label AS run_label,
              d.version AS version, d.created_at AS created_at
       FROM document d JOIN run r ON d.run_id = r.id WHERE d.id = ?`,
    )
    .get(id) as
    | { id: string; run_id: string; project_id: string; run_label: string | null; version: number; created_at: string }
    | undefined;
  if (!doc) return notFound();

  const markdown = [
    `# 보고서 ${doc.id}`,
    "",
    `- 프로젝트: ${doc.project_id}`,
    `- 실행(run): ${doc.run_label ?? doc.run_id}`,
    `- 버전: ${doc.version}`,
    `- 생성일: ${doc.created_at}`,
    "",
    "> 본 문서는 document 레코드의 메타데이터 요약입니다. 전체 분석 본문은 해당 run을 생성한 분석 파이프라인에서 작성됩니다.",
    "",
  ].join("\n");

  const workDir = mkdtempSync(join(tmpdir(), "co-newbiz-report-"));
  const mdPath = join(workDir, `${doc.id}.md`);
  writeFileSync(mdPath, markdown, "utf-8");

  try {
    const results = await renderReport(mdPath, [format], { outDir: workDir });
    const outputPath = results[0].output;
    const bytes = readFileSync(outputPath);
    const fileName = `${doc.id}.${format}`;
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE[format],
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    return ok({ error: `render failed: ${(err as Error).message}` }, 500);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
