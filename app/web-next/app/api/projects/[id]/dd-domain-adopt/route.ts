// GET/POST/DELETE /api/projects/[id]/dd-domain-adopt — the PERSON-ONLY adoption
// of the four newer DD domains (재무·인사·시장·자금조달 계획) into THIS project's
// S9 completion count and the dd gate (2026-10-19 decider-approved; mirrors the
// greenfield hr exception). Analyst+ only, rationale mandatory (10자+), audited.
// POST adopts; DELETE reverts to grandfathered reference-only. Agents can never
// set this (boundary #2 — a gate-rule change is a person's recorded decision).
import { getDb } from "../../../../../../../db/client.ts";
import { authenticate } from "../../../../../lib/auth.ts";
import { visibleProject } from "../../../../../lib/project-visibility.ts";
import { badRequest, fail, forbidden, notFound, ok } from "../../../../../lib/envelope.ts";
import { ddDomainAdoption, writeDdDomainAdoption } from "../../../../../lib/dd-checklist-tailor.ts";
import { appendAudit } from "../../../../../../../db/lib/access-control.ts";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (!visibleProject(auth.auth, (await params).id)) return notFound();
  return ok({ adoption: ddDomainAdoption((await params).id) }, 200);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "추가 실사 도메인 반영은 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const body = (await request.json().catch(() => null)) as { rationale?: unknown; adopt?: unknown } | null;
  const rationale = typeof body?.rationale === "string" ? body.rationale.trim() : "";
  if (rationale.length < 10) return badRequest("invalid_request", "근거는 10자 이상 입력하세요.");
  const adopt = body?.adopt !== false;
  const db = getDb();
  const now = new Date().toISOString();
  writeDdDomainAdoption(db, id, { adopted: adopt, rationale, by: auth.auth.userId, at: now });
  appendAudit(db, {
    actor: auth.auth.userId,
    action: adopt ? "dd_domain.adopted" : "dd_domain.reverted",
    target: `${id}:${rationale.slice(0, 80)}`,
    now,
  });
  return ok({ adoption: ddDomainAdoption(id) }, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  if (auth.auth.role === "viewer") return forbidden("role_required", "되돌리기는 analyst 역할 이상이어야 합니다.");
  const { id } = await params;
  if (!visibleProject(auth.auth, id)) return notFound();
  const db = getDb();
  writeDdDomainAdoption(db, id, { adopted: false, rationale: "", by: auth.auth.userId, at: new Date().toISOString() });
  appendAudit(db, { actor: auth.auth.userId, action: "dd_domain.reverted", target: id, now: new Date().toISOString() });
  return ok({ adoption: ddDomainAdoption(id) }, 200);
}
