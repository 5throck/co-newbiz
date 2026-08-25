// Port of app/server/governance.ts GET/POST /api/interpretations
import { getDb } from "../../../../../db/client.ts";
import { appendAudit } from "../../../../../db/lib/access-control.ts";
import { recordInterpretation, searchInterpretations } from "../../../../../db/lib/compliance.ts";
import { authenticate } from "../../../lib/auth.ts";
import { badRequest, fail, forbidden, ok } from "../../../lib/envelope.ts";

export async function GET(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const rows = searchInterpretations(getDb(), {
    governanceDocId: url.searchParams.get("doc") || undefined,
    clauseRef: url.searchParams.get("clause") || undefined,
    text: url.searchParams.get("q") || undefined,
  });
  return ok(rows);
}

export async function POST(request: Request) {
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const ctx = auth.auth;
  if (ctx.role !== "admin") {
    return forbidden("admin_required", "Interpretations are recorded by the governance administrator.");
  }
  const body = (await request.json().catch(() => null)) as
    | { governance_doc_id?: string; clause_ref?: string; question?: string; answer?: string; supersedes?: string; published?: boolean }
    | null;
  if (!body?.governance_doc_id || !body?.clause_ref?.trim() || !body?.question?.trim() || !body?.answer?.trim()) {
    return badRequest("invalid_request", "governance_doc_id, clause_ref, question and answer are required.");
  }
  try {
    const id = recordInterpretation(getDb(), {
      governanceDocId: body.governance_doc_id,
      clauseRef: body.clause_ref.trim(),
      question: body.question.trim(),
      answer: body.answer.trim(),
      askedBy: ctx.userId,
      answeredBy: ctx.userId,
      answeredAt: new Date().toISOString(),
      supersedes: body.supersedes ?? null,
      published: body.published ?? true,
    });
    appendAudit(getDb(), { actor: ctx.userId, action: "interpretation_record", target: id, now: new Date().toISOString() });
    return ok({ id }, 201);
  } catch (err) {
    return fail(409, "interpretation_conflict", err instanceof Error ? err.message : "Interpretation rejected.");
  }
}
