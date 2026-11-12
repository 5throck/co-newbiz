// 외부 성장률 참조 — 사람이 출처와 함께 기록·갱신한다(ADR: 보정 루프 설계문서
// 2026-09-18-s1-growth-gap-calibration). 기록된 참조는 재분석 때 LLM 선험보다
// 우선하며, 이것이 "재분석 = 단순 반복"을 끊는 첫 고리다.
import { authenticate, requireBusinessActor } from "../../../../../../lib/auth.ts";
import { badRequest, notFound, ok } from "../../../../../../lib/envelope.ts";
import { getDb } from "../../../../../../../../db/client.ts";
import {
  appendExternalReference,
  resolveExternalReference,
  supersedeExternalReference,
} from "../../../../../../lib/market-calibration.ts";

export async function GET(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "read");
  if (denied) return denied;
  const { industryId } = await params;
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();
  return ok({ reference: resolveExternalReference(db, industryId) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Recording external references requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { industryId } = await params;
  const body = (await request.json().catch(() => null)) as {
    source_label?: string;
    source_url?: string | null;
    target_year?: number;
    external_cagr_pct?: number;
    external_size_b?: number | null;
  } | null;
  if (!body?.source_label?.trim())
    return badRequest("source_required", "source_label is required — references without a source are not recorded.");
  if (typeof body.external_cagr_pct !== "number" || body.external_cagr_pct <= 0) {
    return badRequest("cagr_required", "External CAGR (%) must be positive.");
  }
  if (typeof body.target_year !== "number" || body.target_year <= 2026) {
    return badRequest("year_required", "The target year must be after 2026.");
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

// DELETE = 폐기(supersede), 물리 삭제가 아니다 (amendment 2026-11-12c) — 행은
// 지워지지 않고 superseded_at만 남는다(추가 전용 보존). 완료된 분석은 당시
// 참조를 유지하고, 다음 재분석부터 폴백 사다리(웹 검색 > LLM 선험)가 다시
// 동작한다. 감사는 supersedeExternalReference 안에서 첫 폐기에만 기록된다
// (재호출은 멱등 no-op — 200에 본 행을 다시 실어 돌려준다).
export async function DELETE(request: Request, { params }: { params: Promise<{ industryId: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const denied = requireBusinessActor(auth.auth, "write", {
    viewerMessage: "Superseding external references requires the analyst role or higher.",
  });
  if (denied) return denied;
  const { industryId } = await params;
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id?.trim()) return badRequest("id_required", "The id of the reference to supersede is required.");
  const db = getDb();
  if (!db.query("SELECT id FROM md_industry WHERE id = ?").get(industryId)) return notFound();
  const reference = supersedeExternalReference(db, industryId, body.id.trim(), auth.auth.userId);
  if (!reference) return notFound("No such external reference for this industry.");
  return ok({ reference });
}
