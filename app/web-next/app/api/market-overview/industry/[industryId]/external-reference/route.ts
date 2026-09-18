// 외부 성장률 참조 — 사람이 출처와 함께 기록·갱신한다(ADR: 보정 루프 설계문서
// 2026-09-18-s1-growth-gap-calibration). 기록된 참조는 재분석 때 LLM 선험보다
// 우선하며, 이것이 "재분석 = 단순 반복"을 끊는 첫 고리다.
import { authenticate } from "../../../../../../lib/auth.ts";
import { badRequest, forbidden, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import { appendExternalReference, resolveExternalReference } from "../../../../../../lib/market-calibration.ts";

export async function GET(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { industryId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();
  return ok({ reference: resolveExternalReference(db, industryId) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "외부 참조 기록은 analyst 역할 이상이어야 합니다.");
  const { industryId } = await params;
  const body = (await request.json().catch(() => null)) as {
    source_label?: string; source_url?: string | null; target_year?: number;
    external_cagr_pct?: number; external_size_b?: number | null;
  } | null;
  if (!body?.source_label?.trim()) return badRequest("source_required", "출처(source_label)는 필수입니다 — 출처 없는 참조는 기록하지 않습니다.");
  if (typeof body.external_cagr_pct !== "number" || body.external_cagr_pct <= 0) {
    return badRequest("cagr_required", "외부 CAGR(%)는 양수여야 합니다.");
  }
  if (typeof body.target_year !== "number" || body.target_year <= 2026) {
    return badRequest("year_required", "목표 연도는 2026 이후여야 합니다.");
  }
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();
  const reference = appendExternalReference(db, {
    industry_id: industryId,
    source_label: body.source_label.trim(),
    source_url: body.source_url?.trim() || null,
    target_year: Math.round(body.target_year),
    external_cagr_pct: body.external_cagr_pct,
    external_size_b: typeof body.external_size_b === "number" && body.external_size_b > 0 ? body.external_size_b : null,
    captured_from: "user",
    created_by: auth.auth.userId,
  });
  return ok({ reference }, 201);
}
